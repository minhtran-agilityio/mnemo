//! Export: writes every live record into a new `mnemo-export-<timestamp>/` folder inside a
//! folder the owner picked. Notes become one Markdown file each; every other type is one
//! JSON array. Files are copied. Soft-deleted rows are left out. An existing folder is never
//! written into: a taken name gets `-2`, `-3` and so on.

use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use rusqlite::params;
use serde::Serialize;

use super::error::StorageError;
use super::files::{FileRecord, FILES_DIR};
use super::items::{Bookmark, Event, Memory, Note, Project, Run, Task};
use super::record::{Cursor, Page, PageRequest, MAX_PAGE};
use super::Storage;

/// The start of the export folder name.
const FOLDER_PREFIX: &str = "mnemo-export-";

/// How many same-second exports one picked folder may hold before the export refuses.
const MAX_NAME_TRIES: u32 = 1000;

/// How many live records of each type were exported.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCounts {
    pub notes: u64,
    pub bookmarks: u64,
    pub ideas: u64,
    pub projects: u64,
    pub tasks: u64,
    pub events: u64,
    pub runs: u64,
    pub memories: u64,
    pub labels: u64,
    pub links: u64,
    pub files: u64,
}

/// What an export made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    /// The new export folder.
    pub folder: String,
    pub counts: ExportCounts,
    /// Live file records whose file was gone from the files folder. They are listed in
    /// `files.json` but have no copy (honest failure: nothing is invented).
    pub files_missing: u64,
}

/// A link as written to `links.json`: both ends, in the order the database stores them.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportLink {
    id: String,
    a_kind: String,
    a_id: String,
    b_kind: String,
    b_id: String,
    created_at: String,
    updated_at: String,
}

fn io_failed(e: std::io::Error) -> StorageError {
    StorageError::Files(e.kind().to_string())
}

fn json_failed(e: serde_json::Error) -> StorageError {
    StorageError::Files(format!("{:?}", e.classify()))
}

/// `20261121-120000` from `2026-11-21T12:00:00Z`.
fn stamp(now: &str) -> Result<String, StorageError> {
    let digits: String = now.chars().filter(char::is_ascii_digit).collect();
    if digits.len() < 14 {
        return Err(StorageError::Invalid(
            "The export time is not valid.".into(),
        ));
    }
    Ok(format!("{}-{}", &digits[..8], &digits[8..14]))
}

/// Makes the new folder with `create_dir`, which fails when the name exists.
fn make_export_dir(parent: &Path, now: &str) -> Result<PathBuf, ExportError> {
    let base = format!(
        "{FOLDER_PREFIX}{}",
        stamp(now).map_err(ExportError::target)?
    );
    for n in 1..=MAX_NAME_TRIES {
        let name = if n == 1 {
            base.clone()
        } else {
            format!("{base}-{n}")
        };
        let dir = parent.join(name);
        match fs::create_dir(&dir) {
            Ok(()) => return Ok(dir),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => {
                return Err(ExportError::Failed {
                    cause: io_failed(e),
                    folder: FolderState::NotCreated,
                })
            }
        }
    }
    Err(ExportError::Target(
        "That folder already holds too many exports from this second.".into(),
    ))
}

/// What happened to the export folder when an export failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FolderState {
    /// The folder was never made.
    NotCreated,
    /// The partly written folder was removed.
    Removed,
    /// The partly written folder could not be removed and is still there.
    Left,
}

/// Why an export did not finish.
#[derive(Debug)]
pub enum ExportError {
    /// The chosen folder or the export name was refused. Nothing was written. The text is
    /// safe to show.
    Target(String),
    /// The export failed part way. `folder` says what is left on disk.
    Failed {
        cause: StorageError,
        folder: FolderState,
    },
}

impl ExportError {
    fn target(e: StorageError) -> ExportError {
        ExportError::Target(e.to_string())
    }
}

/// The part of an export that is left after the records are written: copying each file
/// into the export folder. It holds no storage handle, so it runs after the storage lock
/// is released.
#[derive(Debug)]
pub struct ExportJob {
    dir: PathBuf,
    counts: ExportCounts,
    /// (source in the files folder, target in the export folder).
    copies: Vec<(PathBuf, PathBuf)>,
    files_missing: u64,
}

impl ExportJob {
    /// Copies the files and returns the summary. A failure removes the export folder.
    pub fn finish(self) -> Result<ExportSummary, ExportError> {
        match self.copy_all() {
            Ok(vanished) => Ok(ExportSummary {
                folder: self.dir.to_string_lossy().into_owned(),
                counts: self.counts,
                files_missing: self.files_missing + vanished,
            }),
            Err(cause) => Err(fail_and_clean(&self.dir, cause)),
        }
    }

    fn copy_all(&self) -> Result<u64, StorageError> {
        let dest = self.dir.join(FILES_DIR);
        fs::create_dir(&dest).map_err(io_failed)?;
        let mut missing = 0;
        for (src, target) in &self.copies {
            match fs::copy(src, target) {
                Ok(_) => {}
                // The file went away after it was planned: count it as missing.
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => missing += 1,
                Err(e) => return Err(io_failed(e)),
            }
        }
        Ok(missing)
    }
}

fn fail_and_clean(dir: &Path, cause: StorageError) -> ExportError {
    let folder = match fs::remove_dir_all(dir) {
        Ok(()) => FolderState::Removed,
        // Nothing is there, so nothing is left for the owner to delete.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => FolderState::Removed,
        Err(_) => FolderState::Left,
    };
    ExportError::Failed { cause, folder }
}

/// The counts, the planned file copies and how many live file records had no file.
type WrittenExport = (ExportCounts, Vec<(PathBuf, PathBuf)>, u64);

/// Writes pages of `T` as one JSON array, never holding more than one page in memory.
fn write_array<T: Serialize>(
    path: &Path,
    mut next_page: impl FnMut(Option<Cursor>) -> Result<Page<T>, StorageError>,
) -> Result<u64, StorageError> {
    let mut out = BufWriter::new(File::create(path).map_err(io_failed)?);
    out.write_all(b"[").map_err(io_failed)?;
    let mut count = 0u64;
    let mut after = None;
    loop {
        let page = next_page(after)?;
        for item in &page.items {
            out.write_all(if count == 0 { b"\n" } else { b",\n" })
                .map_err(io_failed)?;
            serde_json::to_writer_pretty(&mut out, item).map_err(json_failed)?;
            count += 1;
        }
        match page.next {
            Some(c) => after = Some(c),
            None => break,
        }
    }
    out.write_all(b"\n]\n").map_err(io_failed)?;
    out.flush().map_err(io_failed)?;
    Ok(count)
}

fn page_of(after: Option<Cursor>) -> PageRequest {
    PageRequest {
        limit: MAX_PAGE,
        after,
    }
}

/// The first non-empty line of the body, without leading `#` marks.
fn note_title(body: &str) -> String {
    body.lines()
        .map(|l| l.trim().trim_start_matches('#').trim())
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .chars()
        .take(200)
        .collect()
}

fn quoted(s: &str) -> Result<String, StorageError> {
    serde_json::to_string(s).map_err(json_failed)
}

impl Storage {
    /// Exports every live record into a new `mnemo-export-<timestamp>/` folder inside
    /// `parent`, which must be an existing folder. `now` is UTC ISO 8601. A folder the
    /// export made is removed again when the export fails; no other folder is touched.
    /// This holds the storage for the whole export, files included; the app uses
    /// `export_begin` and `ExportJob::finish` so the file copy runs without the lock.
    #[cfg(test)]
    pub fn export_to(&self, parent: &Path, now: &str) -> Result<ExportSummary, ExportError> {
        self.export_begin(parent, now)?.finish()
    }

    /// Writes the records and plans the file copies. The caller drops its storage lock
    /// before calling `finish` on the result.
    pub fn export_begin(&self, parent: &Path, now: &str) -> Result<ExportJob, ExportError> {
        if !parent.is_dir() {
            return Err(ExportError::Target(
                "Choose an existing folder to export into.".into(),
            ));
        }
        let dir = make_export_dir(parent, now)?;
        match self.write_export(&dir) {
            Ok((counts, copies, files_missing)) => Ok(ExportJob {
                dir,
                counts,
                copies,
                files_missing,
            }),
            Err(cause) => Err(fail_and_clean(&dir, cause)),
        }
    }

    fn write_export(&self, dir: &Path) -> Result<WrittenExport, StorageError> {
        let json = |name: &str| dir.join(format!("{name}.json"));
        let mut c = ExportCounts {
            notes: self.export_notes(&dir.join("notes"))?,
            ..ExportCounts::default()
        };
        c.bookmarks = write_array(&json("bookmarks"), |a| {
            self.list::<Bookmark>(&page_of(a), false)
        })?;
        c.ideas = write_array(&json("ideas"), |a| self.list_ideas(&page_of(a), false))?;
        c.projects = write_array(&json("projects"), |a| {
            self.list::<Project>(&page_of(a), false)
        })?;
        c.tasks = write_array(&json("tasks"), |a| self.list::<Task>(&page_of(a), false))?;
        c.events = write_array(&json("events"), |a| self.list::<Event>(&page_of(a), false))?;
        c.runs = write_array(&json("runs"), |a| self.list::<Run>(&page_of(a), false))?;
        c.memories = write_array(&json("memories"), |a| {
            self.list::<Memory>(&page_of(a), false)
        })?;
        let labels = self.list_labels()?;
        c.labels = write_array(&json("labels"), |_| {
            Ok(Page {
                items: labels.clone(),
                next: None,
            })
        })?;
        c.links = write_array(&json("links"), |a| self.page_links(&page_of(a)))?;
        c.files = write_array(&json("files"), |a| self.page_files(&page_of(a)))?;
        let (copies, missing) = self.plan_file_copies(&dir.join(FILES_DIR))?;
        Ok((c, copies, missing))
    }

    fn export_notes(&self, dir: &Path) -> Result<u64, StorageError> {
        fs::create_dir(dir).map_err(io_failed)?;
        let mut count = 0;
        let mut after = None;
        loop {
            let page = self.list::<Note>(&page_of(after), false)?;
            for note in &page.items {
                let labels = self.note_label_names(&note.base.id)?;
                let mut text = String::from("---\n");
                text.push_str(&format!("id: {}\n", quoted(&note.base.id)?));
                text.push_str(&format!("title: {}\n", quoted(&note_title(&note.body))?));
                text.push_str(&format!("created_at: {}\n", quoted(&note.base.created_at)?));
                text.push_str(&format!("updated_at: {}\n", quoted(&note.base.updated_at)?));
                text.push_str(&format!(
                    "labels: {}\n",
                    serde_json::to_string(&labels).map_err(json_failed)?
                ));
                text.push_str("---\n\n");
                text.push_str(&note.body);
                if !text.ends_with('\n') {
                    text.push('\n');
                }
                fs::write(dir.join(format!("{}.md", note.base.id)), text).map_err(io_failed)?;
                count += 1;
            }
            match page.next {
                Some(c) => after = Some(c),
                None => break,
            }
        }
        Ok(count)
    }

    fn note_label_names(&self, note_id: &str) -> Result<Vec<String>, StorageError> {
        let mut st = self.conn.prepare_cached(
            "SELECT l.name FROM note_label nl JOIN label l ON l.id = nl.label_id
             WHERE nl.note_id = ?1 AND nl.deleted_at IS NULL AND l.deleted_at IS NULL
             ORDER BY l.name COLLATE NOCASE, l.id",
        )?;
        let rows = st.query_map([note_id], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    fn page_links(&self, page: &PageRequest) -> Result<Page<ExportLink>, StorageError> {
        let (at, id) = match &page.after {
            Some(c) => (Some(c.created_at.as_str()), Some(c.id.as_str())),
            None => (None, None),
        };
        let mut st = self.conn.prepare_cached(
            "SELECT id, a_kind, a_id, b_kind, b_id, created_at, updated_at FROM item_link
             WHERE deleted_at IS NULL AND (?1 IS NULL OR created_at < ?1 OR (created_at = ?1 AND id < ?2))
             ORDER BY created_at DESC, id DESC LIMIT ?3",
        )?;
        let rows = st
            .query_map(params![at, id, page.limit + 1], |r| {
                Ok(ExportLink {
                    id: r.get(0)?,
                    a_kind: r.get(1)?,
                    a_id: r.get(2)?,
                    b_kind: r.get(3)?,
                    b_id: r.get(4)?,
                    created_at: r.get(5)?,
                    updated_at: r.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(super::items::into_page(
            rows,
            page.limit,
            |l: &ExportLink| Cursor {
                created_at: l.created_at.clone(),
                id: l.id.clone(),
            },
        ))
    }

    fn page_files(&self, page: &PageRequest) -> Result<Page<FileRecord>, StorageError> {
        let (at, id) = match &page.after {
            Some(c) => (Some(c.created_at.as_str()), Some(c.id.as_str())),
            None => (None, None),
        };
        let mut st = self.conn.prepare_cached(
            "SELECT id, original_name, size_bytes, mime, created_at, updated_at FROM file
             WHERE deleted_at IS NULL AND (?1 IS NULL OR created_at < ?1 OR (created_at = ?1 AND id < ?2))
             ORDER BY created_at DESC, id DESC LIMIT ?3",
        )?;
        let rows = st
            .query_map(params![at, id, page.limit + 1], |r| {
                Ok(FileRecord {
                    id: r.get(0)?,
                    original_name: r.get(1)?,
                    size_bytes: r.get(2)?,
                    mime: r.get(3)?,
                    created_at: r.get(4)?,
                    updated_at: r.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(super::items::into_page(
            rows,
            page.limit,
            |f: &FileRecord| Cursor {
                created_at: f.created_at.clone(),
                id: f.id.clone(),
            },
        ))
    }

    /// Keeps the whole copy list in memory (two paths per file): accepted, because the
    /// list is small next to the files themselves and it lets the copy run without the lock.
    ///
    /// Lists, for each live record whose file is on disk, where to copy it from and to
    /// (`dest/<disk name>`). Returns that list and how many live records had no file.
    fn plan_file_copies(
        &self,
        dest: &Path,
    ) -> Result<(Vec<(PathBuf, PathBuf)>, u64), StorageError> {
        let mut copies = Vec::new();
        let mut missing = 0;
        let mut after: Option<Cursor> = None;
        loop {
            let page = self.page_files(&page_of(after))?;
            for f in &page.items {
                let stored: String = self.conn.query_row(
                    "SELECT stored_name FROM file WHERE id = ?1",
                    [&f.id],
                    |r| r.get(0),
                )?;
                match self.resolve(&stored) {
                    Ok(src) => copies.push((src, dest.join(&stored))),
                    Err(StorageError::FileMissing) => missing += 1,
                    Err(e) => return Err(e),
                }
            }
            match page.next {
                Some(c) => after = Some(c),
                None => break,
            }
        }
        Ok((copies, missing))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::collections::HashSet;

    use super::super::ideas::IdeaInput;
    use super::super::items::ItemKind;
    use super::super::items::{
        BookmarkInput, EventInput, MemoryInput, NoteInput, ProjectInput, RunInput, RunOutcome,
        TaskInput,
    };
    use super::super::links::ItemRef;
    use super::super::testing::{open_temp, TempDir};
    use super::*;

    const NOW: &str = "2026-11-21T12:00:00Z";

    /// Two live rows and one soft-deleted row of every type. Returns the soft-deleted ids.
    pub(crate) fn seed_all(s: &mut Storage) -> Vec<String> {
        let mut dead = Vec::new();
        for i in 0..3 {
            let b = s
                .add::<Bookmark>(&BookmarkInput {
                    url: format!("https://example.com/{i}"),
                    title: Some(format!("Bookmark {i}")),
                    summary: None,
                    reason: None,
                    reason_is_guess: false,
                })
                .unwrap();
            let n = s
                .add::<Note>(&NoteInput {
                    body: format!("# Note {i}\n\nbody {i}"),
                })
                .unwrap();
            let p = s
                .add::<Project>(&ProjectInput {
                    title: format!("Project {i}"),
                    status: "planned".into(),
                })
                .unwrap();
            let t = s
                .add::<Task>(&TaskInput {
                    title: format!("Task {i}"),
                    done: false,
                })
                .unwrap();
            let e = s
                .add::<Event>(&EventInput {
                    title: format!("Event {i}"),
                    starts_at: "2026-11-21T10:00:00Z".into(),
                    ends_at: "2026-11-21T11:00:00Z".into(),
                })
                .unwrap();
            let r = s
                .add::<Run>(&RunInput {
                    task_type: format!("summary{i}"),
                    started_at: "2026-11-21T10:00:00Z".into(),
                    duration_ms: Some(5),
                    outcome: Some(RunOutcome::Ok),
                    error: None,
                })
                .unwrap();
            let m = s
                .add::<Memory>(&MemoryInput {
                    body: format!("memory {i}"),
                })
                .unwrap();
            let idea = s
                .add_idea(&IdeaInput::titled(&format!("Idea {i}")))
                .unwrap();
            let label = s.create_label(None, &format!("Label {i}")).unwrap();
            let f = s
                .save_file(&format!("f{i}.txt"), format!("blob {i}").as_bytes())
                .unwrap();
            if i == 2 {
                s.delete::<Bookmark>(&b.base.id).unwrap();
                s.delete::<Note>(&n.base.id).unwrap();
                s.delete::<Project>(&p.base.id).unwrap();
                s.delete::<Task>(&t.base.id).unwrap();
                s.delete::<Event>(&e.base.id).unwrap();
                s.delete::<Run>(&r.base.id).unwrap();
                s.delete::<Memory>(&m.base.id).unwrap();
                s.delete_idea(&idea.base.id).unwrap();
                s.delete_label(&label.base.id).unwrap();
                s.delete_file(&f.id).unwrap();
                dead.extend([
                    b.base.id,
                    n.base.id,
                    p.base.id,
                    t.base.id,
                    e.base.id,
                    r.base.id,
                    m.base.id,
                    idea.base.id,
                    label.base.id,
                    f.id,
                ]);
            }
        }
        // Links: three pairs, one removed again.
        let mk = |s: &mut Storage, title: &str| {
            s.add::<Task>(&TaskInput {
                title: title.into(),
                done: false,
            })
            .unwrap()
            .base
            .id
        };
        let mut link_ids = Vec::new();
        for i in 0..3 {
            let a = mk(s, &format!("link a {i}"));
            let b = mk(s, &format!("link b {i}"));
            let l = s
                .add_link(
                    &ItemRef {
                        kind: ItemKind::Task,
                        id: a,
                    },
                    &ItemRef {
                        kind: ItemKind::Task,
                        id: b,
                    },
                )
                .unwrap();
            link_ids.push(l.id);
        }
        s.remove_link(&link_ids[2]).unwrap();
        dead.push(link_ids[2].clone());
        dead
    }

    fn live(s: &Storage, table: &str) -> u64 {
        s.conn
            .query_row(
                &format!("SELECT count(*) FROM {table} WHERE deleted_at IS NULL"),
                [],
                |r| r.get(0),
            )
            .unwrap()
    }

    fn json_len(dir: &Path, name: &str) -> u64 {
        let v: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join(format!("{name}.json"))).unwrap())
                .unwrap();
        v.as_array().unwrap().len() as u64
    }

    pub(crate) fn all_text(dir: &Path, out: &mut String) {
        for e in fs::read_dir(dir).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                all_text(&p, out);
            } else {
                out.push_str(&p.file_name().unwrap().to_string_lossy());
                out.push('\n');
                out.push_str(&String::from_utf8_lossy(&fs::read(&p).unwrap()));
            }
        }
    }

    #[test]
    fn export_counts_match_live_records_for_every_type() {
        let (mut s, _d) = open_temp();
        seed_all(&mut s);
        let out = TempDir::new();
        let sum = s.export_to(out.path(), NOW).unwrap();
        let dir = PathBuf::from(&sum.folder);
        assert_eq!(
            dir.file_name().unwrap().to_string_lossy(),
            "mnemo-export-20261121-120000"
        );
        let md = fs::read_dir(dir.join("notes"))
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .path()
                    .extension()
                    .and_then(|x| x.to_str())
                    == Some("md")
            })
            .count() as u64;
        assert_eq!(md, live(&s, "note"));
        assert_eq!(sum.counts.notes, md);
        let pairs = [
            ("bookmarks", "bookmark", sum.counts.bookmarks),
            ("ideas", "idea", sum.counts.ideas),
            ("projects", "project", sum.counts.projects),
            ("tasks", "task", sum.counts.tasks),
            ("events", "event", sum.counts.events),
            ("runs", "run", sum.counts.runs),
            ("memories", "memory", sum.counts.memories),
            ("labels", "label", sum.counts.labels),
            ("links", "item_link", sum.counts.links),
            ("files", "file", sum.counts.files),
        ];
        for (name, table, reported) in pairs {
            let db = live(&s, table);
            assert!(db >= 2, "{table} needs two live rows in the seed");
            assert_eq!(json_len(&dir, name), db, "{name}.json");
            assert_eq!(reported, db, "{name} in the summary");
        }
        assert_eq!(
            fs::read_dir(dir.join("files")).unwrap().count() as u64,
            live(&s, "file")
        );
        assert_eq!(sum.files_missing, 0);
    }

    #[test]
    fn export_leaves_out_soft_deleted_rows() {
        let (mut s, _d) = open_temp();
        let dead = seed_all(&mut s);
        let out = TempDir::new();
        let sum = s.export_to(out.path(), NOW).unwrap();
        let mut text = String::new();
        all_text(Path::new(&sum.folder), &mut text);
        for id in &dead {
            assert!(
                !text.contains(id.as_str()),
                "soft-deleted {id} was exported"
            );
        }
        assert!(!text.contains("blob 2"), "a soft-deleted blob was copied");
        let stored: HashSet<String> = fs::read_dir(Path::new(&sum.folder).join("files"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(stored.len(), 2);
    }

    #[test]
    fn a_second_export_never_overwrites_the_first() {
        let (mut s, _d) = open_temp();
        seed_all(&mut s);
        let out = TempDir::new();
        let first = s.export_to(out.path(), NOW).unwrap();
        let mut before = String::new();
        all_text(Path::new(&first.folder), &mut before);
        let second = s.export_to(out.path(), NOW).unwrap();
        assert_ne!(first.folder, second.folder);
        assert!(Path::new(&second.folder).is_dir());
        let mut after = String::new();
        all_text(Path::new(&first.folder), &mut after);
        assert_eq!(before, after, "the first export changed");
        assert_eq!(fs::read_dir(out.path()).unwrap().count(), 2);
    }

    #[test]
    fn export_refuses_a_missing_or_non_folder_target() {
        let (s, d) = open_temp();
        let missing = d.path().join("nope");
        assert!(matches!(
            s.export_to(&missing, NOW),
            Err(ExportError::Target(_))
        ));
        assert!(!missing.exists(), "the missing folder was created");
        let file = d.path().join("a-file");
        fs::write(&file, b"x").unwrap();
        assert!(matches!(
            s.export_to(&file, NOW),
            Err(ExportError::Target(_))
        ));
    }

    #[test]
    fn the_file_copy_runs_without_the_storage() {
        let (s, d) = open_temp();
        let rec = s.save_file("a.bin", &[1, 2, 3]).unwrap();
        let out = TempDir::new();
        let job = s.export_begin(out.path(), NOW).unwrap();
        // The storage is gone (its lock would be free); the copy still finishes.
        drop(s);
        let sum = job.finish().unwrap();
        assert_eq!(sum.counts.files, 1);
        assert_eq!(sum.files_missing, 0);
        let copied: Vec<_> = fs::read_dir(Path::new(&sum.folder).join("files"))
            .unwrap()
            .collect();
        assert_eq!(copied.len(), 1);
        assert!(!rec.id.is_empty());
        drop(d);
    }

    #[test]
    fn a_failed_copy_removes_the_folder_and_says_so() {
        let (s, _d) = open_temp();
        s.save_file("a.bin", &[1, 2, 3]).unwrap();
        let out = TempDir::new();
        let job = s.export_begin(out.path(), NOW).unwrap();
        // A files folder that is already there makes the copy fail (not a vanished source).
        fs::create_dir(job.dir.join(FILES_DIR)).unwrap();
        let folder = job.dir.clone();
        match job.finish() {
            Err(ExportError::Failed { folder: state, .. }) => {
                assert_eq!(state, FolderState::Removed)
            }
            other => panic!("{other:?}"),
        }
        assert!(!folder.exists());
    }

    #[test]
    fn a_folder_that_is_already_gone_counts_as_removed() {
        let e = fail_and_clean(
            Path::new("/nonexistent-mnemo-dir/x"),
            StorageError::FileMissing,
        );
        assert!(matches!(
            e,
            ExportError::Failed {
                folder: FolderState::Removed,
                ..
            }
        ));
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_write_that_cannot_clean_up_says_the_folder_is_left() {
        use std::os::unix::fs::PermissionsExt;
        let parent = TempDir::new();
        let dir = parent.path().join("export");
        fs::create_dir(&dir).unwrap();
        fs::write(dir.join("a.json"), b"x").unwrap();
        // A read-only parent: the folder cannot be unlinked from it.
        fs::set_permissions(parent.path(), fs::Permissions::from_mode(0o555)).unwrap();
        let writable = fs::write(parent.path().join("probe"), b"x").is_ok();
        let e = fail_and_clean(&dir, StorageError::FileMissing);
        fs::set_permissions(parent.path(), fs::Permissions::from_mode(0o755)).unwrap();
        if writable {
            return; // running as root: permissions do not apply
        }
        assert!(matches!(
            e,
            ExportError::Failed {
                folder: FolderState::Left,
                ..
            }
        ));
    }

    #[test]
    fn a_file_that_vanishes_after_planning_counts_as_missing() {
        let (s, _d) = open_temp();
        s.save_file("a.txt", b"hello").unwrap();
        let out = TempDir::new();
        let job = s.export_begin(out.path(), NOW).unwrap();
        for (src, _) in &job.copies {
            fs::remove_file(src).unwrap();
        }
        assert_eq!(job.copies.len(), 1);
        let sum = job.finish().unwrap();
        assert_eq!(sum.files_missing, 1);
    }

    #[test]
    fn a_note_file_has_front_matter_labels_and_body() {
        let (mut s, _d) = open_temp();
        let label = s.create_label(None, "Work").unwrap();
        let n = s
            .save_labelled_note(None, "# Plan\n\nText", std::slice::from_ref(&label.base.id))
            .unwrap();
        let out = TempDir::new();
        let sum = s.export_to(out.path(), NOW).unwrap();
        let id = n.note.base.id;
        let text = fs::read_to_string(
            Path::new(&sum.folder)
                .join("notes")
                .join(format!("{id}.md")),
        )
        .unwrap();
        assert!(text.starts_with("---\n"));
        assert!(text.contains("title: \"Plan\""));
        assert!(text.contains("labels: [\"Work\"]"));
        assert!(text.ends_with("# Plan\n\nText\n"));
    }

    #[test]
    fn a_live_file_record_with_no_file_is_counted_not_hidden() {
        let (s, d) = open_temp();
        let rec = s.save_file("gone.txt", b"x").unwrap();
        let stored: String = s
            .conn
            .query_row(
                "SELECT stored_name FROM file WHERE id = ?1",
                [&rec.id],
                |r| r.get(0),
            )
            .unwrap();
        fs::remove_file(d.path().join("files").join(stored)).unwrap();
        let out = TempDir::new();
        let sum = s.export_to(out.path(), NOW).unwrap();
        assert_eq!(sum.files_missing, 1);
        assert_eq!(sum.counts.files, 1);
    }
}
