//! Folders for bookmarks (#26, BM-02). This file owns the SQL of the `folder` table, the folder
//! columns of `bookmark`, and the one step of Undo.
//!
//! Folders are flat. "Unsorted" is the fixed default folder (migration 11): it cannot be renamed
//! or deleted, and it holds every bookmark that has no other folder. Only the owner creates,
//! renames or deletes a folder, moves a bookmark or deletes one: a save never makes a folder, and
//! an AI answer that names an unknown folder leaves the bookmark in Unsorted.
//!
//! Undo keeps one step in memory (lost when the app closes): the last move or the last bookmark
//! delete. A move undone puts the bookmark back in its old folder with its old reason; a delete
//! undone clears `deleted_at` and brings back the item links that the delete removed.

use rusqlite::{params, OptionalExtension, Transaction};
use serde::Serialize;

use super::bookmarks::{SavedBookmark, MAX_REASON_CHARS};
use super::error::StorageError;
use super::items::invalid;
use super::record::{now_iso, RecordBase};
use super::Storage;

/// The id of the fixed "Unsorted" folder (the row migration 11 inserts).
pub const UNSORTED_ID: &str = "00000000-0000-4000-8000-000000000001";
/// The name of the fixed default folder.
pub const UNSORTED_NAME: &str = "Unsorted";
/// Longest folder name, in characters.
pub const MAX_FOLDER_CHARS: usize = 80;
/// Most live folders, Unsorted included, so the list never grows without a bound.
pub const MAX_FOLDERS: usize = 200;

const FOLDER_NOT_FOUND: StorageError = StorageError::NotFound { kind: "folder" };
const NOTHING_TO_UNDO: &str = "There is nothing to undo.";

/// A live folder and how many live bookmarks it holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    /// True for Unsorted: it cannot be renamed or deleted.
    pub is_default: bool,
    pub count: u32,
}

/// The folder an AI answer chose, and why. The name is looked up among the live folders; the
/// reason is stored as a guess.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderPick {
    pub name: String,
    pub reason: String,
}

/// The one step Undo can take back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Undo {
    /// A move: the bookmark and where it was.
    Move {
        id: String,
        folder_id: String,
        reason: Option<String>,
        is_guess: bool,
    },
    /// A bookmark delete: the bookmark, the time the delete wrote, and the ids of the item links
    /// the delete removed (only those come back).
    Delete {
        id: String,
        at: String,
        links: Vec<String>,
    },
}

// Unsorted last, the rest by name.
const LIST_SQL: &str = "SELECT f.id, f.name, f.is_default,
         (SELECT count(*) FROM bookmark b WHERE b.folder_id = f.id AND b.deleted_at IS NULL)
     FROM folder f WHERE f.deleted_at IS NULL
     ORDER BY f.is_default, f.name COLLATE NOCASE, f.id";

const GET_SQL: &str = "SELECT f.id, f.name, f.is_default,
         (SELECT count(*) FROM bookmark b WHERE b.folder_id = f.id AND b.deleted_at IS NULL)
     FROM folder f WHERE f.id = ?1 AND f.deleted_at IS NULL";

const COUNT_SQL: &str = "SELECT count(*) FROM folder WHERE deleted_at IS NULL";

const INSERT_SQL: &str = "INSERT INTO folder (id, created_at, updated_at, name, is_default)
     VALUES (?1, ?2, ?2, ?3, 0)";

// A default folder is never renamed (is_default = 0 in the WHERE).
const RENAME_SQL: &str = "UPDATE folder SET name = ?3, updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL AND is_default = 0";

const DELETE_SQL: &str = "UPDATE folder SET deleted_at = ?2, updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL AND is_default = 0";

// Every bookmark row of a deleted folder (deleted rows too) goes to Unsorted, as the owner's
// own choice would: no reason, not a guess.
const MOVE_ALL_SQL: &str = "UPDATE bookmark
     SET folder_id = ?2, folder_reason = NULL, folder_is_guess = 0, updated_at = ?3
     WHERE folder_id = ?1";

const LIVE_IN_SQL: &str =
    "SELECT count(*) FROM bookmark WHERE folder_id = ?1 AND deleted_at IS NULL";

const FIND_BY_NAME_SQL: &str = "SELECT id FROM folder
     WHERE deleted_at IS NULL AND name = ?1 COLLATE NOCASE";

// The live non-default folder names, for the save prompt.
const NAMES_SQL: &str = "SELECT name FROM folder
     WHERE deleted_at IS NULL AND is_default = 0 ORDER BY name COLLATE NOCASE, id";

const LIVE_SQL: &str = "SELECT count(*) FROM folder WHERE id = ?1 AND deleted_at IS NULL";

const FOLDER_OF_SQL: &str = "SELECT folder_id, folder_reason, folder_is_guess FROM bookmark
     WHERE id = ?1 AND deleted_at IS NULL";

const SET_FOLDER_SQL: &str = "UPDATE bookmark
     SET folder_id = ?3, folder_reason = ?4, folder_is_guess = ?5, updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL";

// The AI's choice lands only on a bookmark still in Unsorted, so a folder the owner picked while
// the summary ran is never overridden.
const PICK_SQL: &str = "UPDATE bookmark
     SET folder_id = ?3, folder_reason = ?4, folder_is_guess = 1
     WHERE id = ?1 AND deleted_at IS NULL AND folder_id = ?2";

// A bookmark delete: the claim goes with it, and a read that was going ends as "no summary yet".
const DELETE_BOOKMARK_SQL: &str = "UPDATE bookmark
     SET deleted_at = ?2, updated_at = ?2, claim = NULL,
         summary_status = CASE WHEN summary_status = 'reading' THEN 'pending' ELSE summary_status END
     WHERE id = ?1 AND deleted_at IS NULL";

const LIVE_LINKS_SQL: &str = "SELECT id FROM item_link
     WHERE deleted_at IS NULL
       AND ((a_kind = 'bookmark' AND a_id = ?1) OR (b_kind = 'bookmark' AND b_id = ?1))";

const HIDE_LINK_SQL: &str = "UPDATE item_link SET deleted_at = ?2, updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL";

// Only a link this delete removed (same id, same time) comes back.
const RESTORE_LINK_SQL: &str = "UPDATE item_link SET deleted_at = NULL, updated_at = ?3
     WHERE id = ?1 AND deleted_at = ?2";

// A live bookmark of the same link (compare key) as the bookmark ?1, other than itself.
const SAME_LINK_LIVE_SQL: &str = "SELECT count(*) FROM bookmark b
     WHERE b.deleted_at IS NULL AND b.id <> ?1 AND b.compare_key IS NOT NULL
       AND b.compare_key = (SELECT compare_key FROM bookmark WHERE id = ?1)";

const UNDELETE_SQL: &str = "UPDATE bookmark SET deleted_at = NULL, updated_at = ?3
     WHERE id = ?1 AND deleted_at = ?2";

/// The trimmed folder name, or why it is refused: 1 to 80 characters on one line.
fn clean_folder_name(name: &str) -> Result<String, StorageError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(invalid("The folder name cannot be empty.".to_string()));
    }
    if name.contains(['\n', '\r']) {
        return Err(invalid("The folder name must be one line.".to_string()));
    }
    if name.chars().count() > MAX_FOLDER_CHARS {
        return Err(invalid(format!(
            "The folder name is too long (at most {MAX_FOLDER_CHARS} characters)."
        )));
    }
    Ok(name.to_string())
}

fn name_taken() -> StorageError {
    invalid("A folder with this name already exists.".to_string())
}

/// A unique-index refusal reads as a name clash; anything else stays a database error.
fn folder_write_failed(e: rusqlite::Error) -> StorageError {
    match &e {
        rusqlite::Error::SqliteFailure(f, _)
            if f.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            name_taken()
        }
        _ => StorageError::from(e),
    }
}

fn folder_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Folder> {
    Ok(Folder {
        id: r.get(0)?,
        name: r.get(1)?,
        is_default: r.get(2)?,
        count: r.get(3)?,
    })
}

fn refuse_default(action: &str) -> StorageError {
    invalid(format!(
        "{UNSORTED_NAME} is the default folder and cannot be {action}."
    ))
}

/// The id of the live folder named `name` (ignoring case), if there is one.
fn find_by_name(tx: &Transaction<'_>, name: &str) -> Result<Option<String>, StorageError> {
    Ok(tx
        .query_row(FIND_BY_NAME_SQL, [name], |r| r.get(0))
        .optional()?)
}

/// Applies the folder an AI answer chose to the bookmark `id`, inside the caller's transaction
/// (the one that stores its summary). A name that is no live folder changes nothing: the
/// bookmark stays in Unsorted, with no reason and no guess flag, and no folder is made. Only
/// a bookmark still in Unsorted is filed.
pub(super) fn apply_pick(
    tx: &Transaction<'_>,
    id: &str,
    pick: &FolderPick,
) -> Result<(), StorageError> {
    let reason = pick.reason.trim();
    if reason.is_empty() || reason.chars().count() > MAX_REASON_CHARS {
        return Err(invalid(format!(
            "The folder reason must be 1 to {MAX_REASON_CHARS} characters."
        )));
    }
    let Some(folder_id) = find_by_name(tx, pick.name.trim())? else {
        log::info!("bookmark {id}: the answer named no existing folder, it stays in Unsorted");
        return Ok(());
    };
    tx.execute(PICK_SQL, params![id, UNSORTED_ID, folder_id, reason])?;
    Ok(())
}

impl Storage {
    /// The live folders with their live bookmark counts, by name, Unsorted last.
    pub fn list_folders(&self) -> Result<Vec<Folder>, StorageError> {
        let mut st = self.conn.prepare_cached(LIST_SQL)?;
        let rows = st.query_map([], folder_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// The names of the live folders except Unsorted, for the prompt of the save task.
    pub fn folder_names(&self) -> Result<Vec<String>, StorageError> {
        let mut st = self.conn.prepare_cached(NAMES_SQL)?;
        let rows = st.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Creates a folder (the owner's action). The name is trimmed, 1 to 80 characters on one
    /// line, and unique among the live folders ignoring case.
    pub fn create_folder(&mut self, name: &str) -> Result<Folder, StorageError> {
        self.create_folder_at(&now_iso(), name)
    }

    pub(crate) fn create_folder_at(
        &mut self,
        now: &str,
        name: &str,
    ) -> Result<Folder, StorageError> {
        let name = clean_folder_name(name)?;
        let tx = self.immediate()?;
        let n: i64 = tx.query_row(COUNT_SQL, [], |r| r.get(0))?;
        if n as usize >= MAX_FOLDERS {
            return Err(invalid(format!(
                "Mnemo holds at most {MAX_FOLDERS} folders."
            )));
        }
        let id = RecordBase::new_at(now).id;
        tx.execute(INSERT_SQL, params![id, now, name])
            .map_err(folder_write_failed)?;
        let folder = tx.query_row(GET_SQL, [&id], folder_row)?;
        tx.commit()?;
        Ok(folder)
    }

    /// Renames a folder. Unsorted is refused.
    pub fn rename_folder(&mut self, id: &str, name: &str) -> Result<Folder, StorageError> {
        self.rename_folder_at(&now_iso(), id, name)
    }

    pub(crate) fn rename_folder_at(
        &mut self,
        now: &str,
        id: &str,
        name: &str,
    ) -> Result<Folder, StorageError> {
        let name = clean_folder_name(name)?;
        let tx = self.immediate()?;
        let current = tx
            .query_row(GET_SQL, [id], folder_row)
            .optional()?
            .ok_or(FOLDER_NOT_FOUND)?;
        if current.is_default {
            return Err(refuse_default("renamed"));
        }
        tx.execute(RENAME_SQL, params![id, now, name])
            .map_err(folder_write_failed)?;
        let folder = tx.query_row(GET_SQL, [id], folder_row)?;
        tx.commit()?;
        Ok(folder)
    }

    /// Deletes a folder (soft). Every bookmark in it moves to Unsorted in the same transaction, so
    /// none is lost. Returns how many live bookmarks moved. Unsorted is refused.
    pub fn delete_folder(&mut self, id: &str) -> Result<u32, StorageError> {
        self.delete_folder_at(&now_iso(), id)
    }

    pub(crate) fn delete_folder_at(&mut self, now: &str, id: &str) -> Result<u32, StorageError> {
        let tx = self.immediate()?;
        let current = tx
            .query_row(GET_SQL, [id], folder_row)
            .optional()?
            .ok_or(FOLDER_NOT_FOUND)?;
        if current.is_default {
            return Err(refuse_default("deleted"));
        }
        let moved: i64 = tx.query_row(LIVE_IN_SQL, [id], |r| r.get(0))?;
        tx.execute(MOVE_ALL_SQL, params![id, UNSORTED_ID, now])?;
        tx.execute(DELETE_SQL, params![id, now])?;
        tx.commit()?;
        Ok(moved as u32)
    }

    /// Moves a live bookmark to a live folder (the owner's action). The reason and the guess flag
    /// of the old folder are cleared: the owner chose this one. The old place is kept as the one
    /// step of Undo. Moving to the folder it is already in changes nothing and keeps the old step.
    pub fn move_bookmark(
        &mut self,
        id: &str,
        folder_id: &str,
    ) -> Result<SavedBookmark, StorageError> {
        self.move_bookmark_at(&now_iso(), id, folder_id)
    }

    pub(crate) fn move_bookmark_at(
        &mut self,
        now: &str,
        id: &str,
        folder_id: &str,
    ) -> Result<SavedBookmark, StorageError> {
        let tx = self.immediate()?;
        let live: i64 = tx.query_row(LIVE_SQL, [folder_id], |r| r.get(0))?;
        if live == 0 {
            return Err(FOLDER_NOT_FOUND);
        }
        let (old_folder, old_reason, old_guess): (String, Option<String>, bool) = tx
            .query_row(FOLDER_OF_SQL, [id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .optional()?
            .ok_or(StorageError::NotFound { kind: "bookmark" })?;
        if old_folder == folder_id {
            let b = super::bookmarks::saved_bookmark_on(&tx, id)?;
            return Ok(b);
        }
        tx.execute(
            SET_FOLDER_SQL,
            params![id, now, folder_id, None::<String>, false],
        )?;
        let b = super::bookmarks::saved_bookmark_on(&tx, id)?;
        tx.commit()?;
        self.undo = Some(Undo::Move {
            id: id.to_string(),
            folder_id: old_folder,
            reason: old_reason,
            is_guess: old_guess,
        });
        Ok(b)
    }

    /// Deletes a live bookmark (soft, the owner's action) with its item links, and keeps it as the
    /// one step of Undo. A summary run that holds the bookmark loses its claim. Returns the time
    /// of the delete.
    pub fn delete_saved_bookmark(&mut self, id: &str) -> Result<String, StorageError> {
        self.delete_saved_bookmark_at(&now_iso(), id)
    }

    pub(crate) fn delete_saved_bookmark_at(
        &mut self,
        now: &str,
        id: &str,
    ) -> Result<String, StorageError> {
        let tx = self.immediate()?;
        if tx.execute(DELETE_BOOKMARK_SQL, params![id, now])? == 0 {
            return Err(StorageError::NotFound { kind: "bookmark" });
        }
        let links: Vec<String> = {
            let mut st = tx.prepare(LIVE_LINKS_SQL)?;
            let rows = st.query_map([id], |r| r.get(0))?;
            rows.collect::<Result<_, _>>()?
        };
        for link in &links {
            tx.execute(HIDE_LINK_SQL, params![link, now])?;
        }
        tx.commit()?;
        self.undo = Some(Undo::Delete {
            id: id.to_string(),
            at: now.to_string(),
            links,
        });
        Ok(now.to_string())
    }

    /// Takes back the last move or the last bookmark delete, and gives the bookmark as it is now.
    /// There is only one step: it is used up by this call, and a second call has nothing to undo.
    /// A move undone into a folder that was deleted since puts the bookmark in Unsorted.
    pub fn undo_last(&mut self) -> Result<SavedBookmark, StorageError> {
        self.undo_last_at(&now_iso())
    }

    pub(crate) fn undo_last_at(&mut self, now: &str) -> Result<SavedBookmark, StorageError> {
        let step = self
            .undo
            .take()
            .ok_or_else(|| invalid(NOTHING_TO_UNDO.to_string()))?;
        let tx = self.immediate()?;
        let id = match &step {
            Undo::Move {
                id,
                folder_id,
                reason,
                is_guess,
            } => {
                let live: i64 = tx.query_row(LIVE_SQL, [folder_id], |r| r.get(0))?;
                let (to, reason, guess) = if live == 1 {
                    (folder_id.as_str(), reason.clone(), *is_guess)
                } else {
                    (UNSORTED_ID, None, false)
                };
                if tx.execute(SET_FOLDER_SQL, params![id, now, to, reason, guess])? == 0 {
                    return Err(StorageError::NotFound { kind: "bookmark" });
                }
                id
            }
            Undo::Delete { id, at, links } => {
                // The link was saved again after the delete: bringing the old one back would
                // leave it twice. Nothing changes, and the step is kept.
                let again: i64 = tx.query_row(SAME_LINK_LIVE_SQL, [id], |r| r.get(0))?;
                if again > 0 {
                    drop(tx);
                    self.undo = Some(step.clone());
                    return Err(invalid(
                        "This link was saved again after you deleted it, so the old one cannot come back."
                            .to_string(),
                    ));
                }
                if tx.execute(UNDELETE_SQL, params![id, at, now])? == 0 {
                    return Err(StorageError::NotFound { kind: "bookmark" });
                }
                for link in links {
                    tx.execute(RESTORE_LINK_SQL, params![link, at, now])?;
                }
                id
            }
        };
        let b = super::bookmarks::saved_bookmark_on(&tx, id)?;
        tx.commit()?;
        Ok(b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::bookmarks::SummaryStatus;
    use crate::storage::testing::open_temp;

    const T1: &str = "2026-01-01T00:00:00Z";
    const T2: &str = "2026-01-02T00:00:00Z";
    const T3: &str = "2026-01-03T00:00:00Z";

    fn saved(s: &mut Storage, url: &str) -> SavedBookmark {
        s.save_link_at(T1, url).unwrap()
    }

    fn folder_of(s: &Storage, id: &str) -> (String, Option<String>, bool) {
        let b = s.get_saved_bookmark(id).unwrap();
        (b.folder, b.folder_reason, b.folder_is_guess)
    }

    fn names(s: &Storage) -> Vec<String> {
        s.list_folders()
            .unwrap()
            .into_iter()
            .map(|f| f.name)
            .collect()
    }

    #[test]
    fn folder_list_has_unsorted_last_and_counts_the_live_bookmarks() {
        let (mut s, _d) = open_temp();
        assert_eq!(names(&s), vec!["Unsorted"]);
        let b = s.create_folder_at(T1, "Zebra").unwrap();
        s.create_folder_at(T1, "apple").unwrap();
        assert_eq!(names(&s), vec!["apple", "Zebra", "Unsorted"]);
        let one = saved(&mut s, "https://a.example/");
        let two = saved(&mut s, "https://b.example/");
        s.move_bookmark_at(T2, &one.base.id, &b.id).unwrap();
        s.delete_saved_bookmark_at(T3, &two.base.id).unwrap();
        let counts: Vec<(String, u32)> = s
            .list_folders()
            .unwrap()
            .into_iter()
            .map(|f| (f.name, f.count))
            .collect();
        assert_eq!(
            counts,
            vec![
                ("apple".to_string(), 0),
                ("Zebra".to_string(), 1),
                ("Unsorted".to_string(), 0)
            ]
        );
        assert_eq!(s.folder_names().unwrap(), vec!["apple", "Zebra"]);
    }

    #[test]
    fn folder_create_refuses_a_bad_or_taken_name_and_makes_nothing() {
        let (mut s, _d) = open_temp();
        s.create_folder_at(T1, "Dev tools").unwrap();
        for bad in ["", "   ", "two\nlines", &"x".repeat(MAX_FOLDER_CHARS + 1)] {
            assert!(matches!(
                s.create_folder_at(T1, bad),
                Err(StorageError::Invalid(_))
            ));
        }
        for taken in ["dev TOOLS", " Dev tools ", "unsorted", "UNSORTED"] {
            assert_eq!(
                s.create_folder_at(T1, taken).unwrap_err(),
                name_taken(),
                "{taken}"
            );
        }
        assert_eq!(names(&s), vec!["Dev tools", "Unsorted"]);
    }

    #[test]
    fn folder_create_stops_at_the_limit() {
        let (mut s, _d) = open_temp();
        for i in 1..MAX_FOLDERS {
            s.create_folder_at(T1, &format!("f{i}")).unwrap();
        }
        assert!(matches!(
            s.create_folder_at(T1, "one too many"),
            Err(StorageError::Invalid(_))
        ));
        assert_eq!(s.list_folders().unwrap().len(), MAX_FOLDERS);
    }

    #[test]
    fn folder_rename_changes_the_name_and_refuses_unsorted_a_clash_and_a_missing_folder() {
        let (mut s, _d) = open_temp();
        let a = s.create_folder_at(T1, "Read").unwrap();
        s.create_folder_at(T1, "Work").unwrap();
        let got = s.rename_folder_at(T2, &a.id, "  Later ").unwrap();
        assert_eq!(got.name, "Later");
        // Renaming to its own name in another case is allowed.
        assert_eq!(
            s.rename_folder_at(T2, &a.id, "LATER").unwrap().name,
            "LATER"
        );
        assert_eq!(
            s.rename_folder_at(T2, &a.id, "work").unwrap_err(),
            name_taken()
        );
        assert!(matches!(
            s.rename_folder_at(T2, UNSORTED_ID, "Inbox"),
            Err(StorageError::Invalid(m)) if m.contains("cannot be renamed")
        ));
        assert_eq!(
            s.rename_folder_at(T2, "no-such", "X").unwrap_err(),
            FOLDER_NOT_FOUND
        );
        assert_eq!(names(&s), vec!["LATER", "Work", "Unsorted"]);
    }

    #[test]
    fn folder_delete_moves_every_bookmark_to_unsorted_and_loses_none() {
        let (mut s, _d) = open_temp();
        let f = s.create_folder_at(T1, "Dev tools").unwrap();
        let live = saved(&mut s, "https://a.example/");
        let gone = saved(&mut s, "https://b.example/");
        for b in [&live, &gone] {
            s.move_bookmark_at(T2, &b.base.id, &f.id).unwrap();
        }
        s.delete_saved_bookmark_at(T2, &gone.base.id).unwrap();
        let moved = s.delete_folder_at(T3, &f.id).unwrap();
        assert_eq!(moved, 1, "only the live bookmark is counted");
        assert_eq!(names(&s), vec!["Unsorted"]);
        assert_eq!(
            folder_of(&s, &live.base.id),
            ("Unsorted".into(), None, false)
        );
        // The soft-deleted bookmark is kept too, and comes back in Unsorted.
        assert_eq!(s.bookmark_rows_for_test(), 2);
        s.undo_last_at(T3).unwrap();
        assert_eq!(folder_of(&s, &gone.base.id).0, "Unsorted");
        assert_eq!(s.list_folders().unwrap()[0].count, 2);
        // The name is free again.
        s.create_folder_at(T3, "Dev tools").unwrap();
    }

    #[test]
    fn folder_delete_refuses_unsorted_and_a_missing_folder() {
        let (mut s, _d) = open_temp();
        let b = saved(&mut s, "https://a.example/");
        assert!(matches!(
            s.delete_folder_at(T2, UNSORTED_ID),
            Err(StorageError::Invalid(m)) if m.contains("cannot be deleted")
        ));
        assert_eq!(
            s.delete_folder_at(T2, "no-such").unwrap_err(),
            FOLDER_NOT_FOUND
        );
        assert_eq!(names(&s), vec!["Unsorted"]);
        assert_eq!(folder_of(&s, &b.base.id).0, "Unsorted");
    }

    #[test]
    fn folder_move_then_undo_puts_the_bookmark_back_in_its_old_folder() {
        let (mut s, _d) = open_temp();
        let a = s.create_folder_at(T1, "Dev tools").unwrap();
        let b = s.create_folder_at(T1, "Cooking").unwrap();
        let bm = saved(&mut s, "https://a.example/");
        let id = bm.base.id.clone();
        // Filed by the app first (a guess with a reason), then moved by the owner twice.
        let tx = s.conn.transaction().unwrap();
        tx.execute(SET_FOLDER_SQL, params![id, T1, a.id, "It is a tool.", true])
            .unwrap();
        tx.commit().unwrap();
        let moved = s.move_bookmark_at(T2, &id, &b.id).unwrap();
        assert_eq!(
            (
                moved.folder.as_str(),
                moved.folder_reason.clone(),
                moved.folder_is_guess
            ),
            ("Cooking", None, false),
            "an owner move clears the reason and the guess flag"
        );
        let back = s.undo_last_at(T3).unwrap();
        assert_eq!(back.folder, "Dev tools");
        assert_eq!(back.folder_reason.as_deref(), Some("It is a tool."));
        assert!(back.folder_is_guess);
        // One step only.
        assert!(matches!(
            s.undo_last_at(T3),
            Err(StorageError::Invalid(m)) if m == NOTHING_TO_UNDO
        ));
    }

    #[test]
    fn folder_move_to_a_missing_folder_or_of_a_missing_bookmark_is_refused_and_changes_nothing() {
        let (mut s, _d) = open_temp();
        let f = s.create_folder_at(T1, "Dev tools").unwrap();
        let bm = saved(&mut s, "https://a.example/");
        assert_eq!(
            s.move_bookmark_at(T2, &bm.base.id, "no-such").unwrap_err(),
            FOLDER_NOT_FOUND
        );
        assert_eq!(
            s.move_bookmark_at(T2, "no-such", &f.id).unwrap_err(),
            StorageError::NotFound { kind: "bookmark" }
        );
        s.delete_folder_at(T2, &f.id).unwrap();
        assert_eq!(
            s.move_bookmark_at(T2, &bm.base.id, &f.id).unwrap_err(),
            FOLDER_NOT_FOUND,
            "a deleted folder is not a place to move to"
        );
        assert_eq!(folder_of(&s, &bm.base.id).0, "Unsorted");
        assert!(s.undo_last_at(T3).is_err(), "a refused move leaves no step");
    }

    #[test]
    fn folder_move_into_the_same_folder_changes_nothing_and_keeps_the_last_step() {
        let (mut s, _d) = open_temp();
        let f = s.create_folder_at(T1, "Dev tools").unwrap();
        let bm = saved(&mut s, "https://a.example/");
        s.move_bookmark_at(T2, &bm.base.id, &f.id).unwrap();
        s.move_bookmark_at(T3, &bm.base.id, &f.id).unwrap();
        let back = s.undo_last_at(T3).unwrap();
        assert_eq!(back.folder, "Unsorted");
    }

    #[test]
    fn folder_move_undo_after_the_old_folder_was_deleted_puts_the_bookmark_in_unsorted() {
        let (mut s, _d) = open_temp();
        let a = s.create_folder_at(T1, "Old").unwrap();
        let b = s.create_folder_at(T1, "New").unwrap();
        let bm = saved(&mut s, "https://a.example/");
        s.move_bookmark_at(T2, &bm.base.id, &a.id).unwrap();
        s.move_bookmark_at(T2, &bm.base.id, &b.id).unwrap();
        s.delete_folder_at(T3, &a.id).unwrap();
        let back = s.undo_last_at(T3).unwrap();
        assert_eq!(back.folder, "Unsorted");
    }

    #[test]
    fn folder_delete_bookmark_then_undo_brings_the_bookmark_back_with_its_links() {
        let (mut s, _d) = open_temp();
        let bm = saved(&mut s, "https://a.example/");
        let id = bm.base.id.clone();
        s.conn
            .execute(
                "INSERT INTO item_link (id, a_kind, a_id, b_kind, b_id, created_at, updated_at)
                 VALUES ('l1', 'bookmark', ?1, 'bookmark', 'other', ?2, ?2)",
                [&id, T1],
            )
            .unwrap();
        s.delete_saved_bookmark_at(T2, &id).unwrap();
        assert!(s.get_saved_bookmark(&id).is_err());
        assert_eq!(s.list_folders().unwrap()[0].count, 0);
        let live_links = |s: &Storage| -> i64 {
            s.conn
                .query_row(
                    "SELECT count(*) FROM item_link WHERE deleted_at IS NULL",
                    [],
                    |r| r.get(0),
                )
                .unwrap()
        };
        assert_eq!(live_links(&s), 0);
        let back = s.undo_last_at(T3).unwrap();
        assert_eq!(back.base.id, id);
        assert_eq!(back.base.deleted_at, None);
        assert_eq!(live_links(&s), 1);
        assert_eq!(s.list_folders().unwrap()[0].count, 1);
        // The step is used up.
        assert!(s.undo_last_at(T3).is_err());
    }

    #[test]
    fn folder_delete_bookmark_ends_a_read_that_was_going_and_undo_gives_no_summary_yet() {
        let (mut s, _d) = open_temp();
        let (bm, claim) = s.save_link_to_read_at(T1, "https://a.example/").unwrap();
        assert_eq!(bm.summary_status, SummaryStatus::Reading);
        s.delete_saved_bookmark_at(T2, &bm.base.id).unwrap();
        // The run that held the claim lost it.
        let lost = s
            .release_bookmark_at(T2, &bm.base.id, &claim, SummaryStatus::Pending)
            .unwrap();
        assert!(matches!(lost, crate::storage::bookmarks::Held::Lost(None)));
        let back = s.undo_last_at(T3).unwrap();
        assert_eq!(back.summary_status, SummaryStatus::Pending);
    }

    #[test]
    fn folder_delete_bookmark_twice_or_of_a_missing_bookmark_is_refused_and_keeps_the_last_step() {
        let (mut s, _d) = open_temp();
        let a = saved(&mut s, "https://a.example/");
        s.delete_saved_bookmark_at(T2, &a.base.id).unwrap();
        assert_eq!(
            s.delete_saved_bookmark_at(T3, &a.base.id).unwrap_err(),
            StorageError::NotFound { kind: "bookmark" }
        );
        assert!(s.delete_saved_bookmark_at(T3, "no-such").is_err());
        assert_eq!(s.undo_last_at(T3).unwrap().base.id, a.base.id);
    }

    #[test]
    fn folder_undo_with_nothing_done_is_refused() {
        let (mut s, _d) = open_temp();
        assert!(matches!(
            s.undo_last_at(T1),
            Err(StorageError::Invalid(m)) if m == NOTHING_TO_UNDO
        ));
    }

    #[test]
    fn folder_pick_files_a_bookmark_in_a_live_folder_as_a_guess_with_its_reason() {
        let (mut s, _d) = open_temp();
        let f = s.create_folder_at(T1, "Dev tools").unwrap();
        let bm = saved(&mut s, "https://a.example/");
        let tx = s.conn.transaction().unwrap();
        apply_pick(
            &tx,
            &bm.base.id,
            &FolderPick {
                name: " dev TOOLS ".into(),
                reason: " A tool page. ".into(),
            },
        )
        .unwrap();
        tx.commit().unwrap();
        let b = s.get_saved_bookmark(&bm.base.id).unwrap();
        assert_eq!(b.folder_id, f.id);
        assert_eq!(b.folder_reason.as_deref(), Some("A tool page."));
        assert!(b.folder_is_guess);
    }

    #[test]
    fn folder_pick_of_an_unknown_name_makes_no_folder_and_leaves_the_bookmark_in_unsorted() {
        let (mut s, _d) = open_temp();
        let bm = saved(&mut s, "https://a.example/");
        let tx = s.conn.transaction().unwrap();
        apply_pick(
            &tx,
            &bm.base.id,
            &FolderPick {
                name: "Brand new folder".into(),
                reason: "It fits a new folder.".into(),
            },
        )
        .unwrap();
        tx.commit().unwrap();
        assert_eq!(names(&s), vec!["Unsorted"]);
        assert_eq!(folder_of(&s, &bm.base.id), ("Unsorted".into(), None, false));
    }

    #[test]
    fn folder_pick_never_overrides_a_folder_the_owner_chose_and_refuses_a_bad_reason() {
        let (mut s, _d) = open_temp();
        let mine = s.create_folder_at(T1, "Mine").unwrap();
        s.create_folder_at(T1, "Theirs").unwrap();
        let bm = saved(&mut s, "https://a.example/");
        s.move_bookmark_at(T2, &bm.base.id, &mine.id).unwrap();
        let tx = s.conn.transaction().unwrap();
        apply_pick(
            &tx,
            &bm.base.id,
            &FolderPick {
                name: "Theirs".into(),
                reason: "Because.".into(),
            },
        )
        .unwrap();
        for reason in ["  ", &"r".repeat(MAX_REASON_CHARS + 1)] {
            assert!(apply_pick(
                &tx,
                &bm.base.id,
                &FolderPick {
                    name: "Theirs".into(),
                    reason: reason.to_string()
                }
            )
            .is_err());
        }
        tx.commit().unwrap();
        assert_eq!(folder_of(&s, &bm.base.id).0, "Mine");
    }

    #[test]
    fn folder_undo_of_a_delete_brings_back_only_the_links_that_delete_removed() {
        let (mut s, _d) = open_temp();
        let bm = saved(&mut s, "https://a.example/");
        let id = bm.base.id.clone();
        for (l, other) in [("l-old", "x1"), ("l-live", "x2")] {
            s.conn
                .execute(
                    "INSERT INTO item_link (id, a_kind, a_id, b_kind, b_id, created_at, updated_at)
                     VALUES (?1, 'bookmark', ?2, 'bookmark', ?3, ?4, ?4)",
                    [l, &id, other, T1],
                )
                .unwrap();
        }
        // The owner removed one link earlier, in the same second as the delete.
        s.conn
            .execute(
                "UPDATE item_link SET deleted_at = ?1 WHERE id = 'l-old'",
                [T2],
            )
            .unwrap();
        s.delete_saved_bookmark_at(T2, &id).unwrap();
        s.undo_last_at(T3).unwrap();
        let live: Vec<String> = {
            let mut st = s
                .conn
                .prepare("SELECT id FROM item_link WHERE deleted_at IS NULL")
                .unwrap();
            st.query_map([], |r| r.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert_eq!(live, vec!["l-live".to_string()]);
    }

    #[test]
    fn folder_undo_of_a_delete_is_refused_when_the_link_was_saved_again_and_keeps_the_step() {
        let (mut s, _d) = open_temp();
        let old = saved(&mut s, "https://a.example/");
        s.delete_saved_bookmark_at(T2, &old.base.id).unwrap();
        let newer = s.save_link_at(T3, "https://a.example/").unwrap();
        assert!(matches!(
            s.undo_last_at(T3),
            Err(StorageError::Invalid(m)) if m.contains("saved again")
        ));
        assert!(s.get_saved_bookmark(&old.base.id).is_err(), "still deleted");
        // Once the new one is gone, the same step still works.
        s.conn
            .execute(
                "UPDATE bookmark SET deleted_at = ?2 WHERE id = ?1",
                [&newer.base.id, T3],
            )
            .unwrap();
        assert_eq!(s.undo_last_at(T3).unwrap().base.id, old.base.id);
    }
}
