//! A plain error log file in the data folder, written through the `log` facade.
//!
//! A line holds only a time, a level, a source and the message the caller passed. Callers must
//! never pass tokens, secrets or user content (see `.claude/rules/technical.md`).

use log::{LevelFilter, Log, Metadata, Record};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Name of the log file inside the data folder.
pub const LOG_FILE_NAME: &str = "mnemo.log";

/// Only errors are written for now.
const LEVEL: LevelFilter = LevelFilter::Error;

struct FileLogger {
    file: Mutex<File>,
}

/// Returns the log file path inside the data folder.
pub fn log_path(data_dir: &Path) -> PathBuf {
    data_dir.join(LOG_FILE_NAME)
}

/// Formats one log line: seconds since the Unix epoch, level, source, message.
fn format_line(epoch_secs: u64, level: log::Level, target: &str, message: &str) -> String {
    format!("{epoch_secs} {level} {target}: {message}\n")
}

impl Log for FileLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= LEVEL
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let line = format_line(
            secs,
            record.level(),
            record.target(),
            &record.args().to_string(),
        );
        // A failed log write has nowhere else to go; drop it.
        if let Ok(mut file) = self.file.lock() {
            let _ = file.write_all(line.as_bytes());
        }
    }

    fn flush(&self) {
        if let Ok(mut file) = self.file.lock() {
            let _ = file.flush();
        }
    }
}

fn open_logger(data_dir: &Path) -> std::io::Result<FileLogger> {
    fs::create_dir_all(data_dir)?;
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path(data_dir))?;
    Ok(FileLogger {
        file: Mutex::new(file),
    })
}

/// Creates the log file in the data folder and installs it as the global logger.
pub fn init(data_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let logger = open_logger(data_dir)?;
    log::set_boxed_logger(Box::new(logger))?;
    log::set_max_level(LEVEL);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mnemo-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn log_file_is_created_in_the_data_folder() {
        let dir = temp_dir("log-create");
        open_logger(&dir).expect("logger opens");
        assert!(log_path(&dir).is_file());
        assert_eq!(log_path(&dir), dir.join("mnemo.log"));
        fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[test]
    fn log_writes_error_lines_and_skips_lower_levels() {
        let dir = temp_dir("log-levels");
        let logger = open_logger(&dir).expect("logger opens");
        let record = |level, msg: &str| {
            logger.log(
                &Record::builder()
                    .level(level)
                    .target("mnemo::test")
                    .args(format_args!("{msg}"))
                    .build(),
            )
        };
        record(log::Level::Error, "tray failed");
        record(log::Level::Info, "just info");
        let text = fs::read_to_string(log_path(&dir)).expect("log readable");
        assert!(text.contains("ERROR mnemo::test: tray failed"));
        assert!(!text.contains("just info"));
        fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[test]
    fn log_line_holds_only_time_level_source_and_message() {
        let line = format_line(42, log::Level::Error, "mnemo::tray", "no icon");
        assert_eq!(line, "42 ERROR mnemo::tray: no icon\n");
    }
}
