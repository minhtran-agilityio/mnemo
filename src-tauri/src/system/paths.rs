//! The one place that decides where Mnemo keeps its folders.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// The two folders Mnemo owns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppPaths {
    /// Data folder (Tauri `app_data_dir`): the database, the log and saved window state.
    pub data_dir: PathBuf,
    /// Config folder (`~/.config/mnemo/`): Mnemo's own Claude config.
    pub config_dir: PathBuf,
}

/// Builds the paths from the data folder and the home folder.
pub fn paths_from(data_dir: PathBuf, home_dir: &Path) -> AppPaths {
    AppPaths {
        data_dir,
        config_dir: home_dir.join(".config").join("mnemo"),
    }
}

/// Returns the data folder and the config folder for this app.
pub fn app_paths(app: &AppHandle) -> tauri::Result<AppPaths> {
    let resolver = app.path();
    Ok(paths_from(resolver.app_data_dir()?, &resolver.home_dir()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_dir_is_dot_config_mnemo_under_home() {
        let paths = paths_from(
            PathBuf::from("/data/io.mnemo.desktop"),
            Path::new("/home/ana"),
        );
        assert_eq!(paths.config_dir, PathBuf::from("/home/ana/.config/mnemo"));
    }

    #[test]
    fn data_dir_is_kept_as_given() {
        let paths = paths_from(
            PathBuf::from("/data/io.mnemo.desktop"),
            Path::new("/home/ana"),
        );
        assert_eq!(paths.data_dir, PathBuf::from("/data/io.mnemo.desktop"));
    }
}
