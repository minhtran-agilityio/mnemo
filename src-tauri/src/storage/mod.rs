// Owns persistence: reading and writing Mnemo's local data. The only module that touches SQLite.
mod error;
mod migrate;
pub mod record;

use std::fs;
use std::path::Path;
use std::time::Duration;

use rusqlite::Connection;

pub use error::StorageError;

/// How long a writer waits for another writer before giving up.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// The open Mnemo database.
#[allow(dead_code)] // `conn` is first read by the item functions in #14.
pub struct Storage {
    conn: Connection,
}

#[allow(dead_code)] // Status readers; callers arrive with later tickets.
impl Storage {
    /// Opens (or creates) the database at `path`, turns on WAL mode and the busy
    /// timeout, and runs pending migrations. A file that is not a database gives
    /// `StorageError::Open`; it is never deleted or replaced.
    pub fn open(path: &Path) -> Result<Storage, StorageError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| StorageError::Open(e.to_string()))?;
        }
        let mut conn = Connection::open(path).map_err(|e| StorageError::Open(e.to_string()))?;
        conn.busy_timeout(BUSY_TIMEOUT)
            .map_err(|e| StorageError::Open(e.to_string()))?;
        // The first read of the file fails here when it is not a database.
        let mode: String = conn
            .query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))
            .map_err(|e| StorageError::Open(e.to_string()))?;
        if !mode.eq_ignore_ascii_case("wal") {
            return Err(StorageError::Open(format!(
                "could not turn on WAL mode (got {mode})"
            )));
        }
        migrate::run(&mut conn, migrate::MIGRATIONS)?;
        Ok(Storage { conn })
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

    /// The schema version stored in the database.
    pub fn schema_version(&self) -> Result<u32, StorageError> {
        migrate::current_version(&self.conn)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> (tempdir::Dir, std::path::PathBuf) {
        let d = tempdir::Dir::new();
        let p = d.path().join("mnemo.db");
        (d, p)
    }

    // Tiny temp dir helper: std only, removed on drop. Tests never touch the real data folder.
    mod tempdir {
        use std::path::{Path, PathBuf};
        pub struct Dir(PathBuf);
        impl Dir {
            pub fn new() -> Dir {
                let p = std::env::temp_dir().join(format!("mnemo-test-{}", uuid::Uuid::new_v4()));
                std::fs::create_dir_all(&p).unwrap();
                Dir(p)
            }
            pub fn path(&self) -> &Path {
                &self.0
            }
        }
        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    #[test]
    fn open_creates_file_in_wal_mode_with_busy_timeout() {
        let (_d, p) = temp_db();
        let s = Storage::open(&p).unwrap();
        assert!(p.exists());
        assert_eq!(s.journal_mode().unwrap(), "wal");
        assert_eq!(s.busy_timeout_ms().unwrap(), 5000);
        assert_eq!(s.schema_version().unwrap(), 1);
    }

    #[test]
    fn reopening_keeps_version_and_data() {
        let (_d, p) = temp_db();
        drop(Storage::open(&p).unwrap());
        let s = Storage::open(&p).unwrap();
        assert_eq!(s.schema_version().unwrap(), 1);
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
    fn a_folder_in_place_of_the_file_is_refused() {
        let d = tempdir::Dir::new();
        let err = Storage::open(d.path()).err().unwrap();
        assert!(matches!(err, StorageError::Open(_)));
        assert!(d.path().exists());
    }
}
