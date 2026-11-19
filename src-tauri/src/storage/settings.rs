//! The small settings store: one text value per key. Callers never see SQL.

use rusqlite::OptionalExtension;

use super::error::StorageError;
use super::Storage;

impl Storage {
    /// The value saved under `key`, or `None` when the key was never written.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>, StorageError> {
        Ok(self
            .conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .optional()?)
    }

    /// Saves `value` under `key`, replacing an earlier value. `updated_at` is set here.
    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), StorageError> {
        self.conn.execute(
            "INSERT INTO settings (key, value, updated_at)
             VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ON CONFLICT(key) DO UPDATE SET
                 value = excluded.value,
                 updated_at = excluded.updated_at",
            [key, value],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open() -> (Storage, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("mnemo-settings-{}", uuid::Uuid::new_v4()));
        (Storage::open(&dir.join("mnemo.db")).unwrap(), dir)
    }

    #[test]
    fn setting_read_returns_what_was_written() {
        let (s, dir) = open();
        s.set_setting("sidebar_collapsed", "true").unwrap();
        assert_eq!(
            s.get_setting("sidebar_collapsed").unwrap().as_deref(),
            Some("true")
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn setting_write_keeps_each_key_apart_and_survives_reopen() {
        let (s, dir) = open();
        s.set_setting("a", "1").unwrap();
        s.set_setting("b", "2").unwrap();
        drop(s);
        let s = Storage::open(&dir.join("mnemo.db")).unwrap();
        assert_eq!(s.get_setting("a").unwrap().as_deref(), Some("1"));
        assert_eq!(s.get_setting("b").unwrap().as_deref(), Some("2"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn setting_overwrite_keeps_the_last_value_and_one_row() {
        let (s, dir) = open();
        s.set_setting("sidebar_collapsed", "true").unwrap();
        s.set_setting("sidebar_collapsed", "false").unwrap();
        assert_eq!(
            s.get_setting("sidebar_collapsed").unwrap().as_deref(),
            Some("false")
        );
        let rows: i64 = s
            .conn
            .query_row("SELECT count(*) FROM settings", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn setting_missing_key_reads_as_none() {
        let (s, dir) = open();
        assert_eq!(s.get_setting("never_written").unwrap(), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn setting_write_records_a_utc_iso_updated_at() {
        let (s, dir) = open();
        s.set_setting("k", "v").unwrap();
        let at: String = s
            .conn
            .query_row("SELECT updated_at FROM settings WHERE key = 'k'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(at.ends_with('Z') && at.contains('T'), "got {at}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn setting_values_with_quotes_are_stored_as_given() {
        let (s, dir) = open();
        let odd = "x'); DROP TABLE settings; --";
        s.set_setting("k", odd).unwrap();
        assert_eq!(s.get_setting("k").unwrap().as_deref(), Some(odd));
        let _ = std::fs::remove_dir_all(dir);
    }
}
