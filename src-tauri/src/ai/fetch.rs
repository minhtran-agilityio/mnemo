// Reads a web page for "save a link" (#25). The Rust core fetches the page and keeps only its
// text; Claude gets that text and no tools (owner decision 1).
//
// The page is untrusted, and so is the link. The reader:
// - follows at most 5 redirects by hand, and checks every hop again;
// - fetches http and https only, and refuses a link with a user name or password;
// - refuses localhost and every private, local or reserved address (IPv4 and IPv6, also an
//   IPv4 address inside IPv6). A host name is resolved once, every address is checked, and the
//   connection is pinned to those checked addresses, so a second DNS answer cannot point
//   somewhere else. No proxy and no cookies;
// - stops after 15 seconds in total (DNS, every hop, the body read and the HTML parse), reads
//   at most 2 MB of body (and uses what it read);
// - reads only text/html and text/plain;
// - calls a page with under 200 characters of text unreadable, and gives Claude at most
//   20 000 characters.
// Every failure means "link only": the caller stores no summary and invents nothing. Errors are
// sorted by the phase they happen in (`FetchError::is_not_reached`): a failure to reach the site
// or to get the body in time is "not reached" (owner ruling on #25, "All network failures"); a
// problem with the link or the content is "unreadable".

use std::fmt;
use std::io::{self, Read};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use html5ever::tendril::StrTendril;
use html5ever::tokenizer::states::RawKind;
use html5ever::tokenizer::{
    BufferQueue, Tag, TagKind, Token, TokenSink, TokenSinkResult, Tokenizer, TokenizerOpts,
};
use reqwest::blocking::Client;
use reqwest::header::{CONTENT_TYPE, LOCATION};
use reqwest::redirect::Policy;
use reqwest::Url;
use std::cell::{Cell, RefCell};

use super::limits;
use crate::storage::items::MAX_TITLE_CHARS;

/// The limits of one page read. All tunable values of the reader live here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchLimits {
    /// The whole read, every redirect included.
    pub timeout: Duration,
    /// Most redirects followed.
    pub max_redirects: usize,
    /// Most body bytes read. A longer page is read up to here and the rest is left.
    pub max_body_bytes: u64,
    /// Most characters of text given to Claude.
    pub max_text_chars: usize,
    /// Less text than this means the page could not be read.
    pub min_text_chars: usize,
    /// Most attributes on one tag. A page with a bigger tag is too complex to read.
    pub max_tag_attributes: usize,
    /// The least time left for the HTML walk once the body is in (else: not reached).
    pub parse_budget: Duration,
    /// Tests only: lets the reader reach a loopback test server. Every other address is still
    /// checked. A release build has no such switch.
    #[cfg(test)]
    allow_loopback: bool,
    /// Tests only: a host name and the address it resolves to, instead of DNS.
    #[cfg(test)]
    fake_dns: Option<(String, IpAddr)>,
}

/// The owner-confirmed limits (decision 5), from `ai::limits`.
pub const DEFAULT_LIMITS: FetchLimits = FetchLimits {
    timeout: limits::FETCH_TIMEOUT,
    max_redirects: limits::MAX_REDIRECTS,
    max_body_bytes: limits::MAX_BODY_BYTES,
    max_text_chars: limits::MAX_TEXT_CHARS,
    min_text_chars: limits::MIN_TEXT_CHARS,
    max_tag_attributes: limits::MAX_TAG_ATTRIBUTES,
    parse_budget: limits::PARSE_BUDGET,
    #[cfg(test)]
    allow_loopback: false,
    #[cfg(test)]
    fake_dns: None,
};

/// The text of a page that could be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageText {
    /// The `<title>` of an HTML page, at most 500 characters. `None` when it has none.
    pub title: Option<String>,
    /// The visible text, at most `max_text_chars` characters.
    pub text: String,
    /// True when the text was cut to `max_text_chars`.
    pub cut: bool,
}

/// Why a page could not be read. Every case means "link only". `is_not_reached` sorts them: the
/// site was not reached (the owner can ask for a new read), or the page itself cannot be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FetchError {
    /// Not an http or https link.
    NotWebLink,
    /// The link points at this computer or a private or reserved network, or carries a user
    /// name or password.
    Refused,
    /// More than `max_redirects` redirects.
    TooManyRedirects,
    /// The server answered with this status (not a success, not a redirect).
    Status(u16),
    /// The page is not text/html or text/plain.
    NotText,
    /// The page has under `min_text_chars` characters of text.
    TooLittleText,
    /// A tag has more than `max_tag_attributes` attributes: the page is not read.
    TooComplex,
    /// The whole page was read, but making its text passed the deadline: too big to read.
    TooSlow,
    /// The site was not reached: DNS, the connection, TLS, the request or the body read failed,
    /// or the deadline passed before the body was in. The text is one word for the log only.
    NotReached(&'static str),
    /// The reader itself failed (a helper thread panicked). Logged at error level.
    ReaderFailed,
}

impl fmt::Display for FetchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FetchError::NotWebLink => write!(f, "not an http or https link"),
            FetchError::Refused => write!(f, "a local, private or reserved address"),
            FetchError::TooManyRedirects => write!(f, "too many redirects"),
            FetchError::Status(code) => write!(f, "the server answered {code}"),
            FetchError::NotText => write!(f, "not an HTML or text page"),
            FetchError::TooLittleText => write!(f, "too little text on the page"),
            FetchError::TooComplex => write!(f, "the page is too complex to read"),
            FetchError::TooSlow => write!(f, "the page is too big to read in time"),
            FetchError::NotReached(what) => write!(f, "the site could not be reached ({what})"),
            FetchError::ReaderFailed => write!(f, "the page reader failed"),
        }
    }
}

impl std::error::Error for FetchError {}

impl FetchError {
    /// True when the site was not reached (owner ruling on #25, "All network failures"): any
    /// network failure, and HTTP 408, 429 and 5xx. The owner can read it again or paste the
    /// text. False for a lasting answer about the page or the link: "Paste the text" only.
    pub fn is_not_reached(&self) -> bool {
        match self {
            FetchError::NotReached(_) => true,
            FetchError::Status(code) => matches!(*code, 408 | 429 | 500..=599),
            FetchError::NotWebLink
            | FetchError::Refused
            | FetchError::TooManyRedirects
            | FetchError::NotText
            | FetchError::TooLittleText
            | FetchError::TooComplex
            | FetchError::TooSlow
            | FetchError::ReaderFailed => false,
        }
    }
}

/// Reads the text of a page. The app uses `HttpReader`; tests pass a fake.
pub trait PageReader: Send + Sync {
    fn read(&self, url: &str) -> Result<PageText, FetchError>;
}

/// The real reader: blocking HTTP with the limits above. Call it off the main thread.
pub struct HttpReader {
    limits: FetchLimits,
}

impl HttpReader {
    pub fn new(limits: FetchLimits) -> Self {
        HttpReader { limits }
    }
}

impl Default for HttpReader {
    fn default() -> Self {
        HttpReader::new(DEFAULT_LIMITS)
    }
}

impl PageReader for HttpReader {
    fn read(&self, url: &str) -> Result<PageText, FetchError> {
        let deadline = Instant::now() + self.limits.timeout;
        let mut url = Url::parse(url.trim()).map_err(|_| FetchError::NotWebLink)?;
        let mut redirects = 0;
        loop {
            let hop = self.hop(&url, deadline)?;
            match hop {
                Hop::Redirect(next) => {
                    redirects += 1;
                    if redirects > self.limits.max_redirects {
                        return Err(FetchError::TooManyRedirects);
                    }
                    url = next;
                }
                Hop::Page { body, content_type } => {
                    return text_within(body, content_type, &self.limits, deadline);
                }
            }
        }
    }
}

enum Hop {
    Redirect(Url),
    /// The answer, its body not read yet: `text_within` reads it within the deadline.
    Page {
        body: reqwest::blocking::Response,
        content_type: String,
    },
}

impl HttpReader {
    /// One request: check the link, pin its checked addresses, and read the answer.
    fn hop(&self, url: &Url, deadline: Instant) -> Result<Hop, FetchError> {
        let target = self.checked_target(url, deadline)?;
        let left = remaining(deadline)?;
        // Every name is answered from the pinned, checked addresses only: a name that is not
        // pinned gets no address at all, so the guard fails closed.
        let mut builder = Client::builder()
            .dns_resolver(std::sync::Arc::new(NoDns))
            .redirect(Policy::none())
            .no_proxy()
            .timeout(left)
            .connect_timeout(left)
            .user_agent(concat!(
                "Mnemo/",
                env!("CARGO_PKG_VERSION"),
                " (link reader)"
            ));
        if let Target::Name { host, addrs } = &target {
            builder = builder.resolve_to_addrs(host, addrs);
        }
        let client = builder.build().map_err(|e| {
            log::error!("the page reader could not start its HTTP client: {e}");
            FetchError::NotReached("client")
        })?;
        let response = client
            .get(url.clone())
            .header(reqwest::header::ACCEPT, "text/html, text/plain;q=0.9")
            .send()
            .map_err(request_failed)?;
        let status = response.status();
        if status.is_redirection() {
            let next = response
                .headers()
                .get(LOCATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|l| url.join(l).ok())
                .ok_or(FetchError::Status(status.as_u16()))?;
            return Ok(Hop::Redirect(next));
        }
        if !status.is_success() {
            return Err(FetchError::Status(status.as_u16()));
        }
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        if text_kind(&content_type).is_none() {
            return Err(FetchError::NotText);
        }
        Ok(Hop::Page {
            body: response,
            content_type,
        })
    }

    /// The addresses this link may reach, or why it is refused. A literal IP is checked as it
    /// is; a host name is resolved (within the time left) and all its addresses are checked.
    fn checked_target(&self, url: &Url, deadline: Instant) -> Result<Target, FetchError> {
        if !matches!(url.scheme(), "http" | "https") {
            return Err(FetchError::NotWebLink);
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err(FetchError::Refused);
        }
        let port = url.port_or_known_default().ok_or(FetchError::NotWebLink)?;
        let ip_target = |ip: IpAddr| {
            if self.allowed(ip) {
                Ok(Target::Ip)
            } else {
                Err(FetchError::Refused)
            }
        };
        match url.host() {
            None => Err(FetchError::NotWebLink),
            Some(url::Host::Ipv4(ip)) => ip_target(IpAddr::V4(ip)),
            Some(url::Host::Ipv6(ip)) => ip_target(IpAddr::V6(ip)),
            Some(url::Host::Domain(name)) => {
                let host = name.trim_end_matches('.').to_ascii_lowercase();
                if host.is_empty() || host == "localhost" || host.ends_with(".localhost") {
                    return Err(FetchError::Refused);
                }
                let addrs = self.resolve(name, port, deadline)?;
                if addrs.is_empty() {
                    return Err(FetchError::NotReached("dns"));
                }
                if !addrs.iter().all(|a| self.allowed(a.ip())) {
                    return Err(FetchError::Refused);
                }
                Ok(Target::Name {
                    host: name.to_string(),
                    addrs,
                })
            }
        }
    }

    fn allowed(&self, ip: IpAddr) -> bool {
        #[cfg(test)]
        if self.limits.allow_loopback && ip.is_loopback() {
            return true;
        }
        is_public(ip)
    }

    /// Resolves `host` on a helper thread so a slow DNS answer cannot pass the deadline.
    fn resolve(
        &self,
        host: &str,
        port: u16,
        deadline: Instant,
    ) -> Result<Vec<SocketAddr>, FetchError> {
        #[cfg(test)]
        if let Some((name, ip)) = &self.limits.fake_dns {
            return if name == host {
                Ok(vec![SocketAddr::new(*ip, port)])
            } else {
                Err(FetchError::NotReached("dns"))
            };
        }
        let left = remaining(deadline)?;
        let (tx, rx) = mpsc::channel();
        let query = (host.to_string(), port);
        std::thread::spawn(move || {
            let _ = tx.send(query.to_socket_addrs().map(|a| a.collect::<Vec<_>>()));
        });
        match rx.recv_timeout(left) {
            Ok(Ok(addrs)) => Ok(addrs),
            // No such name, no answer from DNS, or the lookup thread gone: not reached.
            Ok(Err(_)) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                Err(FetchError::NotReached("dns"))
            }
            Err(mpsc::RecvTimeoutError::Timeout) => Err(FetchError::NotReached("dns timeout")),
        }
    }
}

/// A resolver that answers no name. The client gets addresses only from `resolve_to_addrs`.
struct NoDns;

impl reqwest::dns::Resolve for NoDns {
    fn resolve(&self, _name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        Box::pin(std::future::ready(Err(
            "Mnemo resolves names itself; this name was not checked".into(),
        )))
    }
}

/// Where a request may connect: a literal IP (checked) or a name pinned to checked addresses.
enum Target {
    Ip,
    Name {
        host: String,
        addrs: Vec<SocketAddr>,
    },
}

/// The time left before the body is in. Past the deadline the site was not reached in time.
fn remaining(deadline: Instant) -> Result<Duration, FetchError> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|d| !d.is_zero())
        .ok_or(FetchError::NotReached("timeout"))
}

/// The time left to make the text of a page that is all in. Past the deadline the page is too
/// big to read (`TooSlow`): a lasting answer about the page.
fn parse_time(deadline: Instant) -> Result<Duration, FetchError> {
    remaining(deadline).map_err(|_| FetchError::TooSlow)
}

/// A request that got no answer: refused, TLS, no route, reset, timeout or a broken answer. All
/// of them mean the site was not reached. The error is logged without the link.
fn request_failed(e: reqwest::Error) -> FetchError {
    let builder = e.is_builder();
    log::info!("the page request failed: {}", e.without_url());
    if builder {
        // A link reqwest cannot request at all: a new read can never pass (decision 35).
        return FetchError::NotWebLink;
    }
    FetchError::NotReached("request")
}

/// The body read failed. reqwest's blocking body gives most errors as `ErrorKind::Other`, so the
/// kind says nothing: any failure while the bytes come in means the site was not reached.
fn read_failed(e: &io::Error) -> FetchError {
    log::info!("the page body could not be read: {:?}", e.kind());
    FetchError::NotReached("body")
}

/// Runs `work` on a helper thread and waits at most until `deadline`. A panic in `work` is
/// caught and logged (`ReaderFailed`); a wait past the deadline gives `late`.
fn on_helper<T: Send + 'static>(
    deadline: Instant,
    late: FetchError,
    work: impl FnOnce() -> Result<T, FetchError> + Send + 'static,
) -> Result<T, FetchError> {
    let left = deadline
        .checked_duration_since(Instant::now())
        .filter(|d| !d.is_zero())
        .ok_or_else(|| late.clone())?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(work)).unwrap_or_else(|_| {
                log::error!("the page reader failed: a helper thread panicked");
                Err(FetchError::ReaderFailed)
            });
        let _ = tx.send(result);
    });
    match rx.recv_timeout(left) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => Err(late),
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            log::error!("the page reader failed: a helper thread ended with no answer");
            Err(FetchError::ReaderFailed)
        }
    }
}

/// Reads the body (at most `max_body_bytes`) and makes its text, each on a helper thread and
/// given only the time left, so the phase is known when the deadline passes. The reqwest
/// blocking client times each read on its own, so a server that sends one byte at a time could
/// outlast the deadline: the read loop stops at the deadline, and the caller stops waiting then
/// too (not reached). The HTML walk checks the same deadline between small chunks (too slow).
/// Either way the bookmark keeps the link only.
fn text_within<R: Read + Send + 'static>(
    body: R,
    content_type: String,
    limits: &FetchLimits,
    deadline: Instant,
) -> Result<PageText, FetchError> {
    let cap = limits.max_body_bytes;
    let bytes = on_helper(
        deadline,
        FetchError::NotReached("body timeout"),
        move || read_until(body, cap, deadline),
    )?;
    // The body came in too late to make its text: the site was slow, not the page too big
    // (decision 34).
    let left = deadline.saturating_duration_since(Instant::now());
    if left < limits.parse_budget {
        return Err(FetchError::NotReached("body timeout"));
    }
    let limits = limits.clone();
    on_helper(deadline, FetchError::TooSlow, move || {
        page_text_until(&bytes, &content_type, &limits, deadline)
    })
}

/// Reads at most `cap` bytes in chunks and gives up once `deadline` has passed.
fn read_until<R: Read>(body: R, cap: u64, deadline: Instant) -> Result<Vec<u8>, FetchError> {
    let mut reader = body.take(cap);
    let mut out = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    loop {
        remaining(deadline).map_err(|_| FetchError::NotReached("body timeout"))?;
        match reader.read(&mut chunk) {
            Ok(0) => return Ok(out),
            Ok(n) => out.extend_from_slice(&chunk[..n]),
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) => return Err(read_failed(&e)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TextKind {
    Html,
    Plain,
}

/// The kind of a Content-Type value, or `None` when it is not text/html or text/plain.
fn text_kind(content_type: &str) -> Option<TextKind> {
    let essence = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match essence.as_str() {
        "text/html" => Some(TextKind::Html),
        "text/plain" => Some(TextKind::Plain),
        _ => None,
    }
}

/// The charset parameter of a Content-Type value, when there is one.
fn charset(content_type: &str) -> Option<&'static encoding_rs::Encoding> {
    content_type.split(';').skip(1).find_map(|p| {
        let (k, v) = p.split_once('=')?;
        if k.trim().eq_ignore_ascii_case("charset") {
            encoding_rs::Encoding::for_label(v.trim().trim_matches('"').as_bytes())
        } else {
            None
        }
    })
}

/// The charset named by a `<meta charset>` or `<meta http-equiv="Content-Type">` tag near the
/// start of an HTML page, found as the HTML standard's prescan finds it: comments, scripts and
/// styles are skipped (a meta tag inside one does not count) and the first meta tag that names a known charset
/// wins. The search stops after `CHARSET_PRESCAN_BYTES` bytes (larger than the standard's 1024,
/// so a long comment or script first still leaves the tag in reach). A UTF-16 label means UTF-8
/// (the bytes were read as ASCII to find it). A byte order mark still wins when decoding.
fn meta_charset(body: &[u8]) -> Option<&'static encoding_rs::Encoding> {
    let head = &body[..body.len().min(limits::CHARSET_PRESCAN_BYTES)];
    let lower = head.to_ascii_lowercase();
    let mut at = 0;
    while let Some(lt) = find(&lower[at..], b"<").map(|i| at + i) {
        let rest = &lower[lt..];
        if rest.starts_with(b"<!--") {
            match find(&rest[4..], b"-->") {
                Some(end) => at = lt + 4 + end + 3,
                None => return None,
            }
            continue;
        }
        // Script and style content is not markup: a meta tag inside it does not count.
        if let Some(close) = raw_end_tag(rest) {
            match find(&rest[1..], close) {
                Some(end) => at = lt + 1 + end + close.len(),
                None => return None,
            }
            continue;
        }
        // No `>` after this `<`: no tag can end, so no meta tag follows.
        let end = lt + find(rest, b">")?;
        if rest.starts_with(b"<meta") && rest.get(5).is_some_and(|c| !c.is_ascii_alphanumeric()) {
            let tag = &lower[lt..end];
            if let Some(enc) = find(tag, b"charset")
                .and_then(|i| charset_value(&head[lt + i + 7..end]))
                .and_then(encoding_rs::Encoding::for_label)
            {
                return Some(
                    if enc == encoding_rs::UTF_16LE || enc == encoding_rs::UTF_16BE {
                        encoding_rs::UTF_8
                    } else {
                        enc
                    },
                );
            }
        }
        at = end + 1;
    }
    None
}

/// The value after `charset` in a meta tag: `= "x"`, `='x'` or `=x`, up to a quote, space,
/// `;`, `/` or the end.
fn charset_value(rest: &[u8]) -> Option<&[u8]> {
    let skip_space =
        |b: &[u8]| -> usize { b.iter().take_while(|c| c.is_ascii_whitespace()).count() };
    let rest = rest[skip_space(rest)..].strip_prefix(b"=")?;
    let rest = &rest[skip_space(rest)..];
    let rest = rest
        .strip_prefix(b"\"")
        .or_else(|| rest.strip_prefix(b"'"))
        .unwrap_or(rest);
    let len = rest
        .iter()
        .position(|&c| c == b'"' || c == b'\'' || c == b';' || c == b'/' || c.is_ascii_whitespace())
        .unwrap_or(rest.len());
    (len > 0).then(|| &rest[..len])
}

/// The end tag to skip to when `rest` (lower case) starts a `<script>` or `<style>` element.
fn raw_end_tag(rest: &[u8]) -> Option<&'static [u8]> {
    let ends_name = |at: usize| rest.get(at).is_some_and(|c| !c.is_ascii_alphanumeric());
    if rest.starts_with(b"<script") && ends_name(7) {
        Some(b"</script")
    } else if rest.starts_with(b"<style") && ends_name(6) {
        Some(b"</style")
    } else {
        None
    }
}

/// Where `needle` first starts in `hay`.
fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// `page_text_until` with the whole read time as its deadline. Tests use it; the reader calls
/// `page_text_until` with the deadline of the read.
#[cfg(test)]
fn page_text(
    body: &[u8],
    content_type: &str,
    limits: &FetchLimits,
) -> Result<PageText, FetchError> {
    page_text_until(body, content_type, limits, Instant::now() + limits.timeout)
}

/// The text of a page body: decoded, the visible text kept, checked and cut to the limits. It
/// stops with `Timeout` once `deadline` has passed.
fn page_text_until(
    body: &[u8],
    content_type: &str,
    limits: &FetchLimits,
    deadline: Instant,
) -> Result<PageText, FetchError> {
    let kind = text_kind(content_type).ok_or(FetchError::NotText)?;
    let encoding = charset(content_type)
        .or_else(|| {
            (kind == TextKind::Html)
                .then(|| meta_charset(body))
                .flatten()
        })
        .unwrap_or(encoding_rs::UTF_8);
    let (decoded, _, _) = encoding.decode(body);
    let (title, text) = match kind {
        TextKind::Html => {
            if too_many_attributes(&decoded, limits.max_tag_attributes) {
                return Err(FetchError::TooComplex);
            }
            html_text(&decoded, deadline)?
        }
        TextKind::Plain => (None, tidy(&decoded)),
    };
    if text.chars().count() < limits.min_text_chars {
        return Err(FetchError::TooLittleText);
    }
    let (text, cut) = cut_chars(&text, limits.max_text_chars);
    let title = title
        .map(|t| cut_chars(&t, MAX_TITLE_CHARS).0)
        .filter(|t| !t.is_empty());
    Ok(PageText { title, text, cut })
}

/// At most `max` characters of `text`, and whether it was cut.
pub fn cut_chars(text: &str, max: usize) -> (String, bool) {
    match text.char_indices().nth(max) {
        Some((at, _)) => (text[..at].to_string(), true),
        None => (text.to_string(), false),
    }
}

/// True when some tag seems to carry more than `max` attributes. One forward pass over the
/// bytes: inside a tag it counts the attribute names and jumps over quoted values. It only reads
/// what looks like tags, so text that merely looks like a huge tag can make a page "too complex"
/// (link only); it never changes what the tokenizer reads.
fn too_many_attributes(html: &str, max: usize) -> bool {
    let b = html.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'<' || !b.get(i + 1).is_some_and(u8::is_ascii_alphabetic) {
            i += 1;
            continue;
        }
        // Skip the tag name.
        i += 1;
        while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'>' && b[i] != b'/' {
            i += 1;
        }
        let mut count = 0usize;
        let mut in_name = false;
        while i < b.len() && b[i] != b'>' {
            let c = b[i];
            if c == b'=' {
                in_name = false;
                i += 1;
                while i < b.len() && b[i].is_ascii_whitespace() {
                    i += 1;
                }
                if let Some(&q) = b.get(i).filter(|&&q| q == b'"' || q == b'\'') {
                    // A quoted value: jump to its closing quote.
                    match b[i + 1..].iter().position(|&x| x == q) {
                        Some(at) => i += at + 2,
                        None => return false,
                    }
                } else {
                    while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'>' {
                        i += 1;
                    }
                }
                continue;
            }
            if c.is_ascii_whitespace() || c == b'/' {
                in_name = false;
            } else if !in_name {
                in_name = true;
                count += 1;
                if count > max {
                    return true;
                }
            }
            i += 1;
        }
    }
    false
}

/// Elements whose content is not page text: the site's own navigation and furniture. A `<main>`
/// or `<article>` start ends any of them left open, so an unclosed `<nav>` cannot hide the page.
/// `<form>` is not here: some sites wrap the whole page in one form (ASP.NET WebForms).
const SKIP: [&str; 8] = [
    "nav", "header", "footer", "aside", "svg", "template", "select", "button",
];

/// The start tags that may stand in `<head>`. Any other start tag ends the head, as in a
/// browser, because `</head>` and `<body>` are both optional.
const IN_HEAD: [&str; 12] = [
    "html", "head", "title", "meta", "link", "base", "basefont", "bgsound", "style", "script",
    "noscript", "template",
];

/// Raw-text elements: their content is not markup and not page text (title aside). The tree
/// builder normally switches the tokenizer into these states; this walk has no tree builder.
fn raw_kind(name: &str) -> Option<RawKind> {
    match name {
        "script" => Some(RawKind::ScriptData),
        "style" | "noscript" | "iframe" | "xmp" | "noembed" | "noframes" => Some(RawKind::Rawtext),
        "title" | "textarea" => Some(RawKind::Rcdata),
        _ => None,
    }
}

/// Elements that start a new line of text.
const BLOCK: [&str; 21] = [
    "p",
    "div",
    "br",
    "li",
    "ul",
    "ol",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "tr",
    "table",
    "section",
    "article",
    "main",
    "pre",
    "blockquote",
    "dt",
    "dd",
];

/// Collects the title and the visible text from the tokens, in one forward pass with no tree:
/// every token costs the same however the page nests, so the walk is linear in the page size.
#[derive(Default)]
struct TextSink {
    text: RefCell<String>,
    title: RefCell<String>,
    /// The raw-text element the tokenizer is inside (its content is skipped).
    raw: RefCell<Option<String>>,
    /// True inside the first `<title>`.
    in_title: Cell<bool>,
    title_done: Cell<bool>,
    /// True inside `<head>` (ended by `</head>`, `<body>`, any start tag that cannot be in the
    /// head, or text).
    in_head: Cell<bool>,
    /// How many `SKIP` elements are open.
    skip: Cell<usize>,
    /// How many `<main>` and `<article>` elements are open. A `<header>` inside one holds the
    /// heading of the content, so it is not skipped.
    content: Cell<usize>,
    /// How many open `<header>` elements were not counted in `skip` (inside content).
    kept_headers: Cell<usize>,
}

impl TextSink {
    fn shown(&self) -> bool {
        self.skip.get() == 0 && !self.in_head.get() && self.raw.borrow().is_none()
    }

    fn tag(&self, tag: &Tag) -> TokenSinkResult<()> {
        let name: &str = &tag.name;
        match tag.kind {
            TagKind::StartTag => {
                match name {
                    "head" => self.in_head.set(true),
                    "main" | "article" => {
                        self.skip.set(0);
                        self.content.set(self.content.get().saturating_add(1));
                    }
                    _ => {}
                }
                if !IN_HEAD.contains(&name) {
                    self.in_head.set(false);
                }
                if name == "header" && self.content.get() > 0 && !tag.self_closing {
                    self.kept_headers
                        .set(self.kept_headers.get().saturating_add(1));
                } else if SKIP.contains(&name) && !tag.self_closing {
                    self.skip.set(self.skip.get().saturating_add(1));
                }
                if self.shown() && BLOCK.contains(&name) {
                    self.text.borrow_mut().push('\n');
                }
                if name == "plaintext" {
                    // Everything after <plaintext> is text, as in a browser.
                    return TokenSinkResult::Plaintext;
                }
                if let Some(kind) = raw_kind(name) {
                    // Like a browser, a self-closing raw-text tag still starts raw text.
                    if name == "title" && !self.title_done.get() && self.skip.get() == 0 {
                        self.in_title.set(true);
                    }
                    *self.raw.borrow_mut() = Some(name.to_string());
                    return TokenSinkResult::RawData(kind);
                }
            }
            TagKind::EndTag => {
                let closes_raw = self.raw.borrow().as_deref() == Some(name);
                if closes_raw {
                    *self.raw.borrow_mut() = None;
                    if name == "title" && self.in_title.get() {
                        self.in_title.set(false);
                        self.title_done.set(true);
                    }
                }
                if name == "head" {
                    self.in_head.set(false);
                }
                if name == "main" || name == "article" {
                    self.content.set(self.content.get().saturating_sub(1));
                    if self.content.get() == 0 {
                        // A <header> left open inside the content ends with it.
                        self.kept_headers.set(0);
                    }
                }
                if name == "header" && self.kept_headers.get() > 0 {
                    self.kept_headers.set(self.kept_headers.get() - 1);
                } else if SKIP.contains(&name) {
                    self.skip.set(self.skip.get().saturating_sub(1));
                }
                if self.shown() && BLOCK.contains(&name) {
                    self.text.borrow_mut().push('\n');
                }
            }
        }
        TokenSinkResult::Continue
    }
}

impl TokenSink for TextSink {
    type Handle = ();

    fn process_token(&self, token: Token, _line: u64) -> TokenSinkResult<()> {
        match token {
            Token::TagToken(tag) => self.tag(&tag),
            Token::CharacterTokens(t) => {
                if self.in_title.get() {
                    let mut title = self.title.borrow_mut();
                    if title.len() < limits::TITLE_BUFFER_BYTES {
                        title.push_str(&t);
                    }
                } else {
                    // Text outside a raw-text element ends the head, as in a browser.
                    if self.in_head.get() && self.raw.borrow().is_none() && !t.trim().is_empty() {
                        self.in_head.set(false);
                    }
                    if self.shown() {
                        self.text.borrow_mut().push_str(&t);
                    }
                }
                TokenSinkResult::Continue
            }
            _ => TokenSinkResult::Continue,
        }
    }
}

/// The `<title>` and the visible text of an HTML document, by html5ever's tokenizer alone (owner
/// decision, #25 review). The input goes in small chunks with a deadline check between them.
fn html_text(source: &str, deadline: Instant) -> Result<(Option<String>, String), FetchError> {
    let tokenizer = Tokenizer::new(TextSink::default(), TokenizerOpts::default());
    let input = BufferQueue::default();
    let mut rest = source;
    while !rest.is_empty() {
        parse_time(deadline)?;
        let mut cut = rest.len().min(limits::HTML_CHUNK_BYTES);
        while !rest.is_char_boundary(cut) {
            cut += 1;
        }
        input.push_back(StrTendril::from_slice(&rest[..cut]));
        rest = &rest[cut..];
        // The sink never asks to run a script, so a feed only ends when the chunk is used up.
        let _ = tokenizer.feed(&input);
    }
    parse_time(deadline)?;
    tokenizer.end();
    let sink = &tokenizer.sink;
    let title = Some(tidy(&sink.title.borrow())).filter(|t| !t.is_empty());
    let text = tidy(&sink.text.borrow());
    Ok((title, text))
}

/// Spaces collapsed inside each line, blank lines dropped, ends trimmed.
fn tidy(text: &str) -> String {
    text.lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// True for an address on the public internet. Loopback, private, link-local, shared (CGNAT),
/// unspecified, broadcast, multicast, documentation, benchmarking and reserved ranges are not,
/// and an IPv4 address carried inside IPv6 is checked as IPv4.
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => is_public_v6(v6),
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0 // 0.0.0.0/8 "this network"
        || ip.is_loopback() // 127/8
        || ip.is_private() // 10/8, 172.16/12, 192.168/16
        || ip.is_link_local() // 169.254/16
        || (a == 100 && (64..=127).contains(&b)) // 100.64/10 shared (CGNAT)
        || (a == 192 && b == 0 && c == 0) // 192.0.0/24 protocol assignments
        || ip.is_documentation() // 192.0.2/24, 198.51.100/24, 203.0.113/24
        || (a == 198 && (18..=19).contains(&b)) // 198.18/15 benchmarking
        || ip.is_multicast() // 224/4
        || a >= 240) // 240/4 reserved and 255.255.255.255
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    let s = ip.segments();
    let v4_at =
        |hi: u16, lo: u16| Ipv4Addr::new((hi >> 8) as u8, hi as u8, (lo >> 8) as u8, lo as u8);
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_public_v4(v4); // ::ffff:a.b.c.d
    }
    if s[..6] == [0; 6] {
        // ::, ::1 and the old IPv4-compatible ::a.b.c.d
        return !ip.is_unspecified() && !ip.is_loopback() && is_public_v4(v4_at(s[6], s[7]));
    }
    if s[0] == 0x64 && s[1] == 0xff9b && s[2..6] == [0; 4] {
        return is_public_v4(v4_at(s[6], s[7])); // 64:ff9b::/96 NAT64
    }
    if s[0] == 0 && s[1] == 0 && s[2] == 0 && s[3] == 0 && s[4] == 0xffff && s[5] == 0 {
        return is_public_v4(v4_at(s[6], s[7])); // ::ffff:0:a.b.c.d IPv4-translated
    }
    if s[0] == 0x2002 {
        return is_public_v4(v4_at(s[1], s[2])); // 2002::/16 6to4
    }
    !((s[0] & 0xfe00) == 0xfc00 // fc00::/7 unique local
        || (s[0] & 0xffc0) == 0xfe80 // fe80::/10 link-local
        || (s[0] & 0xffc0) == 0xfec0 // fec0::/10 old site-local
        || (s[0] & 0xff00) == 0xff00 // ff00::/8 multicast
        || (s[0] == 0x2001 && s[1] == 0x0db8) // 2001:db8::/32 documentation
        || (s[0] == 0x2001 && s[1] == 0) // 2001::/32 Teredo
        || (s[0] == 0x2001 && (s[1] & 0xfff0) == 0x0020) // 2001:20::/28 ORCHIDv2
        || (s[0] == 0x0064 && s[1] == 0xff9b && s[2] == 0x0001) // 64:ff9b:1::/48 local NAT64
        || (s[0] & 0xfff0) == 0x3ff0 // 3fff::/20 documentation
        || (s[0] & 0xe000) != 0x2000) // outside 2000::/3 (global unicast), e.g. 100::/64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;

    /// A test server on 127.0.0.1. `answer(path)` gives the raw HTTP response for each request;
    /// it serves `count` requests, then stops.
    fn serve(count: usize, answer: impl Fn(&str) -> Vec<u8> + Send + 'static) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(count) {
                let Ok(mut stream) = stream else { continue };
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let head = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = head.split_whitespace().nth(1).unwrap_or("/").to_string();
                let _ = stream.write_all(&answer(&path));
            }
        });
        port
    }

    fn response(status: &str, content_type: &str, body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .into_bytes()
    }

    fn redirect(to: &str) -> Vec<u8> {
        format!("HTTP/1.1 302 Found\r\nLocation: {to}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .into_bytes()
    }

    fn long_text() -> String {
        "Rust ownership means every value has one owner at a time. ".repeat(10)
    }

    fn page(title: &str, body: &str) -> String {
        format!("<html><head><title>{title}</title><style>p{{color:red}}</style></head><body><nav>Home | About</nav><script>var x = 1;</script><p>{body}</p><footer>Copyright</footer></body></html>")
    }

    // The default limits never let the reader reach loopback (checked when the tests build).
    const _: () = assert!(!DEFAULT_LIMITS.allow_loopback);

    fn local_limits() -> FetchLimits {
        FetchLimits {
            allow_loopback: true,
            timeout: Duration::from_secs(5),
            ..DEFAULT_LIMITS
        }
    }

    fn local_reader() -> HttpReader {
        HttpReader::new(local_limits())
    }

    #[test]
    fn the_default_limits_are_the_owner_confirmed_ones() {
        assert_eq!(DEFAULT_LIMITS.timeout, Duration::from_secs(15));
        assert_eq!(DEFAULT_LIMITS.max_redirects, 5);
        assert_eq!(DEFAULT_LIMITS.max_body_bytes, 2 * 1024 * 1024);
        assert_eq!(DEFAULT_LIMITS.max_text_chars, 20_000);
        assert_eq!(DEFAULT_LIMITS.min_text_chars, 200);
        assert_eq!(
            DEFAULT_LIMITS.allow_loopback,
            HttpReader::default().limits.allow_loopback
        );
        assert_eq!(HttpReader::default().limits, DEFAULT_LIMITS);
    }

    #[test]
    fn refuses_localhost_and_private_addresses() {
        for ip in [
            "127.0.0.1",
            "127.1.2.3",
            "10.0.0.1",
            "172.16.5.4",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "0.1.2.3",
            "255.255.255.255",
            "224.0.0.1",
            "192.0.2.1",
            "198.18.0.1",
            "240.0.0.1",
            "::1",
            "::",
            "fc00::1",
            "fd12::1",
            "fe80::1",
            "ff02::1",
            "2001:db8::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "64:ff9b::a00:1",
            "2002:c0a8:0101::1",
            "::127.0.0.1",
            "2001::1",
            "fec0::1",
        ] {
            assert!(!is_public(ip.parse().unwrap()), "{ip} must be refused");
        }
        for ip in [
            "93.184.216.34",
            "1.1.1.1",
            "2606:4700::1111",
            "::ffff:93.184.216.34",
            "2002:5db8:d822::1",
        ] {
            assert!(is_public(ip.parse().unwrap()), "{ip} is public");
        }
        // The default reader refuses these before any connection.
        let reader = HttpReader::default();
        for url in [
            "http://localhost/",
            "http://LOCALHOST./x",
            "http://app.localhost/",
            "http://127.0.0.1/",
            "http://2130706433/",
            "http://0x7f.0.0.1/",
            "http://10.0.0.1/",
            "http://[::1]/",
            "http://[::ffff:192.168.0.1]/",
            "http://169.254.169.254/latest/meta-data/",
            "http://user:pw@example.org/",
            "http://user@example.org/",
        ] {
            assert_eq!(reader.read(url), Err(FetchError::Refused), "{url}");
        }
    }

    #[test]
    fn refuses_a_loopback_test_server_with_the_default_limits() {
        let port = serve(1, |_| {
            response("200 OK", "text/html", &page("T", &long_text()))
        });
        let url = format!("http://127.0.0.1:{port}/");
        assert_eq!(HttpReader::default().read(&url), Err(FetchError::Refused));
    }

    #[test]
    fn a_redirect_to_a_private_address_is_refused() {
        let port = serve(1, |_| redirect("http://10.0.0.1/admin"));
        let url = format!("http://127.0.0.1:{port}/");
        assert_eq!(local_reader().read(&url), Err(FetchError::Refused));
    }

    #[test]
    fn refuses_a_scheme_that_is_not_http_or_https() {
        let reader = HttpReader::default();
        for url in [
            "ftp://example.org/file",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hello",
            "mailto:a@example.org",
            "not a link",
        ] {
            assert_eq!(reader.read(url), Err(FetchError::NotWebLink), "{url}");
        }
        // A redirect to another scheme is refused too.
        let port = serve(1, |_| redirect("file:///etc/passwd"));
        assert_eq!(
            local_reader().read(&format!("http://127.0.0.1:{port}/")),
            Err(FetchError::NotWebLink)
        );
    }

    #[test]
    fn refuses_a_content_type_that_is_not_html_or_text() {
        for ct in [
            "application/pdf",
            "image/png",
            "application/json",
            "application/octet-stream",
            "",
        ] {
            let ct2 = ct.to_string();
            let port = serve(1, move |_| response("200 OK", &ct2, &long_text()));
            assert_eq!(
                local_reader().read(&format!("http://127.0.0.1:{port}/")),
                Err(FetchError::NotText),
                "{ct}"
            );
        }
        assert_eq!(text_kind("Text/HTML; charset=utf-8"), Some(TextKind::Html));
        assert_eq!(text_kind("text/plain"), Some(TextKind::Plain));
    }

    #[test]
    fn reads_the_title_and_the_visible_text_of_an_html_page() {
        let body = page("  Rust &amp; ownership ", &long_text());
        let port = serve(1, move |_| {
            response("200 OK", "text/html; charset=utf-8", &body)
        });
        let got = local_reader()
            .read(&format!("http://127.0.0.1:{port}/"))
            .unwrap();
        assert_eq!(got.title.as_deref(), Some("Rust & ownership"));
        assert!(got.text.starts_with("Rust ownership means"));
        for gone in ["var x", "color:red", "Home | About", "Copyright"] {
            assert!(!got.text.contains(gone), "{gone} must not be page text");
        }
        assert!(!got.cut);
    }

    #[test]
    fn decodes_the_charset_of_the_content_type() {
        let mut body = b"Caf\xe9 au lait. ".repeat(30);
        body.extend_from_slice(b"End.");
        let got = page_text(&body, "text/plain; charset=ISO-8859-1", &DEFAULT_LIMITS).unwrap();
        assert!(got.text.starts_with("Café au lait."));
    }

    #[test]
    fn text_under_200_chars_is_unreadable() {
        let short = page("Sign in", "Please sign in to continue.");
        assert_eq!(
            page_text(short.as_bytes(), "text/html", &DEFAULT_LIMITS),
            Err(FetchError::TooLittleText)
        );
        assert_eq!(
            page_text(b"   ", "text/plain", &DEFAULT_LIMITS),
            Err(FetchError::TooLittleText)
        );
        let exactly = "a".repeat(200);
        assert!(page_text(exactly.as_bytes(), "text/plain", &DEFAULT_LIMITS).is_ok());
        let under = "a".repeat(199);
        assert_eq!(
            page_text(under.as_bytes(), "text/plain", &DEFAULT_LIMITS),
            Err(FetchError::TooLittleText)
        );
    }

    #[test]
    fn caps_the_body_at_2_mb() {
        let big = vec![b'a'; 3 * 1024 * 1024];
        let far = Instant::now() + Duration::from_secs(60);
        let read = read_until(&big[..], DEFAULT_LIMITS.max_body_bytes, far).unwrap();
        assert_eq!(read.len(), 2 * 1024 * 1024);
        // Through the reader: a 3 MB page is read up to the cap and still gives its text.
        let port = serve(1, |_| {
            let body = "word ".repeat(3 * 1024 * 1024 / 5);
            response("200 OK", "text/plain", &body)
        });
        let got = local_reader()
            .read(&format!("http://127.0.0.1:{port}/"))
            .unwrap();
        assert!(got.cut);
        assert_eq!(got.text.chars().count(), 20_000);
    }

    #[test]
    fn stops_after_5_redirects() {
        // /r/n redirects to /r/(n+1); /r/6 is the page. From /r/1 that is 5 redirects (read),
        // from /r/0 it is 6 (refused).
        let answer = |path: &str| {
            let n: usize = path.trim_start_matches("/r/").parse().unwrap_or(0);
            if n >= 6 {
                response("200 OK", "text/plain", &long_text())
            } else {
                redirect(&format!("/r/{}", n + 1))
            }
        };
        let port = serve(6, answer);
        assert!(local_reader()
            .read(&format!("http://127.0.0.1:{port}/r/1"))
            .is_ok());
        let port = serve(6, answer);
        assert_eq!(
            local_reader().read(&format!("http://127.0.0.1:{port}/r/0")),
            Err(FetchError::TooManyRedirects)
        );
    }

    #[test]
    fn gives_up_at_the_timeout() {
        let port = serve(1, |_| {
            std::thread::sleep(Duration::from_secs(3));
            response("200 OK", "text/plain", &long_text())
        });
        let reader = HttpReader::new(FetchLimits {
            timeout: Duration::from_millis(300),
            ..local_limits()
        });
        let started = Instant::now();
        assert_eq!(
            reader.read(&format!("http://127.0.0.1:{port}/")),
            Err(FetchError::NotReached("request"))
        );
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn gives_up_at_the_timeout_when_the_body_drips_in() {
        // The headers come at once, then one byte every 100 ms: each read is quick, so only
        // the total deadline can stop it.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 4096];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 100000\r\n\r\n",
                );
                for _ in 0..100 {
                    if stream.write_all(b"a").is_err() {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        });
        let reader = HttpReader::new(FetchLimits {
            timeout: Duration::from_millis(800),
            ..local_limits()
        });
        let started = Instant::now();
        assert_eq!(
            reader.read(&format!("http://127.0.0.1:{port}/")),
            Err(FetchError::NotReached("body timeout"))
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        // The read loop itself stops at the deadline.
        let past = Instant::now();
        assert_eq!(
            read_until(io::repeat(b'a'), u64::MAX, past),
            Err(FetchError::NotReached("body timeout"))
        );
    }

    #[test]
    fn sends_at_most_20k_chars_to_claude() {
        let text = "é".repeat(30_000);
        let got = page_text(text.as_bytes(), "text/plain", &DEFAULT_LIMITS).unwrap();
        assert_eq!(got.text.chars().count(), 20_000);
        assert!(got.cut);
        assert_eq!(cut_chars("abc", 2), ("ab".to_string(), true));
        assert_eq!(cut_chars("abc", 3), ("abc".to_string(), false));
    }

    #[test]
    fn an_error_status_is_unreadable() {
        let port = serve(1, |_| response("403 Forbidden", "text/html", &long_text()));
        assert_eq!(
            local_reader().read(&format!("http://127.0.0.1:{port}/")),
            Err(FetchError::Status(403))
        );
    }

    #[test]
    fn a_host_name_is_pinned_to_its_checked_address_and_keeps_the_port_of_the_link() {
        let port = serve(1, |_| response("200 OK", "text/plain", &long_text()));
        let reader = HttpReader::new(FetchLimits {
            fake_dns: Some(("pinned.test".into(), IpAddr::V4(Ipv4Addr::LOCALHOST))),
            ..local_limits()
        });
        let got = reader.read(&format!("http://pinned.test:{port}/")).unwrap();
        assert!(got.text.starts_with("Rust ownership"));
        // A name that resolves to a private address is refused.
        let reader = HttpReader::new(FetchLimits {
            fake_dns: Some(("inside.test".into(), "192.168.0.10".parse().unwrap())),
            ..local_limits()
        });
        assert_eq!(reader.read("http://inside.test/"), Err(FetchError::Refused));
    }

    /// The bound of one hostile 2 MB page: well under a second in a release build. A debug build
    /// is much slower, so there the bound only shows that the walk ends on its own.
    const HOSTILE_PAGE_BOUND: Duration = if cfg!(debug_assertions) {
        Duration::from_secs(20)
    } else {
        Duration::from_secs(1)
    };

    /// A page of about 2 MB made of `unit` repeated.
    fn two_mb(unit: &str) -> String {
        unit.repeat(2 * 1024 * 1024 / unit.len())
    }

    /// `page_text` with the 15 s deadline must give an answer (any) within the bound.
    fn ends_in_time(name: &str, html: &str) -> Duration {
        let started = Instant::now();
        let _ = page_text(html.as_bytes(), "text/html", &DEFAULT_LIMITS);
        let took = started.elapsed();
        assert!(took < HOSTILE_PAGE_BOUND, "{name} took {took:?}");
        took
    }

    #[test]
    fn hostile_pages_are_read_in_one_linear_pass() {
        // The pages the review measured with the tree parser (16.9 s for 480 KB of <div/>, and
        // a quadratic pre-scan), and the advisor's worst cases.
        let attrs: String = (0..400_000).map(|i| format!(" a{i}")).collect();
        let just_under: String = (0..999).map(|i| format!(" a{i}")).collect();
        let pages = [
            ("<div/> x 2 MB", two_mb("<div/>")),
            (
                "<b> and stray </b>, 2 MB",
                two_mb("<b>x</b></b></i><div></b>"),
            ),
            ("<script></script> x 2 MB", two_mb("<script></script>")),
            (
                "350k nested <div>",
                format!("{}{}", "<div>".repeat(350_000), long_text()),
            ),
            (
                "one tag, 400k attributes",
                format!("<p{attrs}>{}</p>", long_text()),
            ),
            (
                "tags of 999 attributes, 2 MB",
                two_mb(&format!("<p{}>x</p>", just_under)),
            ),
        ];
        for (name, html) in &pages {
            let took = ends_in_time(name, html);
            eprintln!("{name}: {took:?}");
        }
    }

    #[test]
    fn a_tag_with_too_many_attributes_is_too_complex_at_once() {
        let attrs: String = (0..400_000).map(|i| format!(" a{i}")).collect();
        let html = format!("<p{attrs}>{}</p>", long_text());
        let started = Instant::now();
        assert_eq!(
            page_text(html.as_bytes(), "text/html", &DEFAULT_LIMITS),
            Err(FetchError::TooComplex)
        );
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "{:?}",
            started.elapsed()
        );
        // Normal tags, quoted values with spaces and ">" inside, and text are fine.
        let ok = format!(
            "<a href=\"/x?a=1&b=2\" title='a > b c d' data-x=1 hidden>link</a><p>{}</p>",
            long_text()
        );
        assert!(page_text(ok.as_bytes(), "text/html", &DEFAULT_LIMITS).is_ok());
        assert!(!too_many_attributes("<p a b c>", 3));
        assert!(too_many_attributes("<p a b c d>", 3));
        assert!(!too_many_attributes("<p a='x y z w'>", 1));
    }

    #[test]
    fn the_html_walk_stops_at_the_deadline_on_its_own_thread() {
        // page_text_until runs on the calling thread here, so its return is the end of the work.
        let html = two_mb("<div/>");
        let started = Instant::now();
        let deadline = Instant::now() + Duration::from_millis(20);
        assert_eq!(
            page_text_until(html.as_bytes(), "text/html", &DEFAULT_LIMITS, deadline),
            Err(FetchError::TooSlow)
        );
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "{:?}",
            started.elapsed()
        );
    }

    #[test]
    fn an_unclosed_nav_or_header_does_not_hide_the_page() {
        let body = long_text();
        for html in [
            format!("<body><nav><a href=/>Home</a><main><p>{body}</p></main></body>"),
            format!("<body><header>Site<article><p>{body}</p></article></body>"),
            format!("<head><title>T</title><body><p>{body}</p>"),
        ] {
            let got = page_text(html.as_bytes(), "text/html", &DEFAULT_LIMITS).unwrap();
            assert!(got.text.contains("Rust ownership means"), "{html:.80}");
            assert!(!got.text.contains("Home"));
        }
    }

    #[test]
    fn a_head_with_no_end_tag_ends_at_the_first_body_tag_or_text() {
        // Both </head> and <body> are optional in HTML: a browser ends the head at the first
        // tag (or text) that cannot be in it.
        let body = long_text();
        for html in [
            format!("<html><head><title>T</title><meta charset=utf-8><p>{body}</p></html>"),
            format!("<head><title>T</title><div><p>{body}</p></div>"),
            format!("<head><title>T</title><link rel=x>{body}"),
        ] {
            let got = page_text(html.as_bytes(), "text/html", &DEFAULT_LIMITS).unwrap();
            assert!(got.text.contains("Rust ownership means"), "{html:.80}");
            assert_eq!(got.title.as_deref(), Some("T"));
        }
    }

    #[test]
    fn a_page_inside_one_form_and_a_header_inside_an_article_are_read() {
        let body = long_text();
        // ASP.NET WebForms wraps the whole body in one <form>.
        let webforms = format!(
            "<body><form method=post action=./><nav>Home</nav><p>{body}</p><button>Go</button></form></body>"
        );
        let got = page_text(webforms.as_bytes(), "text/html", &DEFAULT_LIMITS).unwrap();
        assert!(got.text.contains("Rust ownership means"));
        assert!(!got.text.contains("Home"));
        assert!(!got.text.contains("Go"));
        let article = format!(
            "<body><header>Site menu</header><article><header><h1>Ownership</h1></header><p>{body}</p></article><footer>Copyright</footer></body>"
        );
        let got = page_text(article.as_bytes(), "text/html", &DEFAULT_LIMITS).unwrap();
        assert!(got.text.starts_with("Ownership\n"), "{:.40}", got.text);
        assert!(got.text.contains("Rust ownership means"));
        assert!(!got.text.contains("Site menu"));
        assert!(!got.text.contains("Copyright"));
    }

    #[test]
    fn a_site_that_is_not_there_refuses_or_fails_tls_was_not_reached() {
        // Nobody listens on this port: the connection is refused.
        let port = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        let got = local_reader().read(&format!("http://127.0.0.1:{port}/"));
        assert!(matches!(got, Err(FetchError::NotReached(_))), "{got:?}");
        // A name with no address.
        let reader = HttpReader::new(FetchLimits {
            fake_dns: Some(("known.test".into(), IpAddr::V4(Ipv4Addr::LOCALHOST))),
            ..local_limits()
        });
        let got = reader.read("http://unknown.test/");
        assert_eq!(got, Err(FetchError::NotReached("dns")));
        // A server that speaks no TLS on an https link.
        let port = serve(1, |_| response("200 OK", "text/plain", &long_text()));
        let got = local_reader().read(&format!("https://127.0.0.1:{port}/"));
        assert!(matches!(got, Err(FetchError::NotReached(_))), "{got:?}");
        assert!(got.unwrap_err().is_not_reached());
    }

    #[test]
    fn a_server_that_drops_before_it_answers_was_not_reached() {
        let port = serve(1, |_| Vec::new());
        let got = local_reader().read(&format!("http://127.0.0.1:{port}/"));
        assert!(matches!(got, Err(FetchError::NotReached(_))), "{got:?}");
    }

    #[test]
    fn a_body_cut_short_by_the_server_was_not_reached() {
        // The real reqwest path: the body read fails with io::ErrorKind::Other.
        let port = serve(1, |_| {
            b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 100000\r\nConnection: close\r\n\r\n0123456789"
                .to_vec()
        });
        let got = local_reader().read(&format!("http://127.0.0.1:{port}/"));
        assert_eq!(got, Err(FetchError::NotReached("body")));
    }

    #[test]
    fn any_failed_body_read_was_not_reached() {
        struct Fails(io::ErrorKind);
        impl Read for Fails {
            fn read(&mut self, _buf: &mut [u8]) -> io::Result<usize> {
                Err(io::Error::new(self.0, "broken"))
            }
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        for kind in [io::ErrorKind::Other, io::ErrorKind::ConnectionReset] {
            assert_eq!(
                read_until(Fails(kind), u64::MAX, deadline),
                Err(FetchError::NotReached("body")),
                "{kind:?}"
            );
        }
    }

    #[test]
    fn a_reader_that_panics_fails_within_the_deadline() {
        struct Panics;
        impl Read for Panics {
            fn read(&mut self, _buf: &mut [u8]) -> io::Result<usize> {
                panic!("a broken reader");
            }
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        let started = Instant::now();
        assert_eq!(
            text_within(Panics, "text/plain".into(), &DEFAULT_LIMITS, deadline),
            Err(FetchError::ReaderFailed)
        );
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn an_unclosed_header_inside_an_article_does_not_hide_the_rest_of_the_page() {
        let body = long_text();
        let html = format!(
            "<body><article><header><h1>Ownership</h1><p>{body}</p></article>\
             <header>Site menu</header><p>After the article.</p></body>"
        );
        let got = page_text(html.as_bytes(), "text/html", &DEFAULT_LIMITS).unwrap();
        assert!(got.text.contains("After the article."), "{}", got.text);
        assert!(!got.text.contains("Site menu"));
    }

    #[test]
    fn the_charset_prescan_is_one_pass_on_hostile_markup() {
        let started = Instant::now();
        for html in [
            "<".repeat(limits::CHARSET_PRESCAN_BYTES),
            "<a".repeat(limits::CHARSET_PRESCAN_BYTES / 2) + ">",
            "<!--".repeat(limits::CHARSET_PRESCAN_BYTES / 4),
        ] {
            assert_eq!(meta_charset(html.as_bytes()), None);
        }
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn the_meta_charset_is_found_after_a_long_comment_and_never_inside_one() {
        let text = "日本語のページです。所有権はRustの中心的な機能です。".repeat(10);
        let enc = encoding_rs::SHIFT_JIS;
        let mut html = format!(
            "<!-- {} <meta charset=\"gbk\"> --><html><head><script>{}</script><meta charset=\"Shift_JIS\"></head><body><p>",
            "licence text ".repeat(200),
            "var a = 1; ".repeat(300)
        )
        .into_bytes();
        html.extend_from_slice(&enc.encode(&text).0);
        let got = page_text(&html, "text/html", &DEFAULT_LIMITS).unwrap();
        assert!(
            got.text.starts_with("日本語のページです。"),
            "{:.40}",
            got.text
        );
    }

    #[test]
    fn a_meta_tag_inside_a_script_or_style_does_not_count() {
        let text = "日本語のページです。所有権はRustの中心的な機能です。".repeat(10);
        let mut html = b"<script>var t = '<meta charset=gbk>';</script>\
            <style>/* <meta charset=gbk> */</style><meta charset=shift_jis><p>"
            .to_vec();
        html.extend_from_slice(&encoding_rs::SHIFT_JIS.encode(&text).0);
        let got = page_text(&html, "text/html", &DEFAULT_LIMITS).unwrap();
        assert!(
            got.text.starts_with("日本語のページです。"),
            "{:.40}",
            got.text
        );
    }

    #[test]
    fn the_charset_of_a_meta_tag_is_used_when_the_server_names_none() {
        let text = "日本語のページです。所有権はRustの中心的な機能です。".repeat(10);
        for (label, meta) in [
            ("Shift_JIS", "<meta charset=\"Shift_JIS\">"),
            (
                "GBK",
                "<meta http-equiv=\"Content-Type\" content=\"text/html; charset=gbk\">",
            ),
        ] {
            let enc = encoding_rs::Encoding::for_label(label.as_bytes()).unwrap();
            let mut html = format!("<html><head>{meta}<title>").into_bytes();
            html.extend_from_slice(&enc.encode("所有権").0);
            html.extend_from_slice(b"</title></head><body><p>");
            html.extend_from_slice(&enc.encode(&text).0);
            html.extend_from_slice(b"</p></body></html>");
            let got = page_text(&html, "text/html", &DEFAULT_LIMITS).unwrap();
            assert_eq!(got.title.as_deref(), Some("所有権"), "{label}");
            assert!(got.text.starts_with("日本語のページです。"), "{label}");
        }
        // The server's charset wins over the meta tag.
        let mut html = b"<meta charset=\"Shift_JIS\"><p>".to_vec();
        html.extend_from_slice("Caf\u{e9} au lait. ".repeat(30).as_bytes());
        let got = page_text(&html, "text/html; charset=utf-8", &DEFAULT_LIMITS).unwrap();
        assert!(got.text.starts_with("Café au lait."));
        // cp1251 named by a meta tag.
        let cyr = "Владение — главная идея Rust. ".repeat(10);
        let mut html = b"<meta charset=windows-1251><p>".to_vec();
        html.extend_from_slice(&encoding_rs::WINDOWS_1251.encode(&cyr).0);
        let got = page_text(&html, "text/html", &DEFAULT_LIMITS).unwrap();
        assert!(got.text.starts_with("Владение"));
    }

    #[test]
    fn a_body_that_comes_in_too_late_to_parse_was_not_reached() {
        // The bytes are all in, but less than the parse budget is left: the site was slow.
        let limits = FetchLimits {
            parse_budget: Duration::from_secs(2),
            ..DEFAULT_LIMITS
        };
        let deadline = Instant::now() + Duration::from_millis(500);
        let body = io::Cursor::new(long_text().into_bytes());
        assert_eq!(
            text_within(body, "text/plain".into(), &limits, deadline),
            Err(FetchError::NotReached("body timeout"))
        );
        // With the budget left, the same body is read.
        let deadline = Instant::now() + Duration::from_secs(5);
        let body = io::Cursor::new(long_text().into_bytes());
        assert!(text_within(body, "text/plain".into(), &limits, deadline).is_ok());
        // A parse that started with its budget and ran out is too slow (the page is too big).
        let html = two_mb("<div/>");
        assert_eq!(
            page_text_until(
                html.as_bytes(),
                "text/html",
                &DEFAULT_LIMITS,
                Instant::now() + Duration::from_millis(20)
            ),
            Err(FetchError::TooSlow)
        );
    }

    #[test]
    fn a_link_reqwest_cannot_request_is_unreadable() {
        let e = Client::new().get("not a link").build().unwrap_err();
        assert!(e.is_builder());
        let got = request_failed(e);
        assert!(!got.is_not_reached(), "{got:?}");
        assert_eq!(got, FetchError::NotWebLink);
    }

    #[test]
    fn every_error_is_sorted_as_not_reached_or_unreadable() {
        // The owner's ruling (#25): any failure to reach the site, and 408, 429, 5xx.
        for e in [
            FetchError::NotReached("dns"),
            FetchError::NotReached("request"),
            FetchError::NotReached("body"),
            FetchError::Status(408),
            FetchError::Status(429),
            FetchError::Status(500),
            FetchError::Status(503),
            FetchError::Status(599),
        ] {
            assert!(e.is_not_reached(), "{e:?}");
        }
        // A problem with the link or the content: "Paste the text" only.
        for e in [
            FetchError::NotWebLink,
            FetchError::Refused,
            FetchError::TooManyRedirects,
            FetchError::Status(400),
            FetchError::Status(401),
            FetchError::Status(403),
            FetchError::Status(404),
            FetchError::Status(410),
            FetchError::Status(304),
            FetchError::NotText,
            FetchError::TooLittleText,
            FetchError::TooComplex,
            FetchError::TooSlow,
            FetchError::ReaderFailed,
        ] {
            assert!(!e.is_not_reached(), "{e:?}");
        }
    }

    #[test]
    fn script_style_and_raw_text_never_become_page_text() {
        let body = long_text();
        let html = format!(
            "<title>T &amp; U</title><script>var a = '<p>not text</p>';</script><style>p{{}}</style>\
             <noscript>Enable JS</noscript><textarea>typed</textarea><svg><title>icon</title></svg>\
             <p>{body}</p><script/>still script</script><p>after</p>"
        );
        let got = page_text(html.as_bytes(), "text/html", &DEFAULT_LIMITS).unwrap();
        assert_eq!(got.title.as_deref(), Some("T & U"));
        for gone in [
            "not text",
            "p{}",
            "Enable JS",
            "typed",
            "icon",
            "still script",
        ] {
            assert!(!got.text.contains(gone), "{gone}");
        }
        assert!(got.text.ends_with("after"));
    }

    #[test]
    fn real_saved_pages_keep_their_title_and_main_text() {
        // (page, title, first main sentence, a sentence near the end, least text characters)
        let pages = [
            (
                include_str!("testdata/rust-home.html"),
                "Rust Programming Language",
                "Rust is blazingly fast and memory-efficient",
                "The Rust project receives support from companies through the Rust Foundation.",
                2_000,
            ),
            (
                include_str!("testdata/rust-book-ownership.html"),
                "What is Ownership? - The Rust Programming Language",
                "Ownership is a set of rules that govern how a Rust pro",
                "transferring ownership: references.",
                20_000,
            ),
            (
                include_str!("testdata/python-tutorial-intro.html"),
                "3. An Informal Introduction to Python",
                "Many of the examples in this manual",
                "Of course, we can use Python for more complicated tasks",
                15_000,
            ),
        ];
        let far = Instant::now() + Duration::from_secs(60);
        for (html, title, first, late, least) in pages {
            let (got_title, text) = html_text(html, far).unwrap();
            let got_title = got_title.unwrap_or_default();
            assert!(got_title.starts_with(title), "{got_title}");
            assert!(text.contains(first), "{title}: missing {first}");
            assert!(text.contains(late), "{title}: missing {late}");
            assert!(
                text.chars().count() >= least,
                "{title}: {}",
                text.chars().count()
            );
            for code in ["function(", "var ", "</", "{display"] {
                assert!(!text.contains(code), "{title}: code {code} in the text");
            }
            // Through the whole reader step: readable, and cut to the 20k limit.
            let page =
                page_text(html.as_bytes(), "text/html; charset=utf-8", &DEFAULT_LIMITS).unwrap();
            assert!(page.text.chars().count() <= 20_000);
        }
    }

    #[test]
    fn a_name_that_is_not_pinned_gets_no_address() {
        use reqwest::dns::Resolve;
        let name: reqwest::dns::Name = "example.org".parse().unwrap();
        let resolving = NoDns.resolve(name);
        let result = tauri::async_runtime::block_on(resolving);
        assert!(result.is_err());
    }

    #[test]
    fn a_deeply_nested_page_does_not_overflow_the_stack() {
        let depth = 350_000;
        let html = format!(
            "{}{}{}",
            "<div>".repeat(depth),
            long_text(),
            "</div>".repeat(depth)
        );
        let got = page_text(html.as_bytes(), "text/html", &DEFAULT_LIMITS).unwrap();
        assert!(got.text.contains("Rust ownership"));
    }

    #[test]
    fn a_body_that_drips_past_the_deadline_is_not_reached() {
        /// A body that gives one byte every 50 ms, then ends: its reader thread stops by itself.
        struct Slow(usize);
        impl Read for Slow {
            fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
                if self.0 == 0 || buf.is_empty() {
                    return Ok(0);
                }
                std::thread::sleep(Duration::from_millis(50));
                self.0 -= 1;
                buf[0] = b'a';
                Ok(1)
            }
        }
        let deadline = Instant::now() + Duration::from_millis(200);
        let started = Instant::now();
        assert_eq!(
            text_within(Slow(40), "text/plain".into(), &DEFAULT_LIMITS, deadline),
            Err(FetchError::NotReached("body timeout"))
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
