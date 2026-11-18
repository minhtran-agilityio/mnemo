// Crate root: declares the core modules and wires the Tauri commands.
mod ai;
mod commands;
mod scheduler;
mod storage;
mod system;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::ping])
        .run(tauri::generate_context!())
        .expect("error while running Mnemo");
}
