// Crate root: declares the core modules and wires the Tauri commands.
mod ai;
mod commands;
mod scheduler;
mod storage;
mod system;

use std::sync::Mutex;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Open the one database in the app data folder. On failure the app stops
            // with a plain error; the data file is never deleted or replaced.
            let dir = system::paths::data_dir(app.handle())?;
            let storage = storage::Storage::open(&system::paths::db_path(&dir))?;
            app.manage(Mutex::new(storage));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::ping])
        .run(tauri::generate_context!())
        .expect("error while running Mnemo");
}
