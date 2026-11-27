// Crate root: declares the core modules and wires the Tauri commands.
mod ai;
mod commands;
mod scheduler;
mod storage;
mod system;

use std::sync::Arc;

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_window_state::StateFlags;

use commands::{
    AiHealthState, AiRunnerState, AppControlStore, AppRunLog, AppStorage, StartupError,
};
use scheduler::ai_control::AiControl;
use scheduler::queue::{Notifier, RunEvent, RunQueue};
use storage::StorageError;

/// The event the UI gets on every AI run state change. Its payload is a `RunEvent`: the run
/// id, the task name and the state, nothing else.
const RUN_STATE_EVENT: &str = "run-state";

/// The event the UI gets after every change of the AI control (switch, lines, pause, a usage
/// reading, a limit pause and its lift). It has no payload: an open Settings screen reads the
/// view again.
const AI_CONTROL_EVENT: &str = "ai-control";

/// The stable code for a storage error. Only this code reaches the UI; the full
/// reason, which can name file paths, goes to the terminal.
fn startup_code(e: &StorageError) -> &'static str {
    match e {
        StorageError::Open(_) => "open",
        StorageError::MigrationFailed { .. } => "migration",
        StorageError::SchemaTooNew { .. } => "too_new",
        StorageError::Database(_) => "database",
        // Item errors cannot happen while opening; they get the generic code.
        StorageError::NotFound { .. } => "database",
        StorageError::Invalid(_) => "database",
        StorageError::FileTooLarge { .. }
        | StorageError::InvalidFileName
        | StorageError::FileMissing
        | StorageError::Files(_) => "database",
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
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

            // MNEMO_FAKE_AI=1 starts the whole app with the fake AI runner (fixed test answers).
            let fake =
                ai::runner::fake_requested(std::env::var_os(ai::runner::FAKE_AI_ENV).as_deref());
            log::info!("AI runner: {}", if fake { "fake" } else { "real" });
            // The AI control: the master switch, the usage lines and the pause. Every AI feature
            // and the queue ask it before a run. It reads its state from the one storage.
            let control = AiControl::new(
                Arc::new(AppControlStore(app.handle().clone())),
                scheduler::ai_control::system_clock(),
            );
            let handle = app.handle().clone();
            control.subscribe(Arc::new(move || {
                if let Err(e) = handle.emit(AI_CONTROL_EVENT, ()) {
                    log::error!("could not send the ai-control event: {e}");
                }
            }));
            // Mnemo's own Claude config files are made once and never rewritten. If they cannot be
            // made, no AI run starts; saving and reading still work. The log holds the error
            // kind only: no path, no file text.
            let claude_config = paths.as_ref().ok().and_then(|p| {
                ai::config::ensure_config(&p.config_dir)
                    .map_err(|e| {
                        log::error!("could not create Mnemo's Claude config: {:?}", e.kind())
                    })
                    .ok()
            });
            let runs_dir = paths
                .as_ref()
                .ok()
                .map(|p| ai::runner::runs_dir(&p.data_dir));
            let inner: Arc<dyn ai::runner::AiRunner> = if fake {
                ai::runner::select_runner(true, runs_dir, claude_config)
            } else {
                Arc::new(real_runner(runs_dir, claude_config, control.clone()))
            };
            // Every run reads its feature's model and effort from the settings table (#24),
            // so the queue gets the runner wrapped in `ConfiguredRunner`.
            let runner = crate::ai::models::app_runner(
                inner,
                Arc::new(commands::StoredChoices(app.handle().clone())),
            );
            app.manage(AiRunnerState { fake });

            // Every AI run goes through this queue: at most 2 at once, owner tasks first. Its
            // rows go to the one managed storage, and each state change goes to the UI.
            let handle = app.handle().clone();
            let notify: Notifier = Arc::new(move |event: &RunEvent| {
                if let Err(e) = handle.emit(RUN_STATE_EVENT, event) {
                    log::error!(
                        "could not send the run-state event of run {}: {e}",
                        event.id
                    );
                }
            });
            app.manage(RunQueue::new(
                runner,
                Arc::new(AppRunLog(app.handle().clone())),
                notify,
                control,
            ));

            // The Claude Code check runs off the main thread, so the window never waits for
            // it. Saving and reading do not depend on its result.
            app.manage(AiHealthState::default());
            tauri::async_runtime::spawn(commands::refresh_ai_health(app.handle().clone()));

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

            // The minimum is also enforced on every resize, so it holds when the size is restored late
            // or when a window saved maximized is un-maximized.
            let main = app.config().app.windows.iter().find(|w| w.label == "main");
            app.manage(system::window::MinimumSize {
                width: main.and_then(|w| w.min_width),
                height: main.and_then(|w| w.min_height),
            });

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
                    let built = WebviewWindowBuilder::from_config(app.handle(), &config)
                        .and_then(|b| b.build())
                        .map_err(|e| e.to_string())?;
                    // The window-state plugin has restored the saved size by now. One saved before
                    // the minimum existed may be smaller; grow it to max(saved, minimum).
                    system::window::enforce_minimum(&built, config.min_width, config.min_height);
                    Ok(())
                });
            if let Err(why) = window {
                eprintln!("Mnemo could not open its window: {why}");
                std::process::exit(1);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            system::window::enforce_on_resize(window, event);
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
            commands::set_setting,
            commands::export_data,
            commands::reset_data,
            commands::data_folder_info,
            commands::open_data_folder,
            commands::get_ai_health,
            commands::check_ai_health,
            commands::get_ai_mode,
            commands::run_test_prompt,
            commands::list_ai_models,
            commands::set_ai_model,
            commands::reset_ai_models,
            commands::cancel_run,
            commands::get_ai_control,
            commands::set_ai_enabled,
            commands::set_ai_thresholds,
            commands::pause_background,
            commands::resume_ai,
            commands::add_bookmark,
            commands::get_bookmark,
            commands::list_bookmarks,
            commands::update_bookmark,
            commands::delete_bookmark,
            commands::save_link,
            commands::summarize_bookmark,
            commands::list_bookmark_cards,
            commands::list_folders,
            commands::create_folder,
            commands::rename_folder,
            commands::delete_folder,
            commands::move_bookmark,
            commands::delete_saved_bookmark,
            commands::undo_last,
            commands::open_link,
            commands::add_note,
            commands::get_note,
            commands::list_notes,
            commands::update_note,
            commands::delete_note,
            commands::add_idea,
            commands::get_idea,
            commands::list_ideas,
            commands::update_idea,
            commands::delete_idea,
            commands::turn_idea_into_project,
            commands::add_project,
            commands::get_project,
            commands::list_projects,
            commands::update_project,
            commands::delete_project,
            commands::add_task,
            commands::get_task,
            commands::list_tasks,
            commands::update_task,
            commands::delete_task,
            commands::add_event,
            commands::get_event,
            commands::list_events,
            commands::update_event,
            commands::delete_event,
            commands::get_run,
            commands::list_runs,
            commands::add_memory,
            commands::get_memory,
            commands::list_memories,
            commands::update_memory,
            commands::delete_memory,
            commands::add_file,
            commands::get_file,
            commands::read_file,
            commands::delete_file,
            commands::file_orphan_report,
            commands::add_link,
            commands::list_links,
            commands::remove_link,
            commands::create_label,
            commands::rename_label,
            commands::move_label,
            commands::delete_label,
            commands::count_label_delete_moves,
            commands::list_labels,
            commands::save_labelled_note,
            commands::list_labelled_notes
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

/// The real runner of the app's queue: it hands each usage reading of a run to the AI control.
fn real_runner(
    runs_dir: Option<std::path::PathBuf>,
    config: Option<ai::config::ClaudeConfig>,
    control: Arc<AiControl>,
) -> ai::runner::ClaudeRunner {
    let sink: ai::usage::UsageSink = Arc::new(move |reading| {
        let now = control.now();
        control.on_usage_reading(reading, now);
    });
    ai::runner::ClaudeRunner::new(runs_dir, config).with_usage(sink)
}

#[cfg(test)]
mod tests {
    use super::{keeps_running_in_tray, start_url, startup_code, StorageError};
    use tauri::WebviewUrl;

    // The window is built from this config entry (create: false), so the minimum here is the minimum
    // of the real window. 800 x 560 is the smallest size every screen is designed and checked for.
    #[test]
    fn main_window_has_a_minimum_of_800_by_560_and_starts_at_900_by_640() {
        // No JSON crate is a dependency, so the compact text of the config is checked.
        let conf: String = include_str!("../tauri.conf.json")
            .split_whitespace()
            .collect();
        for want in [
            "\"minWidth\":800",
            "\"minHeight\":560",
            "\"width\":900",
            "\"height\":640",
        ] {
            assert!(conf.contains(want), "tauri.conf.json lacks {want}");
        }
    }

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
        assert_eq!(
            startup_code(&StorageError::NotFound { kind: "note" }),
            "database"
        );
        assert_eq!(startup_code(&StorageError::Invalid("x".into())), "database");
    }
    /// Leaves every task as built (no Settings row).
    struct NoChoice;

    impl crate::ai::models::ModelChoices for NoChoice {
        fn row(&self, _task: &str) -> Option<crate::ai::models::ModelRow> {
            None
        }
    }

    // #166: the queue's real runner (the `ClaudeRunner` from `real_runner`, wrapped like lib.rs
    // wraps it) hands the usage reading of a run to the AI control. A stand-in `claude` prints
    // the run output, so no real Claude starts.
    #[test]
    fn the_app_queue_runner_sends_each_usage_reading_to_the_ai_control() {
        use crate::ai::cancel::CancelToken;
        use crate::ai::runner::AiTask;
        use std::os::unix::fs::PermissionsExt;
        use std::sync::Arc;

        const NOW: i64 = 1_794_990_000;
        let output = r#"[{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1794999600,"rateLimitType":"five_hour","unifiedWindows":{"five_hour":{"utilization":0.57,"resetsAt":1794999600,"status":"allowed"},"seven_day":{"utilization":0.18,"resetsAt":1795557600,"status":"allowed"}}}},{"type":"result","subtype":"success","is_error":false,"structured_output":{"greeting":"Hi!"}}]"#;
        let dir = std::env::temp_dir().join(format!("mnemo-lib-usage-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let program = dir.join("claude");
        std::fs::write(&program, format!("#!/bin/sh\ncat <<'EOF'\n{output}\nEOF\n")).unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();

        let control = crate::scheduler::ai_control::testing::open_control_at(Arc::new(|| NOW));
        let config = crate::ai::config::test_config();
        let runner = crate::ai::models::app_runner(
            Arc::new(
                super::real_runner(
                    Some(dir.join("runs")),
                    Some(config.clone()),
                    control.clone(),
                )
                .with_stand_in(program),
            ),
            Arc::new(NoChoice),
        );
        let task = AiTask {
            name: "test_prompt".into(),
            prompt: "hi".into(),
            schema: r#"{"type":"object","properties":{"greeting":{"type":"string"}},"required":["greeting"]}"#.into(),
            tools: vec![],
            model: "sonnet".into(),
            effort: None,
            timeout: std::time::Duration::from_secs(10),
        };
        let before = control.reading_seq();
        let got = runner.run_task(&task, &CancelToken::default()).unwrap();

        assert_eq!(got.structured_output, r#"{"greeting":"Hi!"}"#);
        assert_eq!(control.reading_seq(), before + 1);
        let snap = control.snapshot(NOW);
        assert_eq!(snap.level, Some(57));
        assert_eq!(snap.five_hour.and_then(|w| w.percent), Some(57));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(config.dir());
    }
}
