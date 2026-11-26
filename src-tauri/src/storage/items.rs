//! The eight item types and their five actions: add, get, list, update and soft delete.
//! One generic engine runs every action; each type gives its own fixed SQL text,
//! its checks and its row mapping. SQL is never built at run time.

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSqlOutput, Value, ValueRef};
use rusqlite::{params, params_from_iter, OptionalExtension, Row, ToSql, TransactionBehavior};
use serde::{Deserialize, Serialize};

use super::error::StorageError;
use super::links;
use super::record::{now_iso, Cursor, Page, PageRequest, RecordBase};
use super::Storage;

/// Longest title, in characters.
pub const MAX_TITLE_CHARS: usize = 500;
/// Longest web address, in characters.
pub const MAX_URL_CHARS: usize = 2048;
/// Longest short code (project status, run task type), in characters.
pub const MAX_CODE_CHARS: usize = 40;
/// Largest long text (note body, summary, reason, error), in bytes: 1 MB.
pub const MAX_TEXT_BYTES: usize = 1_048_576;

/// The eight item types. The serialised name is also the table name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Bookmark,
    Note,
    Idea,
    Project,
    Task,
    Event,
    Run,
    Memory,
}

impl ItemKind {
    pub const ALL: [ItemKind; 8] = [
        ItemKind::Bookmark,
        ItemKind::Note,
        ItemKind::Idea,
        ItemKind::Project,
        ItemKind::Task,
        ItemKind::Event,
        ItemKind::Run,
        ItemKind::Memory,
    ];

    /// The lowercase name, as stored in `item_link` and sent to the UI.
    pub fn as_str(self) -> &'static str {
        match self {
            ItemKind::Bookmark => "bookmark",
            ItemKind::Note => "note",
            ItemKind::Idea => "idea",
            ItemKind::Project => "project",
            ItemKind::Task => "task",
            ItemKind::Event => "event",
            ItemKind::Run => "run",
            ItemKind::Memory => "memory",
        }
    }

    fn parse(s: &str) -> Option<ItemKind> {
        ItemKind::ALL.into_iter().find(|k| k.as_str() == s)
    }
}

impl ToSql for ItemKind {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for ItemKind {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        ItemKind::parse(value.as_str()?).ok_or(FromSqlError::InvalidType)
    }
}

/// The stages of an idea.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IdeaStage {
    #[default]
    Spark,
    Shape,
    Ready,
    Project,
}

impl IdeaStage {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            IdeaStage::Spark => "spark",
            IdeaStage::Shape => "shape",
            IdeaStage::Ready => "ready",
            IdeaStage::Project => "project",
        }
    }
}

impl FromSql for IdeaStage {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "spark" => Ok(IdeaStage::Spark),
            "shape" => Ok(IdeaStage::Shape),
            "ready" => Ok(IdeaStage::Ready),
            "project" => Ok(IdeaStage::Project),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

/// How an AI run ended. A run that is still going has no outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunOutcome {
    Ok,
    Failed,
    Cancelled,
}

impl RunOutcome {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            RunOutcome::Ok => "ok",
            RunOutcome::Failed => "failed",
            RunOutcome::Cancelled => "cancelled",
        }
    }
}

impl FromSql for RunOutcome {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "ok" => Ok(RunOutcome::Ok),
            "failed" => Ok(RunOutcome::Failed),
            "cancelled" => Ok(RunOutcome::Cancelled),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

/// Where an AI run is: waiting in the queue, running, or one of the three end states.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunState {
    Waiting,
    Running,
    Done,
    Failed,
    Cancelled,
}

impl RunState {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            RunState::Waiting => "waiting",
            RunState::Running => "running",
            RunState::Done => "done",
            RunState::Failed => "failed",
            RunState::Cancelled => "cancelled",
        }
    }

    /// The outcome that goes with this state: none while the run waits or runs.
    pub fn outcome(self) -> Option<RunOutcome> {
        match self {
            RunState::Waiting | RunState::Running => None,
            RunState::Done => Some(RunOutcome::Ok),
            RunState::Failed => Some(RunOutcome::Failed),
            RunState::Cancelled => Some(RunOutcome::Cancelled),
        }
    }

    /// True for done, failed and cancelled.
    pub fn is_end(self) -> bool {
        self.outcome().is_some()
    }
}

impl ToSql for RunState {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for RunState {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "waiting" => Ok(RunState::Waiting),
            "running" => Ok(RunState::Running),
            "done" => Ok(RunState::Done),
            "failed" => Ok(RunState::Failed),
            "cancelled" => Ok(RunState::Cancelled),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

mod sealed {
    pub trait Sealed {}
}

/// One item type. Only this module implements it. Parameters of every write: `?1` id,
/// `?2` the time now, then the type's own fields from `?3` on, in `values` order.
pub trait Item: sealed::Sealed + Sized {
    /// The fields the owner (or a feature) gives when adding or updating.
    type Input;
    const KIND: ItemKind;
    #[doc(hidden)]
    const INSERT_SQL: &'static str;
    #[doc(hidden)]
    const GET_SQL: &'static str;
    #[doc(hidden)]
    const LIST_SQL: &'static str;
    #[doc(hidden)]
    const LIST_ALL_SQL: &'static str;
    #[doc(hidden)]
    const UPDATE_SQL: &'static str;
    #[doc(hidden)]
    const DELETE_SQL: &'static str;
    #[doc(hidden)]
    const EXISTS_SQL: &'static str;
    /// Refuses input that must not be saved. Runs before any write.
    fn validate(input: &Self::Input) -> Result<(), StorageError>;
    /// Refuses an update that must not be saved given the stored row (after `validate`).
    fn validate_update(
        _conn: &rusqlite::Connection,
        _id: &str,
        _input: &Self::Input,
    ) -> Result<(), StorageError> {
        Ok(())
    }
    #[doc(hidden)]
    fn values(input: &Self::Input) -> Vec<Value>;
    #[doc(hidden)]
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self>;
    fn base(&self) -> &RecordBase;
}

/// The fixed SQL text of one item table. `concat!` joins literals at compile time.
/// Columns 0 to 3 of every read are id, created_at, updated_at and deleted_at.
macro_rules! item_sql {
    (table: $table:literal, columns: $cols:literal, insert: $vals:literal, set: $set:literal) => {
        const INSERT_SQL: &'static str = concat!(
            "INSERT INTO ",
            $table,
            " (id, created_at, updated_at, ",
            $cols,
            ") VALUES (?1, ?2, ?2, ",
            $vals,
            ") RETURNING id, created_at, updated_at, deleted_at, ",
            $cols
        );
        const GET_SQL: &'static str = concat!(
            "SELECT id, created_at, updated_at, deleted_at, ",
            $cols,
            " FROM ",
            $table,
            " WHERE id = ?1 AND deleted_at IS NULL"
        );
        // ?1 and ?2 the cursor (or NULL), ?3 the row limit. Live rows only, so the
        // (deleted_at, created_at, id) index serves both the filter and the order.
        const LIST_SQL: &'static str = concat!(
            "SELECT id, created_at, updated_at, deleted_at, ",
            $cols,
            " FROM ",
            $table,
            " WHERE deleted_at IS NULL",
            " AND (?1 IS NULL OR (created_at, id) < (?1, ?2))",
            " ORDER BY created_at DESC, id DESC LIMIT ?3"
        );
        // The same page with deleted rows included.
        const LIST_ALL_SQL: &'static str = concat!(
            "SELECT id, created_at, updated_at, deleted_at, ",
            $cols,
            " FROM ",
            $table,
            " WHERE (?1 IS NULL OR (created_at, id) < (?1, ?2))",
            " ORDER BY created_at DESC, id DESC LIMIT ?3"
        );
        const UPDATE_SQL: &'static str = concat!(
            "UPDATE ",
            $table,
            " SET ",
            $set,
            ", updated_at = ?2",
            " WHERE id = ?1 AND deleted_at IS NULL",
            " RETURNING id, created_at, updated_at, deleted_at, ",
            $cols
        );
        const DELETE_SQL: &'static str = concat!(
            "UPDATE ",
            $table,
            " SET deleted_at = ?2, updated_at = ?2",
            " WHERE id = ?1 AND deleted_at IS NULL"
        );
        const EXISTS_SQL: &'static str = concat!(
            "SELECT count(*) FROM ",
            $table,
            " WHERE id = ?1 AND deleted_at IS NULL"
        );
    };
}

pub(super) fn base_from(row: &Row<'_>) -> rusqlite::Result<RecordBase> {
    Ok(RecordBase {
        id: row.get(0)?,
        created_at: row.get(1)?,
        updated_at: row.get(2)?,
        deleted_at: row.get(3)?,
    })
}

fn text(v: &str) -> Value {
    Value::Text(v.to_string())
}

fn opt_text(v: &Option<String>) -> Value {
    v.as_ref().map_or(Value::Null, |s| Value::Text(s.clone()))
}

/// An optional field that must still be sent, as a value or as null. Update replaces
/// every field, so a field left out must not quietly become empty.
pub(super) fn nullable<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d)
}

// ---- Checks. Messages are shown to the owner as they are. ----

pub(super) fn invalid(message: String) -> StorageError {
    StorageError::Invalid(message)
}

/// Text that must be given: not blank, at most `max` characters.
pub(super) fn required_chars(field: &str, v: &str, max: usize) -> Result<(), StorageError> {
    if v.trim().is_empty() {
        return Err(invalid(format!("The {field} cannot be empty.")));
    }
    if v.chars().count() > max {
        return Err(invalid(format!(
            "The {field} is too long (at most {max} characters)."
        )));
    }
    Ok(())
}

/// Long text that must be given: not blank, at most 1 MB.
pub(super) fn required_text(field: &str, v: &str) -> Result<(), StorageError> {
    if v.trim().is_empty() {
        return Err(invalid(format!("The {field} cannot be empty.")));
    }
    if v.len() > MAX_TEXT_BYTES {
        return Err(invalid(format!("The {field} is too long (at most 1 MB).")));
    }
    Ok(())
}

/// Optional text: null for unknown, never blank (send null instead).
pub(super) fn optional_chars(
    field: &str,
    v: &Option<String>,
    max: usize,
) -> Result<(), StorageError> {
    match v {
        Some(s) => required_chars(field, s, max).map_err(|_| {
            invalid(format!(
                "The {field} must be null or 1 to {max} characters."
            ))
        }),
        None => Ok(()),
    }
}

pub(super) fn optional_text(field: &str, v: &Option<String>) -> Result<(), StorageError> {
    match v {
        Some(s) => required_text(field, s).map_err(|_| {
            invalid(format!(
                "The {field} must be null or 1 byte to 1 MB of text."
            ))
        }),
        None => Ok(()),
    }
}

/// The form the URL parser writes of a link that passed `web_address`: the same check, with a
/// message for a link that is too long only once encoded.
pub(super) fn encoded_web_address(parsed: &url::Url) -> Result<(), StorageError> {
    if parsed.as_str().chars().count() > MAX_URL_CHARS {
        return Err(invalid(
            "The link is too long once encoded (letters such as é take more room in a link)."
                .to_string(),
        ));
    }
    web_address(parsed.as_str())
}

/// A web address: http or https, a host, no spaces, at most 2048 characters.
pub(super) fn web_address(v: &str) -> Result<(), StorageError> {
    let bad = || {
        invalid(
            "The link must be a web address starting with http:// or https://, with no spaces."
                .to_string(),
        )
    };
    if v.chars().count() > MAX_URL_CHARS {
        return Err(invalid(format!(
            "The link is too long (at most {MAX_URL_CHARS} characters)."
        )));
    }
    // The scheme is case-insensitive (RFC 3986), so HTTPS:// is a web address too.
    let lower = v.get(..8).unwrap_or(v).to_ascii_lowercase();
    let rest = if lower.starts_with("https://") {
        &v[8..]
    } else if lower.starts_with("http://") {
        &v[7..]
    } else {
        return Err(bad());
    };
    if v.chars().any(char::is_whitespace) {
        return Err(bad());
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    // The host comes after any `user@` part.
    let host = authority.rsplit('@').next().unwrap_or("");
    if host.is_empty() || host.starts_with(':') {
        return Err(bad());
    }
    Ok(())
}

/// A UTC time in exactly the shape the core writes: `YYYY-MM-DDTHH:MM:SSZ`.
/// Times in this one shape compare correctly as text.
fn utc_time(field: &str, v: &str) -> Result<(), StorageError> {
    let b = v.as_bytes();
    let num = |from: usize, to: usize| -> Option<u32> {
        let part = b.get(from..to)?;
        if part.iter().all(u8::is_ascii_digit) {
            std::str::from_utf8(part).ok()?.parse().ok()
        } else {
            None
        }
    };
    let shape = b.len() == 20
        && b[4] == b'-'
        && b[7] == b'-'
        && b[10] == b'T'
        && b[13] == b':'
        && b[16] == b':'
        && b[19] == b'Z';
    let days_in_month = |y: u32, m: u32| -> u32 {
        match m {
            4 | 6 | 9 | 11 => 30,
            2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
            2 => 28,
            _ => 31,
        }
    };
    let ok = shape
        && num(0, 4).is_some_and(|y| {
            num(5, 7).is_some_and(|m| {
                (1..=12).contains(&m)
                    && num(8, 10).is_some_and(|d| (1..=days_in_month(y, m)).contains(&d))
            })
        })
        && num(11, 13).is_some_and(|h| h <= 23)
        && num(14, 16).is_some_and(|m| m <= 59)
        && num(17, 19).is_some_and(|s| s <= 59);
    if ok {
        Ok(())
    } else {
        Err(invalid(format!(
            "The {field} must be a UTC time like 2026-01-31T09:00:00Z."
        )))
    }
}

// ---- The eight types ----

/// A saved web page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    #[serde(flatten)]
    pub base: RecordBase,
    pub url: String,
    pub title: Option<String>,
    /// Null when the page could not be read.
    pub summary: Option<String>,
    pub reason: Option<String>,
    /// True when the app wrote the reason: it is shown as a guess.
    pub reason_is_guess: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkInput {
    pub url: String,
    #[serde(deserialize_with = "nullable")]
    pub title: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub summary: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub reason: Option<String>,
    pub reason_is_guess: bool,
}

impl sealed::Sealed for Bookmark {}
impl Item for Bookmark {
    type Input = BookmarkInput;
    const KIND: ItemKind = ItemKind::Bookmark;
    // ?9 is the new link as the URL parser writes it (a save stores that form). The same link
    // sent in another form (case, a missing "/") is not a changed link: the stored form stays.
    // A different link is stored in the parsed form too, so a later edit in either form matches
    // it. The site (?8) follows the link. Any owner edit drops a summary run's claim, so the run
    // stops and never writes over it. A bookmark with a summary is done (no AI run takes an
    // owner's summary over); a removed summary, an edit during a read, or a changed link (an
    // old "unreadable" or "not reached" verdict no longer holds) gives pending; any other
    // status stays.
    item_sql!(
        table: "bookmark",
        columns: "url, title, summary, reason, reason_is_guess, site, summary_status, compare_key",
        // The insert and the update share the values: NULLIF(?9, ?9) is NULL and only names ?9.
        // ?10 is the compare key of the link (#28); an edit that changes the link only updates it,
        // even when the new link is already saved.
        insert: "?3, ?4, ?5, ?6, ?7, COALESCE(?8, NULLIF(?9, ?9)),
            CASE WHEN ?5 IS NULL THEN 'pending' ELSE 'done' END, ?10",
        set: "url = CASE WHEN url IS ?3 OR url IS ?9 THEN url ELSE ?9 END, title = ?4, summary = ?5, reason = ?6, reason_is_guess = ?7, site = ?8,
            compare_key = ?10,
            claim = NULL,
            summary_status = CASE WHEN ?5 IS NOT NULL THEN 'done'
                WHEN summary_status IN ('done', 'reading')
                    OR (url IS NOT ?3 AND url IS NOT ?9) THEN 'pending'
                ELSE summary_status END"
    );

    fn validate(i: &BookmarkInput) -> Result<(), StorageError> {
        web_address(&i.url)?;
        optional_chars("title", &i.title, MAX_TITLE_CHARS)?;
        optional_text("summary", &i.summary)?;
        optional_text("reason", &i.reason)?;
        if i.reason_is_guess && i.reason.is_none() {
            return Err(invalid(
                "A reason marked as a guess needs the reason text.".to_string(),
            ));
        }
        Ok(())
    }

    /// A changed link is stored as the URL parser writes it (?9), which percent-encoding or
    /// punycode can make longer: only then is that form checked too, as a save does. The same
    /// link (as stored, or in its parsed form) keeps the stored form and is not checked again.
    fn validate_update(
        conn: &rusqlite::Connection,
        id: &str,
        i: &BookmarkInput,
    ) -> Result<(), StorageError> {
        let Ok(parsed) = url::Url::parse(i.url.trim()) else {
            return Ok(());
        };
        let stored: Option<String> = conn
            .query_row(
                "SELECT url FROM bookmark WHERE id = ?1 AND deleted_at IS NULL",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        match stored {
            Some(url) if url != i.url && url != parsed.as_str() => encoded_web_address(&parsed),
            _ => Ok(()),
        }
    }

    fn values(i: &BookmarkInput) -> Vec<Value> {
        vec![
            text(&i.url),
            opt_text(&i.title),
            opt_text(&i.summary),
            opt_text(&i.reason),
            Value::Integer(i64::from(i.reason_is_guess)),
            opt_text(
                &url::Url::parse(i.url.trim())
                    .ok()
                    .and_then(|u| super::bookmarks::site_of(&u)),
            ),
            text(
                &url::Url::parse(i.url.trim())
                    .map(|u| u.to_string())
                    .unwrap_or_else(|_| i.url.clone()),
            ),
            opt_text(&super::link_key::compare_key_of(&i.url)),
        ]
    }

    fn from_row(r: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Bookmark {
            base: base_from(r)?,
            url: r.get(4)?,
            title: r.get(5)?,
            summary: r.get(6)?,
            reason: r.get(7)?,
            reason_is_guess: r.get(8)?,
        })
    }

    fn base(&self) -> &RecordBase {
        &self.base
    }
}

/// A Markdown note.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    #[serde(flatten)]
    pub base: RecordBase,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteInput {
    pub body: String,
}

impl sealed::Sealed for Note {}
impl Item for Note {
    type Input = NoteInput;
    const KIND: ItemKind = ItemKind::Note;
    item_sql!(table: "note", columns: "body", insert: "?3", set: "body = ?3");

    fn validate(i: &NoteInput) -> Result<(), StorageError> {
        required_text("note text", &i.body)
    }

    fn values(i: &NoteInput) -> Vec<Value> {
        vec![text(&i.body)]
    }

    fn from_row(r: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Note {
            base: base_from(r)?,
            body: r.get(4)?,
        })
    }

    fn base(&self) -> &RecordBase {
        &self.base
    }
}

/// A project. `status` is free text for now (PROJ-01 names its values).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    #[serde(flatten)]
    pub base: RecordBase,
    pub title: String,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    pub title: String,
    pub status: String,
}

impl sealed::Sealed for Project {}
impl Item for Project {
    type Input = ProjectInput;
    const KIND: ItemKind = ItemKind::Project;
    item_sql!(
        table: "project",
        columns: "title, status",
        insert: "?3, ?4",
        set: "title = ?3, status = ?4"
    );

    fn validate(i: &ProjectInput) -> Result<(), StorageError> {
        required_chars("title", &i.title, MAX_TITLE_CHARS)?;
        required_chars("status", &i.status, MAX_CODE_CHARS)
    }

    fn values(i: &ProjectInput) -> Vec<Value> {
        vec![text(&i.title), text(&i.status)]
    }

    fn from_row(r: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Project {
            base: base_from(r)?,
            title: r.get(4)?,
            status: r.get(5)?,
        })
    }

    fn base(&self) -> &RecordBase {
        &self.base
    }
}

/// A task. It is done when `done_at` is set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    #[serde(flatten)]
    pub base: RecordBase,
    pub title: String,
    pub done_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub title: String,
    /// Marking a done task done again keeps the first `done_at`.
    pub done: bool,
}

impl sealed::Sealed for Task {}
impl Item for Task {
    type Input = TaskInput;
    const KIND: ItemKind = ItemKind::Task;
    item_sql!(
        table: "task",
        columns: "title, done_at",
        insert: "?3, CASE WHEN ?4 THEN ?2 ELSE NULL END",
        set: "title = ?3, done_at = CASE WHEN ?4 THEN COALESCE(done_at, ?2) ELSE NULL END"
    );

    fn validate(i: &TaskInput) -> Result<(), StorageError> {
        required_chars("title", &i.title, MAX_TITLE_CHARS)
    }

    fn values(i: &TaskInput) -> Vec<Value> {
        vec![text(&i.title), Value::Integer(i64::from(i.done))]
    }

    fn from_row(r: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Task {
            base: base_from(r)?,
            title: r.get(4)?,
            done_at: r.get(5)?,
        })
    }

    fn base(&self) -> &RecordBase {
        &self.base
    }
}

/// A calendar event. Times are UTC.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    #[serde(flatten)]
    pub base: RecordBase,
    pub title: String,
    pub starts_at: String,
    pub ends_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventInput {
    pub title: String,
    pub starts_at: String,
    pub ends_at: String,
}

impl sealed::Sealed for Event {}
impl Item for Event {
    type Input = EventInput;
    const KIND: ItemKind = ItemKind::Event;
    item_sql!(
        table: "event",
        columns: "title, starts_at, ends_at",
        insert: "?3, ?4, ?5",
        set: "title = ?3, starts_at = ?4, ends_at = ?5"
    );

    fn validate(i: &EventInput) -> Result<(), StorageError> {
        required_chars("title", &i.title, MAX_TITLE_CHARS)?;
        utc_time("start time", &i.starts_at)?;
        utc_time("end time", &i.ends_at)?;
        // Valid because both are in the one fixed UTC shape checked above.
        if i.ends_at < i.starts_at {
            return Err(invalid(
                "The event cannot end before it starts.".to_string(),
            ));
        }
        Ok(())
    }

    fn values(i: &EventInput) -> Vec<Value> {
        vec![text(&i.title), text(&i.starts_at), text(&i.ends_at)]
    }

    fn from_row(r: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Event {
            base: base_from(r)?,
            title: r.get(4)?,
            starts_at: r.get(5)?,
            ends_at: r.get(6)?,
        })
    }

    fn base(&self) -> &RecordBase {
        &self.base
    }
}

/// One AI run. No token counts are ever stored. `created_at` is the time it was queued.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    #[serde(flatten)]
    pub base: RecordBase,
    pub task_type: String,
    pub state: RunState,
    /// Null while the run waits, and for a run cancelled before it started.
    pub started_at: Option<String>,
    /// Set when the run reached an end state (done, failed or cancelled).
    pub ended_at: Option<String>,
    pub duration_ms: Option<i64>,
    /// Null while the run waits or runs; otherwise it matches `state` (done is ok).
    pub outcome: Option<RunOutcome>,
    /// The error the run reported, never invented text.
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunInput {
    pub task_type: String,
    pub state: RunState,
    #[serde(deserialize_with = "nullable")]
    pub started_at: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub ended_at: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub duration_ms: Option<i64>,
    #[serde(deserialize_with = "nullable")]
    pub outcome: Option<RunOutcome>,
    #[serde(deserialize_with = "nullable")]
    pub error: Option<String>,
}

impl sealed::Sealed for Run {}
impl Item for Run {
    type Input = RunInput;
    const KIND: ItemKind = ItemKind::Run;
    item_sql!(
        table: "run",
        columns: "task_type, state, started_at, ended_at, duration_ms, outcome, error",
        insert: "?3, ?4, ?5, ?6, ?7, ?8, ?9",
        set: "task_type = ?3, state = ?4, started_at = ?5, ended_at = ?6, duration_ms = ?7, outcome = ?8, error = ?9"
    );

    fn validate(i: &RunInput) -> Result<(), StorageError> {
        required_chars("task type", &i.task_type, MAX_CODE_CHARS)?;
        if let Some(t) = &i.started_at {
            utc_time("start time", t)?;
        }
        if let Some(t) = &i.ended_at {
            utc_time("end time", t)?;
        }
        if i.state == RunState::Waiting && i.started_at.is_some() {
            return Err(invalid("A waiting run has no start time yet.".to_string()));
        }
        if i.state == RunState::Running && i.started_at.is_none() {
            return Err(invalid("A running run needs its start time.".to_string()));
        }
        if i.state.is_end() != i.ended_at.is_some() {
            return Err(invalid(
                "A run has an end time only when it is done, failed or cancelled.".to_string(),
            ));
        }
        // Valid because both are in the one fixed UTC shape checked above.
        if let (Some(start), Some(end)) = (&i.started_at, &i.ended_at) {
            if end < start {
                return Err(invalid("A run cannot end before it starts.".to_string()));
            }
        }
        if i.outcome != i.state.outcome() {
            return Err(invalid(
                "The run outcome must match its state: ok for done, failed for failed, cancelled for cancelled, none while waiting or running."
                    .to_string(),
            ));
        }
        if i.duration_ms.is_some_and(|d| d < 0) {
            return Err(invalid("The duration cannot be negative.".to_string()));
        }
        optional_text("error", &i.error)
    }

    fn values(i: &RunInput) -> Vec<Value> {
        vec![
            text(&i.task_type),
            text(i.state.as_str()),
            opt_text(&i.started_at),
            opt_text(&i.ended_at),
            i.duration_ms.map_or(Value::Null, Value::Integer),
            i.outcome.map_or(Value::Null, |o| text(o.as_str())),
            opt_text(&i.error),
        ]
    }

    fn from_row(r: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Run {
            base: base_from(r)?,
            task_type: r.get(4)?,
            state: r.get(5)?,
            started_at: r.get(6)?,
            ended_at: r.get(7)?,
            duration_ms: r.get(8)?,
            outcome: r.get(9)?,
            error: r.get(10)?,
        })
    }

    fn base(&self) -> &RecordBase {
        &self.base
    }
}

/// Something the agent remembers: the base fields plus one text body (owner-confirmed).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    #[serde(flatten)]
    pub base: RecordBase,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInput {
    pub body: String,
}

impl sealed::Sealed for Memory {}
impl Item for Memory {
    type Input = MemoryInput;
    const KIND: ItemKind = ItemKind::Memory;
    item_sql!(table: "memory", columns: "body", insert: "?3", set: "body = ?3");

    fn validate(i: &MemoryInput) -> Result<(), StorageError> {
        required_text("memory text", &i.body)
    }

    fn values(i: &MemoryInput) -> Vec<Value> {
        vec![text(&i.body)]
    }

    fn from_row(r: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Memory {
            base: base_from(r)?,
            body: r.get(4)?,
        })
    }

    fn base(&self) -> &RecordBase {
        &self.base
    }
}

/// The query that counts the live row `?1` of `kind`: 1 when it exists, else 0.
pub(crate) fn exists_sql(kind: ItemKind) -> &'static str {
    match kind {
        ItemKind::Bookmark => Bookmark::EXISTS_SQL,
        ItemKind::Note => Note::EXISTS_SQL,
        ItemKind::Idea => super::ideas::EXISTS_SQL,
        ItemKind::Project => Project::EXISTS_SQL,
        ItemKind::Task => Task::EXISTS_SQL,
        ItemKind::Event => Event::EXISTS_SQL,
        ItemKind::Run => Run::EXISTS_SQL,
        ItemKind::Memory => Memory::EXISTS_SQL,
    }
}

fn not_found<T: Item>() -> StorageError {
    StorageError::NotFound {
        kind: T::KIND.as_str(),
    }
}

/// Splits the `limit + 1` rows a list query read into one page and the cursor of the next.
pub(crate) fn into_page<T>(mut rows: Vec<T>, limit: u32, cursor: impl Fn(&T) -> Cursor) -> Page<T> {
    let limit = limit as usize;
    let next = if rows.len() > limit {
        rows.truncate(limit);
        rows.last().map(cursor)
    } else {
        None
    };
    Page { items: rows, next }
}

impl Storage {
    /// Checks and saves a new item. The core sets its id and times.
    pub fn add<T: Item>(&self, input: &T::Input) -> Result<T, StorageError> {
        self.add_at::<T>(&now_iso(), input)
    }

    pub(crate) fn add_at<T: Item>(&self, now: &str, input: &T::Input) -> Result<T, StorageError> {
        T::validate(input)?;
        let base = RecordBase::new_at(now);
        let mut values = vec![Value::Text(base.id), Value::Text(base.created_at)];
        values.extend(T::values(input));
        Ok(self
            .conn
            .query_row(T::INSERT_SQL, params_from_iter(values), T::from_row)?)
    }

    /// The live item with this id. A missing or deleted one gives `NotFound`.
    pub fn get<T: Item>(&self, id: &str) -> Result<T, StorageError> {
        self.conn
            .query_row(T::GET_SQL, [id], T::from_row)
            .optional()?
            .ok_or_else(not_found::<T>)
    }

    /// One page of items, newest first. Deleted items are left out unless asked for.
    pub fn list<T: Item>(
        &self,
        page: &PageRequest,
        include_deleted: bool,
    ) -> Result<Page<T>, StorageError> {
        page.validate()?;
        let (at, id) = match &page.after {
            Some(c) => (Some(c.created_at.as_str()), Some(c.id.as_str())),
            None => (None, None),
        };
        let sql = if include_deleted {
            T::LIST_ALL_SQL
        } else {
            T::LIST_SQL
        };
        let mut stmt = self.conn.prepare_cached(sql)?;
        let rows = stmt
            .query_map(params![at, id, page.limit + 1], T::from_row)?
            .collect::<Result<Vec<T>, _>>()?;
        Ok(into_page(rows, page.limit, |r: &T| Cursor {
            created_at: r.base().created_at.clone(),
            id: r.base().id.clone(),
        }))
    }

    /// Replaces every field of a live item with `input` and sets `updated_at`.
    pub fn update<T: Item>(&self, id: &str, input: &T::Input) -> Result<T, StorageError> {
        self.update_at::<T>(&now_iso(), id, input)
    }

    pub(crate) fn update_at<T: Item>(
        &self,
        now: &str,
        id: &str,
        input: &T::Input,
    ) -> Result<T, StorageError> {
        T::validate(input)?;
        T::validate_update(&self.conn, id, input)?;
        let mut values = vec![text(id), text(now)];
        values.extend(T::values(input));
        self.conn
            .query_row(T::UPDATE_SQL, params_from_iter(values), T::from_row)
            .optional()?
            .ok_or_else(not_found::<T>)
    }

    /// Soft delete: sets `deleted_at` and keeps the row. The item's links are removed
    /// in the same transaction. A missing or already deleted item gives `NotFound`.
    pub fn delete<T: Item>(&mut self, id: &str) -> Result<(), StorageError> {
        self.delete_at::<T>(&now_iso(), id)
    }

    pub(crate) fn delete_at<T: Item>(&mut self, now: &str, id: &str) -> Result<(), StorageError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if tx.execute(T::DELETE_SQL, [id, now])? == 0 {
            return Err(not_found::<T>());
        }
        links::hide_links_of(&tx, T::KIND, id, now)?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::collections::HashSet;
    use std::fmt::Debug;

    use serde::de::IntoDeserializer;

    use super::*;
    use crate::storage::testing::open_temp;

    pub(crate) const T1: &str = "2026-01-01T00:00:00Z";
    const T2: &str = "2026-01-02T00:00:00Z";
    const T3: &str = "2026-01-03T00:00:00Z";

    fn count_all<T: Item>(s: &Storage) -> i64 {
        // The table name comes from the fixed enum, never from input.
        let sql = match T::KIND {
            ItemKind::Bookmark => "SELECT count(*) FROM bookmark",
            ItemKind::Note => "SELECT count(*) FROM note",
            ItemKind::Idea => "SELECT count(*) FROM idea",
            ItemKind::Project => "SELECT count(*) FROM project",
            ItemKind::Task => "SELECT count(*) FROM task",
            ItemKind::Event => "SELECT count(*) FROM event",
            ItemKind::Run => "SELECT count(*) FROM run",
            ItemKind::Memory => "SELECT count(*) FROM memory",
        };
        s.conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn all<T: Item>(s: &Storage, include_deleted: bool) -> Vec<T> {
        s.list::<T>(&PageRequest::first(100), include_deleted)
            .unwrap()
            .items
    }

    /// Runs add, get, list, update and delete for one type and checks the shared rules.
    fn add_get_list_update_delete<T: Item + Clone + PartialEq + Debug>(
        first: T::Input,
        second: T::Input,
        check_first: impl Fn(&T),
        check_second: impl Fn(&T),
    ) {
        let (mut s, _dir) = open_temp();
        // add
        let added: T = s.add_at::<T>(T1, &first).unwrap();
        assert!(uuid::Uuid::parse_str(&added.base().id).is_ok());
        assert_eq!(added.base().created_at, T1);
        assert_eq!(added.base().updated_at, T1);
        assert_eq!(added.base().deleted_at, None);
        check_first(&added);
        // get
        let id = added.base().id.clone();
        assert_eq!(s.get::<T>(&id).unwrap(), added);
        // list
        assert_eq!(all::<T>(&s, false), vec![added.clone()]);
        // update: new fields, new updated_at, same created_at
        let updated: T = s.update_at::<T>(T2, &id, &second).unwrap();
        assert_eq!(updated.base().id, id);
        assert_eq!(updated.base().created_at, T1);
        assert_eq!(updated.base().updated_at, T2);
        check_second(&updated);
        assert_eq!(s.get::<T>(&id).unwrap(), updated);
        // delete: soft, the row stays
        s.delete_at::<T>(T3, &id).unwrap();
        assert!(
            matches!(s.get::<T>(&id), Err(StorageError::NotFound { kind }) if kind == T::KIND.as_str())
        );
        assert_eq!(count_all::<T>(&s), 1);
        assert!(all::<T>(&s, false).is_empty());
        let kept = all::<T>(&s, true);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].base().deleted_at.as_deref(), Some(T3));
        assert_eq!(kept[0].base().updated_at, T3);
        // A deleted item can be neither updated nor deleted again.
        assert!(matches!(
            s.update_at::<T>(T3, &id, &second),
            Err(StorageError::NotFound { .. })
        ));
        assert!(matches!(
            s.delete_at::<T>(T3, &id),
            Err(StorageError::NotFound { .. })
        ));
        // A missing id gives NotFound for every action.
        assert!(matches!(
            s.get::<T>("missing"),
            Err(StorageError::NotFound { .. })
        ));
        assert!(matches!(
            s.update_at::<T>(T3, "missing", &first),
            Err(StorageError::NotFound { .. })
        ));
        assert!(matches!(
            s.delete_at::<T>(T3, "missing"),
            Err(StorageError::NotFound { .. })
        ));
    }

    /// Checks that `input` is refused as Invalid and that nothing was written.
    fn refused<T: Item>(input: T::Input) {
        let (s, _dir) = open_temp();
        assert!(
            matches!(s.add_at::<T>(T1, &input), Err(StorageError::Invalid(_))),
            "add accepted bad input"
        );
        assert_eq!(count_all::<T>(&s), 0);
    }

    pub(crate) fn note(body: &str) -> NoteInput {
        NoteInput {
            body: body.to_string(),
        }
    }

    pub(crate) fn bookmark(url: &str) -> BookmarkInput {
        BookmarkInput {
            url: url.to_string(),
            title: None,
            summary: None,
            reason: None,
            reason_is_guess: false,
        }
    }

    #[test]
    fn bookmark_add_get_list_update_delete() {
        let second = BookmarkInput {
            url: "https://example.org/b?x=1#top".into(),
            title: Some("Example".into()),
            summary: Some("A page.".into()),
            reason: Some("Looks useful".into()),
            reason_is_guess: true,
        };
        add_get_list_update_delete::<Bookmark>(
            bookmark("https://example.com"),
            second,
            |b| {
                assert_eq!(b.url, "https://example.com");
                assert_eq!(
                    (b.title.clone(), b.summary.clone(), b.reason.clone()),
                    (None, None, None)
                );
                assert!(!b.reason_is_guess);
            },
            |b| {
                assert_eq!(b.url, "https://example.org/b?x=1#top");
                assert_eq!(b.summary.as_deref(), Some("A page."));
                assert!(b.reason_is_guess);
            },
        );
    }

    #[test]
    fn note_add_get_list_update_delete() {
        add_get_list_update_delete::<Note>(
            note("# First"),
            note("Second, with 'quotes'); DROP TABLE note; --"),
            |n| assert_eq!(n.body, "# First"),
            |n| assert_eq!(n.body, "Second, with 'quotes'); DROP TABLE note; --"),
        );
    }

    #[test]
    fn memory_add_get_list_update_delete() {
        add_get_list_update_delete::<Memory>(
            MemoryInput {
                body: "likes tea".into(),
            },
            MemoryInput {
                body: "likes coffee".into(),
            },
            |m| assert_eq!(m.body, "likes tea"),
            |m| assert_eq!(m.body, "likes coffee"),
        );
    }

    #[test]
    fn project_add_get_list_update_delete() {
        add_get_list_update_delete::<Project>(
            ProjectInput {
                title: "Mnemo".into(),
                status: "active".into(),
            },
            ProjectInput {
                title: "Mnemo".into(),
                status: "paused".into(),
            },
            |p| assert_eq!(p.status, "active"),
            |p| assert_eq!(p.status, "paused"),
        );
    }

    #[test]
    fn task_add_get_list_update_delete() {
        add_get_list_update_delete::<Task>(
            TaskInput {
                title: "Write tests".into(),
                done: false,
            },
            TaskInput {
                title: "Write tests".into(),
                done: true,
            },
            |t| assert_eq!(t.done_at, None),
            |t| assert_eq!(t.done_at.as_deref(), Some(T2)),
        );
    }

    #[test]
    fn event_add_get_list_update_delete() {
        add_get_list_update_delete::<Event>(
            EventInput {
                title: "Dentist".into(),
                starts_at: "2026-02-01T09:00:00Z".into(),
                ends_at: "2026-02-01T10:00:00Z".into(),
            },
            EventInput {
                title: "Dentist".into(),
                starts_at: "2026-02-02T09:00:00Z".into(),
                ends_at: "2026-02-02T09:00:00Z".into(),
            },
            |e| assert_eq!(e.ends_at, "2026-02-01T10:00:00Z"),
            |e| assert_eq!(e.starts_at, "2026-02-02T09:00:00Z"),
        );
    }

    #[test]
    fn run_add_get_list_update_delete() {
        add_get_list_update_delete::<Run>(
            RunInput {
                task_type: "summary".into(),
                state: RunState::Running,
                started_at: Some(T1.into()),
                ended_at: None,
                duration_ms: None,
                outcome: None,
                error: None,
            },
            RunInput {
                task_type: "summary".into(),
                state: RunState::Failed,
                started_at: Some(T1.into()),
                ended_at: Some(T1.into()),
                duration_ms: Some(1200),
                outcome: Some(RunOutcome::Failed),
                error: Some("claude exited with code 1".into()),
            },
            |r| {
                assert_eq!((r.duration_ms, r.outcome), (None, None));
                assert_eq!((r.state, r.ended_at.as_deref()), (RunState::Running, None));
            },
            |r| {
                assert_eq!(r.duration_ms, Some(1200));
                assert_eq!(r.outcome, Some(RunOutcome::Failed));
                assert_eq!(r.state, RunState::Failed);
                assert_eq!(r.ended_at.as_deref(), Some(T1));
            },
        );
    }

    #[test]
    fn task_done_twice_keeps_the_first_time_and_undone_clears_it() {
        let (s, _dir) = open_temp();
        let t: Task = s
            .add_at::<Task>(
                T1,
                &TaskInput {
                    title: "x".into(),
                    done: true,
                },
            )
            .unwrap();
        assert_eq!(t.done_at.as_deref(), Some(T1));
        let done = TaskInput {
            title: "x".into(),
            done: true,
        };
        let t2: Task = s.update_at::<Task>(T2, &t.base.id, &done).unwrap();
        assert_eq!(t2.done_at.as_deref(), Some(T1));
        let undone = TaskInput {
            title: "x".into(),
            done: false,
        };
        let t3: Task = s.update_at::<Task>(T3, &t.base.id, &undone).unwrap();
        assert_eq!(t3.done_at, None);
    }

    #[test]
    fn add_1000_notes_gives_1000_distinct_uuids() {
        let (s, _dir) = open_temp();
        let mut ids = HashSet::new();
        for n in 0..1000 {
            let added: Note = s.add_at::<Note>(T1, &note(&format!("note {n}"))).unwrap();
            assert!(uuid::Uuid::parse_str(&added.base.id).is_ok());
            ids.insert(added.base.id);
        }
        assert_eq!(ids.len(), 1000);
        assert_eq!(count_all::<Note>(&s), 1000);
    }

    #[test]
    fn list_pages_return_every_row_once_with_equal_times() {
        let (s, _dir) = open_temp();
        for n in 0..25 {
            s.add_at::<Note>(T1, &note(&format!("n{n}"))).unwrap();
        }
        s.add_at::<Note>(T2, &note("newest")).unwrap();
        let mut seen = Vec::new();
        let mut req = PageRequest::first(7);
        loop {
            let page = s.list::<Note>(&req, false).unwrap();
            assert!(page.items.len() <= 7);
            seen.extend(page.items.into_iter().map(|n| n.base));
            match page.next {
                Some(c) => req.after = Some(c),
                None => break,
            }
        }
        assert_eq!(seen.len(), 26);
        assert_eq!(seen.iter().map(|b| &b.id).collect::<HashSet<_>>().len(), 26);
        assert_eq!(seen[0].created_at, T2, "newest first");
    }

    #[test]
    fn list_refuses_a_page_size_outside_1_to_100() {
        let (s, _dir) = open_temp();
        for bad in [0, 101] {
            assert!(matches!(
                s.list::<Note>(&PageRequest::first(bad), false),
                Err(StorageError::Invalid(_))
            ));
        }
    }

    #[test]
    fn update_with_bad_input_changes_nothing() {
        let (s, _dir) = open_temp();
        let n: Note = s.add_at::<Note>(T1, &note("keep")).unwrap();
        assert!(matches!(
            s.update_at::<Note>(T2, &n.base.id, &note("  ")),
            Err(StorageError::Invalid(_))
        ));
        assert_eq!(s.get::<Note>(&n.base.id).unwrap(), n);
    }

    #[test]
    fn note_and_memory_add_refuse_empty_or_too_long_text() {
        refused::<Note>(note(""));
        refused::<Note>(note(" \n\t"));
        refused::<Note>(note(&"x".repeat(MAX_TEXT_BYTES + 1)));
        refused::<Memory>(MemoryInput { body: "".into() });
    }

    #[test]
    fn bookmark_add_refuses_bad_links_and_long_titles() {
        for url in [
            "",
            "example.com",
            "ftp://example.com",
            "https://",
            "https:///path",
            "https://exa mple.com",
            "https://example.com/a b",
            " https://example.com",
            "javascript:alert(1)",
        ] {
            refused::<Bookmark>(bookmark(url));
        }
        refused::<Bookmark>(bookmark(&format!("https://e.com/{}", "a".repeat(2048))));
        let mut long_title = bookmark("https://example.com");
        long_title.title = Some("t".repeat(MAX_TITLE_CHARS + 1));
        refused::<Bookmark>(long_title);
        let mut blank_title = bookmark("https://example.com");
        blank_title.title = Some(" ".into());
        refused::<Bookmark>(blank_title);
        let mut guess_without_reason = bookmark("https://example.com");
        guess_without_reason.reason_is_guess = true;
        refused::<Bookmark>(guess_without_reason);
    }

    #[test]
    fn project_and_task_add_refuse_empty_or_long_fields() {
        refused::<Project>(ProjectInput {
            title: "p".into(),
            status: "".into(),
        });
        refused::<Project>(ProjectInput {
            title: "p".into(),
            status: "s".repeat(MAX_CODE_CHARS + 1),
        });
        refused::<Task>(TaskInput {
            title: "t".repeat(MAX_TITLE_CHARS + 1),
            done: false,
        });
    }

    fn event(starts_at: &str, ends_at: &str) -> EventInput {
        EventInput {
            title: "e".into(),
            starts_at: starts_at.into(),
            ends_at: ends_at.into(),
        }
    }

    #[test]
    fn event_add_refuses_an_end_before_the_start_or_a_non_utc_time() {
        refused::<Event>(event("2026-02-01T10:00:00Z", "2026-02-01T09:00:00Z"));
        for bad in [
            "2026-02-01T10:00:00+01:00",
            "2026-02-01 10:00:00Z",
            "2026-02-01T10:00:00.000Z",
            "2026-13-01T10:00:00Z",
            "2026-02-01T24:00:00Z",
            "tomorrow",
            "",
        ] {
            refused::<Event>(event(bad, "2026-02-01T10:00:00Z"));
            refused::<Event>(event("2026-02-01T09:00:00Z", bad));
        }
    }

    #[test]
    fn run_add_refuses_a_negative_duration_and_an_unknown_outcome() {
        let good = RunInput {
            task_type: "summary".into(),
            state: RunState::Running,
            started_at: Some(T1.into()),
            ended_at: None,
            duration_ms: None,
            outcome: None,
            error: None,
        };
        refused::<Run>(RunInput {
            duration_ms: Some(-1),
            ..good.clone()
        });
        refused::<Run>(RunInput {
            task_type: "".into(),
            ..good.clone()
        });
        // The outcome must match the state, and the end time goes with an end state only.
        refused::<Run>(RunInput {
            outcome: Some(RunOutcome::Ok),
            ..good.clone()
        });
        refused::<Run>(RunInput {
            state: RunState::Done,
            ended_at: Some(T1.into()),
            outcome: Some(RunOutcome::Failed),
            ..good.clone()
        });
        refused::<Run>(RunInput {
            state: RunState::Done,
            outcome: Some(RunOutcome::Ok),
            ..good.clone()
        });
        refused::<Run>(RunInput {
            ended_at: Some(T1.into()),
            ..good.clone()
        });
        // A waiting run has no start; a running run has one; no run ends before it starts.
        refused::<Run>(RunInput {
            state: RunState::Waiting,
            ..good.clone()
        });
        refused::<Run>(RunInput {
            started_at: None,
            ..good.clone()
        });
        refused::<Run>(RunInput {
            state: RunState::Cancelled,
            started_at: Some("2026-01-02T00:00:00Z".into()),
            ended_at: Some("2026-01-01T00:00:00Z".into()),
            outcome: Some(RunOutcome::Cancelled),
            ..good.clone()
        });
        let d: serde::de::value::StrDeserializer<'_, serde::de::value::Error> =
            "paused".into_deserializer();
        assert!(RunState::deserialize(d).is_err());
        // An unknown outcome cannot even be built: serde refuses it before any SQL.
        let d: serde::de::value::StrDeserializer<'_, serde::de::value::Error> =
            "weird".into_deserializer();
        assert!(RunOutcome::deserialize(d).is_err());
        let d: serde::de::value::StrDeserializer<'_, serde::de::value::Error> =
            "cancelled".into_deserializer();
        assert_eq!(RunOutcome::deserialize(d).unwrap(), RunOutcome::Cancelled);
    }

    #[test]
    fn input_json_must_name_every_field_and_null_clears_one() {
        // Update replaces every field, so a field left out is refused, not emptied.
        let partial = r#"{"url":"https://a.example","title":"A"}"#;
        assert!(serde_json::from_str::<BookmarkInput>(partial).is_err());
        assert!(serde_json::from_str::<TaskInput>(r#"{"title":"x"}"#).is_err());
        assert!(serde_json::from_str::<RunInput>(
            r#"{"taskType":"t","startedAt":"2026-01-01T00:00:00Z"}"#
        )
        .is_err());
        let full = r#"{"url":"https://a.example","title":null,"summary":null,"reason":null,"reasonIsGuess":false}"#;
        let b: BookmarkInput = serde_json::from_str(full).unwrap();
        assert_eq!((b.title, b.summary, b.reason), (None, None, None));
    }

    #[test]
    fn list_of_live_items_uses_the_index_without_a_sort() {
        let (s, _dir) = open_temp();
        for sql in [Note::LIST_SQL, Bookmark::LIST_SQL] {
            let plan: Vec<String> = s
                .conn
                .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .unwrap()
                .query_map(params![T1, "x", 10], |r| r.get::<_, String>(3))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            let plan = plan.join(" | ");
            assert!(plan.contains("USING INDEX"), "{plan}");
            assert!(!plan.contains("TEMP B-TREE"), "{plan}");
        }
    }

    #[test]
    fn web_address_takes_any_scheme_case_and_needs_a_host_after_user() {
        assert!(web_address("HTTPS://Example.com/page").is_ok());
        assert!(web_address("Http://example.com").is_ok());
        assert!(web_address("https://user@example.com/x").is_ok());
        assert!(web_address("https://user@/x").is_err());
        assert!(web_address("https:///x").is_err());
        assert!(web_address("ftp://example.com").is_err());
        assert!(web_address("httpsé").is_err());
    }

    #[test]
    fn utc_time_refuses_days_the_month_does_not_have() {
        assert!(utc_time("t", "2026-02-28T09:00:00Z").is_ok());
        assert!(utc_time("t", "2026-02-29T09:00:00Z").is_err());
        assert!(utc_time("t", "2028-02-29T09:00:00Z").is_ok());
        assert!(utc_time("t", "2100-02-29T09:00:00Z").is_err());
        assert!(utc_time("t", "2000-02-29T09:00:00Z").is_ok());
        assert!(utc_time("t", "2026-04-31T09:00:00Z").is_err());
        assert!(utc_time("t", "2026-12-31T23:59:59Z").is_ok());
    }
}
