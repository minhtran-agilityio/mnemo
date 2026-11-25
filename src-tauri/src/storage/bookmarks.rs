//! Saved links with a summary and tags (#25, BM-01). This file owns the SQL of the
//! `bookmark.site` and `bookmark.summary_status` columns and of `bookmark_label`.
//!
//! A save stores the link at once (status `pending`), before any page read or AI work, so
//! nothing is lost when that work fails. The summary, the reason (always a guess) and the
//! tags are written together in one transaction, and only then is the status `done`. A tag is
//! a top label (`label.parent_id` NULL), found by name ignoring case or created.

use std::collections::HashSet;

use rusqlite::{params, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};

use super::error::StorageError;
use super::items::{invalid, optional_chars, required_text, web_address, MAX_TITLE_CHARS};
use super::labels::{clean_name, MAX_LABELS};
use super::record::{now_iso, Cursor, Page, PageRequest, RecordBase};
use super::Storage;

/// Most tags on one bookmark.
pub const MAX_TAGS: usize = 6;
/// Longest summary, in characters.
pub const MAX_SUMMARY_CHARS: usize = 2000;
/// Longest reason, in characters.
pub const MAX_REASON_CHARS: usize = 500;

const BOOKMARK_NOT_FOUND: StorageError = StorageError::NotFound { kind: "bookmark" };

/// Where the summary of a bookmark stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SummaryStatus {
    /// Stored, no summary yet: the save is starting, or the AI run gave no answer.
    Pending,
    /// Mnemo is reading the page or waiting on the AI run.
    Reading,
    /// The page could not be read: link only, no summary.
    Unreadable,
    /// AI was off or at the limit: link only, summary later.
    AiOff,
    /// The summary, the tags and the reason are stored.
    Done,
}

impl SummaryStatus {
    fn as_str(self) -> &'static str {
        match self {
            SummaryStatus::Pending => "pending",
            SummaryStatus::Reading => "reading",
            SummaryStatus::Unreadable => "unreadable",
            SummaryStatus::AiOff => "ai_off",
            SummaryStatus::Done => "done",
        }
    }

    fn parse(text: &str) -> Option<SummaryStatus> {
        [
            SummaryStatus::Pending,
            SummaryStatus::Reading,
            SummaryStatus::Unreadable,
            SummaryStatus::AiOff,
            SummaryStatus::Done,
        ]
        .into_iter()
        .find(|s| s.as_str() == text)
    }
}

/// One tag of a bookmark: its label id and name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkTag {
    pub id: String,
    pub name: String,
}

/// A bookmark as the save-a-link screen shows it: the #14 fields plus the site, the summary
/// status and the tags.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedBookmark {
    #[serde(flatten)]
    pub base: RecordBase,
    pub url: String,
    pub title: Option<String>,
    /// The host of the link, for example "example.org". Null when unknown.
    pub site: Option<String>,
    /// Null when there is no summary (honest failure).
    pub summary: Option<String>,
    pub reason: Option<String>,
    /// True when the app wrote the reason: it is shown as a guess.
    pub reason_is_guess: bool,
    pub summary_status: SummaryStatus,
    /// The tag names, in name order.
    pub tags: Vec<String>,
    /// The same tags with their label ids.
    pub labels: Vec<BookmarkTag>,
}

/// What a finished summary run gives: the summary, the reason (a guess) and 1 to 6 tags.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BookmarkSummary {
    pub summary: String,
    pub reason: String,
    pub tags: Vec<String>,
}

// ---- SQL. Fixed text, parameters only. ----

const INSERT_SQL: &str = "INSERT INTO bookmark
         (id, created_at, updated_at, url, title, summary, reason, reason_is_guess, site, summary_status)
     VALUES (?1, ?2, ?2, ?3, NULL, NULL, NULL, 0, ?4, 'pending')";

const GET_SQL: &str =
    "SELECT b.id, b.created_at, b.updated_at, b.deleted_at, b.url, b.title, b.site,
         b.summary, b.reason, b.reason_is_guess, b.summary_status
     FROM bookmark b WHERE b.id = ?1 AND b.deleted_at IS NULL";

// ?1 and ?2 the cursor (or NULL), ?3 the row limit. Newest first; idx_bookmark_list serves it.
const LIST_SQL: &str =
    "SELECT b.id, b.created_at, b.updated_at, b.deleted_at, b.url, b.title, b.site,
         b.summary, b.reason, b.reason_is_guess, b.summary_status
     FROM bookmark b
     WHERE b.deleted_at IS NULL AND (?1 IS NULL OR (b.created_at, b.id) < (?1, ?2))
     ORDER BY b.created_at DESC, b.id DESC LIMIT ?3";

// A status other than done leaves the summary, reason and tags as they are.
const SET_STATUS_SQL: &str = "UPDATE bookmark SET summary_status = ?3, updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL";

const SET_TITLE_SQL: &str = "UPDATE bookmark SET title = ?3, updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL";

const SET_SUMMARY_SQL: &str = "UPDATE bookmark
     SET summary = ?3, reason = ?4, reason_is_guess = 1, summary_status = 'done', updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL";

// Rows a closed app left in reading go back to pending ("no summary yet").
const RESET_READING_SQL: &str = "UPDATE bookmark SET summary_status = 'pending', updated_at = ?1
     WHERE summary_status = 'reading' AND deleted_at IS NULL";

const FIND_TOP_LABEL_SQL: &str = "SELECT id FROM label
     WHERE deleted_at IS NULL AND parent_id IS NULL AND name = ?1 COLLATE NOCASE LIMIT 1";

const COUNT_LABELS_SQL: &str = "SELECT count(*) FROM label WHERE deleted_at IS NULL";

const INSERT_TOP_LABEL_SQL: &str =
    "INSERT INTO label (id, created_at, updated_at, name, parent_id) VALUES (?1, ?2, ?2, ?3, NULL)";

// Adds the link, or brings a removed one back. A live link keeps its times.
const UPSERT_TAG_SQL: &str =
    "INSERT INTO bookmark_label (id, bookmark_id, label_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT (bookmark_id, label_id) DO UPDATE SET
         updated_at = CASE WHEN deleted_at IS NULL THEN updated_at ELSE excluded.updated_at END,
         deleted_at = NULL";

const LIVE_TAG_LINKS_SQL: &str =
    "SELECT label_id FROM bookmark_label WHERE bookmark_id = ?1 AND deleted_at IS NULL";

const HIDE_TAG_SQL: &str = "UPDATE bookmark_label SET deleted_at = ?3, updated_at = ?3
     WHERE bookmark_id = ?1 AND label_id = ?2 AND deleted_at IS NULL";

// The live tags of bookmark ?1, by name.
const TAGS_OF_BOOKMARK_SQL: &str = "SELECT l.id, l.name FROM bookmark_label bl
     JOIN label l ON l.id = bl.label_id AND l.deleted_at IS NULL
     WHERE bl.bookmark_id = ?1 AND bl.deleted_at IS NULL
     ORDER BY l.name COLLATE NOCASE, l.id";

/// The host of a web address, lower case and without a leading "www.", or `None`.
/// The address was checked by `web_address` first.
pub fn site_of(url: &str) -> Option<String> {
    let rest = url.split_once("://")?.1;
    let authority = rest.split(['/', '?', '#']).next()?;
    let host_port = authority.rsplit('@').next()?;
    let host = if let Some(v6) = host_port.strip_prefix('[') {
        v6.split(']').next()?
    } else {
        host_port.split(':').next()?
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    (!host.is_empty()).then_some(host)
}

/// The base fields and columns of one row; the tags are read after.
fn row_without_tags(r: &Row<'_>) -> rusqlite::Result<SavedBookmark> {
    let status: String = r.get(10)?;
    let summary_status = SummaryStatus::parse(&status).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            10,
            rusqlite::types::Type::Text,
            format!("unknown summary status {status}").into(),
        )
    })?;
    Ok(SavedBookmark {
        base: RecordBase {
            id: r.get(0)?,
            created_at: r.get(1)?,
            updated_at: r.get(2)?,
            deleted_at: r.get(3)?,
        },
        url: r.get(4)?,
        title: r.get(5)?,
        site: r.get(6)?,
        summary: r.get(7)?,
        reason: r.get(8)?,
        reason_is_guess: r.get(9)?,
        summary_status,
        tags: Vec::new(),
        labels: Vec::new(),
    })
}

/// Checks a summary before anything is written: non-blank, within the limits, 1 to 6 tags,
/// each a valid top label name, no tag twice (ignoring case). Returns the trimmed tags.
fn checked_tags(s: &BookmarkSummary) -> Result<Vec<String>, StorageError> {
    required_text("summary", &s.summary)?;
    required_text("reason", &s.reason)?;
    if s.summary.chars().count() > MAX_SUMMARY_CHARS {
        return Err(invalid(format!(
            "The summary is too long (at most {MAX_SUMMARY_CHARS} characters)."
        )));
    }
    if s.reason.chars().count() > MAX_REASON_CHARS {
        return Err(invalid(format!(
            "The reason is too long (at most {MAX_REASON_CHARS} characters)."
        )));
    }
    if s.tags.is_empty() || s.tags.len() > MAX_TAGS {
        return Err(invalid(format!("A bookmark has 1 to {MAX_TAGS} tags.")));
    }
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for tag in &s.tags {
        let name = clean_name(tag)?;
        if seen.insert(name.to_lowercase()) {
            out.push(name);
        }
    }
    Ok(out)
}

/// Checks a summary as `set_bookmark_summary` would, without writing. The AI side uses it to
/// refuse an answer that could not be stored (a schema error).
pub fn check_summary(s: &BookmarkSummary) -> Result<(), StorageError> {
    checked_tags(s).map(|_| ())
}

/// The id of the live top label named `name` (ignoring case), created when missing. `None`
/// when a new label would pass the label limit: that tag is left out, the rest is saved.
fn top_label(tx: &Transaction<'_>, now: &str, name: &str) -> Result<Option<String>, StorageError> {
    if let Some(id) = tx
        .query_row(FIND_TOP_LABEL_SQL, [name], |r| r.get(0))
        .optional()?
    {
        return Ok(Some(id));
    }
    let count: u32 = tx.query_row(COUNT_LABELS_SQL, [], |r| r.get(0))?;
    if count >= MAX_LABELS {
        log::warn!("a bookmark tag was left out: Mnemo holds {MAX_LABELS} labels");
        return Ok(None);
    }
    let id = RecordBase::new_at(now).id;
    tx.execute(INSERT_TOP_LABEL_SQL, params![id, now, name])?;
    Ok(Some(id))
}

impl Storage {
    /// Stores a new link at once: no title, no summary, status `pending`, and the site taken
    /// from the link. The link must be an http or https web address.
    pub fn save_link(&self, url: &str) -> Result<SavedBookmark, StorageError> {
        self.save_link_at(&now_iso(), url)
    }

    pub(crate) fn save_link_at(&self, now: &str, url: &str) -> Result<SavedBookmark, StorageError> {
        let url = url.trim();
        web_address(url)?;
        let base = RecordBase::new_at(now);
        self.conn
            .execute(INSERT_SQL, params![base.id, now, url, site_of(url)])?;
        self.get_saved_bookmark(&base.id)
    }

    /// The live bookmark with its site, status and tags.
    pub fn get_saved_bookmark(&self, id: &str) -> Result<SavedBookmark, StorageError> {
        let mut b = self
            .conn
            .query_row(GET_SQL, [id], row_without_tags)
            .optional()?
            .ok_or(BOOKMARK_NOT_FOUND)?;
        self.fill_tags(&mut b)?;
        Ok(b)
    }

    /// One page of live bookmarks with their site, status and tags, newest first.
    pub fn list_bookmark_cards(
        &self,
        page: &PageRequest,
    ) -> Result<Page<SavedBookmark>, StorageError> {
        page.validate()?;
        let (at, id) = match &page.after {
            Some(c) => (Some(c.created_at.as_str()), Some(c.id.as_str())),
            None => (None, None),
        };
        let mut rows = {
            let mut st = self.conn.prepare_cached(LIST_SQL)?;
            let rows = st.query_map(params![at, id, page.limit + 1], row_without_tags)?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let next = if rows.len() > page.limit as usize {
            rows.truncate(page.limit as usize);
            rows.last().map(|b| Cursor {
                created_at: b.base.created_at.clone(),
                id: b.base.id.clone(),
            })
        } else {
            None
        };
        for b in &mut rows {
            self.fill_tags(b)?;
        }
        Ok(Page { items: rows, next })
    }

    fn fill_tags(&self, b: &mut SavedBookmark) -> Result<(), StorageError> {
        let mut st = self.conn.prepare_cached(TAGS_OF_BOOKMARK_SQL)?;
        let rows = st.query_map([&b.base.id], |r| {
            Ok(BookmarkTag {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        })?;
        b.labels = rows.collect::<Result<_, _>>()?;
        b.tags = b.labels.iter().map(|t| t.name.clone()).collect();
        Ok(())
    }

    /// Sets where the summary stands. `done` is refused here: only a stored summary sets it.
    pub fn set_bookmark_status(
        &self,
        id: &str,
        status: SummaryStatus,
    ) -> Result<SavedBookmark, StorageError> {
        self.set_bookmark_status_at(&now_iso(), id, status)
    }

    pub(crate) fn set_bookmark_status_at(
        &self,
        now: &str,
        id: &str,
        status: SummaryStatus,
    ) -> Result<SavedBookmark, StorageError> {
        if status == SummaryStatus::Done {
            return Err(invalid(
                "A bookmark is done only when its summary is stored.".to_string(),
            ));
        }
        let n = self
            .conn
            .execute(SET_STATUS_SQL, params![id, now, status.as_str()])?;
        if n == 0 {
            return Err(BOOKMARK_NOT_FOUND);
        }
        self.get_saved_bookmark(id)
    }

    /// Sets the title read from the page: trimmed, 1 to 500 characters, or null.
    pub fn set_bookmark_title(
        &self,
        id: &str,
        title: Option<&str>,
    ) -> Result<SavedBookmark, StorageError> {
        self.set_bookmark_title_at(&now_iso(), id, title)
    }

    pub(crate) fn set_bookmark_title_at(
        &self,
        now: &str,
        id: &str,
        title: Option<&str>,
    ) -> Result<SavedBookmark, StorageError> {
        let title = title.map(str::trim).filter(|t| !t.is_empty());
        optional_chars("title", &title.map(str::to_string), MAX_TITLE_CHARS)?;
        let n = self.conn.execute(SET_TITLE_SQL, params![id, now, title])?;
        if n == 0 {
            return Err(BOOKMARK_NOT_FOUND);
        }
        self.get_saved_bookmark(id)
    }

    /// Stores the summary, the reason (marked as a guess) and the tags in one transaction, and
    /// sets the status to `done`. The tags replace the bookmark's old tags. Nothing is written
    /// when any part is invalid.
    pub fn set_bookmark_summary(
        &mut self,
        id: &str,
        summary: &BookmarkSummary,
    ) -> Result<SavedBookmark, StorageError> {
        self.set_bookmark_summary_at(&now_iso(), id, summary)
    }

    pub(crate) fn set_bookmark_summary_at(
        &mut self,
        now: &str,
        id: &str,
        summary: &BookmarkSummary,
    ) -> Result<SavedBookmark, StorageError> {
        let tags = checked_tags(summary)?;
        let tx = self.immediate()?;
        let n = tx.execute(
            SET_SUMMARY_SQL,
            params![id, now, summary.summary.trim(), summary.reason.trim()],
        )?;
        if n == 0 {
            return Err(BOOKMARK_NOT_FOUND);
        }
        let mut keep = HashSet::new();
        for name in &tags {
            if let Some(label_id) = top_label(&tx, now, name)? {
                let link_id = RecordBase::new_at(now).id;
                tx.execute(UPSERT_TAG_SQL, params![link_id, id, label_id, now])?;
                keep.insert(label_id);
            }
        }
        let old: Vec<String> = {
            let mut st = tx.prepare(LIVE_TAG_LINKS_SQL)?;
            let rows = st.query_map([id], |r| r.get(0))?;
            rows.collect::<Result<_, _>>()?
        };
        for label_id in old.iter().filter(|l| !keep.contains(*l)) {
            tx.execute(HIDE_TAG_SQL, params![id, label_id, now])?;
        }
        tx.commit()?;
        self.get_saved_bookmark(id)
    }

    /// Turns bookmarks left in `reading` by an app that closed back into `pending`, so no
    /// card waits for a read that will never end. Returns how many changed.
    pub(crate) fn reset_reading_bookmarks_at(&self, now: &str) -> Result<usize, StorageError> {
        Ok(self.conn.execute(RESET_READING_SQL, [now])?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::items::tests::{bookmark, T1};
    use crate::storage::items::Bookmark;
    use crate::storage::testing::open_temp;

    const T2: &str = "2026-01-02T00:00:00Z";
    const T3: &str = "2026-01-03T00:00:00Z";

    fn summary(tags: &[&str]) -> BookmarkSummary {
        BookmarkSummary {
            summary: "Each window gets a list of allowed commands.".into(),
            reason: "It may matter for the command allow-list.".into(),
            tags: tags.iter().map(|t| t.to_string()).collect(),
        }
    }

    #[test]
    fn site_of_gives_the_host_without_www_port_or_user() {
        let cases = [
            ("https://www.Example.org/a?b", Some("example.org")),
            ("http://v2.tauri.app:8080/x", Some("v2.tauri.app")),
            ("https://user:pw@host.example/", Some("host.example")),
            ("https://[2001:db8::1]:443/", Some("2001:db8::1")),
            ("https://example.org.", Some("example.org")),
            ("not a link", None),
        ];
        for (url, want) in cases {
            assert_eq!(site_of(url).as_deref(), want, "{url}");
        }
    }

    #[test]
    fn save_link_stores_the_link_at_once_as_pending_with_its_site() {
        let (s, _d) = open_temp();
        let b = s
            .save_link_at(T1, " https://www.example.org/page ")
            .unwrap();
        assert_eq!(b.url, "https://www.example.org/page");
        assert_eq!(b.site.as_deref(), Some("example.org"));
        assert_eq!(b.summary_status, SummaryStatus::Pending);
        assert_eq!((b.title, b.summary, b.reason), (None, None, None));
        assert!(!b.reason_is_guess);
        assert!(b.tags.is_empty());
        assert_eq!(b.base.created_at, T1);
        assert_eq!(s.get_saved_bookmark(&b.base.id).unwrap().url, b.url);
    }

    #[test]
    fn save_link_refuses_a_link_that_is_not_a_web_address_and_stores_nothing() {
        let (s, _d) = open_temp();
        for url in [
            "not a link",
            "ftp://x.example",
            "javascript:alert(1)",
            "",
            "https://",
        ] {
            assert!(
                matches!(s.save_link_at(T1, url), Err(StorageError::Invalid(_))),
                "{url}"
            );
        }
        let page = s.list_bookmark_cards(&PageRequest::first(10)).unwrap();
        assert!(page.items.is_empty());
    }

    #[test]
    fn set_bookmark_status_changes_only_the_status_and_refuses_done() {
        let (s, _d) = open_temp();
        let b = s.save_link_at(T1, "https://a.example").unwrap();
        for st in [
            SummaryStatus::Reading,
            SummaryStatus::Unreadable,
            SummaryStatus::AiOff,
            SummaryStatus::Pending,
        ] {
            let got = s.set_bookmark_status_at(T2, &b.base.id, st).unwrap();
            assert_eq!(got.summary_status, st);
            assert_eq!(got.base.updated_at, T2);
            assert_eq!(got.summary, None);
        }
        assert!(matches!(
            s.set_bookmark_status_at(T2, &b.base.id, SummaryStatus::Done),
            Err(StorageError::Invalid(_))
        ));
        assert_eq!(
            s.set_bookmark_status_at(T2, "missing", SummaryStatus::Reading),
            Err(BOOKMARK_NOT_FOUND)
        );
    }

    #[test]
    fn set_bookmark_title_trims_and_checks_the_title() {
        let (s, _d) = open_temp();
        let b = s.save_link_at(T1, "https://a.example").unwrap();
        let got = s
            .set_bookmark_title_at(T2, &b.base.id, Some("  Page  "))
            .unwrap();
        assert_eq!(got.title.as_deref(), Some("Page"));
        let got = s
            .set_bookmark_title_at(T2, &b.base.id, Some("   "))
            .unwrap();
        assert_eq!(got.title, None);
        let long = "a".repeat(MAX_TITLE_CHARS + 1);
        assert!(s
            .set_bookmark_title_at(T2, &b.base.id, Some(&long))
            .is_err());
        assert_eq!(
            s.set_bookmark_title_at(T2, "missing", None),
            Err(BOOKMARK_NOT_FOUND)
        );
    }

    #[test]
    fn set_bookmark_summary_stores_summary_reason_as_guess_and_top_label_tags() {
        let (mut s, _d) = open_temp();
        let b = s.save_link_at(T1, "https://a.example").unwrap();
        let got = s
            .set_bookmark_summary_at(T2, &b.base.id, &summary(&["tauri", " Security ", "TAURI"]))
            .unwrap();
        assert_eq!(got.summary_status, SummaryStatus::Done);
        assert_eq!(
            got.summary.as_deref(),
            Some("Each window gets a list of allowed commands.")
        );
        assert_eq!(
            got.reason.as_deref(),
            Some("It may matter for the command allow-list.")
        );
        assert!(got.reason_is_guess);
        // Same name in another case is one tag; tags are top labels.
        assert_eq!(got.tags, vec!["Security".to_string(), "tauri".to_string()]);
        let labels = s.list_labels().unwrap();
        assert_eq!(labels.len(), 2);
        assert!(labels.iter().all(|l| l.parent_id.is_none()));
    }

    #[test]
    fn set_bookmark_summary_reuses_an_existing_label_and_replaces_old_tags() {
        let (mut s, _d) = open_temp();
        let rust = s.create_label_at(T1, None, "Rust").unwrap();
        let b = s.save_link_at(T1, "https://a.example").unwrap();
        s.set_bookmark_summary_at(T2, &b.base.id, &summary(&["rust", "old"]))
            .unwrap();
        let got = s
            .set_bookmark_summary_at(T3, &b.base.id, &summary(&["new", "RUST"]))
            .unwrap();
        assert_eq!(got.tags, vec!["new".to_string(), "Rust".to_string()]);
        assert!(got.labels.iter().any(|t| t.id == rust.base.id));
        // The dropped tag's label stays; only the link is hidden.
        assert!(s.list_labels().unwrap().iter().any(|l| l.name == "old"));
        // Bringing a dropped tag back revives its link.
        let got = s
            .set_bookmark_summary_at(T3, &b.base.id, &summary(&["old"]))
            .unwrap();
        assert_eq!(got.tags, vec!["old".to_string()]);
    }

    #[test]
    fn set_bookmark_summary_refuses_bad_input_and_writes_nothing() {
        let (mut s, _d) = open_temp();
        let b = s.save_link_at(T1, "https://a.example").unwrap();
        let mut blank = summary(&["a"]);
        blank.summary = "  ".into();
        let mut no_reason = summary(&["a"]);
        no_reason.reason = String::new();
        let mut long = summary(&["a"]);
        long.summary = "x".repeat(MAX_SUMMARY_CHARS + 1);
        let bad = [
            blank,
            no_reason,
            long,
            summary(&[]),
            summary(&["a", "b", "c", "d", "e", "f", "g"]),
            summary(&["two\nlines"]),
            summary(&[&"t".repeat(81)]),
        ];
        for input in bad {
            assert!(
                matches!(
                    s.set_bookmark_summary_at(T2, &b.base.id, &input),
                    Err(StorageError::Invalid(_))
                ),
                "{input:?}"
            );
        }
        let after = s.get_saved_bookmark(&b.base.id).unwrap();
        assert_eq!(after.summary_status, SummaryStatus::Pending);
        assert!(after.tags.is_empty());
        assert!(s.list_labels().unwrap().is_empty());
        assert_eq!(
            s.set_bookmark_summary_at(T2, "missing", &summary(&["a"])),
            Err(BOOKMARK_NOT_FOUND)
        );
    }

    #[test]
    fn set_bookmark_summary_leaves_out_a_new_tag_past_the_label_limit() {
        let (mut s, _d) = open_temp();
        for i in 0..MAX_LABELS {
            s.create_label_at(T1, None, &format!("l{i}")).unwrap();
        }
        let b = s.save_link_at(T1, "https://a.example").unwrap();
        let got = s
            .set_bookmark_summary_at(T2, &b.base.id, &summary(&["l1", "brand-new"]))
            .unwrap();
        assert_eq!(got.tags, vec!["l1".to_string()]);
        assert_eq!(got.summary_status, SummaryStatus::Done);
    }

    #[test]
    fn a_deleted_tag_label_or_a_deleted_bookmark_is_left_out() {
        let (mut s, _d) = open_temp();
        let b = s.save_link_at(T1, "https://a.example").unwrap();
        let got = s
            .set_bookmark_summary_at(T2, &b.base.id, &summary(&["keep", "drop"]))
            .unwrap();
        let drop_id = got
            .labels
            .iter()
            .find(|t| t.name == "drop")
            .unwrap()
            .id
            .clone();
        s.delete_label_at(T3, &drop_id).unwrap();
        // The delete hides the link row itself, in the same transaction as the label.
        let live_links: i64 = s
            .conn
            .query_row(
                "SELECT count(*) FROM bookmark_label WHERE label_id = ?1 AND deleted_at IS NULL",
                [&drop_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(live_links, 0);
        assert_eq!(
            s.get_saved_bookmark(&b.base.id).unwrap().tags,
            vec!["keep".to_string()]
        );
        s.delete_at::<Bookmark>(T3, &b.base.id).unwrap();
        assert_eq!(s.get_saved_bookmark(&b.base.id), Err(BOOKMARK_NOT_FOUND));
        assert!(s
            .list_bookmark_cards(&PageRequest::first(10))
            .unwrap()
            .items
            .is_empty());
    }

    #[test]
    fn list_bookmark_cards_pages_newest_first_and_includes_old_bookmarks() {
        let (s, _d) = open_temp();
        // A bookmark from the #14 add path is listed too, as pending with no site.
        let old: Bookmark = s.add_at(T1, &bookmark("https://old.example")).unwrap();
        let a = s.save_link_at(T2, "https://a.example").unwrap();
        let b = s.save_link_at(T3, "https://b.example").unwrap();
        let first = s.list_bookmark_cards(&PageRequest::first(2)).unwrap();
        let ids: Vec<_> = first.items.iter().map(|x| x.base.id.clone()).collect();
        assert_eq!(ids, vec![b.base.id.clone(), a.base.id.clone()]);
        let next = first.next.clone().unwrap();
        let second = s
            .list_bookmark_cards(&PageRequest {
                limit: 2,
                after: Some(next),
            })
            .unwrap();
        assert_eq!(second.items.len(), 1);
        assert_eq!(second.items[0].base.id, old.base.id);
        assert_eq!(second.items[0].summary_status, SummaryStatus::Pending);
        assert_eq!(second.next, None);
        assert!(s.list_bookmark_cards(&PageRequest::first(0)).is_err());
    }

    #[test]
    fn reset_reading_bookmarks_turns_only_reading_rows_into_pending() {
        let (s, _d) = open_temp();
        let reading = s.save_link_at(T1, "https://a.example").unwrap();
        let off = s.save_link_at(T1, "https://b.example").unwrap();
        s.set_bookmark_status_at(T1, &reading.base.id, SummaryStatus::Reading)
            .unwrap();
        s.set_bookmark_status_at(T1, &off.base.id, SummaryStatus::AiOff)
            .unwrap();
        assert_eq!(s.reset_reading_bookmarks_at(T2).unwrap(), 1);
        assert_eq!(
            s.get_saved_bookmark(&reading.base.id)
                .unwrap()
                .summary_status,
            SummaryStatus::Pending
        );
        assert_eq!(
            s.get_saved_bookmark(&off.base.id).unwrap().summary_status,
            SummaryStatus::AiOff
        );
    }

    #[test]
    fn a_saved_bookmark_serialises_in_camel_case_with_its_status() {
        let (s, _d) = open_temp();
        let b = s.save_link_at(T1, "https://a.example").unwrap();
        let json = serde_json::to_value(&b).unwrap();
        assert_eq!(json["summaryStatus"], "pending");
        assert_eq!(json["site"], "a.example");
        assert_eq!(json["reasonIsGuess"], false);
        assert!(json["tags"].as_array().unwrap().is_empty());
        assert!(json.get("createdAt").is_some());
    }
}
