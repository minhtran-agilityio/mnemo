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
// Every failure means "link only": the caller stores no summary and invents nothing.

use std::fmt;
use std::io::{self, Read};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use reqwest::blocking::Client;
use reqwest::header::{CONTENT_TYPE, LOCATION};
use reqwest::redirect::Policy;
use reqwest::Url;
use scraper::{Html, Node};

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
    /// Deepest element nesting parsed. A deeper page is too complex to read.
    pub max_html_depth: usize,
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
    max_html_depth: limits::MAX_HTML_DEPTH,
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

/// Why a page could not be read. Every case means "link only".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FetchError {
    /// Not an http or https link.
    NotWebLink,
    /// The link points at this computer or a private or reserved network, or carries a user
    /// name or password.
    Refused,
    /// More than `max_redirects` redirects.
    TooManyRedirects,
    /// The read took longer than `timeout`.
    Timeout,
    /// The server answered with this error status.
    Status(u16),
    /// The page is not text/html or text/plain.
    NotText,
    /// The page has under `min_text_chars` characters of text.
    TooLittleText,
    /// The HTML nests deeper than `max_html_depth`: it is not parsed.
    TooComplex,
    /// The host could not be found or reached.
    Network,
}

impl fmt::Display for FetchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FetchError::NotWebLink => write!(f, "not an http or https link"),
            FetchError::Refused => write!(f, "a local, private or reserved address"),
            FetchError::TooManyRedirects => write!(f, "too many redirects"),
            FetchError::Timeout => write!(f, "the page took too long"),
            FetchError::Status(code) => write!(f, "the server answered {code}"),
            FetchError::NotText => write!(f, "not an HTML or text page"),
            FetchError::TooLittleText => write!(f, "too little text on the page"),
            FetchError::TooComplex => write!(f, "the page is too complex to read"),
            FetchError::Network => write!(f, "the site could not be reached"),
        }
    }
}

impl std::error::Error for FetchError {}

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
            FetchError::Network
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
                    return Err(FetchError::Network);
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
                Err(FetchError::Network)
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
            Ok(Err(_)) => Err(FetchError::Network),
            Err(mpsc::RecvTimeoutError::Timeout) => Err(FetchError::Timeout),
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(FetchError::Network),
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

fn remaining(deadline: Instant) -> Result<Duration, FetchError> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|d| !d.is_zero())
        .ok_or(FetchError::Timeout)
}

fn request_failed(e: reqwest::Error) -> FetchError {
    if e.is_timeout() {
        FetchError::Timeout
    } else {
        FetchError::Network
    }
}

fn read_failed(e: io::Error) -> FetchError {
    if e.kind() == io::ErrorKind::TimedOut {
        FetchError::Timeout
    } else {
        FetchError::Network
    }
}

/// Reads the body (at most `max_body_bytes`) and makes its text on a helper thread, given only
/// the time left. The reqwest blocking client times each read on its own, so a server that
/// sends one byte at a time could outlast the deadline: the read loop stops at the deadline,
/// and the caller stops waiting then too. A page built to be slow to parse (very deep nesting)
/// also ends as a timeout. Either way the bookmark keeps the link only.
fn text_within<R: Read + Send + 'static>(
    body: R,
    content_type: String,
    limits: &FetchLimits,
    deadline: Instant,
) -> Result<PageText, FetchError> {
    let left = remaining(deadline)?;
    let limits = limits.clone();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let result = read_until(body, limits.max_body_bytes, deadline)
            .and_then(|bytes| page_text(&bytes, &content_type, &limits));
        let _ = tx.send(result);
    });
    match rx.recv_timeout(left) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => Err(FetchError::Timeout),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(FetchError::Network),
    }
}

/// Reads at most `cap` bytes in chunks and gives up once `deadline` has passed.
fn read_until<R: Read>(body: R, cap: u64, deadline: Instant) -> Result<Vec<u8>, FetchError> {
    let mut reader = body.take(cap);
    let mut out = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    loop {
        remaining(deadline)?;
        match reader.read(&mut chunk) {
            Ok(0) => return Ok(out),
            Ok(n) => out.extend_from_slice(&chunk[..n]),
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) => return Err(read_failed(e)),
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

/// The text of a page body: decoded, the visible text kept, checked and cut to the limits.
pub fn page_text(
    body: &[u8],
    content_type: &str,
    limits: &FetchLimits,
) -> Result<PageText, FetchError> {
    let kind = text_kind(content_type).ok_or(FetchError::NotText)?;
    let encoding = charset(content_type).unwrap_or(encoding_rs::UTF_8);
    let (decoded, _, _) = encoding.decode(body);
    let (title, text) = match kind {
        TextKind::Html => {
            if too_deep(&decoded, limits.max_html_depth) {
                return Err(FetchError::TooComplex);
            }
            html_text(&decoded)
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

/// Elements that never hold others (void) or whose end tag may be left out: the parser closes
/// them itself, so they do not add to the nesting.
const NO_NESTING: [&str; 33] = [
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track",
    "wbr", "param", "keygen", "p", "li", "dt", "dd", "option", "optgroup", "tr", "td", "th",
    "thead", "tbody", "tfoot", "colgroup", "caption", "rt", "rp", "html", "head",
];

/// Raw text elements: their content is not markup.
const RAW_TEXT: [&str; 6] = ["script", "style", "textarea", "title", "xmp", "noscript"];

/// True when the markup nests deeper than `max`, by a quick scan of the tags before any parse.
/// The scan is linear and its count is an upper bound for most pages: it counts each start tag
/// that can hold others and each end tag. Very deep nesting makes the HTML parser slow, so such
/// a page is not parsed at all.
pub fn too_deep(html: &str, max: usize) -> bool {
    let b = html.as_bytes();
    let mut i = 0;
    let mut depth = 0usize;
    while let Some(off) = b[i..].iter().position(|&c| c == b'<') {
        i += off + 1;
        if b[i..].starts_with(b"!--") {
            // A comment holds no markup: skip to its end.
            match html[i..].find("-->") {
                Some(at) => i += at + 3,
                None => break,
            }
            continue;
        }
        match b.get(i) {
            Some(b'/') => {
                depth = depth.saturating_sub(1);
                continue;
            }
            Some(c) if c.is_ascii_alphabetic() => {}
            _ => continue,
        }
        let start = i;
        while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'-') {
            i += 1;
        }
        let name = html[start..i].to_ascii_lowercase();
        let Some(close) = b[i..].iter().position(|&c| c == b'>') else {
            break;
        };
        let self_closing = close > 0 && b[i + close - 1] == b'/';
        i += close + 1;
        if RAW_TEXT.contains(&name.as_str()) {
            // Skip to the end tag, so "<" inside a script is not read as a tag.
            let end = format!("</{name}");
            match html[i..].to_ascii_lowercase().find(&end) {
                Some(at) => i += at,
                None => break,
            }
            continue;
        }
        if self_closing || NO_NESTING.contains(&name.as_str()) {
            continue;
        }
        depth += 1;
        if depth > max {
            return true;
        }
    }
    false
}

/// Elements whose content is not page text: code, styles, and the site's own navigation.
const SKIP: [&str; 12] = [
    "script", "style", "noscript", "template", "svg", "nav", "header", "footer", "aside", "form",
    "iframe", "head",
];

/// Elements that start a new line of text.
const BLOCK: [&str; 18] = [
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
    "pre",
    "blockquote",
];

/// The `<title>` and the visible text of an HTML document. The walk is a loop, not a
/// recursion, so a deeply nested page cannot overflow the stack.
fn html_text(source: &str) -> (Option<String>, String) {
    let doc = Html::parse_document(source);
    let root = doc.root_element();
    let title = root
        .descendent_elements()
        .find(|e| e.value().name() == "title")
        .map(|e| tidy(&e.text().collect::<String>()));
    let mut out = String::new();
    let mut skipping = 0usize;
    for edge in root.traverse() {
        match edge {
            ego_tree::iter::Edge::Open(node) => match node.value() {
                Node::Element(e) if SKIP.contains(&e.name()) => skipping += 1,
                Node::Element(e) if skipping == 0 && BLOCK.contains(&e.name()) => out.push('\n'),
                Node::Text(t) if skipping == 0 => out.push_str(&t[..]),
                _ => {}
            },
            ego_tree::iter::Edge::Close(node) => {
                if let Node::Element(e) = node.value() {
                    if SKIP.contains(&e.name()) {
                        skipping = skipping.saturating_sub(1);
                    } else if skipping == 0 && BLOCK.contains(&e.name()) {
                        out.push('\n');
                    }
                }
            }
        }
    }
    (title, tidy(&out))
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
            Err(FetchError::Timeout)
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
            Err(FetchError::Timeout)
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        // The read loop itself stops at the deadline.
        let past = Instant::now();
        assert_eq!(
            read_until(io::repeat(b'a'), u64::MAX, past),
            Err(FetchError::Timeout)
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

    #[test]
    fn a_page_nested_deeper_than_the_limit_is_not_parsed_and_ends_at_once() {
        // 40 000 nested divs took minutes to parse; the scan refuses them before the parse, on
        // this thread, so no parse is left running.
        let html = format!("{}{}", "<div>".repeat(40_000), long_text());
        let started = Instant::now();
        assert_eq!(
            page_text(html.as_bytes(), "text/html", &DEFAULT_LIMITS),
            Err(FetchError::TooComplex)
        );
        assert!(started.elapsed() < Duration::from_secs(1));
        // The worst page under the cap: 2 MB nested to just under the depth limit, then flat.
        let deep = "<span>".repeat(DEFAULT_LIMITS.max_html_depth - 10);
        let flat = "<div>word word word</div>".repeat((2 * 1024 * 1024 - deep.len()) / 25);
        let worst = format!("{deep}{flat}");
        let started = Instant::now();
        assert!(page_text(worst.as_bytes(), "text/html", &DEFAULT_LIMITS).is_ok());
        // A debug build; a release build is many times faster. The point is that the parse
        // ends by itself in a bounded time, so no thread is left busy.
        assert!(
            started.elapsed() < Duration::from_secs(30),
            "a 2 MB page under the cap parsed in {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn the_depth_scan_skips_void_elements_optional_ends_and_script_text() {
        let max = 3;
        assert!(!too_deep(
            "<div><p>a<p>b<p>c<p>d<br><img src=x><hr/></div>",
            max
        ));
        assert!(!too_deep(
            "<div><script>if (a<b) { x = '<div><div><div><div>'; }</script></div>",
            max
        ));
        assert!(!too_deep(
            "<div></div><div></div><div></div><div></div><div></div>",
            max
        ));
        assert!(too_deep("<div><section><article><span>x", max));
        assert!(!too_deep("<!-- <div><div><div><div> --> < not a tag", max));
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
        let depth = DEFAULT_LIMITS.max_html_depth - 6;
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
    fn a_page_that_takes_too_long_ends_as_a_timeout() {
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
            Err(FetchError::Timeout)
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
