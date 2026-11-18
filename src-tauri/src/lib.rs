// Crate root: declares the core modules and wires the Tauri commands.
mod ai;
mod commands;
mod scheduler;
mod storage;
mod system;

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

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
            let paths = system::paths::app_paths(app.handle())?;
            // The log is best effort: if it cannot be opened, say so on stderr and keep going.
            if let Err(err) = system::logging::init(&paths.data_dir) {
                eprintln!("mnemo: could not open the error log: {err}");
            }

            // Close hides the window only when a tray item really exists to bring it back.
            let tray = system::tray::tray_available()
                && match system::tray::build_tray(app) {
                    Ok(()) => true,
                    Err(err) => {
                        log::error!("could not build the tray item: {err}");
                        false
                    }
                };
            app.manage(system::window::TrayAvailable(tray));
            app.manage(system::window::HiddenAt::default());
            Ok(())
        })
        .on_window_event(system::window::on_window_event)
        .invoke_handler(tauri::generate_handler![commands::ping])
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
