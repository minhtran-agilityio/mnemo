// Owns persistence: reading and writing Mnemo's local data. The only module that touches SQLite.
pub mod ai_control;
pub mod bookmarks;
#[cfg(test)]
mod concurrency;
mod error;
pub mod export;
pub mod files;
pub mod folders;
pub mod ideas;
pub mod items;
pub mod labels;
mod link_key;
pub mod links;
mod migrate;
pub mod record;
mod reset;
pub mod runs;
mod settings;

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::Connection;

pub use error::StorageError;
pub use files::FileRecord;
pub use items::Item;
pub use links::ItemRef;
pub use record::PageRequest;

/// How long a writer waits for another writer before giving up.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// The open Mnemo database.
pub struct Storage {
    conn: Connection,
    /// The folder for images and attachments, beside the database. Made on the first save.
    files_dir: PathBuf,
    /// The database file, kept so Reset can delete it and open a new one.
    db_path: PathBuf,
    /// Set when a Reset deleted the data but could not open a new database. The
    /// connection is then an empty stand-in; callers must treat the storage as down.
    unavailable: bool,
    /// The one step of Undo (#26): the last bookmark move or delete. Held in memory only, so it is
    /// lost when the app closes.
    undo: Option<folders::Undo>,
}

#[allow(dead_code)] // Status readers; callers arrive with later tickets.
impl Storage {
    /// Opens (or creates) the database at `path`, turns on WAL mode and the busy
    /// timeout, and runs pending migrations. A file that is not a database gives
    /// `StorageError::Open`; it is never deleted or replaced. Runs left in running or
    /// waiting by an app that closed are then marked failed ("app closed").
    pub fn open(path: &Path) -> Result<Storage, StorageError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| StorageError::Open(e.to_string()))?;
        }
        let mut conn = Connection::open(path).map_err(|e| StorageError::Open(e.to_string()))?;
        conn.busy_timeout(BUSY_TIMEOUT)
            .map_err(|e| StorageError::Open(e.to_string()))?;
        // Refuse a file from a newer Mnemo before anything is written to it: turning on
        // WAL changes the file header and adds -wal/-shm files. The first read of the
        // file also fails here when it is not a database.
        let found =
            migrate::current_version(&conn).map_err(|e| StorageError::Open(e.to_string()))?;
        migrate::check_supported(found, migrate::MIGRATIONS)?;
        let mode: String = conn
            .query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))
            .map_err(|e| StorageError::Open(e.to_string()))?;
        if !mode.eq_ignore_ascii_case("wal") {
            return Err(StorageError::Open(format!(
                "could not turn on WAL mode (got {mode})"
            )));
        }
        // WAL with NORMAL syncs the log less often, so a commit holds the write lock for
        // a shorter time and a busy disk does not push a waiting writer past the busy
        // timeout. A power cut can lose the last commits; it cannot corrupt the file.
        conn.execute_batch("PRAGMA synchronous = NORMAL")
            .map_err(|e| StorageError::Open(e.to_string()))?;
        migrate::run(&mut conn, migrate::MIGRATIONS)?;
        let files_dir = path
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join(files::FILES_DIR);
        let mut storage = Storage {
            conn,
            files_dir,
            db_path: path.to_path_buf(),
            unavailable: false,
            undo: None,
        };
        // The app holds one storage, opened before any run is queued, so a run still in
        // running or waiting here was left by an app that closed. A failure is logged and
        // does not stop the app: the rows stay as they are until the next start.
        match storage.fail_interrupted_runs(&record::now_iso()) {
            Ok(0) => {}
            Ok(n) => log::info!("marked {n} interrupted AI runs as failed (app closed)"),
            Err(e) => log::error!("could not mark interrupted AI runs as failed: {e}"),
        }
        // Bookmarks saved before the compare key existed get theirs, so the duplicate check sees
        // them (#28). A failure is logged: those rows stay unkeyed until the next open.
        match storage.fill_compare_keys() {
            Ok(0) => {}
            Ok(n) => log::info!("{n} bookmarks got their compare key"),
            Err(e) => log::error!("could not fill the compare key of old bookmarks: {e}"),
        }
        // The same for a page read a closed app left going: back to "no summary yet".
        match storage.reset_reading_bookmarks_at(&record::now_iso()) {
            Ok(0) => {}
            Ok(n) => log::info!("{n} bookmarks left reading were set back to pending"),
            Err(e) => log::error!("could not reset bookmarks left reading: {e}"),
        }
        Ok(storage)
    }

    /// True after a failed Reset left no usable database. The app must be restarted.
    pub fn is_unavailable(&self) -> bool {
        self.unavailable
    }

    /// The journal mode in use. Expected to be "wal".
    pub fn journal_mode(&self) -> Result<String, StorageError> {
        Ok(self
            .conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))?)
    }

    /// The busy timeout in milliseconds.
    pub fn busy_timeout_ms(&self) -> Result<u64, StorageError> {
        Ok(self
            .conn
            .query_row("PRAGMA busy_timeout", [], |r| r.get(0))?)
    }

    /// The synchronous level: 0 OFF, 1 NORMAL, 2 FULL. Expected to be 1.
    pub fn synchronous_level(&self) -> Result<u32, StorageError> {
        Ok(self
            .conn
            .query_row("PRAGMA synchronous", [], |r| r.get(0))?)
    }

    /// Rolls back a transaction left open by code that panicked while holding the
    /// storage lock, so the next caller starts from the last committed state.
    pub fn recover_after_panic(&self) -> Result<(), StorageError> {
        if !self.conn.is_autocommit() {
            self.conn.execute_batch("ROLLBACK")?;
        }
        Ok(())
    }

    /// The schema version stored in the database.
    pub fn schema_version(&self) -> Result<u32, StorageError> {
        migrate::current_version(&self.conn)
    }
}

/// Temporary databases for tests: std only, removed on drop. Tests never touch the
/// real data folder.
#[cfg(test)]
pub(crate) mod testing {
    use std::path::{Path, PathBuf};

    use super::Storage;

    pub struct TempDir(PathBuf);

    impl TempDir {
        pub fn new() -> TempDir {
            let p = std::env::temp_dir().join(format!("mnemo-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&p).unwrap();
            TempDir(p)
        }

        pub fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A migrated database in a new temporary folder. Keep the folder alive while the
    /// storage is used.
    pub fn open_temp() -> (Storage, TempDir) {
        let dir = TempDir::new();
        let storage = Storage::open(&dir.path().join("mnemo.db")).unwrap();
        (storage, dir)
    }
}

#[cfg(test)]
mod tests {
    use super::testing::TempDir;
    use super::*;

    fn temp_db() -> (TempDir, std::path::PathBuf) {
        let d = TempDir::new();
        let p = d.path().join("mnemo.db");
        (d, p)
    }

    #[test]
    fn open_creates_file_in_wal_mode_with_busy_timeout() {
        let (_d, p) = temp_db();
        let s = Storage::open(&p).unwrap();
        assert!(p.exists());
        assert_eq!(s.journal_mode().unwrap(), "wal");
        assert_eq!(s.busy_timeout_ms().unwrap(), 5000);
        assert_eq!(s.synchronous_level().unwrap(), 1, "NORMAL");
        assert_eq!(s.schema_version().unwrap(), 11);
    }

    #[test]
    fn reopening_keeps_version_and_data() {
        let (_d, p) = temp_db();
        drop(Storage::open(&p).unwrap());
        let s = Storage::open(&p).unwrap();
        assert_eq!(s.schema_version().unwrap(), 11);
    }

    #[test]
    fn a_garbage_file_is_refused_and_left_untouched() {
        let (_d, p) = temp_db();
        let junk = b"this is definitely not a sqlite database file, just text".repeat(20);
        fs::write(&p, &junk).unwrap();
        let err = Storage::open(&p).err().unwrap();
        assert!(matches!(err, StorageError::Open(_)));
        assert_eq!(fs::read(&p).unwrap(), junk);
        let leftovers: Vec<_> = fs::read_dir(p.parent().unwrap()).unwrap().collect();
        assert_eq!(leftovers.len(), 1);
    }

    #[test]
    fn a_file_from_a_newer_mnemo_is_refused_before_wal_is_turned_on() {
        let (_dir, path) = temp_db();
        {
            let conn = rusqlite::Connection::open(&path).unwrap();
            conn.execute_batch("PRAGMA user_version = 99").unwrap();
        }
        let before = fs::read(&path).unwrap();
        let err = Storage::open(&path)
            .err()
            .expect("a newer file must be refused");
        assert!(matches!(err, StorageError::SchemaTooNew { found: 99, .. }));
        assert_eq!(
            fs::read(&path).unwrap(),
            before,
            "the file must be left as it is"
        );
        assert!(
            !path.with_extension("db-wal").exists(),
            "no -wal file may be created"
        );
    }

    #[test]
    fn a_folder_in_place_of_the_file_is_refused() {
        let d = TempDir::new();
        let err = Storage::open(d.path()).err().unwrap();
        assert!(matches!(err, StorageError::Open(_)));
        assert!(d.path().exists());
    }

    #[test]
    fn recover_after_panic_rolls_back_an_open_transaction() {
        let (_d, p) = temp_db();
        let s = Storage::open(&p).unwrap();
        s.conn
            .execute_batch(
                "BEGIN; CREATE TABLE half_done (x INTEGER); INSERT INTO half_done VALUES (1);",
            )
            .unwrap();
        assert!(!s.conn.is_autocommit());
        s.recover_after_panic().unwrap();
        assert!(s.conn.is_autocommit());
        let left: i64 = s
            .conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name = 'half_done'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(left, 0);
        // With no open transaction it does nothing.
        s.recover_after_panic().unwrap();
    }
}
