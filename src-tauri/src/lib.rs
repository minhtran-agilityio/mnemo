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
            system::logging::init(&paths.data_dir)?;

            let tray = system::tray::tray_available();
            app.manage(system::window::TrayAvailable(tray));
            if tray {
                if let Err(err) = system::tray::build_tray(app) {
                    log::error!("could not build the tray item: {err}");
                }
            }
            Ok(())
        })
        .on_window_event(system::window::on_window_event)
        .invoke_handler(tauri::generate_handler![commands::ping])
        .run(tauri::generate_context!())
        .expect("error while running Mnemo");
}
