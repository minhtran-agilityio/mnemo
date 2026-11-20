//! Nested labels for notes (#33). A label has an optional parent label; a note carries one
//! or more labels through `note_label`. This file owns the `label` and `note_label` SQL and
//! the label rules: a live name is unique per parent (ignoring case), a label never moves
//! under itself or one of its own labels, a delete moves the notes and child labels to the
//! parent, and a note is saved only with at least one label. Every write that changes more
//! than one row runs in one transaction.

use std::collections::HashSet;

use rusqlite::{params, ErrorCode, OptionalExtension, Row, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};

use super::error::StorageError;
use super::items::{Item, Note, NoteInput};
use super::record::{now_iso, RecordBase, MAX_PAGE};
use super::Storage;

/// Longest label name, in characters.
pub const MAX_LABEL_CHARS: usize = 80;
/// Most live labels. Create refuses more, so the label list is always bounded.
pub const MAX_LABELS: u32 = 1000;

const DUPLICATE: &str = "A label with this name already exists here.";
const UNDER_ITSELF: &str = "A label cannot move under itself or one of its own labels.";
const TOP_HOLDS_NOTES: &str =
    "This top label still holds notes that have no other label. Give them another label first.";
const NEEDS_LABEL: &str = "A note needs at least one label.";

const LABEL_NOT_FOUND: StorageError = StorageError::NotFound { kind: "label" };
const NOTE_NOT_FOUND: StorageError = StorageError::NotFound { kind: "note" };

/// A label. `parent_id` is null for a top label.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    #[serde(flatten)]
    pub base: RecordBase,
    pub name: String,
    pub parent_id: Option<String>,
}

/// What a label delete changed: how many notes got the parent label, how many child
/// labels moved up, and the parent they moved to (null for a top label).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteLabelOutcome {
    pub moved_notes: u32,
    pub moved_labels: u32,
    pub parent_id: Option<String>,
}

/// A note with the ids of its live labels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelledNote {
    pub note: Note,
    pub label_ids: Vec<String>,
}

/// Where a page of notes starts: the `updated_at` and `id` of the last note of the page before.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeCursor {
    pub updated_at: String,
    pub id: String,
}

/// Which page of notes to read: at most `limit` notes (1 to 100), after `after` when given.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePageRequest {
    pub limit: u32,
    #[serde(default)]
    pub after: Option<ChangeCursor>,
}

impl ChangePageRequest {
    #[cfg(test)]
    pub fn first(limit: u32) -> Self {
        ChangePageRequest { limit, after: None }
    }

    fn validate(&self) -> Result<(), StorageError> {
        if (1..=MAX_PAGE).contains(&self.limit) {
            Ok(())
        } else {
            Err(StorageError::Invalid(format!(
                "A page holds 1 to {MAX_PAGE} records."
            )))
        }
    }
}

/// One page of notes, newest change first. `next` is set when more notes follow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePage<T> {
    pub items: Vec<T>,
    pub next: Option<ChangeCursor>,
}

// ---- SQL. Fixed text, parameters only. ----

const GET_LABEL_SQL: &str = "SELECT id, created_at, updated_at, deleted_at, name, parent_id
     FROM label WHERE id = ?1 AND deleted_at IS NULL";

const COUNT_LABELS_SQL: &str = "SELECT count(*) FROM label WHERE deleted_at IS NULL";

// A live label under parent ?1 (NULL: top level) named ?2 (ignoring case), other than ?3 and ?4.
const CLASH_SQL: &str = "SELECT name FROM label
     WHERE deleted_at IS NULL AND parent_id IS ?1 AND name = ?2 COLLATE NOCASE
       AND (?3 IS NULL OR id <> ?3) AND (?4 IS NULL OR id <> ?4)
     LIMIT 1";

const INSERT_LABEL_SQL: &str =
    "INSERT INTO label (id, created_at, updated_at, name, parent_id) VALUES (?1, ?2, ?2, ?3, ?4)
     RETURNING id, created_at, updated_at, deleted_at, name, parent_id";

const RENAME_LABEL_SQL: &str = "UPDATE label SET name = ?3, updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL
     RETURNING id, created_at, updated_at, deleted_at, name, parent_id";

const MOVE_LABEL_SQL: &str = "UPDATE label SET parent_id = ?3, updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL
     RETURNING id, created_at, updated_at, deleted_at, name, parent_id";

const LIST_LABELS_SQL: &str = "SELECT id, created_at, updated_at, deleted_at, name, parent_id
     FROM label WHERE deleted_at IS NULL
     ORDER BY name COLLATE NOCASE, id LIMIT ?1";

// 1 when ?2 is ?1 or one of the labels above ?1. UNION stops at a repeated row.
const IS_SELF_OR_ANCESTOR_SQL: &str = "WITH RECURSIVE up(id, parent_id) AS (
         SELECT id, parent_id FROM label WHERE id = ?1
         UNION
         SELECT l.id, l.parent_id FROM label l JOIN up ON l.id = up.parent_id
     )
     SELECT count(*) FROM up WHERE id = ?2";

const LIVE_CHILDREN_SQL: &str =
    "SELECT id, name FROM label WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY id";

// Live notes linked to top label ?1 that have no other live label.
const NOTES_ONLY_HERE_SQL: &str = "SELECT count(*) FROM note_label nl
     JOIN note n ON n.id = nl.note_id AND n.deleted_at IS NULL
     WHERE nl.label_id = ?1 AND nl.deleted_at IS NULL
       AND NOT EXISTS (
           SELECT 1 FROM note_label o
           JOIN label ol ON ol.id = o.label_id AND ol.deleted_at IS NULL
           WHERE o.note_id = nl.note_id AND o.label_id <> ?1 AND o.deleted_at IS NULL
       )";

const LIVE_NOTES_OF_LABEL_SQL: &str = "SELECT nl.note_id FROM note_label nl
     JOIN note n ON n.id = nl.note_id AND n.deleted_at IS NULL
     WHERE nl.label_id = ?1 AND nl.deleted_at IS NULL ORDER BY nl.note_id";

const DELETE_LABEL_SQL: &str = "UPDATE label SET deleted_at = ?2, updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL";

const HIDE_LINKS_OF_LABEL_SQL: &str = "UPDATE note_label SET deleted_at = ?2, updated_at = ?2
     WHERE label_id = ?1 AND deleted_at IS NULL";

const MOVE_CHILDREN_SQL: &str = "UPDATE label SET parent_id = ?1, updated_at = ?2
     WHERE parent_id = ?3 AND deleted_at IS NULL";

// Adds the link, or brings a removed one back. A live link keeps its times.
const UPSERT_LINK_SQL: &str =
    "INSERT INTO note_label (id, note_id, label_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT (note_id, label_id) DO UPDATE SET
         updated_at = CASE WHEN deleted_at IS NULL THEN updated_at ELSE excluded.updated_at END,
         deleted_at = NULL";

const LIVE_LINKS_OF_NOTE_SQL: &str =
    "SELECT label_id FROM note_label WHERE note_id = ?1 AND deleted_at IS NULL";

const HIDE_LINK_SQL: &str = "UPDATE note_label SET deleted_at = ?3, updated_at = ?3
     WHERE note_id = ?1 AND label_id = ?2 AND deleted_at IS NULL";

// The live labels of note ?1, oldest link first.
const LABEL_IDS_OF_NOTE_SQL: &str = "SELECT nl.label_id FROM note_label nl
     JOIN label l ON l.id = nl.label_id AND l.deleted_at IS NULL
     WHERE nl.note_id = ?1 AND nl.deleted_at IS NULL
     ORDER BY nl.created_at, nl.label_id";

// ?1 and ?2 the cursor (or NULL), ?3 the row limit.
const LIST_ALL_NOTES_SQL: &str = "SELECT n.id, n.created_at, n.updated_at, n.deleted_at, n.body
     FROM note n
     WHERE n.deleted_at IS NULL
       AND (?1 IS NULL OR (n.updated_at, n.id) < (?1, ?2))
     ORDER BY n.updated_at DESC, n.id DESC LIMIT ?3";

// ?4 the label: its notes and the notes of every live label below it, each note once.
const LIST_NOTES_OF_LABEL_SQL: &str = "WITH RECURSIVE sub(id) AS (
         SELECT id FROM label WHERE id = ?4 AND deleted_at IS NULL
         UNION
         SELECT l.id FROM label l JOIN sub ON l.parent_id = sub.id WHERE l.deleted_at IS NULL
     )
     SELECT n.id, n.created_at, n.updated_at, n.deleted_at, n.body
     FROM note n
     WHERE n.deleted_at IS NULL
       AND EXISTS (
           SELECT 1 FROM note_label nl JOIN sub ON sub.id = nl.label_id
           WHERE nl.note_id = n.id AND nl.deleted_at IS NULL
       )
       AND (?1 IS NULL OR (n.updated_at, n.id) < (?1, ?2))
     ORDER BY n.updated_at DESC, n.id DESC LIMIT ?3";

fn label_from_row(r: &Row<'_>) -> rusqlite::Result<Label> {
    Ok(Label {
        base: RecordBase {
            id: r.get(0)?,
            created_at: r.get(1)?,
            updated_at: r.get(2)?,
            deleted_at: r.get(3)?,
        },
        name: r.get(4)?,
        parent_id: r.get(5)?,
    })
}

/// The trimmed name, or why it is refused.
fn clean_name(name: &str) -> Result<String, StorageError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(StorageError::Invalid(
            "The label name cannot be empty.".to_string(),
        ));
    }
    if name.contains(['\n', '\r']) {
        return Err(StorageError::Invalid(
            "The label name must be one line.".to_string(),
        ));
    }
    if name.chars().count() > MAX_LABEL_CHARS {
        return Err(StorageError::Invalid(format!(
            "The label name is too long (at most {MAX_LABEL_CHARS} characters)."
        )));
    }
    Ok(name.to_string())
}

/// A unique-index refusal on the label table reads as a name clash; anything else stays a
/// database error.
fn label_write_failed(e: rusqlite::Error) -> StorageError {
    match &e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == ErrorCode::ConstraintViolation => {
            StorageError::Invalid(DUPLICATE.to_string())
        }
        _ => e.into(),
    }
}

fn live_label(tx: &Transaction<'_>, id: &str) -> Result<Label, StorageError> {
    tx.query_row(GET_LABEL_SQL, [id], label_from_row)
        .optional()?
        .ok_or(LABEL_NOT_FOUND)
}

/// The name of a live label under `parent` that clashes with `name`, leaving out `skip`.
fn clash(
    tx: &Transaction<'_>,
    parent: Option<&str>,
    name: &str,
    skip: [Option<&str>; 2],
) -> Result<Option<String>, StorageError> {
    Ok(tx
        .query_row(CLASH_SQL, params![parent, name, skip[0], skip[1]], |r| {
            r.get(0)
        })
        .optional()?)
}

fn refuse_clash(
    tx: &Transaction<'_>,
    parent: Option<&str>,
    name: &str,
    skip: Option<&str>,
) -> Result<(), StorageError> {
    match clash(tx, parent, name, [skip, None])? {
        Some(_) => Err(StorageError::Invalid(DUPLICATE.to_string())),
        None => Ok(()),
    }
}

fn upsert_link(
    tx: &Transaction<'_>,
    now: &str,
    note_id: &str,
    label_id: &str,
) -> Result<(), StorageError> {
    let id = RecordBase::new_at(now).id;
    tx.execute(UPSERT_LINK_SQL, params![id, note_id, label_id, now])?;
    Ok(())
}

impl Storage {
    fn immediate(&mut self) -> Result<Transaction<'_>, StorageError> {
        // Immediate: the checks and the writes see the same state, and a second writer
        // waits for the busy timeout instead of failing at once.
        Ok(self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?)
    }

    /// Creates a label under `parent` (None: a top label). The name is trimmed, 1 to 80
    /// characters on one line, and unique among the live labels of that parent.
    pub fn create_label(
        &mut self,
        parent: Option<&str>,
        name: &str,
    ) -> Result<Label, StorageError> {
        self.create_label_at(&now_iso(), parent, name)
    }

    pub(crate) fn create_label_at(
        &mut self,
        now: &str,
        parent: Option<&str>,
        name: &str,
    ) -> Result<Label, StorageError> {
        let name = clean_name(name)?;
        let tx = self.immediate()?;
        let count: u32 = tx.query_row(COUNT_LABELS_SQL, [], |r| r.get(0))?;
        if count >= MAX_LABELS {
            return Err(StorageError::Invalid(format!(
                "Mnemo holds at most {MAX_LABELS} labels. Delete a label first."
            )));
        }
        if let Some(p) = parent {
            live_label(&tx, p)?;
        }
        refuse_clash(&tx, parent, &name, None)?;
        let base = RecordBase::new_at(now);
        let label = tx
            .query_row(
                INSERT_LABEL_SQL,
                params![base.id, now, name, parent],
                label_from_row,
            )
            .map_err(label_write_failed)?;
        tx.commit()?;
        Ok(label)
    }

    /// Renames a live label. The new name follows the same rules as on create.
    pub fn rename_label(&mut self, id: &str, name: &str) -> Result<Label, StorageError> {
        self.rename_label_at(&now_iso(), id, name)
    }

    pub(crate) fn rename_label_at(
        &mut self,
        now: &str,
        id: &str,
        name: &str,
    ) -> Result<Label, StorageError> {
        let name = clean_name(name)?;
        let tx = self.immediate()?;
        let label = live_label(&tx, id)?;
        refuse_clash(&tx, label.parent_id.as_deref(), &name, Some(id))?;
        let label = tx
            .query_row(RENAME_LABEL_SQL, params![id, now, name], label_from_row)
            .map_err(label_write_failed)?;
        tx.commit()?;
        Ok(label)
    }

    /// Moves a live label under `new_parent` (None: to the top). Moving under itself or
    /// one of its own labels is refused, and so is a name clash under the new parent.
    pub fn move_label(
        &mut self,
        id: &str,
        new_parent: Option<&str>,
    ) -> Result<Label, StorageError> {
        self.move_label_at(&now_iso(), id, new_parent)
    }

    pub(crate) fn move_label_at(
        &mut self,
        now: &str,
        id: &str,
        new_parent: Option<&str>,
    ) -> Result<Label, StorageError> {
        let tx = self.immediate()?;
        let label = live_label(&tx, id)?;
        if let Some(p) = new_parent {
            if p == id {
                return Err(StorageError::Invalid(UNDER_ITSELF.to_string()));
            }
            live_label(&tx, p)?;
            let below: i64 = tx.query_row(IS_SELF_OR_ANCESTOR_SQL, [p, id], |r| r.get(0))?;
            if below > 0 {
                return Err(StorageError::Invalid(UNDER_ITSELF.to_string()));
            }
        }
        refuse_clash(&tx, new_parent, &label.name, Some(id))?;
        let label = tx
            .query_row(MOVE_LABEL_SQL, params![id, now, new_parent], label_from_row)
            .map_err(label_write_failed)?;
        tx.commit()?;
        Ok(label)
    }

    /// Deletes a live label (soft). Its notes get the parent label and its child labels move
    /// to the parent. A top label is refused while it holds a live note with no other label.
    /// No note is changed or deleted.
    pub fn delete_label(&mut self, id: &str) -> Result<DeleteLabelOutcome, StorageError> {
        self.delete_label_at(&now_iso(), id)
    }

    pub(crate) fn delete_label_at(
        &mut self,
        now: &str,
        id: &str,
    ) -> Result<DeleteLabelOutcome, StorageError> {
        let tx = self.immediate()?;
        let label = live_label(&tx, id)?;
        let parent = label.parent_id.clone();
        // Every check runs before the first write.
        if parent.is_none() {
            let only_here: i64 = tx.query_row(NOTES_ONLY_HERE_SQL, [id], |r| r.get(0))?;
            if only_here > 0 {
                return Err(StorageError::Invalid(TOP_HOLDS_NOTES.to_string()));
            }
        }
        let children: Vec<(String, String)> = {
            let mut st = tx.prepare(LIVE_CHILDREN_SQL)?;
            let rows = st.query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<Result<_, _>>()?
        };
        for (child_id, child_name) in &children {
            // The label being deleted is left out: it is gone before its children move.
            if clash(
                &tx,
                parent.as_deref(),
                child_name,
                [Some(child_id.as_str()), Some(id)],
            )?
            .is_some()
            {
                return Err(StorageError::Invalid(format!(
                    "The label \"{child_name}\" cannot move up: a label with that name already exists there. Rename it first."
                )));
            }
        }
        let notes: Vec<String> = {
            let mut st = tx.prepare(LIVE_NOTES_OF_LABEL_SQL)?;
            let rows = st.query_map([id], |r| r.get(0))?;
            rows.collect::<Result<_, _>>()?
        };
        tx.execute(DELETE_LABEL_SQL, params![id, now])?;
        let mut moved_notes = 0u32;
        if let Some(p) = &parent {
            for note_id in &notes {
                upsert_link(&tx, now, note_id, p)?;
                moved_notes += 1;
            }
        }
        tx.execute(HIDE_LINKS_OF_LABEL_SQL, params![id, now])?;
        let moved_labels = tx
            .execute(MOVE_CHILDREN_SQL, params![parent, now, id])
            .map_err(label_write_failed)? as u32;
        tx.commit()?;
        Ok(DeleteLabelOutcome {
            moved_notes,
            moved_labels,
            parent_id: parent,
        })
    }

    /// Every live label, flat with its parent id, ordered by name. Create keeps the count
    /// at most 1000, so the list is bounded.
    pub fn list_labels(&self) -> Result<Vec<Label>, StorageError> {
        let mut st = self.conn.prepare_cached(LIST_LABELS_SQL)?;
        let rows = st.query_map([MAX_LABELS], label_from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Adds a note (`id` None) or replaces the text of a live note, and sets its labels to
    /// exactly `label_ids`. At least one live label is required. One transaction: a refusal
    /// leaves no note and no link behind.
    pub fn save_labelled_note(
        &mut self,
        id: Option<&str>,
        body: &str,
        label_ids: &[String],
    ) -> Result<LabelledNote, StorageError> {
        self.save_labelled_note_at(&now_iso(), id, body, label_ids)
    }

    pub(crate) fn save_labelled_note_at(
        &mut self,
        now: &str,
        id: Option<&str>,
        body: &str,
        label_ids: &[String],
    ) -> Result<LabelledNote, StorageError> {
        let mut seen = HashSet::new();
        let wanted: Vec<String> = label_ids
            .iter()
            .filter(|l| seen.insert(l.as_str()))
            .cloned()
            .collect();
        if wanted.is_empty() {
            return Err(StorageError::Invalid(NEEDS_LABEL.to_string()));
        }
        let input = NoteInput {
            body: body.to_string(),
        };
        <Note as Item>::validate(&input)?;
        let tx = self.immediate()?;
        for l in &wanted {
            live_label(&tx, l)?;
        }
        let note = match id {
            Some(id) => tx
                .query_row(
                    <Note as Item>::UPDATE_SQL,
                    params![id, now, input.body],
                    <Note as Item>::from_row,
                )
                .optional()?
                .ok_or(NOTE_NOT_FOUND)?,
            None => {
                let base = RecordBase::new_at(now);
                tx.query_row(
                    <Note as Item>::INSERT_SQL,
                    params![base.id, now, input.body],
                    <Note as Item>::from_row,
                )?
            }
        };
        let note_id = note.base.id.clone();
        let current: Vec<String> = {
            let mut st = tx.prepare(LIVE_LINKS_OF_NOTE_SQL)?;
            let rows = st.query_map([&note_id], |r| r.get(0))?;
            rows.collect::<Result<_, _>>()?
        };
        for old in current.iter().filter(|c| !wanted.contains(c)) {
            tx.execute(HIDE_LINK_SQL, params![note_id, old, now])?;
        }
        for l in &wanted {
            upsert_link(&tx, now, &note_id, l)?;
        }
        tx.commit()?;
        Ok(LabelledNote {
            note,
            label_ids: wanted,
        })
    }

    /// One page of live notes, newest change first, each with its live label ids.
    /// `Some(label)`: the notes of that label and of every live label below it, each once.
    /// `None`: every live note.
    pub fn list_labelled_notes(
        &self,
        label: Option<&str>,
        page: &ChangePageRequest,
    ) -> Result<ChangePage<LabelledNote>, StorageError> {
        page.validate()?;
        let (at, after_id) = match &page.after {
            Some(c) => (Some(c.updated_at.as_str()), Some(c.id.as_str())),
            None => (None, None),
        };
        let limit = page.limit + 1;
        let notes: Vec<Note> = match label {
            Some(l) => {
                self.conn
                    .query_row(GET_LABEL_SQL, [l], label_from_row)
                    .optional()?
                    .ok_or(LABEL_NOT_FOUND)?;
                let mut st = self.conn.prepare_cached(LIST_NOTES_OF_LABEL_SQL)?;
                let rows =
                    st.query_map(params![at, after_id, limit, l], <Note as Item>::from_row)?;
                rows.collect::<Result<_, _>>()?
            }
            None => {
                let mut st = self.conn.prepare_cached(LIST_ALL_NOTES_SQL)?;
                let rows = st.query_map(params![at, after_id, limit], <Note as Item>::from_row)?;
                rows.collect::<Result<_, _>>()?
            }
        };
        let mut items = Vec::with_capacity(notes.len());
        let mut st = self.conn.prepare_cached(LABEL_IDS_OF_NOTE_SQL)?;
        for note in notes {
            let label_ids = st
                .query_map([&note.base.id], |r| r.get(0))?
                .collect::<Result<Vec<String>, _>>()?;
            items.push(LabelledNote { note, label_ids });
        }
        let next = if items.len() > page.limit as usize {
            items.truncate(page.limit as usize);
            items.last().map(|n| ChangeCursor {
                updated_at: n.note.base.updated_at.clone(),
                id: n.note.base.id.clone(),
            })
        } else {
            None
        };
        Ok(ChangePage { items, next })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::testing::open_temp;
    use crate::storage::PageRequest;

    const T1: &str = "2026-01-01T00:00:00Z";
    const T2: &str = "2026-01-02T00:00:00Z";
    const T3: &str = "2026-01-03T00:00:00Z";
    const T4: &str = "2026-01-04T00:00:00Z";

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    fn invalid(r: Result<impl std::fmt::Debug, StorageError>) -> String {
        match r {
            Err(StorageError::Invalid(m)) => m,
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    fn live_notes(s: &Storage) -> i64 {
        s.conn
            .query_row(
                "SELECT count(*) FROM note WHERE deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap()
    }

    fn all_rows(s: &Storage, table: &str) -> i64 {
        let sql = match table {
            "note" => "SELECT count(*) FROM note",
            "note_label" => "SELECT count(*) FROM note_label",
            "label" => "SELECT count(*) FROM label",
            _ => unreachable!(),
        };
        s.conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    /// A snapshot of every label and link row, to prove a refusal wrote nothing.
    fn snapshot(s: &Storage) -> Vec<String> {
        let mut out = Vec::new();
        for sql in [
            "SELECT id || '|' || name || '|' || ifnull(parent_id, '-') || '|' || ifnull(deleted_at, '-') || '|' || updated_at FROM label ORDER BY id",
            "SELECT note_id || '|' || label_id || '|' || ifnull(deleted_at, '-') || '|' || updated_at FROM note_label ORDER BY note_id, label_id",
            "SELECT id || '|' || body || '|' || ifnull(deleted_at, '-') || '|' || updated_at FROM note ORDER BY id",
        ] {
            let mut st = s.conn.prepare(sql).unwrap();
            let rows = st.query_map([], |r| r.get::<_, String>(0)).unwrap();
            out.extend(rows.map(|r| r.unwrap()));
        }
        out
    }

    fn label(s: &mut Storage, parent: Option<&str>, name: &str) -> String {
        s.create_label_at(T1, parent, name).unwrap().base.id
    }

    fn note(s: &mut Storage, body: &str, labels: &[&str]) -> String {
        s.save_labelled_note_at(T1, None, body, &ids(labels))
            .unwrap()
            .note
            .base
            .id
    }

    fn labels_of(s: &Storage, note_id: &str) -> Vec<String> {
        let mut st = s.conn.prepare(LABEL_IDS_OF_NOTE_SQL).unwrap();
        let rows = st.query_map([note_id], |r| r.get(0)).unwrap();
        let mut v: Vec<String> = rows.map(|r| r.unwrap()).collect();
        v.sort();
        v
    }

    fn listed(s: &Storage, label: Option<&str>) -> Vec<String> {
        s.list_labelled_notes(label, &ChangePageRequest::first(100))
            .unwrap()
            .items
            .into_iter()
            .map(|n| n.note.base.id)
            .collect()
    }

    fn parent_of(s: &Storage, id: &str) -> Option<String> {
        s.conn
            .query_row("SELECT parent_id FROM label WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .unwrap()
    }

    // ---- create ----

    #[test]
    fn create_label_makes_top_and_child_labels_with_a_trimmed_name() {
        let (mut s, _d) = open_temp();
        let top = s.create_label_at(T1, None, "  Work ").unwrap();
        assert!(uuid::Uuid::parse_str(&top.base.id).is_ok());
        assert_eq!(top.name, "Work");
        assert_eq!(top.parent_id, None);
        assert_eq!(top.base.created_at, T1);
        assert_eq!(top.base.updated_at, T1);
        let child = s.create_label_at(T2, Some(&top.base.id), "Plans").unwrap();
        assert_eq!(child.parent_id.as_deref(), Some(top.base.id.as_str()));
        assert_eq!(s.list_labels().unwrap(), vec![child, top]);
    }

    #[test]
    fn create_label_refuses_an_empty_long_or_multi_line_name() {
        let (mut s, _d) = open_temp();
        for bad in ["", "   ", "two\nlines", "a\rb"] {
            invalid(s.create_label_at(T1, None, bad));
        }
        let long = "x".repeat(MAX_LABEL_CHARS + 1);
        assert!(invalid(s.create_label_at(T1, None, &long)).contains("too long"));
        s.create_label_at(T1, None, &"x".repeat(MAX_LABEL_CHARS))
            .unwrap();
        assert_eq!(all_rows(&s, "label"), 1);
    }

    #[test]
    fn create_label_refuses_a_duplicate_sibling_ignoring_case() {
        let (mut s, _d) = open_temp();
        let work = label(&mut s, None, "Work");
        assert_eq!(invalid(s.create_label_at(T1, None, "work")), DUPLICATE);
        label(&mut s, Some(&work), "Plans");
        assert_eq!(
            invalid(s.create_label_at(T1, Some(&work), "PLANS")),
            DUPLICATE
        );
        assert_eq!(all_rows(&s, "label"), 2);
    }

    #[test]
    fn create_label_allows_the_same_name_under_another_parent() {
        let (mut s, _d) = open_temp();
        let work = label(&mut s, None, "Work");
        let home = label(&mut s, None, "Home");
        label(&mut s, Some(&work), "Plans");
        label(&mut s, Some(&home), "Plans");
        // A child may share its parent's name.
        label(&mut s, Some(&work), "Work");
        assert_eq!(s.list_labels().unwrap().len(), 5);
    }

    #[test]
    fn create_label_refuses_a_missing_or_deleted_parent() {
        let (mut s, _d) = open_temp();
        assert_eq!(
            s.create_label_at(T1, Some("missing"), "A").unwrap_err(),
            LABEL_NOT_FOUND
        );
        let gone = label(&mut s, None, "Gone");
        s.delete_label_at(T2, &gone).unwrap();
        assert_eq!(
            s.create_label_at(T3, Some(&gone), "A").unwrap_err(),
            LABEL_NOT_FOUND
        );
    }

    #[test]
    fn create_label_refuses_more_than_the_label_limit() {
        let (mut s, _d) = open_temp();
        for i in 0..MAX_LABELS {
            s.conn
                .execute(
                    "INSERT INTO label (id, created_at, updated_at, name) VALUES (?1, ?2, ?2, ?1)",
                    params![format!("l{i}"), T1],
                )
                .unwrap();
        }
        assert!(invalid(s.create_label_at(T1, None, "One more")).contains("at most"));
        assert_eq!(s.list_labels().unwrap().len(), MAX_LABELS as usize);
    }

    #[test]
    fn create_label_maps_a_unique_index_refusal_to_the_plain_message() {
        let e = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE),
            Some("UNIQUE constraint failed: label.name".into()),
        );
        assert_eq!(
            label_write_failed(e),
            StorageError::Invalid(DUPLICATE.into())
        );
        let other = label_write_failed(rusqlite::Error::QueryReturnedNoRows);
        assert!(matches!(other, StorageError::Database(_)));
    }

    // ---- rename ----

    #[test]
    fn rename_label_changes_the_name_and_updated_at() {
        let (mut s, _d) = open_temp();
        let work = label(&mut s, None, "Work");
        let renamed = s.rename_label_at(T2, &work, " Job ").unwrap();
        assert_eq!(renamed.name, "Job");
        assert_eq!(renamed.base.created_at, T1);
        assert_eq!(renamed.base.updated_at, T2);
    }

    #[test]
    fn rename_label_refuses_a_sibling_clash_but_allows_a_case_change_of_itself() {
        let (mut s, _d) = open_temp();
        let work = label(&mut s, None, "work");
        label(&mut s, None, "Home");
        assert_eq!(invalid(s.rename_label_at(T2, &work, "HOME")), DUPLICATE);
        assert_eq!(s.rename_label_at(T2, &work, "Work").unwrap().name, "Work");
    }

    #[test]
    fn rename_label_refuses_a_missing_label_and_a_bad_name() {
        let (mut s, _d) = open_temp();
        assert_eq!(
            s.rename_label_at(T1, "missing", "A").unwrap_err(),
            LABEL_NOT_FOUND
        );
        let work = label(&mut s, None, "Work");
        invalid(s.rename_label_at(T2, &work, " "));
    }

    // ---- move ----

    #[test]
    fn move_label_under_itself_is_refused() {
        let (mut s, _d) = open_temp();
        let work = label(&mut s, None, "Work");
        assert_eq!(
            invalid(s.move_label_at(T2, &work, Some(&work))),
            UNDER_ITSELF
        );
    }

    #[test]
    fn move_label_under_its_grandchild_is_refused_and_nothing_changes() {
        let (mut s, _d) = open_temp();
        let a = label(&mut s, None, "A");
        let b = label(&mut s, Some(&a), "B");
        let c = label(&mut s, Some(&b), "C");
        let before = snapshot(&s);
        assert_eq!(invalid(s.move_label_at(T2, &a, Some(&b))), UNDER_ITSELF);
        assert_eq!(invalid(s.move_label_at(T2, &a, Some(&c))), UNDER_ITSELF);
        assert_eq!(snapshot(&s), before);
    }

    #[test]
    fn move_label_under_an_unrelated_label_and_back_to_the_top() {
        let (mut s, _d) = open_temp();
        let a = label(&mut s, None, "A");
        let b = label(&mut s, Some(&a), "B");
        let other = label(&mut s, None, "Other");
        let moved = s.move_label_at(T2, &b, Some(&other)).unwrap();
        assert_eq!(moved.parent_id.as_deref(), Some(other.as_str()));
        assert_eq!(moved.base.updated_at, T2);
        // A label may move under a label that sits below one of its siblings.
        let top = s.move_label_at(T3, &b, None).unwrap();
        assert_eq!(top.parent_id, None);
        s.move_label_at(T3, &a, Some(&other)).unwrap();
        assert_eq!(parent_of(&s, &a).as_deref(), Some(other.as_str()));
    }

    #[test]
    fn move_label_refuses_a_name_clash_but_allows_its_own_parent() {
        let (mut s, _d) = open_temp();
        let a = label(&mut s, None, "A");
        let b = label(&mut s, None, "B");
        let plans_a = label(&mut s, Some(&a), "Plans");
        label(&mut s, Some(&b), "plans");
        assert_eq!(invalid(s.move_label_at(T2, &plans_a, Some(&b))), DUPLICATE);
        assert_eq!(
            s.move_label_at(T2, &plans_a, Some(&a))
                .unwrap()
                .parent_id
                .as_deref(),
            Some(a.as_str())
        );
    }

    #[test]
    fn move_label_refuses_a_missing_or_deleted_target() {
        let (mut s, _d) = open_temp();
        let a = label(&mut s, None, "A");
        assert_eq!(
            s.move_label_at(T2, &a, Some("missing")).unwrap_err(),
            LABEL_NOT_FOUND
        );
        assert_eq!(
            s.move_label_at(T2, "missing", None).unwrap_err(),
            LABEL_NOT_FOUND
        );
    }

    // ---- delete ----

    #[test]
    fn delete_label_moves_its_notes_to_the_parent() {
        let (mut s, _d) = open_temp();
        let work = label(&mut s, None, "Work");
        let plans = label(&mut s, Some(&work), "Plans");
        let n1 = note(&mut s, "one", &[&plans]);
        let n2 = note(&mut s, "two", &[&plans, &work]);
        let out = s.delete_label_at(T2, &plans).unwrap();
        assert_eq!(
            out,
            DeleteLabelOutcome {
                moved_notes: 2,
                moved_labels: 0,
                parent_id: Some(work.clone())
            }
        );
        assert_eq!(labels_of(&s, &n1), vec![work.clone()]);
        assert_eq!(labels_of(&s, &n2), vec![work.clone()]);
        let mut under_work = listed(&s, Some(&work));
        under_work.sort();
        let mut both = vec![n1, n2];
        both.sort();
        assert_eq!(under_work, both);
        assert_eq!(
            s.list_labelled_notes(Some(&plans), &ChangePageRequest::first(10))
                .unwrap_err(),
            LABEL_NOT_FOUND
        );
    }

    #[test]
    fn delete_keeps_the_live_note_count_and_loses_no_note() {
        let (mut s, _d) = open_temp();
        let work = label(&mut s, None, "Work");
        let plans = label(&mut s, Some(&work), "Plans");
        let q1 = label(&mut s, Some(&plans), "Q1");
        let home = label(&mut s, None, "Home");
        let mut all = Vec::new();
        for (i, labels) in [
            vec![plans.as_str()],
            vec![q1.as_str()],
            vec![q1.as_str(), home.as_str()],
            vec![work.as_str()],
            vec![home.as_str()],
        ]
        .iter()
        .enumerate()
        {
            all.push(note(&mut s, &format!("note {i}"), labels));
        }
        let before = live_notes(&s);
        assert_eq!(before, 5);
        s.delete_label_at(T2, &plans).unwrap();
        assert_eq!(live_notes(&s), before);
        s.delete_label_at(T3, &q1).unwrap();
        assert_eq!(live_notes(&s), before);
        // Every note still has a live label and is still listed.
        for n in &all {
            assert!(!labels_of(&s, n).is_empty(), "note {n} lost its labels");
        }
        assert_eq!(listed(&s, None).len(), 5);
    }

    #[test]
    fn delete_label_moves_child_labels_up() {
        let (mut s, _d) = open_temp();
        let work = label(&mut s, None, "Work");
        let plans = label(&mut s, Some(&work), "Plans");
        let q1 = label(&mut s, Some(&plans), "Q1");
        let q2 = label(&mut s, Some(&plans), "Q2");
        let n = note(&mut s, "deep", &[&q1]);
        let out = s.delete_label_at(T2, &plans).unwrap();
        assert_eq!(out.moved_labels, 2);
        assert_eq!(out.moved_notes, 0);
        assert_eq!(parent_of(&s, &q1).as_deref(), Some(work.as_str()));
        assert_eq!(parent_of(&s, &q2).as_deref(), Some(work.as_str()));
        assert_eq!(listed(&s, Some(&work)), vec![n.clone()]);
        assert_eq!(labels_of(&s, &n), vec![q1]);
    }

    #[test]
    fn delete_label_moves_up_a_child_named_like_the_deleted_label() {
        let (mut s, _d) = open_temp();
        let top = label(&mut s, None, "Work");
        let child = label(&mut s, Some(&top), "Work");
        let n = note(&mut s, "x", &[&top, &child]);
        let out = s.delete_label_at(T2, &top).unwrap();
        assert_eq!(out.moved_labels, 1);
        assert_eq!(parent_of(&s, &child), None);
        assert_eq!(labels_of(&s, &n), vec![child]);
    }

    #[test]
    fn delete_label_refuses_a_child_name_clash_and_writes_nothing() {
        let (mut s, _d) = open_temp();
        let work = label(&mut s, None, "Work");
        let plans = label(&mut s, Some(&work), "Plans");
        label(&mut s, Some(&plans), "Ideas");
        label(&mut s, Some(&work), "ideas");
        note(&mut s, "n", &[&plans]);
        let before = snapshot(&s);
        let msg = invalid(s.delete_label_at(T2, &plans));
        assert!(msg.contains("\"Ideas\""), "{msg}");
        assert_eq!(snapshot(&s), before);
    }

    #[test]
    fn delete_of_a_top_label_holding_a_note_with_no_other_label_is_refused() {
        let (mut s, _d) = open_temp();
        let work = label(&mut s, None, "Work");
        let n = note(&mut s, "only here", &[&work]);
        let before = snapshot(&s);
        assert_eq!(invalid(s.delete_label_at(T2, &work)), TOP_HOLDS_NOTES);
        assert_eq!(snapshot(&s), before);
        assert_eq!(labels_of(&s, &n), vec![work]);
    }

    #[test]
    fn delete_of_a_top_label_whose_notes_have_other_labels_keeps_the_count() {
        let (mut s, _d) = open_temp();
        let work = label(&mut s, None, "Work");
        let home = label(&mut s, None, "Home");
        let plans = label(&mut s, Some(&work), "Plans");
        let n1 = note(&mut s, "a", &[&work, &home]);
        let n2 = note(&mut s, "b", &[&plans]);
        let before = live_notes(&s);
        let out = s.delete_label_at(T2, &work).unwrap();
        assert_eq!(out.parent_id, None);
        assert_eq!(out.moved_notes, 0);
        assert_eq!(out.moved_labels, 1);
        assert_eq!(live_notes(&s), before);
        assert_eq!(labels_of(&s, &n1), vec![home]);
        assert_eq!(labels_of(&s, &n2), vec![plans.clone()]);
        assert_eq!(parent_of(&s, &plans), None);
    }

    #[test]
    fn delete_of_a_top_label_ignores_deleted_notes() {
        let (mut s, _d) = open_temp();
        let work = label(&mut s, None, "Work");
        let n = note(&mut s, "gone", &[&work]);
        // The #14 delete hides the note but not its label links.
        s.delete_at::<Note>(T2, &n).unwrap();
        s.delete_label_at(T3, &work).unwrap();
        assert!(s.list_labels().unwrap().is_empty());
    }

    #[test]
    fn delete_label_refuses_a_missing_or_deleted_label() {
        let (mut s, _d) = open_temp();
        assert_eq!(
            s.delete_label_at(T1, "missing").unwrap_err(),
            LABEL_NOT_FOUND
        );
        let a = label(&mut s, None, "A");
        s.delete_label_at(T2, &a).unwrap();
        assert_eq!(s.delete_label_at(T3, &a).unwrap_err(), LABEL_NOT_FOUND);
        assert_eq!(all_rows(&s, "label"), 1);
    }

    // ---- list labels ----

    #[test]
    fn list_labels_leaves_out_deleted_labels_and_orders_by_name() {
        let (mut s, _d) = open_temp();
        let b = label(&mut s, None, "beta");
        let a = label(&mut s, None, "Alpha");
        let gone = label(&mut s, None, "Gone");
        s.delete_label_at(T2, &gone).unwrap();
        let names: Vec<(String, String)> = s
            .list_labels()
            .unwrap()
            .into_iter()
            .map(|l| (l.base.id, l.name))
            .collect();
        assert_eq!(names, vec![(a, "Alpha".into()), (b, "beta".into())]);
    }

    // ---- save ----

    #[test]
    fn save_with_no_label_is_refused_and_writes_nothing() {
        let (mut s, _d) = open_temp();
        assert_eq!(
            invalid(s.save_labelled_note_at(T1, None, "text", &[])),
            NEEDS_LABEL
        );
        assert_eq!(all_rows(&s, "note"), 0);
        assert_eq!(all_rows(&s, "note_label"), 0);
        // An update that would drop every label is refused too, and changes nothing.
        let work = label(&mut s, None, "Work");
        let n = note(&mut s, "kept", &[&work]);
        let before = snapshot(&s);
        assert_eq!(
            invalid(s.save_labelled_note_at(T2, Some(&n), "changed", &[])),
            NEEDS_LABEL
        );
        assert_eq!(snapshot(&s), before);
    }

    #[test]
    fn save_with_an_unknown_or_deleted_label_is_refused_and_writes_nothing() {
        let (mut s, _d) = open_temp();
        let work = label(&mut s, None, "Work");
        let gone = label(&mut s, None, "Gone");
        s.delete_label_at(T2, &gone).unwrap();
        let before = snapshot(&s);
        for bad in [ids(&[&work, "missing"]), ids(&[&gone])] {
            assert_eq!(
                s.save_labelled_note_at(T3, None, "x", &bad).unwrap_err(),
                LABEL_NOT_FOUND
            );
        }
        assert_eq!(snapshot(&s), before);
    }

    #[test]
    fn save_refuses_a_bad_body_and_a_missing_note() {
        let (mut s, _d) = open_temp();
        let work = label(&mut s, None, "Work");
        invalid(s.save_labelled_note_at(T1, None, "  ", &ids(&[&work])));
        assert_eq!(
            s.save_labelled_note_at(T1, Some("missing"), "x", &ids(&[&work]))
                .unwrap_err(),
            NOTE_NOT_FOUND
        );
        assert_eq!(all_rows(&s, "note"), 0);
        assert_eq!(all_rows(&s, "note_label"), 0);
    }

    #[test]
    fn save_adds_a_note_with_its_labels_once_each() {
        let (mut s, _d) = open_temp();
        let work = label(&mut s, None, "Work");
        let home = label(&mut s, None, "Home");
        let saved = s
            .save_labelled_note_at(T1, None, "# Hi", &ids(&[&work, &home, &work]))
            .unwrap();
        assert_eq!(saved.note.body, "# Hi");
        assert_eq!(saved.note.base.created_at, T1);
        assert_eq!(saved.label_ids, ids(&[&work, &home]));
        let mut want = ids(&[&work, &home]);
        want.sort();
        assert_eq!(labels_of(&s, &saved.note.base.id), want);
        assert_eq!(s.get::<Note>(&saved.note.base.id).unwrap(), saved.note);
    }

    #[test]
    fn save_update_replaces_the_text_and_the_label_set() {
        let (mut s, _d) = open_temp();
        let a = label(&mut s, None, "A");
        let b = label(&mut s, None, "B");
        let c = label(&mut s, None, "C");
        let n = note(&mut s, "first", &[&a, &b]);
        let saved = s
            .save_labelled_note_at(T2, Some(&n), "second", &ids(&[&b, &c]))
            .unwrap();
        assert_eq!(saved.note.base.id, n);
        assert_eq!(saved.note.body, "second");
        assert_eq!(saved.note.base.created_at, T1);
        assert_eq!(saved.note.base.updated_at, T2);
        let mut want = ids(&[&b, &c]);
        want.sort();
        assert_eq!(labels_of(&s, &n), want);
        // Adding a removed label again brings the same link row back.
        s.save_labelled_note_at(T3, Some(&n), "third", &ids(&[&a]))
            .unwrap();
        assert_eq!(labels_of(&s, &n), vec![a]);
        assert_eq!(all_rows(&s, "note_label"), 3);
    }

    #[test]
    fn save_update_of_a_deleted_note_is_refused() {
        let (mut s, _d) = open_temp();
        let a = label(&mut s, None, "A");
        let n = note(&mut s, "x", &[&a]);
        s.delete_at::<Note>(T2, &n).unwrap();
        assert_eq!(
            s.save_labelled_note_at(T3, Some(&n), "y", &ids(&[&a]))
                .unwrap_err(),
            NOTE_NOT_FOUND
        );
    }

    // ---- list notes ----

    #[test]
    fn list_of_a_parent_label_includes_child_and_grandchild_notes_once() {
        let (mut s, _d) = open_temp();
        let work = label(&mut s, None, "Work");
        let plans = label(&mut s, Some(&work), "Plans");
        let q1 = label(&mut s, Some(&plans), "Q1");
        let home = label(&mut s, None, "Home");
        let top = s
            .save_labelled_note_at(T1, None, "top", &ids(&[&work]))
            .unwrap();
        let child = s
            .save_labelled_note_at(T2, None, "child", &ids(&[&plans]))
            .unwrap();
        // Linked to two labels of the same subtree: listed once.
        let grand = s
            .save_labelled_note_at(T3, None, "grand", &ids(&[&q1, &plans]))
            .unwrap();
        let other = note(&mut s, "home", &[&home]);
        let ids_of = |label: &str| listed(&s, Some(label));
        assert_eq!(
            ids_of(&work),
            vec![
                grand.note.base.id.clone(),
                child.note.base.id.clone(),
                top.note.base.id.clone()
            ]
        );
        assert_eq!(
            ids_of(&plans),
            vec![grand.note.base.id.clone(), child.note.base.id.clone()]
        );
        assert_eq!(ids_of(&q1), vec![grand.note.base.id.clone()]);
        assert_eq!(ids_of(&home), vec![other]);
        let page = s
            .list_labelled_notes(Some(&q1), &ChangePageRequest::first(10))
            .unwrap();
        let mut got = page.items[0].label_ids.clone();
        got.sort();
        let mut want = ids(&[&q1, &plans]);
        want.sort();
        assert_eq!(got, want);
    }

    #[test]
    fn list_labelled_notes_leaves_out_deleted_notes_and_removed_links() {
        let (mut s, _d) = open_temp();
        let a = label(&mut s, None, "A");
        let b = label(&mut s, None, "B");
        let gone = note(&mut s, "gone", &[&a]);
        let moved = note(&mut s, "moved", &[&a]);
        s.delete_at::<Note>(T2, &gone).unwrap();
        s.save_labelled_note_at(T2, Some(&moved), "moved", &ids(&[&b]))
            .unwrap();
        assert!(listed(&s, Some(&a)).is_empty());
        assert_eq!(listed(&s, Some(&b)), vec![moved.clone()]);
        assert_eq!(listed(&s, None), vec![moved]);
    }

    #[test]
    fn list_labelled_notes_without_a_label_lists_all_newest_change_first() {
        let (mut s, _d) = open_temp();
        let a = label(&mut s, None, "A");
        let old = s
            .save_labelled_note_at(T1, None, "old", &ids(&[&a]))
            .unwrap();
        let new = s
            .save_labelled_note_at(T2, None, "new", &ids(&[&a]))
            .unwrap();
        assert_eq!(
            listed(&s, None),
            vec![new.note.base.id.clone(), old.note.base.id.clone()]
        );
        // Editing the old note moves it to the top.
        s.save_labelled_note_at(T4, Some(&old.note.base.id), "edited", &ids(&[&a]))
            .unwrap();
        assert_eq!(
            listed(&s, None),
            vec![old.note.base.id.clone(), new.note.base.id.clone()]
        );
        // A note added by #14 without a label is listed too, with no label ids.
        let bare = s
            .add_at::<Note>(
                T3,
                &NoteInput {
                    body: "bare".into(),
                },
            )
            .unwrap();
        let page = s
            .list_labelled_notes(None, &ChangePageRequest::first(10))
            .unwrap();
        assert_eq!(page.items[1].note.base.id, bare.base.id);
        assert!(page.items[1].label_ids.is_empty());
    }

    #[test]
    fn list_labelled_notes_pages_with_a_cursor_without_repeats() {
        let (mut s, _d) = open_temp();
        let a = label(&mut s, None, "A");
        let times = [T1, T2, T2, T3, T4];
        for (i, t) in times.iter().enumerate() {
            s.save_labelled_note_at(t, None, &format!("n{i}"), &ids(&[&a]))
                .unwrap();
        }
        for filter in [None, Some(a.as_str())] {
            let mut seen = Vec::new();
            let mut page = ChangePageRequest::first(2);
            loop {
                let got = s.list_labelled_notes(filter, &page).unwrap();
                seen.extend(got.items.iter().map(|n| n.note.base.id.clone()));
                match got.next {
                    Some(c) => page.after = Some(c),
                    None => break,
                }
            }
            assert_eq!(seen, listed(&s, filter));
            assert_eq!(seen.len(), 5);
            let unique: HashSet<_> = seen.iter().collect();
            assert_eq!(unique.len(), 5);
        }
    }

    #[test]
    fn list_labelled_notes_refuses_a_bad_page_or_an_unknown_label() {
        let (s, _d) = open_temp();
        for bad in [0, 101] {
            invalid(s.list_labelled_notes(None, &ChangePageRequest::first(bad)));
        }
        assert_eq!(
            s.list_labelled_notes(Some("missing"), &ChangePageRequest::first(10))
                .unwrap_err(),
            LABEL_NOT_FOUND
        );
        // The #14 list keeps its own cursor and still works.
        assert!(s
            .list::<Note>(&PageRequest::first(10), false)
            .unwrap()
            .items
            .is_empty());
    }
}
