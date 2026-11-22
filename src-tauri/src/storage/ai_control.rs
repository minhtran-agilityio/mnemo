//! The stored state of the AI control (#23): six keys in the existing `settings` table, no
//! migration. This is the only code that reads or writes them.
//!
//! - `ai_enabled`: "true" or "false"; missing means on.
//! - `ai_warn_at`, `ai_pause_at`: whole numbers as text; missing means the default.
//! - `ai_pause_reason`: "limit" or "owner"; missing means not paused.
//! - `ai_paused_until`: Unix seconds as text; missing means no time (only Resume lifts it).
//! - `ai_usage_last`: the last usage reading as JSON, with its read time.
//!
//! A stored value that does not parse is read as missing and logged; it is never rewritten here.

use rusqlite::{params, TransactionBehavior};
use serde::{Deserialize, Serialize};

use super::error::StorageError;
use super::Storage;

pub const KEY_ENABLED: &str = "ai_enabled";
pub const KEY_WARN_AT: &str = "ai_warn_at";
pub const KEY_PAUSE_AT: &str = "ai_pause_at";
pub const KEY_PAUSED_UNTIL: &str = "ai_paused_until";
pub const KEY_PAUSE_REASON: &str = "ai_pause_reason";
pub const KEY_USAGE_LAST: &str = "ai_usage_last";

/// Why AI work is paused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StoredPauseReason {
    /// A run hit the usage limit.
    Limit,
    /// The owner paused background work.
    Owner,
}

impl StoredPauseReason {
    fn as_str(self) -> &'static str {
        match self {
            StoredPauseReason::Limit => "limit",
            StoredPauseReason::Owner => "owner",
        }
    }

    fn parse(text: &str) -> Option<StoredPauseReason> {
        match text {
            "limit" => Some(StoredPauseReason::Limit),
            "owner" => Some(StoredPauseReason::Owner),
            _ => None,
        }
    }
}

/// A pause and, when known, the Unix second it lifts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct StoredPause {
    pub reason: StoredPauseReason,
    pub until: Option<i64>,
}

/// One usage window as stored. `utilization` is the raw value (**Unverified** scale).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredWindow {
    #[serde(default)]
    pub utilization: Option<f64>,
    #[serde(default)]
    pub resets_at: Option<i64>,
    #[serde(default)]
    pub status: Option<String>,
    /// When this window was read, in Unix seconds. A window kept from an earlier reading has
    /// an older time than the reading's `readAt`.
    #[serde(default)]
    pub read_at: Option<i64>,
}

/// The last usage reading: when it was read and both windows.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredReading {
    pub read_at: i64,
    #[serde(default)]
    pub five_hour: Option<StoredWindow>,
    #[serde(default)]
    pub seven_day: Option<StoredWindow>,
}

/// Everything stored for the AI control. `None` means missing (or unreadable).
#[derive(Debug, Clone, PartialEq)]
pub struct StoredAiControl {
    pub enabled: bool,
    pub warn_at: Option<i64>,
    pub pause_at: Option<i64>,
    pub pause: Option<StoredPause>,
    pub usage_last: Option<StoredReading>,
}

/// A value that did not parse is logged by key only, never by content, and read as missing.
fn unreadable<T>(key: &str) -> Option<T> {
    log::warn!("the stored setting {key} could not be read; it is treated as missing");
    None
}

fn parse_number(key: &str, text: Option<String>) -> Option<i64> {
    let text = text?;
    text.trim().parse::<i64>().ok().or_else(|| unreadable(key))
}

impl Storage {
    /// Reads the six AI control keys.
    pub fn ai_control_settings(&self) -> Result<StoredAiControl, StorageError> {
        let enabled = match self.get_setting(KEY_ENABLED)?.as_deref() {
            None | Some("true") => true,
            Some("false") => false,
            // Not a known word: AI stays on, as when the key is missing.
            Some(_) => unreadable::<bool>(KEY_ENABLED).unwrap_or(true),
        };
        let warn_at = parse_number(KEY_WARN_AT, self.get_setting(KEY_WARN_AT)?);
        let pause_at = parse_number(KEY_PAUSE_AT, self.get_setting(KEY_PAUSE_AT)?);
        let reason = match self.get_setting(KEY_PAUSE_REASON)? {
            None => None,
            Some(text) => StoredPauseReason::parse(&text).or_else(|| unreadable(KEY_PAUSE_REASON)),
        };
        let until = parse_number(KEY_PAUSED_UNTIL, self.get_setting(KEY_PAUSED_UNTIL)?);
        let usage_last = match self.get_setting(KEY_USAGE_LAST)? {
            None => None,
            Some(text) => serde_json::from_str::<StoredReading>(&text)
                .ok()
                .or_else(|| unreadable(KEY_USAGE_LAST)),
        };
        Ok(StoredAiControl {
            enabled,
            warn_at,
            pause_at,
            pause: reason.map(|reason| StoredPause { reason, until }),
            usage_last,
        })
    }

    /// Saves the master switch.
    pub fn set_ai_enabled(&self, on: bool) -> Result<(), StorageError> {
        self.set_setting(KEY_ENABLED, if on { "true" } else { "false" })
    }

    /// Saves both thresholds in one transaction. The caller checks them first.
    pub fn set_ai_thresholds(&mut self, warn_at: i64, pause_at: i64) -> Result<(), StorageError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        for (key, value) in [(KEY_WARN_AT, warn_at), (KEY_PAUSE_AT, pause_at)] {
            tx.execute(UPSERT_SQL, params![key, value.to_string()])?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Saves the pause (reason and time) in one transaction, or removes both keys for `None`.
    pub fn set_ai_pause(&mut self, pause: Option<&StoredPause>) -> Result<(), StorageError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        match pause {
            Some(p) => {
                tx.execute(UPSERT_SQL, params![KEY_PAUSE_REASON, p.reason.as_str()])?;
                match p.until {
                    Some(t) => tx.execute(UPSERT_SQL, params![KEY_PAUSED_UNTIL, t.to_string()])?,
                    None => tx.execute(DELETE_SQL, params![KEY_PAUSED_UNTIL])?,
                };
            }
            None => {
                tx.execute(DELETE_SQL, params![KEY_PAUSE_REASON])?;
                tx.execute(DELETE_SQL, params![KEY_PAUSED_UNTIL])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Saves the last usage reading as JSON.
    pub fn set_ai_usage_last(&self, reading: &StoredReading) -> Result<(), StorageError> {
        let text = serde_json::to_string(reading)
            .map_err(|e| StorageError::Invalid(format!("the usage reading is not valid: {e}")))?;
        self.set_setting(KEY_USAGE_LAST, &text)
    }
}

const UPSERT_SQL: &str = "INSERT INTO settings (key, value, updated_at)
     VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at";

const DELETE_SQL: &str = "DELETE FROM settings WHERE key = ?1";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::testing::open_temp;

    fn reading() -> StoredReading {
        StoredReading {
            read_at: 1_794_990_000,
            five_hour: Some(StoredWindow {
                utilization: Some(0.57),
                resets_at: Some(1_794_999_600),
                status: Some("allowed".into()),
                read_at: Some(1_794_990_000),
            }),
            seven_day: None,
        }
    }

    #[test]
    fn ai_control_settings_defaults_when_no_key_is_stored() {
        let (s, _dir) = open_temp();
        let got = s.ai_control_settings().unwrap();
        assert_eq!(
            got,
            StoredAiControl {
                enabled: true,
                warn_at: None,
                pause_at: None,
                pause: None,
                usage_last: None,
            }
        );
    }

    #[test]
    fn ai_enabled_and_thresholds_round_trip_in_settings_keys_and_survive_reopen() {
        let (mut s, dir) = open_temp();
        s.set_ai_enabled(false).unwrap();
        s.set_ai_thresholds(50, 90).unwrap();
        assert_eq!(
            s.get_setting(KEY_ENABLED).unwrap().as_deref(),
            Some("false")
        );
        assert_eq!(s.get_setting(KEY_WARN_AT).unwrap().as_deref(), Some("50"));
        assert_eq!(s.get_setting(KEY_PAUSE_AT).unwrap().as_deref(), Some("90"));
        drop(s);
        let s = Storage::open(&dir.path().join("mnemo.db")).unwrap();
        let got = s.ai_control_settings().unwrap();
        assert!(!got.enabled);
        assert_eq!((got.warn_at, got.pause_at), (Some(50), Some(90)));
        s.set_ai_enabled(true).unwrap();
        assert!(s.ai_control_settings().unwrap().enabled);
    }

    #[test]
    fn ai_pause_limit_state_is_stored_in_settings_keys_and_cleared() {
        let (mut s, _dir) = open_temp();
        let limit = StoredPause {
            reason: StoredPauseReason::Limit,
            until: Some(1_794_999_600),
        };
        s.set_ai_pause(Some(&limit)).unwrap();
        assert_eq!(
            s.get_setting(KEY_PAUSE_REASON).unwrap().as_deref(),
            Some("limit")
        );
        assert_eq!(
            s.get_setting(KEY_PAUSED_UNTIL).unwrap().as_deref(),
            Some("1794999600")
        );
        assert_eq!(s.ai_control_settings().unwrap().pause, Some(limit));
        // An owner pause has no time: the old time is removed with it.
        let owner = StoredPause {
            reason: StoredPauseReason::Owner,
            until: None,
        };
        s.set_ai_pause(Some(&owner)).unwrap();
        assert_eq!(s.get_setting(KEY_PAUSED_UNTIL).unwrap(), None);
        assert_eq!(s.ai_control_settings().unwrap().pause, Some(owner));
        s.set_ai_pause(None).unwrap();
        assert_eq!(s.get_setting(KEY_PAUSE_REASON).unwrap(), None);
        assert_eq!(s.ai_control_settings().unwrap().pause, None);
    }

    #[test]
    fn ai_usage_last_reading_is_stored_as_json_with_its_read_at() {
        let (s, _dir) = open_temp();
        s.set_ai_usage_last(&reading()).unwrap();
        let text = s.get_setting(KEY_USAGE_LAST).unwrap().unwrap();
        let json: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(json["readAt"], 1_794_990_000);
        assert_eq!(json["fiveHour"]["utilization"], 0.57);
        assert_eq!(json["fiveHour"]["resetsAt"], 1_794_999_600);
        assert!(json["sevenDay"].is_null());
        assert_eq!(s.ai_control_settings().unwrap().usage_last, Some(reading()));
    }

    #[test]
    fn ai_control_settings_reads_broken_values_as_missing_and_leaves_them_stored() {
        let (s, _dir) = open_temp();
        s.set_setting(KEY_ENABLED, "maybe").unwrap();
        s.set_setting(KEY_WARN_AT, "sixty").unwrap();
        s.set_setting(KEY_PAUSE_AT, "9.5").unwrap();
        s.set_setting(KEY_PAUSE_REASON, "sleepy").unwrap();
        s.set_setting(KEY_PAUSED_UNTIL, "soon").unwrap();
        s.set_setting(KEY_USAGE_LAST, "{not json").unwrap();
        let got = s.ai_control_settings().unwrap();
        assert!(got.enabled);
        assert_eq!((got.warn_at, got.pause_at), (None, None));
        assert_eq!(got.pause, None);
        assert_eq!(got.usage_last, None);
        // Never repaired silently in the file.
        assert_eq!(
            s.get_setting(KEY_USAGE_LAST).unwrap().as_deref(),
            Some("{not json")
        );
        // A limit pause with a broken time is still a pause, with no time.
        s.set_setting(KEY_PAUSE_REASON, "limit").unwrap();
        assert_eq!(
            s.ai_control_settings().unwrap().pause,
            Some(StoredPause {
                reason: StoredPauseReason::Limit,
                until: None
            })
        );
    }
}
