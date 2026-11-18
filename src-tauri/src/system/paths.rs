//! Where Mnemo keeps its files on this machine.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// File name of the one SQLite database inside the data folder.
const DB_FILE_NAME: &str = "mnemo.db";

/// Returns the Tauri app data folder. The folder may not exist yet.
pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Could not find the Mnemo data folder: {e}"))
}

/// Joins the data folder and the database file name.
pub fn db_path(data_dir: &Path) -> PathBuf {
    data_dir.join(DB_FILE_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db_path_is_inside_the_data_folder() {
        let p = db_path(Path::new("/tmp/mnemo-data"));
        assert_eq!(p, Path::new("/tmp/mnemo-data/mnemo.db"));
    }
}
