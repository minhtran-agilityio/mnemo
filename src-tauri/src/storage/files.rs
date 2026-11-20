//! Images and attached files: plain files in one `files/` folder beside the database.
//! The database keeps the original name and metadata; the disk name is a UUID plus an
//! optional extension. Only this module builds a path inside the folder, and it never
//! returns a path to a caller: a read goes by file id and stays inside the folder.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use rusqlite::OptionalExtension;
use serde::Serialize;
use uuid::Uuid;

use super::error::StorageError;
use super::record::now_iso;
use super::Storage;

/// The folder name beside the database file.
pub const FILES_DIR: &str = "files";

/// The size limit when the setting is missing or not usable. The 20 MB value is a
/// guess by the ticket author, **Unverified** as the right limit.
pub const DEFAULT_MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;

/// The setting that holds the limit, in bytes.
const MAX_BYTES_SETTING: &str = "files.max_bytes";

/// The most orphan files one report lists.
const MAX_ORPHANS: usize = 1000;

const MAX_NAME_CHARS: usize = 255;
const MAX_EXT_CHARS: usize = 10;

/// What the UI may know about a saved file. The disk name is not part of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRecord {
    pub id: String,
    pub original_name: String,
    pub size_bytes: u64,
    pub mime: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A file in the folder that no row owns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrphanFile {
    pub name: String,
    pub size_bytes: u64,
}

/// The clean-up report: it only lists, it deletes nothing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrphanReport {
    pub files: Vec<OrphanFile>,
    /// True when more than the listed files are orphans.
    pub truncated: bool,
}

/// True when `s` has the shape of a file id (a hyphenated UUID). The command layer
/// checks this first, so a path-like text never reaches storage.
pub fn is_file_id(s: &str) -> bool {
    s.len() == 36 && Uuid::parse_str(s).is_ok()
}

fn io_failed(e: io::Error) -> StorageError {
    StorageError::Files(e.kind().to_string())
}

/// Checks the name the owner's file had and keeps its last path component. The result
/// is for display only and is never used as a disk name.
fn clean_original_name(name: &str) -> Result<String, StorageError> {
    if name.is_empty()
        || name.chars().count() > MAX_NAME_CHARS
        || name.chars().any(char::is_control)
    {
        return Err(StorageError::InvalidFileName);
    }
    let last = name.rsplit(['/', '\\']).next().unwrap_or("");
    if last.is_empty() || last == "." || last == ".." {
        return Err(StorageError::InvalidFileName);
    }
    Ok(last.to_string())
}

/// The lowercased extension when it is 1 to 10 ASCII letters or digits.
fn safe_extension(name: &str) -> Option<String> {
    let ext = Path::new(name).extension()?.to_str()?.to_ascii_lowercase();
    let ok = !ext.is_empty()
        && ext.len() <= MAX_EXT_CHARS
        && ext.chars().all(|c| c.is_ascii_alphanumeric());
    ok.then_some(ext)
}

fn guess_mime(ext: Option<&str>) -> Option<&'static str> {
    match ext? {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "pdf" => Some("application/pdf"),
        "txt" => Some("text/plain"),
        "md" => Some("text/markdown"),
        _ => None,
    }
}

const FILE_COLUMNS: &str = "id, original_name, size_bytes, mime, created_at, updated_at";

fn record_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<FileRecord> {
    Ok(FileRecord {
        id: r.get(0)?,
        original_name: r.get(1)?,
        size_bytes: r.get(2)?,
        mime: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

impl Storage {
    /// The size limit in bytes: the `files.max_bytes` setting, or the default when it
    /// is missing or not a positive whole number.
    pub fn max_file_bytes(&self) -> Result<u64, StorageError> {
        match self.get_setting(MAX_BYTES_SETTING)? {
            None => Ok(DEFAULT_MAX_FILE_BYTES),
            Some(text) => match text.trim().parse::<u64>() {
                Ok(n) if n > 0 => Ok(n),
                _ => {
                    log::warn!(
                        "{MAX_BYTES_SETTING} is not a positive whole number; using the default"
                    );
                    Ok(DEFAULT_MAX_FILE_BYTES)
                }
            },
        }
    }

    /// Saves `bytes` as a new file. The size is checked before the folder or any file
    /// is made. The file is written under a temporary name, renamed, and then the row
    /// is added; if the row fails, the file is removed again.
    pub fn save_file(&self, original_name: &str, bytes: &[u8]) -> Result<FileRecord, StorageError> {
        let original = clean_original_name(original_name)?;
        let limit = self.max_file_bytes()?;
        if bytes.len() as u64 > limit {
            return Err(StorageError::FileTooLarge { limit_bytes: limit });
        }
        let ext = safe_extension(&original);
        let id = Uuid::new_v4().to_string();
        let stored = match &ext {
            Some(e) => format!("{id}.{e}"),
            None => id.clone(),
        };
        fs::create_dir_all(&self.files_dir).map_err(io_failed)?;
        let part = self.files_dir.join(format!(".{id}.part"));
        let dest = self.files_dir.join(&stored);
        if let Err(e) = fs::write(&part, bytes) {
            let _ = fs::remove_file(&part);
            return Err(io_failed(e));
        }
        if let Err(e) = fs::rename(&part, &dest) {
            let _ = fs::remove_file(&part);
            return Err(io_failed(e));
        }
        let now = now_iso();
        let mime = guess_mime(ext.as_deref());
        let inserted = self.conn.execute(
            "INSERT INTO file (id, original_name, stored_name, size_bytes, mime, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            rusqlite::params![id, original, stored, bytes.len() as i64, mime, now],
        );
        if let Err(e) = inserted {
            let _ = fs::remove_file(&dest);
            return Err(e.into());
        }
        Ok(FileRecord {
            id,
            original_name: original,
            size_bytes: bytes.len() as u64,
            mime: mime.map(str::to_string),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    /// The saved file's details. A deleted or unknown id gives `NotFound`.
    pub fn get_file(&self, id: &str) -> Result<FileRecord, StorageError> {
        self.conn
            .query_row(
                &format!("SELECT {FILE_COLUMNS} FROM file WHERE id = ?1 AND deleted_at IS NULL"),
                [id],
                record_from_row,
            )
            .optional()?
            .ok_or(StorageError::NotFound { kind: "file" })
    }

    /// The saved file's bytes. The disk name comes from the row, never from the caller,
    /// and is resolved inside the files folder.
    pub fn read_file(&self, id: &str) -> Result<Vec<u8>, StorageError> {
        let stored: String = self
            .conn
            .query_row(
                "SELECT stored_name FROM file WHERE id = ?1 AND deleted_at IS NULL",
                [id],
                |r| r.get(0),
            )
            .optional()?
            .ok_or(StorageError::NotFound { kind: "file" })?;
        let path = self.resolve(&stored)?;
        fs::read(path).map_err(io_failed)
    }

    /// Soft-deletes the row. The file stays on disk until the owner removes it.
    pub fn delete_file(&self, id: &str) -> Result<(), StorageError> {
        let now = now_iso();
        let changed = self.conn.execute(
            "UPDATE file SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
            rusqlite::params![id, now],
        )?;
        if changed == 0 {
            return Err(StorageError::NotFound { kind: "file" });
        }
        Ok(())
    }

    /// The path of a stored name inside the files folder. A name with a separator, a
    /// parent step, a root or a NUL is refused, and the real path (after links are
    /// followed) must still be inside the folder.
    fn resolve(&self, stored_name: &str) -> Result<PathBuf, StorageError> {
        if stored_name.is_empty()
            || stored_name == "."
            || stored_name == ".."
            || stored_name.contains(['/', '\\', '\0'])
        {
            return Err(StorageError::InvalidFileName);
        }
        let name = Path::new(stored_name);
        let mut parts = name.components();
        let single_normal = matches!(
            (parts.next(), parts.next()),
            (Some(Component::Normal(_)), None)
        );
        if name.is_absolute() || !single_normal {
            return Err(StorageError::InvalidFileName);
        }
        let not_found = |e: io::Error| match e.kind() {
            io::ErrorKind::NotFound => StorageError::NotFound { kind: "file" },
            _ => io_failed(e),
        };
        let root = fs::canonicalize(&self.files_dir).map_err(not_found)?;
        let full = fs::canonicalize(root.join(stored_name)).map_err(not_found)?;
        if !full.starts_with(&root) {
            return Err(StorageError::InvalidFileName);
        }
        Ok(full)
    }

    /// Lists files in the folder that no row owns (rows with `deleted_at` still own
    /// theirs). Leftover temporary files are listed too. It deletes nothing.
    pub fn orphan_report(&self) -> Result<OrphanReport, StorageError> {
        let mut owned = HashSet::new();
        {
            let mut st = self.conn.prepare("SELECT stored_name FROM file")?;
            for name in st.query_map([], |r| r.get::<_, String>(0))? {
                owned.insert(name?);
            }
        }
        let entries = match fs::read_dir(&self.files_dir) {
            Ok(e) => e,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                return Ok(OrphanReport {
                    files: Vec::new(),
                    truncated: false,
                })
            }
            Err(e) => return Err(io_failed(e)),
        };
        let mut files = Vec::new();
        for entry in entries {
            let entry = entry.map_err(io_failed)?;
            let meta = entry.metadata().map_err(io_failed)?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry.file_type().map_err(io_failed)?.is_file() && !owned.contains(&name) {
                files.push(OrphanFile {
                    name,
                    size_bytes: meta.len(),
                });
            }
        }
        files.sort_by(|a, b| a.name.cmp(&b.name));
        let truncated = files.len() > MAX_ORPHANS;
        files.truncate(MAX_ORPHANS);
        Ok(OrphanReport { files, truncated })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::testing::open_temp;

    fn image_bytes() -> Vec<u8> {
        let mut b = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        b.extend(0..=255u8);
        b
    }

    fn files_dir(dir: &crate::storage::testing::TempDir) -> PathBuf {
        dir.path().join(FILES_DIR)
    }

    fn file_rows(s: &Storage) -> i64 {
        s.conn
            .query_row("SELECT count(*) FROM file", [], |r| r.get(0))
            .unwrap()
    }

    fn stored_name(s: &Storage, id: &str) -> String {
        s.conn
            .query_row("SELECT stored_name FROM file WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .unwrap()
    }

    #[test]
    fn saved_image_reads_back_byte_for_byte() {
        let (s, _d) = open_temp();
        let bytes = image_bytes();
        let rec = s.save_file("photo.PNG", &bytes).unwrap();
        assert_eq!(rec.original_name, "photo.PNG");
        assert_eq!(rec.size_bytes, bytes.len() as u64);
        assert_eq!(rec.mime.as_deref(), Some("image/png"));
        assert_eq!(s.read_file(&rec.id).unwrap(), bytes);
        assert_eq!(s.get_file(&rec.id).unwrap(), rec);
    }

    #[test]
    fn two_files_with_the_same_name_do_not_overwrite() {
        let (s, d) = open_temp();
        let a = s.save_file("photo.png", b"first").unwrap();
        let b = s.save_file("photo.png", b"second").unwrap();
        assert_ne!(a.id, b.id);
        let (na, nb) = (stored_name(&s, &a.id), stored_name(&s, &b.id));
        assert_ne!(na, nb);
        assert_eq!(fs::read(files_dir(&d).join(&na)).unwrap(), b"first");
        assert_eq!(fs::read(files_dir(&d).join(&nb)).unwrap(), b"second");
        assert_eq!(s.read_file(&a.id).unwrap(), b"first");
        assert_eq!(s.read_file(&b.id).unwrap(), b"second");
        assert_eq!(s.get_file(&a.id).unwrap().original_name, "photo.png");
        assert_eq!(s.get_file(&b.id).unwrap().original_name, "photo.png");
    }

    #[test]
    fn a_file_over_the_limit_is_refused_and_leaves_nothing() {
        let (s, d) = open_temp();
        s.set_setting("files.max_bytes", "10").unwrap();
        let err = s.save_file("big.bin", &[7u8; 11]).unwrap_err();
        assert_eq!(err, StorageError::FileTooLarge { limit_bytes: 10 });
        assert!(err.to_string().contains("10 bytes"), "{err}");
        assert_eq!(file_rows(&s), 0);
        let left = fs::read_dir(files_dir(&d)).map(|r| r.count()).unwrap_or(0);
        assert_eq!(left, 0);
        // A file at the limit is accepted.
        s.save_file("ok.bin", &[7u8; 10]).unwrap();
    }

    #[test]
    fn the_limit_message_names_megabytes() {
        let err = StorageError::FileTooLarge {
            limit_bytes: DEFAULT_MAX_FILE_BYTES,
        };
        assert_eq!(
            err.to_string(),
            "This file is larger than the limit of 20 MB. Choose a smaller file."
        );
    }

    #[test]
    fn the_limit_defaults_to_20_mb() {
        let (s, _d) = open_temp();
        assert_eq!(s.max_file_bytes().unwrap(), 20 * 1024 * 1024);
        s.set_setting("files.max_bytes", "1048576").unwrap();
        assert_eq!(s.max_file_bytes().unwrap(), 1_048_576);
    }

    #[test]
    fn a_bad_limit_setting_falls_back_to_the_default() {
        let (s, _d) = open_temp();
        for bad in ["", "0", "-5", "abc", "1.5", "20MB"] {
            s.set_setting("files.max_bytes", bad).unwrap();
            assert_eq!(s.max_file_bytes().unwrap(), DEFAULT_MAX_FILE_BYTES, "{bad}");
        }
    }

    #[test]
    fn soft_delete_hides_the_row_and_keeps_the_file() {
        let (s, d) = open_temp();
        let rec = s.save_file("note.txt", b"keep me").unwrap();
        let on_disk = files_dir(&d).join(stored_name(&s, &rec.id));
        s.delete_file(&rec.id).unwrap();
        assert_eq!(
            s.get_file(&rec.id).unwrap_err(),
            StorageError::NotFound { kind: "file" }
        );
        assert_eq!(
            s.read_file(&rec.id).unwrap_err(),
            StorageError::NotFound { kind: "file" }
        );
        let deleted: Option<String> = s
            .conn
            .query_row(
                "SELECT deleted_at FROM file WHERE id = ?1",
                [&rec.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(deleted.is_some());
        assert_eq!(fs::read(on_disk).unwrap(), b"keep me");
        assert_eq!(
            s.delete_file(&rec.id).unwrap_err(),
            StorageError::NotFound { kind: "file" }
        );
    }

    #[test]
    fn an_empty_or_control_char_name_is_refused() {
        let (s, d) = open_temp();
        for bad in ["", "a\nb.png", "a\0b", "dir/", "..", &"x".repeat(256)] {
            assert_eq!(
                s.save_file(bad, b"x").unwrap_err(),
                StorageError::InvalidFileName,
                "{bad:?}"
            );
        }
        assert_eq!(file_rows(&s), 0);
        assert!(!files_dir(&d).exists());
    }

    #[test]
    fn a_path_in_the_original_name_keeps_only_the_last_part_and_never_names_the_disk_file() {
        let (s, d) = open_temp();
        let rec = s.save_file("../../evil/pic.JPG", b"x").unwrap();
        assert_eq!(rec.original_name, "pic.JPG");
        let stored = stored_name(&s, &rec.id);
        assert!(stored.ends_with(".jpg") && !stored.contains("pic"));
        assert!(files_dir(&d).join(stored).exists());
        let odd = s.save_file("archive.tar.gz?x", b"y").unwrap();
        assert_eq!(stored_name(&s, &odd.id), odd.id, "bad extension is dropped");
        assert_eq!(odd.mime, None);
    }

    #[test]
    fn resolve_refuses_parent_absolute_and_separator_names() {
        let (s, _d) = open_temp();
        for bad in ["../x", "..", ".", "/etc/passwd", "a/b", "a\\b", "", "a\0b"] {
            assert_eq!(
                s.resolve(bad).unwrap_err(),
                StorageError::InvalidFileName,
                "{bad:?}"
            );
        }
    }

    #[test]
    fn a_row_pointing_outside_the_folder_is_not_read() {
        let (s, d) = open_temp();
        fs::write(d.path().join("outside.txt"), b"secret").unwrap();
        s.save_file("real.txt", b"real").unwrap();
        s.conn
            .execute(
                "INSERT INTO file (id, original_name, stored_name, size_bytes, created_at, updated_at)
                 VALUES ('evil', 'outside.txt', '../outside.txt', 6, 'x', 'x')",
                [],
            )
            .unwrap();
        assert_eq!(
            s.read_file("evil").unwrap_err(),
            StorageError::InvalidFileName
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_folder_is_refused() {
        let (s, d) = open_temp();
        s.save_file("real.txt", b"real").unwrap();
        fs::write(d.path().join("outside.txt"), b"secret").unwrap();
        std::os::unix::fs::symlink(d.path().join("outside.txt"), files_dir(&d).join("link"))
            .unwrap();
        s.conn
            .execute(
                "INSERT INTO file (id, original_name, stored_name, size_bytes, created_at, updated_at)
                 VALUES ('lnk', 'link', 'link', 6, 'x', 'x')",
                [],
            )
            .unwrap();
        assert_eq!(
            s.read_file("lnk").unwrap_err(),
            StorageError::InvalidFileName
        );
    }

    #[test]
    fn a_row_whose_file_is_missing_gives_not_found() {
        let (s, d) = open_temp();
        let rec = s.save_file("a.txt", b"a").unwrap();
        fs::remove_file(files_dir(&d).join(stored_name(&s, &rec.id))).unwrap();
        assert_eq!(
            s.read_file(&rec.id).unwrap_err(),
            StorageError::NotFound { kind: "file" }
        );
    }

    #[test]
    fn is_file_id_accepts_only_uuids() {
        assert!(is_file_id(&Uuid::new_v4().to_string()));
        for bad in ["", "../mnemo.db", "/etc/passwd", "a/b", "not-a-uuid"] {
            assert!(!is_file_id(bad), "{bad}");
        }
    }

    #[test]
    fn orphan_report_lists_a_planted_orphan_and_deletes_nothing() {
        let (s, d) = open_temp();
        let a = s.save_file("a.txt", b"aaa").unwrap();
        let b = s.save_file("b.txt", b"bbb").unwrap();
        s.delete_file(&b.id).unwrap();
        fs::write(files_dir(&d).join("stray.bin"), b"stray").unwrap();
        let report = s.orphan_report().unwrap();
        assert_eq!(
            report,
            OrphanReport {
                files: vec![OrphanFile {
                    name: "stray.bin".to_string(),
                    size_bytes: 5
                }],
                truncated: false
            }
        );
        assert_eq!(s.read_file(&a.id).unwrap(), b"aaa");
        assert_eq!(
            fs::read(files_dir(&d).join(stored_name(&s, &b.id))).unwrap(),
            b"bbb"
        );
        assert_eq!(fs::read(files_dir(&d).join("stray.bin")).unwrap(), b"stray");
    }

    #[test]
    fn orphan_report_on_a_new_database_is_empty() {
        let (s, _d) = open_temp();
        let report = s.orphan_report().unwrap();
        assert!(report.files.is_empty() && !report.truncated);
    }
}
