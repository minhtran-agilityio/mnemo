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
/// Deepest element nesting the reader parses. A deeper page is too complex: link only. Real
/// pages stay far below; very deep nesting makes the HTML parser slow.
pub const MAX_HTML_DEPTH: usize = 256;
/// How long one summary run may take.
pub const SUMMARY_TIMEOUT: Duration = Duration::from_secs(120);
