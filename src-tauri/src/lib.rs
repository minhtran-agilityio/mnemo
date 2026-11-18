// Crate root: declares the core modules and wires the Tauri commands.
mod ai;
mod commands;
mod scheduler;
mod storage;
mod system;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use commands::{AppStorage, StartupError};
use storage::StorageError;

/// The stable code for a storage error. Only this code reaches the UI; the full
/// reason, which can name file paths, goes to the terminal.
fn startup_code(e: &StorageError) -> &'static str {
    match e {
        StorageError::Open(_) => "open",
        StorageError::MigrationFailed { .. } => "migration",
        StorageError::SchemaTooNew { .. } => "too_new",
        StorageError::Database(_) => "database",
    }
}

/// The first page of the main window: the app, or the bundled error page with the
/// error code when storage failed. The error page is the window's first load, so the
/// app page cannot replace it.
fn start_url(error: Option<&StartupError>, app_url: WebviewUrl) -> WebviewUrl {
    match error {
        None => app_url,
        Some(e) => WebviewUrl::App(format!("error.html?code={}", e.code).into()),
    }
}

/// Opens the one database in the app data folder. The data file is never deleted or
/// replaced when this fails.
fn open_storage(app: &tauri::AppHandle) -> Result<storage::Storage, StartupError> {
    let dir = system::paths::data_dir(app).map_err(|detail| StartupError {
        code: "folder",
        detail,
    })?;
    storage::Storage::open(&system::paths::db_path(&dir)).map_err(|e| StartupError {
        code: startup_code(&e),
        detail: e.to_string(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let opened = open_storage(app.handle());
            let error = opened.as_ref().err().cloned();
            if let Some(e) = &error {
                eprintln!(
                    "Mnemo could not open its data file ({}): {}",
                    e.code, e.detail
                );
            }
            app.manage(AppStorage::new(opened));

            // The main window is built here (`create: false` in tauri.conf.json) so it can
            // start on the error page. If it cannot be built, Mnemo prints why and exits
            // with code 1. Returning an error from setup would make Tauri panic instead.
            let window = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .ok_or_else(|| "tauri.conf.json has no main window".to_string())
                .and_then(|mut config| {
                    config.url = start_url(error.as_ref(), config.url);
                    WebviewWindowBuilder::from_config(app.handle(), &config)
                        .and_then(|b| b.build())
                        .map_err(|e| e.to_string())
                });
            if let Err(why) = window {
                eprintln!("Mnemo could not open its window: {why}");
                std::process::exit(1);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::ping])
        .run(tauri::generate_context!())
        .expect("error while running Mnemo");
}

#[cfg(test)]
mod tests {
    use super::{start_url, startup_code, StartupError, StorageError};
    use tauri::WebviewUrl;

    #[test]
    fn start_url_is_the_app_when_storage_opened() {
        let url = start_url(None, WebviewUrl::App("index.html".into()));
        assert!(matches!(url, WebviewUrl::App(p) if p.to_str() == Some("index.html")));
    }

    #[test]
    fn start_url_is_the_error_page_with_only_the_code() {
        let e = StartupError {
            code: "open",
            detail: "unable to open /home/u/#work/100%/mnemo.db".into(),
        };
        let url = start_url(Some(&e), WebviewUrl::App("index.html".into()));
        assert!(matches!(url, WebviewUrl::App(p) if p.to_str() == Some("error.html?code=open")));
    }

    #[test]
    fn each_storage_error_has_a_stable_code() {
        assert_eq!(startup_code(&StorageError::Open("x".into())), "open");
        assert_eq!(
            startup_code(&StorageError::MigrationFailed {
                number: 2,
                reason: "x".into()
            }),
            "migration"
        );
        assert_eq!(
            startup_code(&StorageError::SchemaTooNew {
                found: 9,
                supported: 1
            }),
            "too_new"
        );
        assert_eq!(
            startup_code(&StorageError::Database("x".into())),
            "database"
        );
    }
}
