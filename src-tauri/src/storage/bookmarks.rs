//! Saved links with a summary and tags (#25, BM-01). This file owns the SQL of the
//! `bookmark.site` and `bookmark.summary_status` columns and of `bookmark_label`.
//!
//! A save stores the link at once, before any page read or AI work, so nothing is lost when
//! that work fails. A summary run first holds the claim (`reading`): the save stores the link
//! as `reading` in one statement, "Summarize later" claims it in one conditional UPDATE.
//! **Only a run that holds the claim may write, and every write after the claim is conditional
//! on `summary_status = 'reading'`.** No row changed means the owner took the bookmark over
//! (for example wrote a summary) or deleted it: the run stops and changes nothing (`Held::Lost`). The summary, the reason (always a guess) and the
//! tags are written together in one transaction, and only then is the status `done`. A tag is
//! a label found by name ignoring case (a top label first, else one the owner moved under a
//! parent), or a new top label (`label.parent_id` NULL).

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
    /// Stored, no summary yet: the save is starting, the site could not be reached for now, or
    /// the AI run gave no answer.
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

/// What a write that needs the summary claim did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Held {
    /// The run held the claim and the write is done: the bookmark after it.
    Written(SavedBookmark),
    /// The run no longer holds the claim and nothing was written: the owner changed the
    /// bookmark (its current row) or deleted it (`None`).
    Lost(Option<SavedBookmark>),
}

// ---- SQL. Fixed text, parameters only. ----

const INSERT_SQL: &str = "INSERT INTO bookmark
         (id, created_at, updated_at, url, title, summary, reason, reason_is_guess, site, summary_status)
     VALUES (?1, ?2, ?2, ?3, NULL, NULL, NULL, 0, ?4, ?5)";

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

// Tests only: any status, claim or not.
#[cfg(test)]
const SET_STATUS_SQL: &str = "UPDATE bookmark SET summary_status = ?3, updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL";

// Ends a claim with a status other than done; the summary, reason and tags stay as they are.
const RELEASE_SQL: &str = "UPDATE bookmark SET summary_status = ?3, updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL AND summary_status = 'reading'";

// Starts a new summary: only a live bookmark that is not done and not being read already.
const CLAIM_SQL: &str = "UPDATE bookmark SET summary_status = 'reading', updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL AND summary_status NOT IN ('reading', 'done')";

const SET_TITLE_SQL: &str = "UPDATE bookmark SET title = ?3, updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL AND summary_status = 'reading'";

const SET_SUMMARY_SQL: &str = "UPDATE bookmark
     SET summary = ?3, reason = ?4, reason_is_guess = 1, summary_status = 'done', updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL AND summary_status = 'reading'";

// Rows a closed app left in reading go back to pending ("no summary yet").
const RESET_READING_SQL: &str = "UPDATE bookmark SET summary_status = 'pending', updated_at = ?1
     WHERE summary_status = 'reading' AND deleted_at IS NULL";

// A live label named ?1 (ignoring case): a top label first, else the oldest one the owner moved
// under a parent, so a moved tag is not made again at the top.
const FIND_TAG_LABEL_SQL: &str = "SELECT id FROM label
     WHERE deleted_at IS NULL AND name = ?1 COLLATE NOCASE
     ORDER BY parent_id IS NOT NULL, created_at, id LIMIT 1";

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

/// The link as the page reader will fetch it: parsed by the same URL parser, http or https,
/// with a host and no user name or password. A link the two could read differently (such as
/// `http://a.example\@b.example/`) is stored in the parsed form, so the stored link, its site and
/// the page read all name the same host.
fn parsed_link(url: &str) -> Result<url::Url, StorageError> {
    let refused = || {
        invalid(
            "The link must be a web address starting with http:// or https://, with no user name or password."
                .to_string(),
        )
    };
    let parsed = url::Url::parse(url).map_err(|_| refused())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().unwrap_or("").is_empty()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(refused());
    }
    Ok(parsed)
}

/// The host of a parsed link, lower case, without a leading "www." or a trailing dot, or `None`.
pub fn site_of(url: &url::Url) -> Option<String> {
    let host = url
        .host_str()?
        .trim_start_matches('[')
        .trim_end_matches(']');
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

/// The id of the live label named `name` (ignoring case): the top label, else one the owner
/// moved under a parent; a new top label when there is none. `None`
/// when a new label would pass the label limit: that tag is left out, the rest is saved.
fn top_label(tx: &Transaction<'_>, now: &str, name: &str) -> Result<Option<String>, StorageError> {
    if let Some(id) = tx
        .query_row(FIND_TAG_LABEL_SQL, [name], |r| r.get(0))
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
    /// Tests only: stores a new link with no claim (`pending`), as an old row or a failed
    /// run leaves it.
    #[cfg(test)]
    pub(crate) fn save_link_at(&self, now: &str, url: &str) -> Result<SavedBookmark, StorageError> {
        self.insert_link(now, url, SummaryStatus::Pending)
    }

    /// Stores a new link at once, already claimed for its first summary (`reading`), in one
    /// statement, so no other call can start a summary of it first: no title, no summary, and
    /// the site taken from the link. The link must be an http or https web address.
    pub fn save_link_to_read(&self, url: &str) -> Result<SavedBookmark, StorageError> {
        self.save_link_to_read_at(&now_iso(), url)
    }

    pub(crate) fn save_link_to_read_at(
        &self,
        now: &str,
        url: &str,
    ) -> Result<SavedBookmark, StorageError> {
        self.insert_link(now, url, SummaryStatus::Reading)
    }

    fn insert_link(
        &self,
        now: &str,
        url: &str,
        status: SummaryStatus,
    ) -> Result<SavedBookmark, StorageError> {
        let url = url.trim();
        web_address(url)?;
        let parsed = parsed_link(url)?;
        web_address(parsed.as_str())?;
        let base = RecordBase::new_at(now);
        self.conn.execute(
            INSERT_SQL,
            params![
                base.id,
                now,
                parsed.as_str(),
                site_of(&parsed),
                status.as_str()
            ],
        )?;
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

    /// After a write that needs the claim changed `n` rows: the bookmark, or what it is now.
    fn held(&self, n: usize, id: &str) -> Result<Held, StorageError> {
        if n == 1 {
            return Ok(Held::Written(self.get_saved_bookmark(id)?));
        }
        match self.get_saved_bookmark(id) {
            Ok(b) => Ok(Held::Lost(Some(b))),
            Err(StorageError::NotFound { .. }) => Ok(Held::Lost(None)),
            Err(e) => Err(e),
        }
    }

    /// Ends the claim of a summary run with `status` (not `done`, not `reading`): only while
    /// the bookmark is still `reading`. Otherwise nothing changes (`Held::Lost`).
    pub fn release_bookmark(&self, id: &str, status: SummaryStatus) -> Result<Held, StorageError> {
        self.release_bookmark_at(&now_iso(), id, status)
    }

    pub(crate) fn release_bookmark_at(
        &self,
        now: &str,
        id: &str,
        status: SummaryStatus,
    ) -> Result<Held, StorageError> {
        if matches!(status, SummaryStatus::Done | SummaryStatus::Reading) {
            return Err(invalid(
                "A summary run ends done only by storing its summary.".to_string(),
            ));
        }
        let n = self
            .conn
            .execute(RELEASE_SQL, params![id, now, status.as_str()])?;
        self.held(n, id)
    }

    /// Tests only: sets any status but `done`, claim or not.
    #[cfg(test)]
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

    /// Starts a new summary of a stored bookmark ("Paste the text", "Summarize later"): sets
    /// `reading` in one statement, so two calls cannot both start. A bookmark that already has
    /// its summary (`done`) or is being read is refused, and its stored summary stays as it is.
    pub fn claim_bookmark_for_summary(&self, id: &str) -> Result<SavedBookmark, StorageError> {
        self.claim_bookmark_for_summary_at(&now_iso(), id)
    }

    pub(crate) fn claim_bookmark_for_summary_at(
        &self,
        now: &str,
        id: &str,
    ) -> Result<SavedBookmark, StorageError> {
        if self.conn.execute(CLAIM_SQL, params![id, now])? == 1 {
            return self.get_saved_bookmark(id);
        }
        let b = self.get_saved_bookmark(id)?;
        Err(invalid(match b.summary_status {
            SummaryStatus::Done => "This link already has its summary.".to_string(),
            _ => "Mnemo is already reading this link. Wait for it to finish.".to_string(),
        }))
    }

    /// Sets the title read from the page: trimmed, 1 to 500 characters, or null. Only while
    /// the run holds the claim (`reading`).
    pub fn set_bookmark_title(&self, id: &str, title: Option<&str>) -> Result<Held, StorageError> {
        self.set_bookmark_title_at(&now_iso(), id, title)
    }

    pub(crate) fn set_bookmark_title_at(
        &self,
        now: &str,
        id: &str,
        title: Option<&str>,
    ) -> Result<Held, StorageError> {
        let title = title.map(str::trim).filter(|t| !t.is_empty());
        optional_chars("title", &title.map(str::to_string), MAX_TITLE_CHARS)?;
        let n = self.conn.execute(SET_TITLE_SQL, params![id, now, title])?;
        self.held(n, id)
    }

    /// Stores the summary, the reason (marked as a guess) and the tags in one transaction, and
    /// sets the status to `done`, only while the run holds the claim (`reading`). The tags
    /// replace the bookmark's old tags. Nothing is written when any part is invalid, or when
    /// the owner took the bookmark over (`Held::Lost`).
    pub fn set_bookmark_summary(
        &mut self,
        id: &str,
        summary: &BookmarkSummary,
    ) -> Result<Held, StorageError> {
        self.set_bookmark_summary_at(&now_iso(), id, summary)
    }

    pub(crate) fn set_bookmark_summary_at(
        &mut self,
        now: &str,
        id: &str,
        summary: &BookmarkSummary,
    ) -> Result<Held, StorageError> {
        let tags = checked_tags(summary)?;
        let tx = self.immediate()?;
        let n = tx.execute(
            SET_SUMMARY_SQL,
            params![id, now, summary.summary.trim(), summary.reason.trim()],
        )?;
        if n == 0 {
            drop(tx);
            return self.held(0, id);
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
        self.held(1, id)
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
    use crate::storage::items::{Bookmark, BookmarkInput};
    use crate::storage::testing::open_temp;

    const T2: &str = "2026-01-02T00:00:00Z";
    const T3: &str = "2026-01-03T00:00:00Z";

    /// The bookmark after a write the run held the claim for.
    fn written(h: Result<Held, StorageError>) -> SavedBookmark {
        match h.unwrap() {
            Held::Written(b) => b,
            Held::Lost(b) => panic!("the claim was lost: {b:?}"),
        }
    }

    /// Claims `id` and stores `sum` for it, as a summary run does.
    fn summarized(s: &mut Storage, now: &str, id: &str, sum: &BookmarkSummary) -> SavedBookmark {
        s.set_bookmark_status_at(now, id, SummaryStatus::Reading)
            .unwrap();
        written(s.set_bookmark_summary_at(now, id, sum))
    }

    fn summary(tags: &[&str]) -> BookmarkSummary {
        BookmarkSummary {
            summary: "Each window gets a list of allowed commands.".into(),
            reason: "It may matter for the command allow-list.".into(),
            tags: tags.iter().map(|t| t.to_string()).collect(),
        }
    }

    #[test]
    fn site_of_gives_the_host_without_www_or_port() {
        let cases = [
            ("https://www.Example.org/a?b", Some("example.org")),
            ("http://v2.tauri.app:8080/x", Some("v2.tauri.app")),
            ("https://[2001:db8::1]:443/", Some("2001:db8::1")),
            ("https://example.org./", Some("example.org")),
        ];
        for (url, want) in cases {
            let parsed = url::Url::parse(url).unwrap();
            assert_eq!(site_of(&parsed).as_deref(), want, "{url}");
        }
    }

    #[test]
    fn save_link_stores_the_host_the_reader_fetches_and_refuses_a_user_name() {
        let (s, _d) = open_temp();
        // The URL parser reads a backslash as "/", so the page read goes to evil.example: the stored
        // link and site say so too, never paypal.com.
        let b = s
            .save_link_at(T1, "http://evil.example\\@paypal.com/")
            .unwrap();
        assert_eq!(b.site.as_deref(), Some("evil.example"));
        assert!(b.url.starts_with("http://evil.example/"), "{}", b.url);
        for url in [
            "https://user:pw@host.example/",
            "https://user@host.example/",
        ] {
            assert!(
                matches!(s.save_link_at(T1, url), Err(StorageError::Invalid(_))),
                "{url}"
            );
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
    fn claim_for_summary_refuses_a_done_or_reading_bookmark_and_keeps_its_summary() {
        let (mut s, _d) = open_temp();
        let b = s.save_link_at(T1, "https://a.example").unwrap();
        for st in [
            SummaryStatus::Unreadable,
            SummaryStatus::AiOff,
            SummaryStatus::Pending,
        ] {
            s.set_bookmark_status_at(T1, &b.base.id, st).unwrap();
            let got = s.claim_bookmark_for_summary_at(T2, &b.base.id).unwrap();
            assert_eq!(got.summary_status, SummaryStatus::Reading);
        }
        // Reading: a second claim is refused.
        assert!(matches!(
            s.claim_bookmark_for_summary_at(T2, &b.base.id),
            Err(StorageError::Invalid(_))
        ));
        let done = summarized(&mut s, T2, &b.base.id, &summary(&["a"]));
        assert!(matches!(
            s.claim_bookmark_for_summary_at(T3, &b.base.id),
            Err(StorageError::Invalid(_))
        ));
        assert_eq!(s.get_saved_bookmark(&b.base.id).unwrap(), done);
        assert_eq!(
            s.claim_bookmark_for_summary_at(T3, "missing"),
            Err(BOOKMARK_NOT_FOUND)
        );
    }

    #[test]
    fn set_bookmark_title_trims_and_checks_the_title() {
        let (s, _d) = open_temp();
        let b = s.save_link_to_read_at(T1, "https://a.example").unwrap();
        let got = written(s.set_bookmark_title_at(T2, &b.base.id, Some("  Page  ")));
        assert_eq!(got.title.as_deref(), Some("Page"));
        let got = written(s.set_bookmark_title_at(T2, &b.base.id, Some("   ")));
        assert_eq!(got.title, None);
        let long = "a".repeat(MAX_TITLE_CHARS + 1);
        assert!(s
            .set_bookmark_title_at(T2, &b.base.id, Some(&long))
            .is_err());
        assert_eq!(
            s.set_bookmark_title_at(T2, "missing", None),
            Ok(Held::Lost(None))
        );
    }

    #[test]
    fn set_bookmark_summary_stores_summary_reason_as_guess_and_top_label_tags() {
        let (mut s, _d) = open_temp();
        let b = s.save_link_at(T1, "https://a.example").unwrap();
        let got = summarized(
            &mut s,
            T2,
            &b.base.id,
            &summary(&["tauri", " Security ", "TAURI"]),
        );
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
        summarized(&mut s, T2, &b.base.id, &summary(&["rust", "old"]));
        let got = summarized(&mut s, T3, &b.base.id, &summary(&["new", "RUST"]));
        assert_eq!(got.tags, vec!["new".to_string(), "Rust".to_string()]);
        assert!(got.labels.iter().any(|t| t.id == rust.base.id));
        // The dropped tag's label stays; only the link is hidden.
        assert!(s.list_labels().unwrap().iter().any(|l| l.name == "old"));
        // Bringing a dropped tag back revives its link.
        let got = summarized(&mut s, T3, &b.base.id, &summary(&["old"]));
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
            Ok(Held::Lost(None))
        );
    }

    #[test]
    fn set_bookmark_summary_leaves_out_a_new_tag_past_the_label_limit() {
        let (mut s, _d) = open_temp();
        for i in 0..MAX_LABELS {
            s.create_label_at(T1, None, &format!("l{i}")).unwrap();
        }
        let b = s.save_link_at(T1, "https://a.example").unwrap();
        let got = summarized(&mut s, T2, &b.base.id, &summary(&["l1", "brand-new"]));
        assert_eq!(got.tags, vec!["l1".to_string()]);
        assert_eq!(got.summary_status, SummaryStatus::Done);
    }

    #[test]
    fn a_deleted_tag_label_or_a_deleted_bookmark_is_left_out() {
        let (mut s, _d) = open_temp();
        let b = s.save_link_at(T1, "https://a.example").unwrap();
        let got = summarized(&mut s, T2, &b.base.id, &summary(&["keep", "drop"]));
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
    fn only_a_run_that_holds_the_claim_writes() {
        let (mut s, _d) = open_temp();
        let b = s.save_link_to_read_at(T1, "https://a.example").unwrap();
        assert_eq!(b.summary_status, SummaryStatus::Reading);
        // The owner writes a summary through the item path during the read.
        let mine = BookmarkInput {
            summary: Some("My own summary.".into()),
            ..bookmark("https://a.example/")
        };
        let _: Bookmark = s.update_at(T2, &b.base.id, &mine).unwrap();
        let owner = s.get_saved_bookmark(&b.base.id).unwrap();
        assert_eq!(owner.summary_status, SummaryStatus::Done);
        // Every write of the run now changes nothing and gives the owner's row.
        let lost = Ok(Held::Lost(Some(owner.clone())));
        assert_eq!(s.set_bookmark_title_at(T3, &b.base.id, Some("AI")), lost);
        assert_eq!(
            s.set_bookmark_summary_at(T3, &b.base.id, &summary(&["ai"])),
            lost
        );
        for status in [
            SummaryStatus::Pending,
            SummaryStatus::Unreadable,
            SummaryStatus::AiOff,
        ] {
            assert_eq!(s.release_bookmark_at(T3, &b.base.id, status), lost);
        }
        assert_eq!(s.get_saved_bookmark(&b.base.id).unwrap(), owner);
        assert!(s.list_labels().unwrap().is_empty());
        // A run cannot end done or reading by a release.
        let c = s.save_link_to_read_at(T1, "https://c.example").unwrap();
        for status in [SummaryStatus::Done, SummaryStatus::Reading] {
            assert!(matches!(
                s.release_bookmark_at(T2, &c.base.id, status),
                Err(StorageError::Invalid(_))
            ));
        }
        assert_eq!(
            written(s.release_bookmark_at(T2, &c.base.id, SummaryStatus::Unreadable))
                .summary_status,
            SummaryStatus::Unreadable
        );
        // Deleted during the read: nothing to write, no row.
        let d = s.save_link_to_read_at(T1, "https://d.example").unwrap();
        s.delete_at::<Bookmark>(T2, &d.base.id).unwrap();
        assert_eq!(
            s.release_bookmark_at(T3, &d.base.id, SummaryStatus::Pending),
            Ok(Held::Lost(None))
        );
    }

    #[test]
    fn a_tag_the_owner_moved_under_a_parent_is_reused_not_made_again() {
        let (mut s, _d) = open_temp();
        let b = s.save_link_at(T1, "https://a.example").unwrap();
        summarized(&mut s, T1, &b.base.id, &summary(&["rust"]));
        let rust = s.list_labels().unwrap()[0].clone();
        let parent = s.create_label_at(T1, None, "Languages").unwrap();
        s.move_label_at(T2, &rust.base.id, Some(&parent.base.id))
            .unwrap();
        let c = s.save_link_at(T2, "https://c.example").unwrap();
        let done = summarized(&mut s, T3, &c.base.id, &summary(&["Rust"]));
        assert_eq!(done.labels[0].id, rust.base.id);
        assert_eq!(s.list_labels().unwrap().len(), 2);
        // A top label of that name still wins over a child one.
        let top = s.create_label_at(T3, None, "rust").unwrap();
        let d = s.save_link_at(T3, "https://d.example").unwrap();
        let done = summarized(&mut s, T3, &d.base.id, &summary(&["rust"]));
        assert_eq!(done.labels[0].id, top.base.id);
    }

    #[test]
    fn the_item_path_keeps_the_site_and_the_summary_status_true() {
        let (s, _d) = open_temp();
        // Added with no summary: pending, with its site.
        let plain: Bookmark = s.add_at(T1, &bookmark("https://www.a.example/x")).unwrap();
        let card = s.get_saved_bookmark(&plain.base.id).unwrap();
        assert_eq!(card.site.as_deref(), Some("a.example"));
        assert_eq!(card.summary_status, SummaryStatus::Pending);
        // The owner writes a summary: done, so no AI run takes it over.
        let owned = BookmarkInput {
            url: "https://b.example/y".into(),
            summary: Some("My own summary.".into()),
            ..bookmark("https://b.example/y")
        };
        let b: Bookmark = s.update_at(T2, &plain.base.id, &owned).unwrap();
        let card = s.get_saved_bookmark(&b.base.id).unwrap();
        assert_eq!(card.site.as_deref(), Some("b.example"));
        assert_eq!(card.summary_status, SummaryStatus::Done);
        assert!(s.claim_bookmark_for_summary_at(T2, &b.base.id).is_err());
        // The summary removed: no longer done.
        let _: Bookmark = s
            .update_at(T3, &b.base.id, &bookmark("https://b.example/y"))
            .unwrap();
        let card = s.get_saved_bookmark(&b.base.id).unwrap();
        assert_eq!(card.summary_status, SummaryStatus::Pending);
        // Unreadable stays unreadable when only the title changes.
        s.set_bookmark_status_at(T3, &b.base.id, SummaryStatus::Unreadable)
            .unwrap();
        let titled = BookmarkInput {
            title: Some("B".into()),
            ..bookmark("https://b.example/y")
        };
        let _: Bookmark = s.update_at(T3, &b.base.id, &titled).unwrap();
        let card = s.get_saved_bookmark(&b.base.id).unwrap();
        assert_eq!(card.summary_status, SummaryStatus::Unreadable);
        // Added with a summary: done.
        let with = BookmarkInput {
            summary: Some("Text.".into()),
            ..bookmark("https://c.example")
        };
        let c: Bookmark = s.add_at(T3, &with).unwrap();
        let card = s.get_saved_bookmark(&c.base.id).unwrap();
        assert_eq!(card.summary_status, SummaryStatus::Done);
        assert_eq!(card.site.as_deref(), Some("c.example"));
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
