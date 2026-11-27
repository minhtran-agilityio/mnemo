// The tunable values of save a link (#25), in one place (.claude/rules/technical.md: tunable
// values live in one config module). The owner confirmed the page limits (decision 5).

use std::time::Duration;

/// The whole page read: DNS, every redirect, the body and the HTML parse.
pub const FETCH_TIMEOUT: Duration = Duration::from_secs(15);
/// Most redirects followed.
pub const MAX_REDIRECTS: usize = 5;
/// Most body bytes read. A longer page is read up to here and the rest is left.
pub const MAX_BODY_BYTES: u64 = 2 * 1024 * 1024;
/// Most characters of page text (or pasted text) given to Claude.
pub const MAX_TEXT_CHARS: usize = 20_000;
/// Less page text than this means the page could not be read (link only).
pub const MIN_TEXT_CHARS: usize = 200;
/// Most attributes on one HTML tag. html5ever checks each new attribute against the earlier
/// ones of the same tag, so the cost of one tag grows with the square of its attribute count;
/// a page with a bigger tag is too complex to read (link only). Real tags have a few dozen.
pub const MAX_TAG_ATTRIBUTES: usize = 1_000;
/// How long one summary run may take.
pub const SUMMARY_TIMEOUT: Duration = Duration::from_secs(120);
/// How much decoded HTML the tokenizer gets between two deadline checks. Small, so one chunk
/// of a hostile page (for example a tag with a huge number of attributes, whose duplicate
/// check is quadratic) cannot run long past the deadline.
pub const HTML_CHUNK_BYTES: usize = 4 * 1024;
/// Longest title kept while reading a page (the stored title is cut to 500 characters later).
pub const TITLE_BUFFER_BYTES: usize = 8 * 1024;
/// How many first bytes of an HTML page are searched for a `<meta charset>` when the server
/// names no charset. The HTML standard's prescan uses 1024; a legacy page with a long comment
/// or script first needs more. Comments are skipped, so the cost stays one pass.
pub const CHARSET_PRESCAN_BYTES: usize = 64 * 1024;
/// How often a run waiting in the queue looks at its cancel token.
pub const QUEUED_CANCEL_POLL: Duration = Duration::from_millis(50);
/// The least time the HTML walk must have when the body is in. With less left, the body came in
/// too late: the site was too slow (not reached), not the page too big (decision 34).
pub const PARSE_BUDGET: Duration = Duration::from_secs(2);

// ---- Import old links from a file (#29) ----

/// The largest file an import reads. A browser export of 10 000 bookmarks is about 2 MB.
pub const IMPORT_MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
/// The most entries one import file may hold.
pub const IMPORT_MAX_ENTRIES: usize = 20_000;
/// The longest link title kept while reading the file, in characters (the insert keeps at most
/// 500; a longer one is dropped).
pub const IMPORT_MAX_TITLE_CHARS: usize = 600;
/// How long an import worker waits after a fault (a storage error, or a run that ended with no
/// reason while AI may run) before the import goes on. It doubles after each fault in a row.
pub const IMPORT_RETRY_FIRST: Duration = Duration::from_secs(5);
/// The longest wait after faults in a row.
pub const IMPORT_RETRY_MOST: Duration = Duration::from_secs(300);
