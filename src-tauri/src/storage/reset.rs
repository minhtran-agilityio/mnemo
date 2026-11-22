//! Reset: deletes the whole database and the files folder, then opens an empty database
//! the same as a fresh install. It runs only with the exact confirm word and makes no backup.

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::Path;

use rusqlite::Connection;

use super::error::StorageError;
use super::Storage;

/// The word the owner types to confirm a reset.
pub const RESET_WORD: &str = "RESET";

fn io_failed(e: io::Error) -> StorageError {
    StorageError::Files(e.kind().to_string())
}

/// Removes a file; a file that is not there is fine.
fn remove_file(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

fn with_suffix(path: &Path, suffix: &str) -> std::path::PathBuf {
    let mut s: OsString = path.as_os_str().to_owned();
    s.push(suffix);
    s.into()
}

impl Storage {
    /// Deletes every row, the settings and the files folder, then reopens an empty
    /// database. With any `confirm` other than `RESET_WORD` nothing is touched. The
    /// storage lock is held by the caller for the whole call. If a delete fails, what is
    /// left is still reopened so the app keeps a connection, and the error is returned.
    pub fn reset(&mut self, confirm: &str) -> Result<(), StorageError> {
        if confirm != RESET_WORD {
            return Err(StorageError::Invalid(
                "Type RESET to confirm. Nothing was deleted.".into(),
            ));
        }
        let db_path = self.db_path.clone();
        let files_dir = self.files_dir.clone();
        // Close the live connection first, so the database file is not in use.
        self.conn = Connection::open_in_memory()?;
        let mut failed = None;
        for suffix in ["", "-wal", "-shm"] {
            if let Err(e) = remove_file(&with_suffix(&db_path, suffix)) {
                failed.get_or_insert(io_failed(e));
            }
        }
        if let Err(e) = match fs::remove_dir_all(&files_dir) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        } {
            failed.get_or_insert(io_failed(e));
        }
        *self = Storage::open(&db_path)?;
        match failed {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::super::export::tests::{all_text, seed_all};
    use super::super::testing::{open_temp, TempDir};
    use super::*;
    use crate::storage::items::{Note, NoteInput};

    const NOW: &str = "2026-11-21T12:00:00Z";

    /// Every user table with its row count, and the sorted table names.
    fn shape(s: &Storage) -> (Vec<String>, Vec<(String, i64)>) {
        let mut st = s
            .conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .unwrap();
        let names: Vec<String> = st
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let counts = names
            .iter()
            .map(|n| {
                let c: i64 = s
                    .conn
                    .query_row(&format!("SELECT count(*) FROM \"{n}\""), [], |r| r.get(0))
                    .unwrap();
                (n.clone(), c)
            })
            .collect();
        (names, counts)
    }

    fn files_in(dir: &Path) -> usize {
        fs::read_dir(dir).map(|d| d.count()).unwrap_or(0)
    }

    #[test]
    fn reset_without_the_word_keeps_all_data() {
        let (mut s, d) = open_temp();
        seed_all(&mut s);
        s.set_setting("theme", "dark").unwrap();
        let before = shape(&s);
        let blobs = files_in(&d.path().join("files"));
        assert!(blobs > 0);
        for word in ["", "reset", "RESET ", " RESET", "Reset"] {
            let err = s.reset(word).unwrap_err();
            assert!(matches!(err, StorageError::Invalid(_)), "{word:?}");
            assert_eq!(shape(&s), before, "{word:?}");
            assert_eq!(files_in(&d.path().join("files")), blobs, "{word:?}");
        }
        assert_eq!(s.get_setting("theme").unwrap().as_deref(), Some("dark"));
    }

    #[test]
    fn confirmed_reset_equals_a_fresh_install() {
        let (mut s, d) = open_temp();
        seed_all(&mut s);
        s.set_setting("theme", "dark").unwrap();
        s.reset(RESET_WORD).unwrap();

        let (fresh, _fd) = open_temp();
        assert_eq!(s.schema_version().unwrap(), fresh.schema_version().unwrap());
        let (names, counts) = shape(&s);
        let (fresh_names, _) = shape(&fresh);
        assert_eq!(names, fresh_names);
        assert!(counts.iter().all(|(_, c)| *c == 0), "{counts:?}");
        assert_eq!(s.get_setting("theme").unwrap(), None);
        assert_eq!(files_in(&d.path().join("files")), 0);
        assert!(!d.path().join("files").exists() || files_in(&d.path().join("files")) == 0);
        assert_eq!(s.journal_mode().unwrap(), "wal");
    }

    #[test]
    fn storage_works_after_reset() {
        let (mut s, _d) = open_temp();
        seed_all(&mut s);
        s.reset(RESET_WORD).unwrap();
        let n = s
            .add::<Note>(&NoteInput {
                body: "after".into(),
            })
            .unwrap();
        assert_eq!(s.get::<Note>(&n.base.id).unwrap().body, "after");
        let f = s.save_file("a.txt", b"hello").unwrap();
        assert_eq!(s.read_file(&f.id).unwrap(), b"hello");
        // A second reset works too.
        s.reset(RESET_WORD).unwrap();
    }

    fn copy_dir(from: &Path, to: &Path) {
        fs::create_dir_all(to).unwrap();
        for e in fs::read_dir(from).unwrap() {
            let e = e.unwrap();
            let dest: PathBuf = to.join(e.file_name());
            if e.path().is_dir() {
                copy_dir(&e.path(), &dest);
            } else {
                fs::copy(e.path(), dest).unwrap();
            }
        }
    }

    #[test]
    fn restore_of_a_copied_data_folder_opens_with_all_data() {
        let (mut s, d) = open_temp();
        let dead = seed_all(&mut s);
        let rec = s.save_file("keep.bin", &[0, 1, 2, 255]).unwrap();
        let out1 = TempDir::new();
        let before = s.export_to(out1.path(), NOW).unwrap();
        // Closing Mnemo, then copying the whole folder.
        drop(s);
        let backup = TempDir::new();
        let copy = backup.path().join("mnemo-backup");
        copy_dir(d.path(), &copy);
        let restored = Storage::open(&copy.join("mnemo.db")).unwrap();
        assert_eq!(restored.read_file(&rec.id).unwrap(), vec![0, 1, 2, 255]);
        let out2 = TempDir::new();
        let after = restored.export_to(out2.path(), NOW).unwrap();
        assert_eq!(before.counts, after.counts);
        let (mut a, mut b) = (String::new(), String::new());
        all_text(Path::new(&before.folder), &mut a);
        all_text(Path::new(&after.folder), &mut b);
        assert_eq!(a, b, "the restored data differs");
        assert!(!dead.is_empty());
    }
}
