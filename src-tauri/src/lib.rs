// Crate root: declares the core modules and wires the Tauri commands.
mod ai;
mod commands;
mod scheduler;
mod storage;
mod system;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_window_state::StateFlags;

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
fn start_url(error_code: Option<&str>, app_url: WebviewUrl) -> WebviewUrl {
    match error_code {
        None => app_url,
        Some(code) => WebviewUrl::App(format!("error.html?code={code}").into()),
    }
}

/// Opens the one database in the app data folder. The data file is never deleted or
/// replaced when this fails.
fn open_storage(data_dir: &std::path::Path) -> Result<storage::Storage, StartupError> {
    storage::Storage::open(&system::paths::db_path(data_dir)).map_err(|e| StartupError {
        code: startup_code(&e),
        detail: e.to_string(),
    })
}

/// Managed state: true when storage could not be opened and the window shows the error page.
struct StartupFailed(bool);

/// Whether Mnemo builds its tray item and hides to it on close. Not on the error page:
/// the page asks the owner to quit, and a hidden broken app would only show it again.
fn keeps_running_in_tray(storage_failed: bool, tray_available: bool) -> bool {
    tray_available && !storage_failed
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single instance first: a second start focuses the running window and exits.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            system::window::show_main(app);
        }))
        // Keep size and position (not visibility, so a hidden window never starts hidden).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .setup(|app| {
            let paths = system::paths::app_paths(app.handle());
            // The log is best effort: if it cannot be opened, say so on stderr and keep going.
            if let Ok(paths) = &paths {
                if let Err(err) = system::logging::init(&paths.data_dir) {
                    eprintln!("mnemo: could not open the error log: {err}");
                }
            }

            let opened = match &paths {
                Ok(paths) => open_storage(&paths.data_dir),
                Err(e) => Err(StartupError {
                    code: "folder",
                    detail: format!("Could not find the Mnemo data folder: {e}"),
                }),
            };
            if let Err(e) = &opened {
                // stderr for a terminal start, the log for a start from the Dock or a launcher.
                eprintln!(
                    "Mnemo could not open its data file ({}): {}",
                    e.code, e.detail
                );
                log::error!("could not open the data file ({}): {}", e.code, e.detail);
            }
            let error_code = opened.as_ref().err().map(|e| e.code);
            app.manage(AppStorage::new(opened));
            app.manage(StartupFailed(error_code.is_some()));

            // Close hides the window only when a tray item really exists to bring it back.
            // On the error page there is no tray: closing the window quits Mnemo.
            let tray = keeps_running_in_tray(error_code.is_some(), system::tray::tray_available())
                && match system::tray::build_tray(app) {
                    Ok(()) => true,
                    Err(err) => {
                        log::error!("could not build the tray item: {err}");
                        false
                    }
                };
            app.manage(system::window::TrayAvailable(tray));
            app.manage(system::window::HiddenAt::default());

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
                    config.url = start_url(error_code, config.url);
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
        .on_window_event(|window, event| {
            // The error page asks the owner to quit and start again, so a close there
            // quits instead of hiding to the tray.
            let failed = window.try_state::<StartupFailed>().is_some_and(|s| s.0);
            if !failed {
                system::window::on_window_event(window, event);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::get_setting,
            commands::set_setting
        ])
        .build(tauri::generate_context!())
        .expect("error while building Mnemo")
        .run(|_app, _event| {
            // macOS: a click on the Dock icon shows a window that was closed to hide.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                system::window::show_main(_app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{keeps_running_in_tray, start_url, startup_code, StorageError};
    use tauri::WebviewUrl;

    #[test]
    fn no_tray_on_the_error_page() {
        assert!(keeps_running_in_tray(false, true));
        assert!(!keeps_running_in_tray(true, true));
        assert!(!keeps_running_in_tray(false, false));
    }

    #[test]
    fn start_url_is_the_app_when_storage_opened() {
        let url = start_url(None, WebviewUrl::App("index.html".into()));
        assert!(matches!(url, WebviewUrl::App(p) if p.to_str() == Some("index.html")));
    }

    #[test]
    fn start_url_is_the_error_page_with_only_the_code() {
        let url = start_url(Some("open"), WebviewUrl::App("index.html".into()));
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
