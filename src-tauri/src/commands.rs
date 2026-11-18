// Commands the UI can call through Tauri's invoke bridge, and the state they share.

use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use tauri::Manager;

use crate::storage::{Storage, StorageError};

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
pub struct AppStorage(Result<Mutex<Storage>, StartupError>);

impl AppStorage {
    pub fn new(opened: Result<Storage, StartupError>) -> Self {
        AppStorage(opened.map(Mutex::new))
    }

    /// Locks the database, or returns `storage_unavailable` when it was not opened.
    /// A lock poisoned by an earlier panic is recovered after rolling back any
    /// transaction the panicking code left open.
    pub fn get(&self) -> Result<MutexGuard<'_, Storage>, AppError> {
        match &self.0 {
            Ok(m) => match m.lock() {
                Ok(guard) => Ok(guard),
                Err(poisoned) => {
                    // An earlier command panicked while holding the lock. Roll back what
                    // it left open, then carry on with the last committed state.
                    let guard = poisoned.into_inner();
                    guard.recover_after_panic().map_err(|_| AppError {
                        code: "storage_unavailable",
                        message: "Mnemo could not recover its data file after an error. Nothing was deleted. Quit Mnemo and start it again.".to_string(),
                    })?;
                    m.clear_poison();
                    Ok(guard)
                }
            },
            Err(_) => Err(AppError {
                code: "storage_unavailable",
                message: "Mnemo could not open its data file when it started. Nothing was deleted. Quit Mnemo and start it again.".to_string(),
            }),
        }
    }
}

/// Returns a fixed reply so the UI can prove the Rust core is reachable.
#[tauri::command]
pub fn ping() -> String {
    "pong from the Rust core".to_string()
}

const MAX_KEY_LEN: usize = 100;
const MAX_VALUE_LEN: usize = 1000;

fn invalid_setting(message: &str) -> AppError {
    AppError {
        code: "invalid_setting",
        message: message.to_string(),
    }
}

/// A setting key is 1 to 100 characters of a-z, 0-9, underscore, dot or hyphen.
fn check_setting_key(key: &str) -> Result<(), AppError> {
    let ok = !key.is_empty()
        && key.len() <= MAX_KEY_LEN
        && key
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '.' | '-'));
    if ok {
        Ok(())
    } else {
        Err(invalid_setting(
            "The setting name must be 1 to 100 characters: a-z, 0-9, underscore, dot or hyphen.",
        ))
    }
}

/// The error the UI sees for a storage failure. The reason stays out of the message.
fn storage_failed(e: StorageError) -> AppError {
    log::error!("settings storage call failed: {e}");
    AppError {
        code: "storage_error",
        message: "Mnemo could not read or save its settings. Nothing was deleted.".to_string(),
    }
}

fn read_setting(storage: &AppStorage, key: &str) -> Result<Option<String>, AppError> {
    check_setting_key(key)?;
    storage.get()?.get_setting(key).map_err(storage_failed)
}

fn write_setting(storage: &AppStorage, key: &str, value: &str) -> Result<(), AppError> {
    check_setting_key(key)?;
    if value.len() > MAX_VALUE_LEN {
        return Err(invalid_setting("The setting value is too long."));
    }
    storage
        .get()?
        .set_setting(key, value)
        .map_err(storage_failed)
}

/// Runs `work` on a blocking thread, so the storage lock and SQLite I/O never hold up
/// the main thread. A thread that failed gives the same coded error as a storage failure.
async fn off_main_thread<T, F>(app: tauri::AppHandle, work: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(&AppStorage) -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let storage = app.state::<AppStorage>();
        work(&storage)
    })
    .await
    .map_err(|e| {
        log::error!("settings task did not finish: {e}");
        AppError {
            code: "storage_error",
            message: "Mnemo could not read or save its settings. Nothing was deleted.".to_string(),
        }
    })?
}

/// The value saved under `key`, or null when it was never saved.
#[tauri::command]
pub async fn get_setting(app: tauri::AppHandle, key: String) -> Result<Option<String>, AppError> {
    off_main_thread(app, move |storage| read_setting(storage, &key)).await
}

/// Saves `value` under `key`, replacing an earlier value.
#[tauri::command]
pub async fn set_setting(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), AppError> {
    off_main_thread(app, move |storage| write_setting(storage, &key, &value)).await
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

    #[test]
    fn setting_commands_write_then_read_through_app_storage() {
        let (storage, dir) = temp_storage();
        let state = AppStorage::new(Ok(storage));
        assert_eq!(read_setting(&state, "sidebar_collapsed").unwrap(), None);
        write_setting(&state, "sidebar_collapsed", "true").unwrap();
        write_setting(&state, "sidebar_collapsed", "false").unwrap();
        assert_eq!(
            read_setting(&state, "sidebar_collapsed")
                .unwrap()
                .as_deref(),
            Some("false")
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn setting_commands_give_storage_unavailable_when_the_database_did_not_open() {
        let state = AppStorage::new(Err(StartupError {
            code: "open",
            detail: "x".into(),
        }));
        assert_eq!(
            read_setting(&state, "k").unwrap_err().code,
            "storage_unavailable"
        );
        assert_eq!(
            write_setting(&state, "k", "v").unwrap_err().code,
            "storage_unavailable"
        );
    }

    #[test]
    fn setting_commands_refuse_a_bad_key_or_a_too_long_value() {
        let (storage, dir) = temp_storage();
        let state = AppStorage::new(Ok(storage));
        for bad in ["", "Has Space", "a/b", &"k".repeat(101)] {
            assert_eq!(
                read_setting(&state, bad).unwrap_err().code,
                "invalid_setting"
            );
            assert_eq!(
                write_setting(&state, bad, "v").unwrap_err().code,
                "invalid_setting"
            );
        }
        assert_eq!(
            write_setting(&state, "k", &"v".repeat(1001))
                .unwrap_err()
                .code,
            "invalid_setting"
        );
        assert_eq!(read_setting(&state, "k").unwrap(), None);
        let _ = std::fs::remove_dir_all(dir);
    }
}
