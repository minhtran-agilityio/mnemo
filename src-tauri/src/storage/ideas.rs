//! Ideas (#34): an idea with a title, a text, tags, a source (a saved item or a web
//! link), a "why" line and an outline. Four plain code checks (has a tag, has a source,
//! has a why, has an outline) set its stage; they are advice only and never block a
//! write. "Turn into project" works at any stage: it adds a project, links idea and
//! project, and moves the idea to the stage Project. No AI is used here.
//!
//! Stage rule (read from the prototype v71, see `stage_for`): 0 or 1 checks pass is
//! Spark, 2 or 3 is Shape, all 4 is Ready. Project only comes from "Turn into project"
//! and stays, whatever the checks say later.

use rusqlite::types::Value;
use rusqlite::{
    params, params_from_iter, OptionalExtension, Row, Transaction, TransactionBehavior,
};
use serde::{Deserialize, Serialize};

use super::error::StorageError;
use super::items::{
    base_from, exists_sql, invalid, nullable, optional_chars, optional_text, required_chars,
    web_address, IdeaStage, Item, ItemKind, Project, ProjectInput, MAX_TITLE_CHARS,
};
use super::links::{hide_links_of, link_in_tx, require_live, ItemRef};
use super::record::{now_iso, Cursor, Page, PageRequest, RecordBase};
use super::Storage;

/// Longest tag, in characters.
pub const MAX_TAG_CHARS: usize = 40;
/// Most tags on one idea.
pub const MAX_TAGS: usize = 20;
/// Longest "why" line, in characters.
pub const MAX_WHY_CHARS: usize = 500;
/// The status of a project made from an idea, until PROJ-01 names the values.
pub const NEW_PROJECT_STATUS: &str = "planned";

/// Where an idea comes from: one of the owner's saved items, or a web link.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum IdeaSource {
    /// A saved bookmark or note.
    Item { item: ItemRef },
    /// A web address (http or https).
    Link { url: String },
}

/// The four plain checks. Advice only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaChecks {
    pub has_tag: bool,
    pub has_source: bool,
    pub has_why: bool,
    pub has_outline: bool,
}

impl IdeaChecks {
    /// How many of the four checks pass (0 to 4).
    pub fn passed(&self) -> u8 {
        [
            self.has_tag,
            self.has_source,
            self.has_why,
            self.has_outline,
        ]
        .into_iter()
        .filter(|ok| *ok)
        .count() as u8
    }
}

/// The stage that follows the checks. An idea that was turned into a project stays
/// Project. Otherwise 0-1 passed checks is Spark, 2-3 is Shape and 4 is Ready (the
/// thresholds of the "Ready to become a project?" advice in the prototype v71).
pub fn stage_for(checks: &IdeaChecks, is_project: bool) -> IdeaStage {
    if is_project {
        return IdeaStage::Project;
    }
    match checks.passed() {
        0 | 1 => IdeaStage::Spark,
        2 | 3 => IdeaStage::Shape,
        _ => IdeaStage::Ready,
    }
}

/// An idea as the UI sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Idea {
    #[serde(flatten)]
    pub base: RecordBase,
    pub title: String,
    pub text: Option<String>,
    pub source: Option<IdeaSource>,
    pub why: Option<String>,
    /// Plain text, one point per line.
    pub outline: Option<String>,
    /// Live tags, in the order they were added.
    pub tags: Vec<String>,
    pub stage: IdeaStage,
    pub checks: IdeaChecks,
    /// The live project this idea was turned into, if any.
    pub project_id: Option<String>,
}

/// What the owner gives when adding or updating an idea. Every field must be sent
/// (null for unknown), because update replaces every field, tags included.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaInput {
    pub title: String,
    #[serde(deserialize_with = "nullable")]
    pub text: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub source: Option<IdeaSource>,
    #[serde(deserialize_with = "nullable")]
    pub why: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub outline: Option<String>,
    pub tags: Vec<String>,
}

impl IdeaInput {
    /// An idea with only a title.
    #[cfg(test)]
    pub fn titled(title: &str) -> Self {
        IdeaInput {
            title: title.to_string(),
            text: None,
            source: None,
            why: None,
            outline: None,
            tags: Vec::new(),
        }
    }
}

/// The result of "Turn into project": the idea, now at the stage Project, and the new project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaProject {
    pub idea: Idea,
    pub project: Project,
}

/// Cleans one tag the way the prototype does: trimmed, no leading "#", lower case,
/// inner spaces as "-". Refuses an empty, too long or control-character tag.
pub fn clean_tag(raw: &str) -> Result<String, StorageError> {
    let t = raw.trim().trim_start_matches('#').trim().to_lowercase();
    let t = t.split_whitespace().collect::<Vec<_>>().join("-");
    if t.is_empty() {
        return Err(invalid("A tag cannot be empty.".to_string()));
    }
    if t.chars().count() > MAX_TAG_CHARS {
        return Err(invalid(format!(
            "A tag is too long (at most {MAX_TAG_CHARS} characters)."
        )));
    }
    if t.chars().any(char::is_control) {
        return Err(invalid("A tag cannot hold control characters.".to_string()));
    }
    Ok(t)
}

/// The cleaned tags without repeats, in the order given.
fn clean_tags(raw: &[String]) -> Result<Vec<String>, StorageError> {
    // Refuse an oversized list before any work: repeats may shrink it, but not by much.
    if raw.len() > MAX_TAGS * 2 || raw.iter().any(|r| r.len() > MAX_TAG_CHARS * 4) {
        return Err(invalid(format!(
            "An idea has at most {MAX_TAGS} tags of at most {MAX_TAG_CHARS} characters."
        )));
    }
    let mut out: Vec<String> = Vec::new();
    for r in raw {
        let t = clean_tag(r)?;
        if !out.contains(&t) {
            out.push(t);
        }
    }
    if out.len() > MAX_TAGS {
        return Err(invalid(format!("An idea has at most {MAX_TAGS} tags.")));
    }
    Ok(out)
}

/// Checks every field. Returns the cleaned tags.
fn validate(i: &IdeaInput) -> Result<Vec<String>, StorageError> {
    required_chars("title", &i.title, MAX_TITLE_CHARS)?;
    optional_text("text", &i.text)?;
    optional_chars("why line", &i.why, MAX_WHY_CHARS)?;
    optional_text("outline", &i.outline)?;
    match &i.source {
        Some(IdeaSource::Link { url }) => web_address(url)?,
        Some(IdeaSource::Item { item }) => {
            if !matches!(item.kind, ItemKind::Bookmark | ItemKind::Note) {
                return Err(invalid(
                    "The source must be a saved link or a note.".to_string(),
                ));
            }
        }
        None => {}
    }
    clean_tags(&i.tags)
}

/// The source as the four stored columns: kind, id, url.
fn source_values(s: &Option<IdeaSource>) -> [Value; 3] {
    match s {
        Some(IdeaSource::Item { item }) => [
            Value::Text(item.kind.as_str().to_string()),
            Value::Text(item.id.clone()),
            Value::Null,
        ],
        Some(IdeaSource::Link { url }) => [Value::Null, Value::Null, Value::Text(url.clone())],
        None => [Value::Null, Value::Null, Value::Null],
    }
}

fn opt(v: &Option<String>) -> Value {
    v.as_ref().map_or(Value::Null, |s| Value::Text(s.clone()))
}

pub(crate) const EXISTS_SQL: &str =
    "SELECT count(*) FROM idea WHERE id = ?1 AND deleted_at IS NULL";

const INSERT_SQL: &str = "INSERT INTO idea
     (id, created_at, updated_at, title, body, source_kind, source_id, source_url, why, outline, stage)
     VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'spark')";

const UPDATE_SQL: &str = "UPDATE idea SET updated_at = ?2, title = ?3, body = ?4,
         source_kind = ?5, source_id = ?6, source_url = ?7, why = ?8, outline = ?9
     WHERE id = ?1 AND deleted_at IS NULL";

const SET_STAGE_SQL: &str = "UPDATE idea SET stage = ?2 WHERE id = ?1";

const GET_SQL: &str = concat!(
    "SELECT ",
    "id, created_at, updated_at, deleted_at, title, body, source_kind, source_id, source_url, why, outline, stage",
    " FROM idea WHERE id = ?1 AND deleted_at IS NULL"
);

// ?1 and ?2 the cursor (or NULL), ?3 the row limit.
const LIST_SQL: &str = concat!(
    "SELECT ",
    "id, created_at, updated_at, deleted_at, title, body, source_kind, source_id, source_url, why, outline, stage",
    " FROM idea WHERE deleted_at IS NULL",
    " AND (?1 IS NULL OR (created_at, id) < (?1, ?2))",
    " ORDER BY created_at DESC, id DESC LIMIT ?3"
);

const LIST_ALL_SQL: &str = concat!(
    "SELECT ",
    "id, created_at, updated_at, deleted_at, title, body, source_kind, source_id, source_url, why, outline, stage",
    " FROM idea WHERE (?1 IS NULL OR (created_at, id) < (?1, ?2))",
    " ORDER BY created_at DESC, id DESC LIMIT ?3"
);

const DELETE_SQL: &str = "UPDATE idea SET deleted_at = ?2, updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL";

const TAGS_SQL: &str = "SELECT tag FROM idea_tag
     WHERE idea_id = ?1 AND deleted_at IS NULL ORDER BY created_at, rowid";

// Adds a tag, or brings a removed one back with the new time.
const TAG_UPSERT_SQL: &str = "INSERT INTO idea_tag (id, idea_id, tag, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT (idea_id, tag) DO UPDATE SET
         created_at = CASE WHEN deleted_at IS NULL THEN created_at ELSE excluded.created_at END,
         updated_at = CASE WHEN deleted_at IS NULL THEN updated_at ELSE excluded.updated_at END,
         deleted_at = NULL";

const HIDE_TAGS_SQL: &str = "UPDATE idea_tag SET deleted_at = ?2, updated_at = ?2
     WHERE idea_id = ?1 AND deleted_at IS NULL";

const TAG_HIDE_SQL: &str = "UPDATE idea_tag SET deleted_at = ?3, updated_at = ?3
     WHERE idea_id = ?1 AND tag = ?2 AND deleted_at IS NULL";

// The live project linked to the idea. 'idea' < 'project', so the idea is always end a.
const PROJECT_OF_SQL: &str = "SELECT l.b_id FROM item_link l
     JOIN project p ON p.id = l.b_id AND p.deleted_at IS NULL
     WHERE l.a_kind = 'idea' AND l.a_id = ?1 AND l.b_kind = 'project' AND l.deleted_at IS NULL
     ORDER BY l.created_at, l.id LIMIT 1";

/// One idea row before its tags and project are added.
struct Row0 {
    base: RecordBase,
    title: String,
    text: Option<String>,
    source: Option<IdeaSource>,
    why: Option<String>,
    outline: Option<String>,
    stage: IdeaStage,
}

fn row0(r: &Row<'_>) -> rusqlite::Result<Row0> {
    let kind: Option<ItemKind> = r.get(6)?;
    let id: Option<String> = r.get(7)?;
    let url: Option<String> = r.get(8)?;
    let source = match (kind, id, url) {
        (Some(kind), Some(id), _) => Some(IdeaSource::Item {
            item: ItemRef { kind, id },
        }),
        (_, _, Some(url)) => Some(IdeaSource::Link { url }),
        _ => None,
    };
    Ok(Row0 {
        base: base_from(r)?,
        title: r.get(4)?,
        text: r.get(5)?,
        source,
        why: r.get(9)?,
        outline: r.get(10)?,
        stage: r.get(11)?,
    })
}

/// The four checks. A saved item that was deleted later no longer counts as a source;
/// the idea keeps pointing at it, so nothing is lost if it comes back.
fn checks_of(
    conn: &rusqlite::Connection,
    row: &Row0,
    tag_count: usize,
) -> Result<IdeaChecks, StorageError> {
    let filled = |v: &Option<String>| v.as_deref().is_some_and(|s| !s.trim().is_empty());
    let has_source = match &row.source {
        Some(IdeaSource::Item { item }) => {
            let n: i64 = conn.query_row(exists_sql(item.kind), [&item.id], |r| r.get(0))?;
            n > 0
        }
        Some(IdeaSource::Link { .. }) => true,
        None => false,
    };
    Ok(IdeaChecks {
        has_tag: tag_count > 0,
        has_source,
        has_why: filled(&row.why),
        has_outline: filled(&row.outline),
    })
}

fn tags_of(conn: &rusqlite::Connection, id: &str) -> Result<Vec<String>, StorageError> {
    let mut st = conn.prepare_cached(TAGS_SQL)?;
    let tags = st
        .query_map([id], |r| r.get(0))?
        .collect::<Result<Vec<String>, _>>()?;
    Ok(tags)
}

fn project_of(conn: &rusqlite::Connection, id: &str) -> Result<Option<String>, StorageError> {
    Ok(conn
        .query_row(PROJECT_OF_SQL, [id], |r| r.get(0))
        .optional()?)
}

/// Adds the tags and the project to a row.
fn complete(conn: &rusqlite::Connection, row: Row0) -> Result<Idea, StorageError> {
    let tags = tags_of(conn, &row.base.id)?;
    let checks = checks_of(conn, &row, tags.len())?;
    let project_id = project_of(conn, &row.base.id)?;
    Ok(Idea {
        base: row.base,
        title: row.title,
        text: row.text,
        source: row.source,
        why: row.why,
        outline: row.outline,
        tags,
        stage: row.stage,
        checks,
        project_id,
    })
}

fn read(conn: &rusqlite::Connection, id: &str) -> Result<Idea, StorageError> {
    let row = conn
        .query_row(GET_SQL, [id], row0)
        .optional()?
        .ok_or(NOT_FOUND)?;
    complete(conn, row)
}

const NOT_FOUND: StorageError = StorageError::NotFound { kind: "idea" };

/// Makes the live tags of `id` exactly `tags`: removed ones are soft deleted, new or
/// removed-before ones are added. Nothing else of the idea changes.
fn sync_tags(
    tx: &Transaction<'_>,
    now: &str,
    id: &str,
    tags: &[String],
) -> Result<(), StorageError> {
    for old in tags_of(tx, id)? {
        if !tags.contains(&old) {
            tx.execute(TAG_HIDE_SQL, params![id, old, now])?;
        }
    }
    for t in tags {
        let base = RecordBase::new_at(now);
        tx.execute(TAG_UPSERT_SQL, params![base.id, id, t, now])?;
    }
    Ok(())
}

/// Sets the stage from the checks, keeping Project.
fn restage(tx: &Transaction<'_>, id: &str) -> Result<(), StorageError> {
    let row = tx.query_row(GET_SQL, [id], row0)?;
    let tags = tags_of(tx, id)?;
    let stage = stage_for(
        &checks_of(tx, &row, tags.len())?,
        row.stage == IdeaStage::Project,
    );
    tx.execute(SET_STAGE_SQL, params![id, stage.as_str()])?;
    Ok(())
}

/// The source item must exist and be live when it is saved.
fn require_source(tx: &Transaction<'_>, s: &Option<IdeaSource>) -> Result<(), StorageError> {
    if let Some(IdeaSource::Item { item }) = s {
        require_live(tx, item)?;
    }
    Ok(())
}

fn write_values(id: &str, now: &str, i: &IdeaInput) -> Vec<Value> {
    let mut v = vec![
        Value::Text(id.to_string()),
        Value::Text(now.to_string()),
        Value::Text(i.title.clone()),
        opt(&i.text),
    ];
    v.extend(source_values(&i.source));
    v.push(opt(&i.why));
    v.push(opt(&i.outline));
    v
}

impl Storage {
    /// Adds an idea with its tags. Its stage follows the checks.
    pub fn add_idea(&mut self, input: &IdeaInput) -> Result<Idea, StorageError> {
        self.add_idea_at(&now_iso(), input)
    }

    pub(crate) fn add_idea_at(
        &mut self,
        now: &str,
        input: &IdeaInput,
    ) -> Result<Idea, StorageError> {
        let tags = validate(input)?;
        let base = RecordBase::new_at(now);
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_source(&tx, &input.source)?;
        tx.execute(
            INSERT_SQL,
            params_from_iter(write_values(&base.id, now, input)),
        )?;
        sync_tags(&tx, now, &base.id, &tags)?;
        restage(&tx, &base.id)?;
        tx.commit()?;
        read(&self.conn, &base.id)
    }

    /// The live idea with this id, with its tags, checks and project.
    pub fn get_idea(&self, id: &str) -> Result<Idea, StorageError> {
        read(&self.conn, id)
    }

    /// One page of ideas, newest first. Deleted ideas are left out unless asked for.
    pub fn list_ideas(
        &self,
        page: &PageRequest,
        include_deleted: bool,
    ) -> Result<Page<Idea>, StorageError> {
        page.validate()?;
        let (at, after_id) = match &page.after {
            Some(c) => (Some(c.created_at.as_str()), Some(c.id.as_str())),
            None => (None, None),
        };
        let sql = if include_deleted {
            LIST_ALL_SQL
        } else {
            LIST_SQL
        };
        let rows = {
            let mut st = self.conn.prepare_cached(sql)?;
            let rows = st
                .query_map(params![at, after_id, page.limit + 1], row0)?
                .collect::<Result<Vec<Row0>, _>>()?;
            rows
        };
        let ideas = rows
            .into_iter()
            .map(|r| complete(&self.conn, r))
            .collect::<Result<Vec<Idea>, _>>()?;
        Ok(super::items::into_page(ideas, page.limit, |i: &Idea| {
            Cursor {
                created_at: i.base.created_at.clone(),
                id: i.base.id.clone(),
            }
        }))
    }

    /// Replaces every field of a live idea, tags included, and sets its stage from the
    /// checks. A removed tag is soft deleted; nothing else is deleted.
    pub fn update_idea(&mut self, id: &str, input: &IdeaInput) -> Result<Idea, StorageError> {
        self.update_idea_at(&now_iso(), id, input)
    }

    pub(crate) fn update_idea_at(
        &mut self,
        now: &str,
        id: &str,
        input: &IdeaInput,
    ) -> Result<Idea, StorageError> {
        let tags = validate(input)?;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_source(&tx, &input.source)?;
        if tx.execute(UPDATE_SQL, params_from_iter(write_values(id, now, input)))? == 0 {
            return Err(NOT_FOUND);
        }
        sync_tags(&tx, now, id, &tags)?;
        restage(&tx, id)?;
        tx.commit()?;
        read(&self.conn, id)
    }

    /// Soft deletes an idea, its links and its tags (all soft). Its project is kept.
    pub fn delete_idea(&mut self, id: &str) -> Result<(), StorageError> {
        self.delete_idea_at(&now_iso(), id)
    }

    pub(crate) fn delete_idea_at(&mut self, now: &str, id: &str) -> Result<(), StorageError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if tx.execute(DELETE_SQL, [id, now])? == 0 {
            return Err(NOT_FOUND);
        }
        hide_links_of(&tx, ItemKind::Idea, id, now)?;
        tx.execute(HIDE_TAGS_SQL, params![id, now])?;
        tx.commit()?;
        Ok(())
    }

    /// "Turn into project", at any stage: adds a project with the idea's title, links
    /// idea and project (one link, seen from both ends), and moves the idea to the stage
    /// Project. One transaction. An idea that already has a live project is refused.
    pub fn turn_idea_into_project(&mut self, id: &str) -> Result<IdeaProject, StorageError> {
        self.turn_idea_into_project_at(&now_iso(), id)
    }

    pub(crate) fn turn_idea_into_project_at(
        &mut self,
        now: &str,
        id: &str,
    ) -> Result<IdeaProject, StorageError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let row = tx
            .query_row(GET_SQL, [id], row0)
            .optional()?
            .ok_or(NOT_FOUND)?;
        if project_of(&tx, id)?.is_some() {
            return Err(invalid("This idea is already a project.".to_string()));
        }
        let input = ProjectInput {
            title: row.title.clone(),
            status: NEW_PROJECT_STATUS.to_string(),
        };
        Project::validate(&input)?;
        let base = RecordBase::new_at(now);
        let mut values = vec![Value::Text(base.id.clone()), Value::Text(now.to_string())];
        values.extend(Project::values(&input));
        let project: Project = tx.query_row(
            Project::INSERT_SQL,
            params_from_iter(values),
            Project::from_row,
        )?;
        link_in_tx(
            &tx,
            now,
            &ItemRef {
                kind: ItemKind::Idea,
                id: id.to_string(),
            },
            &ItemRef {
                kind: ItemKind::Project,
                id: project.base.id.clone(),
            },
        )?;
        tx.execute(
            "UPDATE idea SET stage = 'project', updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
        tx.commit()?;
        Ok(IdeaProject {
            idea: read(&self.conn, id)?,
            project,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::items::tests::{bookmark, T1};
    use crate::storage::items::Bookmark;
    use crate::storage::testing::{open_temp, TempDir};

    const T2: &str = "2026-01-02T00:00:00Z";
    const T3: &str = "2026-01-03T00:00:00Z";

    fn checks(tag: bool, source: bool, why: bool, outline: bool) -> IdeaChecks {
        IdeaChecks {
            has_tag: tag,
            has_source: source,
            has_why: why,
            has_outline: outline,
        }
    }

    fn link(url: &str) -> Option<IdeaSource> {
        Some(IdeaSource::Link {
            url: url.to_string(),
        })
    }

    /// An idea input with the first `n` of the four checks passing (tag, source, why, outline).
    fn with_checks(n: usize) -> IdeaInput {
        let mut i = IdeaInput::titled("Garden robot");
        if n >= 1 {
            i.tags = vec!["garden".into()];
        }
        if n >= 2 {
            i.source = link("https://example.com/soil");
        }
        if n >= 3 {
            i.why = Some("So the plants live while I travel.".into());
        }
        if n >= 4 {
            i.outline = Some("Sensor\nPump\nSchedule".into());
        }
        i
    }

    #[test]
    fn idea_stage_follows_the_number_of_passed_checks_from_0_to_4() {
        // The pure rule, every combination of the four checks.
        for mask in 0u8..16 {
            let c = checks(mask & 1 > 0, mask & 2 > 0, mask & 4 > 0, mask & 8 > 0);
            let want = match mask.count_ones() {
                0 | 1 => IdeaStage::Spark,
                2 | 3 => IdeaStage::Shape,
                _ => IdeaStage::Ready,
            };
            assert_eq!(c.passed() as u32, mask.count_ones());
            assert_eq!(stage_for(&c, false), want, "mask {mask:04b}");
            assert_eq!(stage_for(&c, true), IdeaStage::Project);
        }
    }

    #[test]
    fn idea_stage_steps_through_0_1_2_3_4_checks_when_saved() {
        let (mut s, _d) = open_temp();
        let want = [
            IdeaStage::Spark,
            IdeaStage::Spark,
            IdeaStage::Shape,
            IdeaStage::Shape,
            IdeaStage::Ready,
        ];
        // Each step added, then the same idea updated one check at a time.
        for (n, stage) in want.iter().enumerate() {
            let i = s.add_idea_at(T1, &with_checks(n)).unwrap();
            assert_eq!(i.checks.passed() as usize, n);
            assert_eq!(i.stage, *stage, "{n} checks on add");
        }
        let id = s.add_idea_at(T1, &with_checks(0)).unwrap().base.id;
        for (n, stage) in want.iter().enumerate() {
            let i = s.update_idea_at(T2, &id, &with_checks(n)).unwrap();
            assert_eq!(i.stage, *stage, "{n} checks on update");
            assert_eq!(s.get_idea(&id).unwrap().stage, *stage);
        }
    }

    #[test]
    fn idea_checks_ignore_blank_why_and_outline_and_never_block_a_save() {
        let (mut s, _d) = open_temp();
        // A spark with nothing but a title saves fine: the checks are advice only.
        let i = s
            .add_idea_at(T1, &IdeaInput::titled("Just a thought"))
            .unwrap();
        assert_eq!(i.checks, IdeaChecks::default());
        assert_eq!(i.stage, IdeaStage::Spark);
        // A blank why or outline is refused, not counted.
        let mut blank = with_checks(4);
        blank.why = Some("   ".into());
        assert!(matches!(
            s.add_idea_at(T1, &blank),
            Err(StorageError::Invalid(_))
        ));
    }

    #[test]
    fn removing_a_tag_from_a_ready_idea_moves_it_back_one_stage_and_deletes_nothing() {
        let (mut s, _d) = open_temp();
        let ready = s.add_idea_at(T1, &with_checks(4)).unwrap();
        assert_eq!(ready.stage, IdeaStage::Ready);
        let mut no_tag = with_checks(4);
        no_tag.tags.clear();
        let back = s.update_idea_at(T2, &ready.base.id, &no_tag).unwrap();
        assert_eq!(back.stage, IdeaStage::Shape, "one stage back");
        assert!(back.tags.is_empty());
        // Nothing deleted: the idea, its fields and the tag row are all still there.
        assert_eq!(back.title, ready.title);
        assert_eq!(back.source, ready.source);
        assert_eq!(back.why, ready.why);
        assert_eq!(back.outline, ready.outline);
        assert_eq!(back.base.deleted_at, None);
        let (rows, hidden): (i64, Option<String>) = s
            .conn
            .query_row(
                "SELECT count(*), max(deleted_at) FROM idea_tag WHERE idea_id = ?1",
                [&ready.base.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(rows, 1, "the tag row is kept, only marked removed");
        assert_eq!(hidden.as_deref(), Some(T2));
        let ideas: i64 = s
            .conn
            .query_row("SELECT count(*) FROM idea", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ideas, 1);
        // Adding the tag again brings the same row back and the idea is Ready again.
        let again = s
            .update_idea_at(T3, &ready.base.id, &with_checks(4))
            .unwrap();
        assert_eq!(again.stage, IdeaStage::Ready);
        assert_eq!(again.tags, vec!["garden".to_string()]);
    }

    #[test]
    fn turn_idea_into_project_works_at_every_stage_and_links_both_ways() {
        let (mut s, _d) = open_temp();
        for n in 0..=4 {
            let idea = s.add_idea_at(T1, &with_checks(n)).unwrap();
            let before = idea.stage;
            let done = s.turn_idea_into_project_at(T2, &idea.base.id).unwrap();
            assert_ne!(before, IdeaStage::Project);
            assert_eq!(done.idea.stage, IdeaStage::Project, "from {before:?}");
            assert_eq!(done.project.title, idea.title);
            assert_eq!(done.project.status, NEW_PROJECT_STATUS);
            // Idea -> project.
            assert_eq!(
                done.idea.project_id.as_deref(),
                Some(done.project.base.id.as_str())
            );
            let pr = ItemRef {
                kind: ItemKind::Project,
                id: done.project.base.id.clone(),
            };
            let ir = ItemRef {
                kind: ItemKind::Idea,
                id: idea.base.id.clone(),
            };
            let from_idea = s.list_links(&ir, &PageRequest::first(10)).unwrap().items;
            assert_eq!(from_idea.len(), 1);
            assert_eq!(from_idea[0].other, pr);
            // Project -> idea.
            let from_project = s.list_links(&pr, &PageRequest::first(10)).unwrap().items;
            assert_eq!(from_project.len(), 1);
            assert_eq!(from_project[0].other, ir);
            // The idea's fields are kept.
            assert_eq!(done.idea.tags, idea.tags);
            assert_eq!(done.idea.why, idea.why);
        }
    }

    #[test]
    fn turn_idea_into_project_twice_is_refused_and_the_stage_stays_project() {
        let (mut s, _d) = open_temp();
        let idea = s.add_idea_at(T1, &with_checks(1)).unwrap();
        s.turn_idea_into_project_at(T2, &idea.base.id).unwrap();
        assert!(matches!(
            s.turn_idea_into_project_at(T3, &idea.base.id),
            Err(StorageError::Invalid(_))
        ));
        let projects: i64 = s
            .conn
            .query_row("SELECT count(*) FROM project", [], |r| r.get(0))
            .unwrap();
        assert_eq!(projects, 1);
        // Editing the idea later keeps the stage Project, whatever the checks say.
        let i = s
            .update_idea_at(T3, &idea.base.id, &with_checks(0))
            .unwrap();
        assert_eq!(i.stage, IdeaStage::Project);
        assert!(i.project_id.is_some());
        assert!(matches!(
            s.turn_idea_into_project_at(T3, "missing"),
            Err(StorageError::NotFound { kind: "idea" })
        ));
    }

    #[test]
    fn ideas_are_kept_after_reopen_with_tags_source_why_outline_and_project() {
        let dir = TempDir::new();
        let path = dir.path().join("mnemo.db");
        let (id, project_id) = {
            let mut s = Storage::open(&path).unwrap();
            let id = s.add_idea_at(T1, &with_checks(4)).unwrap().base.id;
            let mut spark = IdeaInput::titled("Second thought");
            spark.text = Some("Longer **text**".into());
            s.add_idea_at(T1, &spark).unwrap();
            let p = s
                .turn_idea_into_project_at(T2, &id)
                .unwrap()
                .project
                .base
                .id;
            (id, p)
        };
        let s = Storage::open(&path).unwrap();
        let i = s.get_idea(&id).unwrap();
        assert_eq!(i.stage, IdeaStage::Project);
        assert_eq!(i.tags, vec!["garden".to_string()]);
        assert_eq!(i.source, link("https://example.com/soil"));
        assert_eq!(i.why.as_deref(), Some("So the plants live while I travel."));
        assert_eq!(i.outline.as_deref(), Some("Sensor\nPump\nSchedule"));
        assert_eq!(i.project_id.as_deref(), Some(project_id.as_str()));
        let all = s.list_ideas(&PageRequest::first(10), false).unwrap().items;
        assert_eq!(all.len(), 2);
        assert!(all
            .iter()
            .any(|x| x.text.as_deref() == Some("Longer **text**") && x.stage == IdeaStage::Spark));
    }

    #[test]
    fn idea_source_can_be_a_saved_item_and_must_be_live() {
        let (mut s, _d) = open_temp();
        let b: Bookmark = s.add_at(T1, &bookmark("https://a.example")).unwrap();
        let mut i = with_checks(1);
        i.source = Some(IdeaSource::Item {
            item: ItemRef {
                kind: ItemKind::Bookmark,
                id: b.base.id.clone(),
            },
        });
        let saved = s.add_idea_at(T1, &i).unwrap();
        assert_eq!(saved.source, i.source);
        assert_eq!(saved.stage, IdeaStage::Shape);
        // A missing item, or a type that is not a saved item, is refused.
        i.source = Some(IdeaSource::Item {
            item: ItemRef {
                kind: ItemKind::Bookmark,
                id: "missing".into(),
            },
        });
        assert!(matches!(
            s.add_idea_at(T1, &i),
            Err(StorageError::NotFound { kind: "bookmark" })
        ));
        i.source = Some(IdeaSource::Item {
            item: ItemRef {
                kind: ItemKind::Task,
                id: "t".into(),
            },
        });
        assert!(matches!(
            s.add_idea_at(T1, &i),
            Err(StorageError::Invalid(_))
        ));
        i.source = link("ftp://nope");
        assert!(matches!(
            s.add_idea_at(T1, &i),
            Err(StorageError::Invalid(_))
        ));
    }

    #[test]
    fn idea_add_refuses_bad_fields_and_writes_nothing() {
        let (mut s, _d) = open_temp();
        let mut bad = vec![
            IdeaInput::titled(" "),
            IdeaInput::titled(&"t".repeat(MAX_TITLE_CHARS + 1)),
        ];
        let mut long_why = with_checks(0);
        long_why.why = Some("w".repeat(MAX_WHY_CHARS + 1));
        bad.push(long_why);
        let mut many = with_checks(0);
        many.tags = (0..=MAX_TAGS).map(|n| format!("t{n}")).collect();
        bad.push(many);
        let mut long_tag = with_checks(0);
        long_tag.tags = vec!["x".repeat(MAX_TAG_CHARS + 1)];
        bad.push(long_tag);
        let mut empty_tag = with_checks(0);
        empty_tag.tags = vec!["  # ".into()];
        bad.push(empty_tag);
        for b in bad {
            assert!(
                matches!(s.add_idea_at(T1, &b), Err(StorageError::Invalid(_))),
                "{b:?}"
            );
        }
        let n: i64 = s
            .conn
            .query_row("SELECT count(*) FROM idea", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn a_deleted_source_item_no_longer_counts_and_deleting_an_idea_hides_its_tags() {
        let (mut s, _d) = open_temp();
        let b: Bookmark = s.add_at(T1, &bookmark("https://a.example")).unwrap();
        let mut i = with_checks(1);
        i.source = Some(IdeaSource::Item {
            item: ItemRef {
                kind: ItemKind::Bookmark,
                id: b.base.id.clone(),
            },
        });
        let idea = s.add_idea_at(T1, &i).unwrap();
        assert!(idea.checks.has_source);
        s.delete_at::<Bookmark>(T2, &b.base.id).unwrap();
        let after = s.get_idea(&idea.base.id).unwrap();
        assert!(!after.checks.has_source);
        assert_eq!(after.source, i.source, "the pointer is kept");
        s.delete_idea_at(T3, &idea.base.id).unwrap();
        let live: i64 = s
            .conn
            .query_row(
                "SELECT count(*) FROM idea_tag WHERE idea_id = ?1 AND deleted_at IS NULL",
                [&idea.base.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(live, 0);
        let rows: i64 = s
            .conn
            .query_row("SELECT count(*) FROM idea_tag", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1, "soft delete: the row stays");
    }

    #[test]
    fn an_oversized_tag_list_is_refused_before_cleaning() {
        let (mut s, _d) = open_temp();
        let mut i = IdeaInput::titled("t");
        i.tags = vec!["a".into(); MAX_TAGS * 2 + 1];
        assert!(matches!(
            s.add_idea_at(T1, &i),
            Err(StorageError::Invalid(_))
        ));
        i.tags = vec!["x".repeat(MAX_TAG_CHARS * 4 + 1)];
        assert!(matches!(
            s.add_idea_at(T1, &i),
            Err(StorageError::Invalid(_))
        ));
    }

    #[test]
    fn idea_tags_are_cleaned_and_kept_once_in_order() {
        let (mut s, _d) = open_temp();
        let mut i = IdeaInput::titled("Tags");
        i.tags = vec![" #Agents ".into(), "soil  sensors".into(), "agents".into()];
        let saved = s.add_idea_at(T1, &i).unwrap();
        assert_eq!(
            saved.tags,
            vec!["agents".to_string(), "soil-sensors".to_string()]
        );
    }

    #[test]
    fn idea_get_list_update_and_delete_follow_the_shared_rules() {
        let (mut s, _d) = open_temp();
        let a = s.add_idea_at(T1, &with_checks(1)).unwrap();
        let b = s.add_idea_at(T2, &with_checks(2)).unwrap();
        assert_eq!(a.base.created_at, T1);
        let page = s.list_ideas(&PageRequest::first(1), false).unwrap();
        assert_eq!(page.items[0].base.id, b.base.id, "newest first");
        let mut req = PageRequest::first(1);
        req.after = page.next;
        assert_eq!(
            s.list_ideas(&req, false).unwrap().items[0].base.id,
            a.base.id
        );
        let u = s.update_idea_at(T3, &a.base.id, &with_checks(3)).unwrap();
        assert_eq!(u.base.updated_at, T3);
        assert_eq!(u.base.created_at, T1);
        s.delete_idea_at(T3, &a.base.id).unwrap();
        assert!(matches!(
            s.get_idea(&a.base.id),
            Err(StorageError::NotFound { kind: "idea" })
        ));
        assert!(matches!(
            s.update_idea_at(T3, &a.base.id, &with_checks(1)),
            Err(StorageError::NotFound { .. })
        ));
        assert!(matches!(
            s.delete_idea_at(T3, &a.base.id),
            Err(StorageError::NotFound { .. })
        ));
        assert_eq!(
            s.list_ideas(&PageRequest::first(10), false)
                .unwrap()
                .items
                .len(),
            1
        );
        let all = s.list_ideas(&PageRequest::first(10), true).unwrap().items;
        assert_eq!(all.len(), 2);
        assert!(matches!(
            s.list_ideas(&PageRequest::first(0), false),
            Err(StorageError::Invalid(_))
        ));
    }

    #[test]
    fn idea_input_json_must_name_every_field() {
        assert!(serde_json::from_str::<IdeaInput>(r#"{"title":"x","tags":[]}"#).is_err());
        let full = r#"{"title":"x","text":null,"source":{"type":"link","url":"https://a.b"},"why":null,"outline":null,"tags":["a"]}"#;
        let i: IdeaInput = serde_json::from_str(full).unwrap();
        assert_eq!(i.source, link("https://a.b"));
        let item = r#"{"title":"x","text":null,"source":{"type":"item","item":{"kind":"note","id":"n1"}},"why":null,"outline":null,"tags":[]}"#;
        assert!(serde_json::from_str::<IdeaInput>(item).is_ok());
    }
}
