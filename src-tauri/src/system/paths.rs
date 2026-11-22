//! The one place that decides where Mnemo keeps its folders and files.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// File name of the one SQLite database inside the data folder.
const DB_FILE_NAME: &str = "mnemo.db";

/// The two folders Mnemo owns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppPaths {
    /// Data folder (Tauri `app_data_dir`): the database and the log. The window-state plugin
    /// keeps its own small file in Tauri's `app_config_dir`, not here.
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

/// Returns the data folder and the config folder for this app. The folders may not exist yet.
pub fn app_paths(app: &AppHandle) -> tauri::Result<AppPaths> {
    let resolver = app.path();
    Ok(paths_from(resolver.app_data_dir()?, &resolver.home_dir()?))
}

/// Joins the data folder and the database file name.
pub fn db_path(data_dir: &Path) -> PathBuf {
    data_dir.join(DB_FILE_NAME)
}

/// The one-line backup commands the Data section shows, one per system.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupCommands {
    pub macos: String,
    pub ubuntu: String,
}

/// Puts `path` in double quotes for a shell, so a space or `$` in it stays text.
fn shell_quoted(path: &Path) -> String {
    let mut out = String::from("\"");
    for c in path.to_string_lossy().chars() {
        if matches!(c, '"' | '\\' | '$' | '`') {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('"');
    out
}

/// The copy commands for a backup of the data folder. The owner closes Mnemo first.
pub fn backup_commands(data_dir: &Path) -> BackupCommands {
    let from = shell_quoted(data_dir);
    BackupCommands {
        macos: format!("cp -Rp {from} ~/mnemo-backup-$(date +%Y-%m-%d)"),
        ubuntu: format!("cp -a {from} ~/mnemo-backup-$(date +%Y-%m-%d)"),
    }
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

    #[test]
    fn db_path_is_inside_the_data_folder() {
        let p = db_path(Path::new("/tmp/mnemo-data"));
        assert_eq!(p, Path::new("/tmp/mnemo-data/mnemo.db"));
    }

    #[test]
    fn backup_commands_copy_the_quoted_data_folder() {
        let c = backup_commands(Path::new("/home/ana/.local/share/io.mnemo.desktop"));
        assert_eq!(
            c.ubuntu,
            "cp -a \"/home/ana/.local/share/io.mnemo.desktop\" ~/mnemo-backup-$(date +%Y-%m-%d)"
        );
        assert_eq!(
            c.macos,
            "cp -Rp \"/home/ana/.local/share/io.mnemo.desktop\" ~/mnemo-backup-$(date +%Y-%m-%d)"
        );
    }

    #[test]
    fn backup_commands_quote_a_path_with_spaces_and_shell_marks() {
        let c = backup_commands(Path::new("/Users/Ana B/Library/Application Support/x$y"));
        assert_eq!(
            c.macos,
            "cp -Rp \"/Users/Ana B/Library/Application Support/x\\$y\" ~/mnemo-backup-$(date +%Y-%m-%d)"
        );
        assert!(c.ubuntu.starts_with("cp -a \"/Users/Ana B/"));
    }
}
