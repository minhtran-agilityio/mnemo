//! The compare key of a link (#28, LIB-02): a plain-code rule that turns a web address into the
//! text two saves of the same link share. It also owns the step at open that fills the key of
//! bookmarks saved before the column existed.
//!
//! The rules (the owner's answers, 2026-11-26):
//! - the scheme stays: `http` and `https` are different links;
//! - the host is lower case, without a leading `www.`, without a trailing dot, and without its
//!   default port (80 for http, 443 for https); another port stays;
//! - the path keeps its letter case; one trailing `/` is dropped;
//! - the query drops only `utm_*`, `fbclid` and `gclid` (names compared ignoring case); every other
//!   parameter stays, in its order, so another order is another link;
//! - the fragment is dropped.

use rusqlite::params;
use rusqlite::types::Value;

use super::error::StorageError;
use super::Storage;

/// Rows read and written per step of the fill at open.
const FILL_BATCH: i64 = 500;

// Live or deleted: a key is cheap, and every row keeps it. ?1 the last id of the batch before.
const UNKEYED_SQL: &str = "SELECT id, url FROM bookmark
     WHERE compare_key IS NULL AND id > ?1 ORDER BY id LIMIT ?2";

// Only a row that still has no key: a key written by a save or an edit in between is kept.
const SET_KEY_SQL: &str =
    "UPDATE bookmark SET compare_key = ?2 WHERE id = ?1 AND compare_key IS NULL";

/// True for a query parameter the key drops: `utm_*`, `fbclid`, `gclid` (any letter case).
fn is_tracking(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.starts_with("utm_") || name == "fbclid" || name == "gclid"
}

/// The compare key of a parsed link, or `None` when it has no host.
pub fn compare_key(url: &url::Url) -> Option<String> {
    let host = url.host_str()?.trim_end_matches('.').to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    if host.is_empty() {
        return None;
    }
    // `Url::port` is `None` for the default port of the scheme.
    let port = url.port().map(|p| format!(":{p}")).unwrap_or_default();
    let path = url.path();
    let path = path.strip_suffix('/').unwrap_or(path);
    let kept: Vec<&str> = url
        .query()
        .unwrap_or("")
        .split('&')
        .filter(|pair| !pair.is_empty())
        .filter(|pair| !is_tracking(pair.split('=').next().unwrap_or("")))
        .collect();
    let query = if kept.is_empty() {
        String::new()
    } else {
        format!("?{}", kept.join("&"))
    };
    Some(format!("{}://{host}{port}{path}{query}", url.scheme()))
}

/// The compare key of link text, or `None` when it is not a parsable web address.
pub fn compare_key_of(text: &str) -> Option<String> {
    compare_key(&url::Url::parse(text.trim()).ok()?)
}

impl Storage {
    /// Fills `compare_key` for every bookmark that has none (rows saved before migration 10), in
    /// batches inside one transaction each. A link that cannot be parsed keeps a NULL key (it is
    /// never invented) and is tried again at the next open. Returns the rows filled.
    ///
    /// One transaction per batch is safe: each row's key is independent of every other row, the
    /// write only fills a NULL key, and a fill that stops half way leaves the rest NULL for the
    /// next open, never a half-written row.
    pub(crate) fn fill_compare_keys(&mut self) -> Result<usize, StorageError> {
        let mut filled = 0;
        let mut after = String::new();
        loop {
            let tx = self.immediate()?;
            // SQLite does not enforce the TEXT type, so a url may be any value: read it as one, and
            // skip a row whose url is not text (it keeps a NULL key) instead of stopping the fill.
            let rows: Vec<(String, Value)> = {
                let mut st = tx.prepare_cached(UNKEYED_SQL)?;
                let rows =
                    st.query_map(params![after, FILL_BATCH], |r| Ok((r.get(0)?, r.get(1)?)))?;
                rows.collect::<Result<_, _>>()?
            };
            let Some((last, _)) = rows.last() else {
                return Ok(filled);
            };
            after = last.clone();
            for (id, url) in &rows {
                let Value::Text(url) = url else { continue };
                if let Some(key) = compare_key_of(url) {
                    filled += tx.execute(SET_KEY_SQL, params![id, key])?;
                }
            }
            tx.commit()?;
        }
    }

    /// Tests only: the stored compare key of bookmark `id`, deleted or not.
    #[cfg(test)]
    pub(crate) fn compare_key_of_bookmark(&self, id: &str) -> Result<Option<String>, StorageError> {
        use rusqlite::OptionalExtension;
        Ok(self
            .conn
            .query_row(
                "SELECT compare_key FROM bookmark WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .optional()?
            .flatten())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::testing::open_temp;

    fn key(s: &str) -> String {
        compare_key_of(s).unwrap()
    }

    #[test]
    fn duplicate_key_ignores_www_the_fragment_a_trailing_slash_and_host_case() {
        let base = key("https://example.org/a");
        for same in [
            "https://www.example.org/a",
            "https://example.org/a#top",
            "https://example.org/a/",
            "https://EXAMPLE.Org/a",
            "https://example.org./a",
            "https://example.org:443/a",
        ] {
            assert_eq!(key(same), base, "{same}");
        }
        assert_eq!(key("http://example.org:80/"), key("http://example.org"));
        assert_ne!(key("https://example.org:8443/a"), base);
    }

    #[test]
    fn duplicate_key_drops_only_utm_fbclid_and_gclid_and_keeps_other_query_parameters() {
        assert_eq!(
            key("https://example.org/a?utm_source=x&id=7&fbclid=1&UTM_medium=y&gclid=2"),
            key("https://example.org/a?id=7")
        );
        assert_eq!(
            key("https://example.org/a?utm_source=x"),
            key("https://example.org/a")
        );
        assert_ne!(
            key("https://example.org/a?id=7"),
            key("https://example.org/a?id=8")
        );
        assert_ne!(
            key("https://example.org/a?id=7"),
            key("https://example.org/a")
        );
        assert_ne!(
            key("https://example.org/a?q=1"),
            key("https://example.org/a?q=1&r=2")
        );
    }

    #[test]
    fn duplicate_key_treats_http_and_https_and_another_parameter_order_as_different_links() {
        assert_ne!(key("http://example.org/a"), key("https://example.org/a"));
        assert_ne!(
            key("https://example.org/a?x=1&y=2"),
            key("https://example.org/a?y=2&x=1")
        );
    }

    #[test]
    fn duplicate_key_keeps_the_letter_case_of_the_path_and_tells_two_pages_apart() {
        assert_ne!(
            key("https://example.org/Page"),
            key("https://example.org/page")
        );
        assert_ne!(
            key("https://example.org/one"),
            key("https://example.org/two")
        );
        assert_ne!(
            key("https://example.org/one"),
            key("https://example.org/one/two")
        );
    }

    #[test]
    fn duplicate_key_of_the_site_root_is_the_same_with_and_without_the_slash() {
        assert_eq!(key("https://example.org"), key("https://example.org/"));
        assert_eq!(key("https://example.org/?"), key("https://example.org/"));
    }

    #[test]
    fn duplicate_key_is_none_for_text_that_is_not_a_web_address() {
        assert_eq!(compare_key_of("not a link"), None);
        assert_eq!(compare_key_of("mailto:a@b.example"), None);
    }

    #[test]
    fn duplicate_fill_at_open_gives_old_bookmarks_their_key_and_skips_an_unparsable_link() {
        let (mut s, _d) = open_temp();
        for (id, url) in [
            ("b-1", "https://www.example.org/a#x"),
            ("b-2", "https://example.org/b"),
            ("b-3", "not a link"),
        ] {
            s.conn
                .execute(
                    "INSERT INTO bookmark (id, created_at, updated_at, url) VALUES (?1, ?2, ?2, ?3)",
                    params![id, "2026-01-01T00:00:00Z", url],
                )
                .unwrap();
        }
        assert_eq!(s.fill_compare_keys().unwrap(), 2);
        assert_eq!(
            s.compare_key_of_bookmark("b-1").unwrap().as_deref(),
            Some("https://example.org/a")
        );
        assert_eq!(
            s.compare_key_of_bookmark("b-2").unwrap().as_deref(),
            Some("https://example.org/b")
        );
        // Honest failure: a link that cannot be read gets no invented key, and a second fill
        // finds nothing new.
        assert_eq!(s.compare_key_of_bookmark("b-3").unwrap(), None);
        assert_eq!(s.fill_compare_keys().unwrap(), 0);
    }
    #[test]
    fn duplicate_fill_at_open_skips_a_row_whose_url_is_not_text_and_keys_the_rows_after_it() {
        let (mut s, _d) = open_temp();
        // SQLite does not enforce TEXT: a blob url sorts first (id 'a'), rows after it must still
        // get their key.
        s.conn
            .execute(
                "INSERT INTO bookmark (id, created_at, updated_at, url) VALUES ('a', ?1, ?1, X'6162')",
                ["2026-01-01T00:00:00Z"],
            )
            .unwrap();
        s.conn
            .execute(
                "INSERT INTO bookmark (id, created_at, updated_at, url) VALUES ('b', ?1, ?1, 'https://example.org/b')",
                ["2026-01-01T00:00:00Z"],
            )
            .unwrap();
        assert_eq!(s.fill_compare_keys().unwrap(), 1);
        assert_eq!(s.compare_key_of_bookmark("a").unwrap(), None);
        assert_eq!(
            s.compare_key_of_bookmark("b").unwrap().as_deref(),
            Some("https://example.org/b")
        );
    }
}
