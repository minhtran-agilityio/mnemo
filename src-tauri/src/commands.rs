// Commands the UI can call through Tauri's invoke bridge, and the state they share.

use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::Serialize;

use crate::storage::Storage;

/// The one error shape every command returns: a stable machine `code` and a plain
/// `message`. It never carries file paths, stack traces or raw error text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppError {
    pub code: &'static str,
    pub message: String,
}

/// Why storage could not be opened at start. `code` is safe to show in the UI;
/// `detail` is the full reason and only goes to the terminal.
#[derive(Debug, Clone)]
pub struct StartupError {
    pub code: &'static str,
    pub detail: String,
}

/// The storage the commands use: the open database, or why it could not be opened.
/// It is always registered, so a command gets an error back instead of a panic.
#[allow(dead_code)] // `get` is first called by the item commands in #14.
pub struct AppStorage(Result<Mutex<Storage>, StartupError>);

#[allow(dead_code)]
impl AppStorage {
    pub fn new(opened: Result<Storage, StartupError>) -> Self {
        AppStorage(opened.map(Mutex::new))
    }

    /// Locks the database, or returns `storage_unavailable` when it was not opened.
    /// A lock poisoned by an earlier panic is recovered: SQLite rolled back that
    /// work, so the connection is still good.
    pub fn get(&self) -> Result<MutexGuard<'_, Storage>, AppError> {
        match &self.0 {
            Ok(m) => Ok(m.lock().unwrap_or_else(PoisonError::into_inner)),
            Err(e) => Err(AppError {
                code: "storage_unavailable",
                message: format!(
                    "Mnemo's data file is not open (reason: {}). Nothing was deleted.",
                    e.code
                ),
            }),
        }
    }
}

/// Returns a fixed reply so the UI can prove the Rust core is reachable.
#[tauri::command]
pub fn ping() -> String {
    "pong from the Rust core".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_returns_pong() {
        assert_eq!(ping(), "pong from the Rust core");
    }

    fn temp_storage() -> (Storage, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("mnemo-appstorage-{}", uuid::Uuid::new_v4()));
        (Storage::open(&dir.join("mnemo.db")).unwrap(), dir)
    }

    #[test]
    fn app_storage_gives_the_database_when_it_opened() {
        let (storage, dir) = temp_storage();
        assert!(AppStorage::new(Ok(storage)).get().is_ok());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn app_storage_returns_a_coded_error_without_the_detail() {
        let state = AppStorage::new(Err(StartupError {
            code: "open",
            detail: "unable to open /home/someone/secret/mnemo.db".into(),
        }));
        let err = state.get().err().unwrap();
        assert_eq!(err.code, "storage_unavailable");
        assert!(err.message.contains("open"));
        assert!(
            !err.message.contains('/'),
            "no path may reach the UI: {}",
            err.message
        );
    }

    #[test]
    fn app_storage_recovers_from_a_poisoned_lock() {
        let (storage, dir) = temp_storage();
        let state = std::sync::Arc::new(AppStorage::new(Ok(storage)));
        let s2 = state.clone();
        let _ = std::thread::spawn(move || {
            let _guard = s2.get().unwrap();
            panic!("a command panicked while holding storage");
        })
        .join();
        assert!(state.get().is_ok());
        let _ = std::fs::remove_dir_all(dir);
    }
}
