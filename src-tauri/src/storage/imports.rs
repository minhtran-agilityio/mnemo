//! Import old links from a file (#29, LIB-03). This file owns the SQL of `import_run` and
//! `import_item`, and reads the file the owner picked, as `export.rs` writes the folder the owner
//! picked.
//!
//! A file is a browser bookmarks export (HTML: every `<a href>`) or plain text (one link per
//! line). Each entry is checked by the rules of save a link (`bookmarks::checked_link`): one that
//! is not an http or https web address is skipped and counted (`not_links`); a repeat of an
//! earlier entry by the #28 compare key is skipped and counted (`repeats_in_file`); a link a live
//! bookmark already has is skipped and counted (`already_saved`), and that bookmark is not
//! changed. A soft-deleted bookmark does not block. Every other link is stored at once as link
//! only (`pending`), all in one transaction with the import row. With summaries, each new
//! bookmark also gets an `import_item` (`waiting`); the scheduler (`scheduler::import`) makes
//! the summaries as background work and writes each item's end here.
//!
//! The import state survives a restart: `pause_running_imports_at`, at open, turns an import a
//! closed app left running into paused (`closed`), with all its counts kept.

use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use super::bookmarks::{checked_link, insert_link_only_on, live_key_exists};
use super::error::StorageError;
use super::items::invalid;
use super::record::{now_iso, RecordBase};
use super::Storage;

/// The largest file an import reads. A browser export of 10 000 bookmarks is about 2 MB.
pub const MAX_IMPORT_FILE_BYTES: u64 = 20 * 1024 * 1024;
/// The most entries one import takes.
pub const MAX_IMPORT_ENTRIES: usize = 20_000;

const IMPORT_NOT_FOUND: StorageError = StorageError::NotFound { kind: "import" };

/// Where an import stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportState {
    /// The summaries are being made (or wait for AI to be allowed to run).
    Running,
    /// Paused: by the owner, or because the app closed during the import.
    Paused,
    /// No summary is left to make.
    Finished,
    /// The owner pressed "Stop here": the import ended early. Its links that had no summary
    /// yet stay link only.
    Stopped,
}

impl ImportState {
    fn as_str(self) -> &'static str {
        match self {
            ImportState::Running => "running",
            ImportState::Paused => "paused",
            ImportState::Finished => "finished",
            ImportState::Stopped => "stopped",
        }
    }

    fn parse(text: &str) -> Option<ImportState> {
        [
            ImportState::Running,
            ImportState::Paused,
            ImportState::Finished,
            ImportState::Stopped,
        ]
        .into_iter()
        .find(|s| s.as_str() == text)
    }
}

/// Why an import is paused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PausedBy {
    /// The owner pressed Pause.
    Owner,
    /// Mnemo closed during the import.
    Closed,
}

impl PausedBy {
    fn as_str(self) -> &'static str {
        match self {
            PausedBy::Owner => "owner",
            PausedBy::Closed => "closed",
        }
    }

    fn parse(text: &str) -> Option<PausedBy> {
        [PausedBy::Owner, PausedBy::Closed]
            .into_iter()
            .find(|s| s.as_str() == text)
    }
}

/// Where the summary of one imported link stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemState {
    /// No summary yet. AI off or at the limit also counts as waiting.
    Waiting,
    /// The summary is stored.
    Done,
    /// The AI run failed, or the page could not be read (unreadable or not reached).
    Failed,
    /// The owner deleted the bookmark during the import.
    Removed,
    /// The import was stopped before this link's summary: it stays link only.
    Stopped,
}

impl ItemState {
    fn as_str(self) -> &'static str {
        match self {
            ItemState::Waiting => "waiting",
            ItemState::Done => "done",
            ItemState::Failed => "failed",
            ItemState::Removed => "removed",
            ItemState::Stopped => "stopped",
        }
    }
}

/// One link of a file, checked.
#[derive(Debug, Clone, PartialEq, Eq)]
struct FileLink {
    url: url::Url,
    key: Option<String>,
    title: Option<String>,
}

/// A file read and checked: its links in file order with the repeats inside the file left out,
/// and the counts of what was skipped. Nothing is stored yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportFile {
    /// The base name of the file, never its path.
    pub file_name: String,
    /// Every entry read: links, repeats and entries that are not links.
    pub found: u32,
    pub repeats_in_file: u32,
    pub not_links: u32,
    links: Vec<FileLink>,
}

/// What an import would do, before anything is stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub file_name: String,
    pub found: u32,
    /// Links that would be added.
    pub to_add: u32,
    pub repeats_in_file: u32,
    pub already_saved: u32,
    pub not_links: u32,
}

/// One import as the Import screen shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportView {
    #[serde(flatten)]
    pub base: RecordBase,
    pub file_name: String,
    pub state: ImportState,
    /// Set only while paused.
    pub paused_by: Option<PausedBy>,
    pub with_summaries: bool,
    pub found: u32,
    pub added: u32,
    pub repeats_in_file: u32,
    pub already_saved: u32,
    pub not_links: u32,
    pub done: u32,
    pub waiting: u32,
    pub failed: u32,
}

/// One waiting link of an import: its item and its bookmark.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportItem {
    pub id: String,
    pub bookmark_id: String,
}

// ---- SQL. Fixed text, parameters only. ----

const UNFINISHED_SQL: &str = "SELECT EXISTS (SELECT 1 FROM import_run
     WHERE deleted_at IS NULL AND state NOT IN ('finished', 'stopped'))";

// ?1 id, ?2 now, ?3 file name, ?4 state, ?5 with summaries, ?6..?10 the counts.
const INSERT_RUN_SQL: &str = "INSERT INTO import_run
         (id, created_at, updated_at, file_name, state, paused_by, with_summaries,
          found, added, repeats_in_file, already_saved, not_links)
     VALUES (?1, ?2, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8, ?9, ?10)";

const INSERT_ITEM_SQL: &str = "INSERT INTO import_item
         (id, created_at, updated_at, import_id, bookmark_id, position, state)
     VALUES (?1, ?2, ?2, ?3, ?4, ?5, 'waiting')";

const SET_ADDED_SQL: &str = "UPDATE import_run SET added = ?2, already_saved = ?3 WHERE id = ?1";

/// The import rows with their done, waiting and failed counts, then `$tail`.
macro_rules! select_runs {
    ($tail:literal) => {
        concat!(
            "SELECT r.id, r.created_at, r.updated_at, r.deleted_at, r.file_name, r.state,
                 r.paused_by, r.with_summaries, r.found, r.added, r.repeats_in_file,
                 r.already_saved, r.not_links,
                 (SELECT count(*) FROM import_item i WHERE i.import_id = r.id AND i.state = 'done'),
                 (SELECT count(*) FROM import_item i WHERE i.import_id = r.id AND i.state = 'waiting'),
                 (SELECT count(*) FROM import_item i WHERE i.import_id = r.id AND i.state = 'failed')
             FROM import_run r ",
            $tail
        )
    };
}

// The newest live import; idx_import_run_latest serves it. Times have whole seconds, so two
// imports in one second are told apart by the order they were stored in (rowid), not by id.
const LATEST_SQL: &str =
    select_runs!("WHERE r.deleted_at IS NULL ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1");
const BY_ID_SQL: &str = select_runs!("WHERE r.id = ?1 AND r.deleted_at IS NULL");

// ?1 the import, ?2 the row limit; file order.
const WAITING_SQL: &str = "SELECT id, bookmark_id FROM import_item
     WHERE import_id = ?1 AND state = 'waiting' AND deleted_at IS NULL
     ORDER BY position LIMIT ?2";

// Only a waiting item ends: an end written twice keeps the first. A summary that was stored
// while the import was being stopped still counts as done.
const SET_ITEM_SQL: &str = "UPDATE import_item SET state = ?3, updated_at = ?2
     WHERE id = ?1 AND (state = 'waiting' OR (state = 'stopped' AND ?3 = 'done'))";

// ?3 the new state, ?4 paused by, ?5 the state it must have now.
const SET_STATE_SQL: &str = "UPDATE import_run SET state = ?3, paused_by = ?4, updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL AND state = ?5";

const FINISH_IF_DONE_SQL: &str =
    "UPDATE import_run SET state = 'finished', paused_by = NULL, updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL AND state = 'running'
       AND NOT EXISTS (SELECT 1 FROM import_item
                       WHERE import_id = ?1 AND state = 'waiting' AND deleted_at IS NULL)";

// "Stop here": a running or paused import ends as stopped, and its waiting links stay link only.
const STOP_RUN_SQL: &str =
    "UPDATE import_run SET state = 'stopped', paused_by = NULL, updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL AND state IN ('running', 'paused')";
const STOP_ITEMS_SQL: &str = "UPDATE import_item SET state = 'stopped', updated_at = ?2
     WHERE import_id = ?1 AND state = 'waiting'";

const PAUSE_RUNNING_SQL: &str =
    "UPDATE import_run SET state = 'paused', paused_by = 'closed', updated_at = ?1
     WHERE state = 'running' AND deleted_at IS NULL";

// ---- Reading the file ----

/// The text of the file at `path`: at most `MAX_IMPORT_FILE_BYTES`, UTF-8. Every refusal is a
/// plain `Invalid` message without the path.
fn read_text(path: &Path) -> Result<String, StorageError> {
    let unreadable = || invalid("Mnemo could not read that file. Pick another file.".to_string());
    let meta = fs::metadata(path).map_err(|_| unreadable())?;
    if !meta.is_file() {
        return Err(invalid("Pick a file, not a folder.".to_string()));
    }
    if meta.len() > MAX_IMPORT_FILE_BYTES {
        return Err(too_large());
    }
    let file = fs::File::open(path).map_err(|_| unreadable())?;
    // Checked again on the open file: the path may name something else by now.
    if !file.metadata().map_err(|_| unreadable())?.is_file() {
        return Err(invalid("Pick a file, not a folder.".to_string()));
    }
    let mut bytes = Vec::new();
    file.take(MAX_IMPORT_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| unreadable())?;
    if bytes.len() as u64 > MAX_IMPORT_FILE_BYTES {
        return Err(too_large());
    }
    // A byte order mark is not part of the text.
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    String::from_utf8(bytes.to_vec()).map_err(|_| {
        invalid(
            "That file is not plain text Mnemo can read (UTF-8). Export the bookmarks again as HTML or text."
                .to_string(),
        )
    })
}

fn too_large() -> StorageError {
    invalid(format!(
        "That file is larger than {} MB. Split it into smaller files.",
        MAX_IMPORT_FILE_BYTES / (1024 * 1024)
    ))
}

/// True when the text is a browser bookmarks export (HTML) rather than one link per line.
fn is_html(path: &Path, text: &str) -> bool {
    let html_name = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("html") || e.eq_ignore_ascii_case("htm"));
    let head: String = text
        .trim_start()
        .chars()
        .take(200)
        .collect::<String>()
        .to_ascii_lowercase();
    html_name
        || head.starts_with("<!doctype")
        || head.starts_with("<html")
        || head.starts_with("<dl")
}

/// One entry as the file gives it: the link text and the title, if any.
type Entry = (String, Option<String>);

/// Every non-blank line, trimmed, in file order, at most one past `MAX_IMPORT_ENTRIES` (so a
/// file with more is refused without holding all of them). A blank line is not an entry.
fn text_entries(text: &str) -> Vec<Entry> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .take(MAX_IMPORT_ENTRIES + 1)
        .map(|l| (l.to_string(), None))
        .collect()
}

mod html {
    use std::cell::RefCell;

    use html5ever::tendril::StrTendril;
    use html5ever::tokenizer::{
        BufferQueue, TagKind, Token, TokenSink, TokenSinkResult, Tokenizer, TokenizerOpts,
    };

    use super::{Entry, MAX_IMPORT_ENTRIES};

    /// The longest title kept while reading, in characters; a longer one is dropped by the insert.
    const TITLE_BUFFER_CHARS: usize = 600;

    /// Collects every `<a href>` with the text inside it, by html5ever's tokenizer (entities
    /// decoded), in one forward pass.
    #[derive(Default)]
    struct AnchorSink {
        entries: RefCell<Vec<Entry>>,
        /// The anchor being read: its href and its text so far.
        open: RefCell<Option<(String, String)>>,
    }

    impl AnchorSink {
        fn close(&self) {
            if let Some((href, text)) = self.open.borrow_mut().take() {
                let mut entries = self.entries.borrow_mut();
                // One past the limit is enough to refuse the file.
                if entries.len() > MAX_IMPORT_ENTRIES {
                    return;
                }
                let title = text.split_whitespace().collect::<Vec<_>>().join(" ");
                let title = (!title.is_empty()).then_some(title);
                entries.push((href, title));
            }
        }
    }

    impl TokenSink for AnchorSink {
        type Handle = ();

        fn process_token(&self, token: Token, _line: u64) -> TokenSinkResult<()> {
            match token {
                Token::TagToken(tag) if &*tag.name == "a" => match tag.kind {
                    TagKind::StartTag => {
                        // An anchor left open ends where the next one starts.
                        self.close();
                        if let Some(href) = tag.attrs.iter().find(|a| &*a.name.local == "href") {
                            *self.open.borrow_mut() = Some((href.value.to_string(), String::new()));
                        }
                    }
                    TagKind::EndTag => self.close(),
                },
                Token::CharacterTokens(t) => {
                    if let Some((_, text)) = self.open.borrow_mut().as_mut() {
                        let room = TITLE_BUFFER_CHARS.saturating_sub(text.chars().count());
                        text.extend(t.chars().take(room));
                    }
                }
                _ => {}
            }
            TokenSinkResult::Continue
        }
    }

    /// Every `<a href>` of the document, in order, with its text as the title.
    pub(super) fn entries(text: &str) -> Vec<Entry> {
        let tokenizer = Tokenizer::new(AnchorSink::default(), TokenizerOpts::default());
        let input = BufferQueue::default();
        input.push_back(StrTendril::from_slice(text));
        let _ = tokenizer.feed(&input);
        tokenizer.end();
        tokenizer.sink.close();
        tokenizer.sink.entries.take()
    }
}

/// Checks the entries of a file: links in order, repeats inside the file and entries that are
/// not links skipped and counted.
fn checked(file_name: String, entries: Vec<Entry>) -> Result<ImportFile, StorageError> {
    if entries.len() > MAX_IMPORT_ENTRIES {
        return Err(invalid(format!(
            "That file has more than {MAX_IMPORT_ENTRIES} entries. Split it into smaller files."
        )));
    }
    let mut seen: HashSet<String> = HashSet::new();
    let mut file = ImportFile {
        file_name,
        found: entries.len() as u32,
        repeats_in_file: 0,
        not_links: 0,
        links: Vec::new(),
    };
    for (text, title) in entries {
        let Ok((url, key)) = checked_link(&text) else {
            file.not_links += 1;
            continue;
        };
        // The link itself stands in for a key that is unknown.
        let seen_as = key.clone().unwrap_or_else(|| url.as_str().to_string());
        if !seen.insert(seen_as) {
            file.repeats_in_file += 1;
            continue;
        }
        file.links.push(FileLink { url, key, title });
    }
    Ok(file)
}

/// Reads and checks the file at `path` (a browser bookmarks export or a text file with one link
/// per line). Writes nothing. The path is never stored, logged or put in a message.
pub fn read_import_file(path: &Path) -> Result<ImportFile, StorageError> {
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.chars().take(255).collect::<String>())
        .filter(|n| !n.trim().is_empty())
        .ok_or_else(|| invalid("Pick a file to import.".to_string()))?;
    let text = read_text(path)?;
    let entries = if is_html(path, &text) {
        html::entries(&text)
    } else {
        text_entries(&text)
    };
    checked(file_name, entries)
}

// ---- Rows ----

fn count(r: &Row<'_>, i: usize) -> rusqlite::Result<u32> {
    let n: i64 = r.get(i)?;
    Ok(u32::try_from(n).unwrap_or(u32::MAX))
}

fn view_row(r: &Row<'_>) -> rusqlite::Result<ImportView> {
    let bad = |i: usize, what: &str| {
        rusqlite::Error::FromSqlConversionFailure(
            i,
            rusqlite::types::Type::Text,
            format!("unknown import {what}").into(),
        )
    };
    let state: String = r.get(5)?;
    let paused_by: Option<String> = r.get(6)?;
    Ok(ImportView {
        base: RecordBase {
            id: r.get(0)?,
            created_at: r.get(1)?,
            updated_at: r.get(2)?,
            deleted_at: r.get(3)?,
        },
        file_name: r.get(4)?,
        state: ImportState::parse(&state).ok_or_else(|| bad(5, "state"))?,
        paused_by: match paused_by {
            Some(p) => Some(PausedBy::parse(&p).ok_or_else(|| bad(6, "pause"))?),
            None => None,
        },
        with_summaries: r.get(7)?,
        found: count(r, 8)?,
        added: count(r, 9)?,
        repeats_in_file: count(r, 10)?,
        already_saved: count(r, 11)?,
        not_links: count(r, 12)?,
        done: count(r, 13)?,
        waiting: count(r, 14)?,
        failed: count(r, 15)?,
    })
}

fn view_on(conn: &Connection, id: &str) -> Result<ImportView, StorageError> {
    conn.query_row(BY_ID_SQL, [id], view_row)
        .optional()?
        .ok_or(IMPORT_NOT_FOUND)
}

impl Storage {
    /// What importing `file` would do now: the links it would add and the counts it would skip.
    /// Writes nothing.
    pub fn preview_import(&self, file: &ImportFile) -> Result<ImportPreview, StorageError> {
        let mut already_saved = 0;
        for link in &file.links {
            if let Some(key) = &link.key {
                if live_key_exists(&self.conn, key)? {
                    already_saved += 1;
                }
            }
        }
        Ok(ImportPreview {
            file_name: file.file_name.clone(),
            found: file.found,
            to_add: file.links.len() as u32 - already_saved,
            repeats_in_file: file.repeats_in_file,
            already_saved,
            not_links: file.not_links,
        })
    }

    /// Imports `file`: every link no live bookmark has is stored at once as link only, and the
    /// import row with its counts, in one transaction. With `with_summaries`, each new bookmark
    /// gets a waiting item and the import starts `running` (`finished` when nothing was added);
    /// without, it is `finished` at once and the links stay link only. A link already saved is
    /// skipped and counted, and its bookmark is not changed. Refused while another import is
    /// not finished.
    pub fn start_import(
        &mut self,
        file: &ImportFile,
        with_summaries: bool,
    ) -> Result<ImportView, StorageError> {
        self.start_import_at(&now_iso(), file, with_summaries)
    }

    pub(crate) fn start_import_at(
        &mut self,
        now: &str,
        file: &ImportFile,
        with_summaries: bool,
    ) -> Result<ImportView, StorageError> {
        let tx = self.immediate()?;
        let unfinished: bool = tx.query_row(UNFINISHED_SQL, [], |r| r.get(0))?;
        if unfinished {
            return Err(invalid(
                "An import is not finished yet. Continue it, or wait until it is done, before you import another file."
                    .to_string(),
            ));
        }
        let run = RecordBase::new_at(now);
        // The state is set below, once the links are counted.
        tx.execute(
            INSERT_RUN_SQL,
            params![
                run.id,
                now,
                file.file_name,
                ImportState::Finished.as_str(),
                with_summaries,
                file.found,
                0,
                file.repeats_in_file,
                0,
                file.not_links
            ],
        )?;
        let (mut added, mut already_saved) = (0u32, 0u32);
        for link in &file.links {
            if let Some(key) = &link.key {
                if live_key_exists(&tx, key)? {
                    already_saved += 1;
                    continue;
                }
            }
            let bookmark_id = insert_link_only_on(
                &tx,
                now,
                &link.url,
                link.key.as_deref(),
                link.title.as_deref(),
            )?;
            if with_summaries {
                let item = RecordBase::new_at(now);
                tx.execute(
                    INSERT_ITEM_SQL,
                    params![item.id, now, run.id, bookmark_id, added],
                )?;
            }
            added += 1;
        }
        tx.execute(SET_ADDED_SQL, params![run.id, added, already_saved])?;
        if with_summaries && added > 0 {
            tx.execute(
                SET_STATE_SQL,
                params![
                    run.id,
                    now,
                    ImportState::Running.as_str(),
                    None::<&str>,
                    ImportState::Finished.as_str()
                ],
            )?;
        }
        let view = view_on(&tx, &run.id)?;
        tx.commit()?;
        Ok(view)
    }

    /// The newest import, or `None` when there was none.
    pub fn latest_import(&self) -> Result<Option<ImportView>, StorageError> {
        Ok(self.conn.query_row(LATEST_SQL, [], view_row).optional()?)
    }

    /// The import `id`.
    pub fn get_import(&self, id: &str) -> Result<ImportView, StorageError> {
        view_on(&self.conn, id)
    }

    /// Up to `limit` waiting items of import `id`, in file order.
    pub fn waiting_import_items(
        &self,
        id: &str,
        limit: u32,
    ) -> Result<Vec<ImportItem>, StorageError> {
        let mut st = self.conn.prepare_cached(WAITING_SQL)?;
        let rows = st.query_map(params![id, limit], |r| {
            Ok(ImportItem {
                id: r.get(0)?,
                bookmark_id: r.get(1)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Ends a waiting item with `state` (`Waiting` changes nothing). An item that already ended
    /// keeps its first end. True when the item changed.
    pub fn end_import_item(&self, item_id: &str, state: ItemState) -> Result<bool, StorageError> {
        self.end_import_item_at(&now_iso(), item_id, state)
    }

    pub(crate) fn end_import_item_at(
        &self,
        now: &str,
        item_id: &str,
        state: ItemState,
    ) -> Result<bool, StorageError> {
        if state == ItemState::Waiting {
            return Ok(false);
        }
        Ok(self
            .conn
            .execute(SET_ITEM_SQL, params![item_id, now, state.as_str()])?
            == 1)
    }

    /// Pause (the owner): a running import becomes paused by the owner. A paused or finished
    /// one is left as it is.
    pub fn pause_import(&self, id: &str) -> Result<ImportView, StorageError> {
        self.pause_import_at(&now_iso(), id)
    }

    pub(crate) fn pause_import_at(&self, now: &str, id: &str) -> Result<ImportView, StorageError> {
        self.conn.execute(
            SET_STATE_SQL,
            params![
                id,
                now,
                ImportState::Paused.as_str(),
                PausedBy::Owner.as_str(),
                ImportState::Running.as_str()
            ],
        )?;
        view_on(&self.conn, id)
    }

    /// Continue (the owner): a paused import runs again (`finished` at once when no item waits).
    /// A running or finished one is left as it is.
    pub fn continue_import(&self, id: &str) -> Result<ImportView, StorageError> {
        self.continue_import_at(&now_iso(), id)
    }

    pub(crate) fn continue_import_at(
        &self,
        now: &str,
        id: &str,
    ) -> Result<ImportView, StorageError> {
        self.conn.execute(
            SET_STATE_SQL,
            params![
                id,
                now,
                ImportState::Running.as_str(),
                None::<&str>,
                ImportState::Paused.as_str()
            ],
        )?;
        self.finish_import_if_done_at(now, id)
    }

    /// "Stop here" (the owner): a running or paused import ends as stopped; its links with no
    /// summary yet stay link only, and another file may be imported. A finished or stopped
    /// import is left as it is. One transaction.
    pub fn stop_import(&mut self, id: &str) -> Result<ImportView, StorageError> {
        self.stop_import_at(&now_iso(), id)
    }

    pub(crate) fn stop_import_at(
        &mut self,
        now: &str,
        id: &str,
    ) -> Result<ImportView, StorageError> {
        let tx = self.immediate()?;
        if tx.execute(STOP_RUN_SQL, params![id, now])? == 1 {
            tx.execute(STOP_ITEMS_SQL, params![id, now])?;
        }
        let view = view_on(&tx, id)?;
        tx.commit()?;
        Ok(view)
    }

    /// A running import with no waiting item left becomes finished. Gives the import as it is.
    pub fn finish_import_if_done(&self, id: &str) -> Result<ImportView, StorageError> {
        self.finish_import_if_done_at(&now_iso(), id)
    }

    pub(crate) fn finish_import_if_done_at(
        &self,
        now: &str,
        id: &str,
    ) -> Result<ImportView, StorageError> {
        self.conn.execute(FINISH_IF_DONE_SQL, params![id, now])?;
        view_on(&self.conn, id)
    }

    /// At open: an import a closed app left running becomes paused (`closed`), counts kept.
    pub(crate) fn pause_running_imports_at(&self, now: &str) -> Result<usize, StorageError> {
        Ok(self.conn.execute(PAUSE_RUNNING_SQL, [now])?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::bookmarks::SummaryStatus;
    use crate::storage::testing::{open_temp, TempDir};

    const T: &str = "2026-01-01T00:00:00Z";
    const T2: &str = "2026-01-02T00:00:00Z";

    fn fixture(name: &str) -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/acceptance/fixtures")
            .join(name)
    }

    fn write(dir: &TempDir, name: &str, text: &str) -> std::path::PathBuf {
        let p = dir.path().join(name);
        fs::write(&p, text).unwrap();
        p
    }

    fn live_bookmarks(s: &Storage) -> i64 {
        s.conn
            .query_row(
                "SELECT count(*) FROM bookmark WHERE deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap()
    }

    #[test]
    fn reads_a_browser_bookmarks_export_html_with_titles_repeats_and_entries_that_are_not_links() {
        let file = read_import_file(&fixture("lib-03-bookmarks-export.html")).unwrap();
        assert_eq!(file.file_name, "lib-03-bookmarks-export.html");
        assert_eq!(file.found, 55);
        assert_eq!(file.links.len(), 50);
        assert_eq!(file.repeats_in_file, 3);
        assert_eq!(file.not_links, 2);
        assert_eq!(
            file.links[0].url.as_str(),
            "https://example.org/import/page-1"
        );
        assert_eq!(file.links[0].title.as_deref(), Some("Example page 1"));
    }

    #[test]
    fn reads_a_plain_text_file_with_one_url_per_line() {
        let file = read_import_file(&fixture("lib-03-links.txt")).unwrap();
        let urls: Vec<&str> = file.links.iter().map(|l| l.url.as_str()).collect();
        assert_eq!(
            urls,
            [
                "https://example.net/notes/alpha",
                "https://example.net/notes/beta",
                "https://example.net/notes/gamma",
                "https://example.net/notes/delta"
            ]
        );
        assert_eq!(
            (file.found, file.repeats_in_file, file.not_links),
            (7, 1, 2)
        );
        assert!(file.links.iter().all(|l| l.title.is_none()));
    }

    #[test]
    fn a_line_that_is_not_a_link_is_skipped_and_counted_and_blank_lines_are_not_entries() {
        let dir = TempDir::new();
        let p = write(
            &dir,
            "links.txt",
            "\n  https://a.example/one  \nnot a link\n\nftp://a.example/file\njavascript:alert(1)\nhttps://user@a.example/x\n\n",
        );
        let file = read_import_file(&p).unwrap();
        assert_eq!(file.found, 5);
        assert_eq!(file.not_links, 4);
        assert_eq!(file.links.len(), 1);
        assert_eq!(file.links[0].url.as_str(), "https://a.example/one");
    }

    #[test]
    fn a_line_that_is_not_a_link_does_not_stop_the_import_of_the_other_links() {
        let (mut s, dir) = open_temp();
        let p = write(
            &dir,
            "links.txt",
            "https://a.example/1\n%%% junk %%%\nhttps://a.example/2\n<html>?\nhttps://a.example/3\n",
        );
        let file = read_import_file(&p).unwrap();
        let view = s.start_import_at(T, &file, true).unwrap();
        assert_eq!((view.added, view.not_links, view.waiting), (3, 2, 3));
        assert_eq!(live_bookmarks(&s), 3);
    }

    #[test]
    fn html_entities_in_the_link_and_title_are_decoded_and_an_anchor_without_href_is_no_entry() {
        let dir = TempDir::new();
        let p = write(
            &dir,
            "b.html",
            "<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><A HREF=\"https://a.example/?a=1&amp;b=2\">Tom &amp; Jerry &lt;3</A><DT><A NAME=x>no link</A><DT><a href='https://a.example/2'>  two\n words </a></DL>",
        );
        let file = read_import_file(&p).unwrap();
        assert_eq!(file.found, 2);
        assert_eq!(file.links[0].url.as_str(), "https://a.example/?a=1&b=2");
        assert_eq!(file.links[0].title.as_deref(), Some("Tom & Jerry <3"));
        assert_eq!(file.links[1].title.as_deref(), Some("two words"));
    }

    #[test]
    fn import_refuses_a_folder_a_missing_file_a_file_that_is_not_utf8_and_a_huge_file() {
        let dir = TempDir::new();
        let err = |p: &Path| match read_import_file(p) {
            Err(StorageError::Invalid(m)) => m,
            other => panic!("expected a plain refusal, got {other:?}"),
        };
        assert!(err(dir.path()).contains("not a folder"));
        assert!(err(&dir.path().join("missing.txt")).contains("could not read"));
        let bad = dir.path().join("latin1.txt");
        fs::write(&bad, b"https://a.example/\xE9\n").unwrap();
        assert!(err(&bad).contains("UTF-8"));
        let big = dir.path().join("big.txt");
        let f = fs::File::create(&big).unwrap();
        f.set_len(MAX_IMPORT_FILE_BYTES + 1).unwrap();
        assert!(err(&big).contains("larger than"));
        // No message names the path.
        assert!(!err(&bad).contains(dir.path().to_str().unwrap()));
    }

    #[test]
    fn import_refuses_a_file_with_more_entries_than_the_limit_in_text_and_html() {
        let dir = TempDir::new();
        let many = "x\n".repeat(MAX_IMPORT_ENTRIES + 5);
        let p = write(&dir, "many.txt", &many);
        assert!(
            matches!(read_import_file(&p), Err(StorageError::Invalid(m)) if m.contains("more than"))
        );
        let anchors = "<a href=\"https://a.example/\">a</a>".repeat(MAX_IMPORT_ENTRIES + 5);
        let p = write(
            &dir,
            "many.html",
            &format!("<!DOCTYPE NETSCAPE-Bookmark-file-1>{anchors}"),
        );
        assert!(
            matches!(read_import_file(&p), Err(StorageError::Invalid(m)) if m.contains("more than"))
        );
        // A title is kept to a bounded length while it is read.
        let long = format!("<a href=\"https://a.example/\">{}</a>", "t".repeat(10_000));
        let p = write(&dir, "long.html", &format!("<!DOCTYPE html>{long}"));
        let file = read_import_file(&p).unwrap();
        assert_eq!(
            file.links[0].title.as_ref().map(|t| t.chars().count()),
            Some(600)
        );
    }

    #[test]
    fn a_file_of_50_links_imports_all_links_at_once_as_link_only_with_50_waiting() {
        let (mut s, _dir) = open_temp();
        let file = read_import_file(&fixture("lib-03-bookmarks-export.html")).unwrap();
        let view = s.start_import_at(T, &file, true).unwrap();
        assert_eq!(view.state, ImportState::Running);
        assert_eq!(
            (view.found, view.added, view.repeats_in_file, view.not_links),
            (55, 50, 3, 2)
        );
        assert_eq!((view.done, view.waiting, view.failed), (0, 50, 0));
        assert_eq!(live_bookmarks(&s), 50);
        let page = s
            .list_bookmark_cards(&crate::storage::PageRequest {
                after: None,
                limit: 100,
            })
            .unwrap();
        assert!(page
            .items
            .iter()
            .all(|b| b.summary_status == SummaryStatus::Pending
                && b.summary.is_none()
                && b.reason.is_none()
                && b.tags.is_empty()));
        assert!(page
            .items
            .iter()
            .any(|b| b.title.as_deref() == Some("Example page 1")
                && b.site.as_deref() == Some("example.org")));
        // The waiting items are in file order.
        let first = s.waiting_import_items(&view.base.id, 2).unwrap();
        let b = s.get_saved_bookmark(&first[0].bookmark_id).unwrap();
        assert_eq!(b.url, "https://example.org/import/page-1");
    }

    #[test]
    fn repeats_inside_the_file_are_skipped_and_counted_by_the_compare_key() {
        let dir = TempDir::new();
        let p = write(
            &dir,
            "r.txt",
            "https://a.example/p\nhttps://www.a.example/p/?utm_source=x#top\nHTTPS://A.EXAMPLE/p\nhttps://a.example/P\n",
        );
        let file = read_import_file(&p).unwrap();
        // The path keeps its letter case (#28), so /P is another page.
        assert_eq!((file.links.len(), file.repeats_in_file), (2, 2));
    }

    #[test]
    fn a_link_already_saved_is_skipped_and_counted_by_the_compare_key_and_the_saved_bookmark_is_unchanged(
    ) {
        let (mut s, dir) = open_temp();
        let old = s.save_link_at(T, "https://a.example/saved").unwrap();
        let before = s.get_saved_bookmark(&old.base.id).unwrap();
        let p = write(
            &dir,
            "s.txt",
            "https://www.a.example/saved/?utm_medium=mail\nhttps://a.example/new\n",
        );
        let file = read_import_file(&p).unwrap();
        let preview = s.preview_import(&file).unwrap();
        assert_eq!((preview.to_add, preview.already_saved), (1, 1));
        let view = s.start_import_at(T2, &file, true).unwrap();
        assert_eq!((view.added, view.already_saved, view.waiting), (1, 1, 1));
        assert_eq!(s.get_saved_bookmark(&old.base.id).unwrap(), before);
        assert_eq!(live_bookmarks(&s), 2);
    }

    #[test]
    fn a_link_whose_saved_bookmark_was_deleted_is_imported_again() {
        let (mut s, dir) = open_temp();
        let old = s.save_link_at(T, "https://a.example/gone").unwrap();
        s.conn
            .execute(
                "UPDATE bookmark SET deleted_at = ?2 WHERE id = ?1",
                params![old.base.id, T],
            )
            .unwrap();
        let p = write(&dir, "d.txt", "https://a.example/gone\n");
        let file = read_import_file(&p).unwrap();
        assert_eq!(s.preview_import(&file).unwrap().to_add, 1);
        let view = s.start_import_at(T2, &file, true).unwrap();
        assert_eq!((view.added, view.already_saved), (1, 0));
        assert_eq!(live_bookmarks(&s), 1);
    }

    #[test]
    fn preview_of_an_import_writes_nothing() {
        let (s, _dir) = open_temp();
        let file = read_import_file(&fixture("lib-03-links.txt")).unwrap();
        let preview = s.preview_import(&file).unwrap();
        assert_eq!(
            preview,
            ImportPreview {
                file_name: "lib-03-links.txt".to_string(),
                found: 7,
                to_add: 4,
                repeats_in_file: 1,
                already_saved: 0,
                not_links: 2
            }
        );
        assert_eq!(live_bookmarks(&s), 0);
        assert_eq!(s.latest_import().unwrap(), None);
    }

    #[test]
    fn an_import_without_summaries_stores_links_as_link_only_and_is_finished_at_once() {
        let (mut s, _dir) = open_temp();
        let file = read_import_file(&fixture("lib-03-links.txt")).unwrap();
        let view = s.start_import_at(T, &file, false).unwrap();
        assert_eq!(view.state, ImportState::Finished);
        assert!(!view.with_summaries);
        assert_eq!(
            (view.added, view.done, view.waiting, view.failed),
            (4, 0, 0, 0)
        );
        assert!(s
            .waiting_import_items(&view.base.id, 10)
            .unwrap()
            .is_empty());
        assert_eq!(live_bookmarks(&s), 4);
        // Another import may start at once.
        s.start_import_at(T2, &file, false).unwrap();
    }

    #[test]
    fn running_the_same_import_twice_adds_nothing_the_second_time() {
        let (mut s, _dir) = open_temp();
        let file = read_import_file(&fixture("lib-03-links.txt")).unwrap();
        s.start_import_at(T, &file, false).unwrap();
        let again = s.start_import_at(T2, &file, false).unwrap();
        assert_eq!((again.added, again.already_saved), (0, 4));
        assert_eq!(again.state, ImportState::Finished);
        assert_eq!(live_bookmarks(&s), 4);
    }

    #[test]
    fn a_second_import_is_refused_while_one_is_not_finished_and_stores_nothing() {
        let (mut s, dir) = open_temp();
        let file = read_import_file(&fixture("lib-03-links.txt")).unwrap();
        let first = s.start_import_at(T, &file, true).unwrap();
        let other = read_import_file(&write(&dir, "o.txt", "https://b.example/\n")).unwrap();
        assert!(matches!(
            s.start_import_at(T2, &other, true),
            Err(StorageError::Invalid(_))
        ));
        assert_eq!(live_bookmarks(&s), 4);
        assert_eq!(s.latest_import().unwrap().unwrap().base.id, first.base.id);
    }

    #[test]
    fn import_progress_counts_done_waiting_and_failed_and_finishes_when_none_waits() {
        let (mut s, _dir) = open_temp();
        let file = read_import_file(&fixture("lib-03-links.txt")).unwrap();
        let view = s.start_import_at(T, &file, true).unwrap();
        let items = s.waiting_import_items(&view.base.id, 10).unwrap();
        assert_eq!(items.len(), 4);
        assert!(s
            .end_import_item_at(T2, &items[0].id, ItemState::Done)
            .unwrap());
        assert!(s
            .end_import_item_at(T2, &items[1].id, ItemState::Failed)
            .unwrap());
        // The first end is kept.
        assert!(!s
            .end_import_item_at(T2, &items[1].id, ItemState::Done)
            .unwrap());
        let v = s.finish_import_if_done_at(T2, &view.base.id).unwrap();
        assert_eq!(
            (v.done, v.waiting, v.failed, v.state),
            (1, 2, 1, ImportState::Running)
        );
        s.end_import_item_at(T2, &items[2].id, ItemState::Done)
            .unwrap();
        s.end_import_item_at(T2, &items[3].id, ItemState::Removed)
            .unwrap();
        let v = s.finish_import_if_done_at(T2, &view.base.id).unwrap();
        assert_eq!(
            (v.done, v.waiting, v.failed, v.state),
            (2, 0, 1, ImportState::Finished)
        );
        assert_eq!(v.paused_by, None);
    }

    #[test]
    fn pause_by_the_owner_and_continue_change_only_the_import_state() {
        let (mut s, _dir) = open_temp();
        let file = read_import_file(&fixture("lib-03-links.txt")).unwrap();
        let id = s.start_import_at(T, &file, true).unwrap().base.id;
        let v = s.pause_import_at(T2, &id).unwrap();
        assert_eq!(
            (v.state, v.paused_by, v.waiting),
            (ImportState::Paused, Some(PausedBy::Owner), 4)
        );
        // A second pause changes nothing.
        assert_eq!(
            s.pause_import_at(T2, &id).unwrap().paused_by,
            Some(PausedBy::Owner)
        );
        let v = s.continue_import_at(T2, &id).unwrap();
        assert_eq!(
            (v.state, v.paused_by, v.waiting),
            (ImportState::Running, None, 4)
        );
        assert!(matches!(
            s.pause_import_at(T2, "nope"),
            Err(StorageError::NotFound { .. })
        ));
    }

    #[test]
    fn stop_here_ends_the_import_leaves_its_links_link_only_and_lets_another_file_be_imported() {
        let (mut s, dir) = open_temp();
        let file = read_import_file(&fixture("lib-03-links.txt")).unwrap();
        let id = s.start_import_at(T, &file, true).unwrap().base.id;
        let items = s.waiting_import_items(&id, 10).unwrap();
        s.end_import_item_at(T2, &items[0].id, ItemState::Done)
            .unwrap();
        let v = s.stop_import_at(T2, &id).unwrap();
        assert_eq!(v.state, ImportState::Stopped);
        assert_eq!((v.done, v.waiting, v.failed, v.added), (1, 0, 0, 4));
        // Its links stay as they are: link only, "no summary yet".
        assert_eq!(live_bookmarks(&s), 4);
        let b = s.get_saved_bookmark(&items[1].bookmark_id).unwrap();
        assert_eq!(b.summary_status, SummaryStatus::Pending);
        // Pause and Continue do nothing to a stopped import; a summary stored meanwhile counts.
        assert_eq!(
            s.continue_import_at(T2, &id).unwrap().state,
            ImportState::Stopped
        );
        assert!(s
            .end_import_item_at(T2, &items[1].id, ItemState::Done)
            .unwrap());
        assert!(!s
            .end_import_item_at(T2, &items[2].id, ItemState::Failed)
            .unwrap());
        assert_eq!(s.get_import(&id).unwrap().done, 2);
        // A new file can be imported now.
        let other = read_import_file(&write(&dir, "o.txt", "https://b.example/\n")).unwrap();
        assert_eq!(
            s.start_import_at(T2, &other, true).unwrap().state,
            ImportState::Running
        );
    }

    #[test]
    fn the_latest_import_is_the_last_one_stored_even_within_the_same_second() {
        let (mut s, _dir) = open_temp();
        let file = read_import_file(&fixture("lib-03-links.txt")).unwrap();
        let mut last = String::new();
        for _ in 0..8 {
            last = s.start_import_at(T, &file, false).unwrap().base.id;
        }
        assert_eq!(s.latest_import().unwrap().unwrap().base.id, last);
    }

    #[test]
    fn stop_here_on_a_paused_import_ends_it_too_and_a_restart_keeps_it_stopped() {
        let dir = TempDir::new();
        let db = dir.path().join("mnemo.db");
        let id = {
            let mut s = Storage::open(&db).unwrap();
            let file = read_import_file(&fixture("lib-03-links.txt")).unwrap();
            let id = s.start_import_at(T, &file, true).unwrap().base.id;
            s.pause_import_at(T2, &id).unwrap();
            assert_eq!(
                s.stop_import_at(T2, &id).unwrap().state,
                ImportState::Stopped
            );
            id
        };
        let s = Storage::open(&db).unwrap();
        let v = s.get_import(&id).unwrap();
        assert_eq!(
            (v.state, v.paused_by, v.waiting),
            (ImportState::Stopped, None, 0)
        );
    }

    #[test]
    fn after_a_restart_the_running_import_opens_paused_with_its_counts_kept() {
        let dir = TempDir::new();
        let db = dir.path().join("mnemo.db");
        let (id, items) = {
            let mut s = Storage::open(&db).unwrap();
            let file = read_import_file(&fixture("lib-03-bookmarks-export.html")).unwrap();
            let id = s.start_import_at(T, &file, true).unwrap().base.id;
            let items = s.waiting_import_items(&id, 3).unwrap();
            s.end_import_item_at(T2, &items[0].id, ItemState::Done)
                .unwrap();
            s.end_import_item_at(T2, &items[1].id, ItemState::Failed)
                .unwrap();
            // The third is mid-read when the app quits.
            s.claim_bookmark_for_summary_at(T2, &items[2].bookmark_id)
                .unwrap();
            (id, items)
        };
        let s = Storage::open(&db).unwrap();
        let v = s.latest_import().unwrap().unwrap();
        assert_eq!(v.base.id, id);
        assert_eq!(
            (v.state, v.paused_by),
            (ImportState::Paused, Some(PausedBy::Closed))
        );
        assert_eq!(
            (v.found, v.added, v.repeats_in_file, v.not_links),
            (55, 50, 3, 2)
        );
        assert_eq!((v.done, v.waiting, v.failed), (1, 48, 1));
        // The link that was being read is back to "no summary yet" and still waits.
        let b = s.get_saved_bookmark(&items[2].bookmark_id).unwrap();
        assert_eq!(b.summary_status, SummaryStatus::Pending);
    }
}
