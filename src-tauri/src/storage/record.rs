//! The shared base of every record: UUID id, UTC ISO 8601 times set by the core,
//! and a soft-delete mark. Item tables (#14) build on it.
#![allow(dead_code)] // First user is the item tables in #14.

use std::time::{SystemTime, UNIX_EPOCH};

use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordBase {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

impl RecordBase {
    pub fn new() -> Self {
        Self::new_at(&now_iso())
    }

    /// Same as `new` with a given time, so tests need no clock.
    pub fn new_at(now: &str) -> Self {
        RecordBase {
            id: Uuid::new_v4().to_string(),
            created_at: now.to_string(),
            updated_at: now.to_string(),
            deleted_at: None,
        }
    }

    pub fn touch_at(&mut self, now: &str) {
        self.updated_at = now.to_string();
    }

    pub fn soft_delete_at(&mut self, now: &str) {
        self.deleted_at = Some(now.to_string());
        self.updated_at = now.to_string();
    }

    pub fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }
}

impl Default for RecordBase {
    fn default() -> Self {
        Self::new()
    }
}

/// The current time as UTC ISO 8601, for example `2026-11-18T08:30:00Z`.
pub fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format_utc(secs)
}

/// Formats Unix seconds as UTC ISO 8601 (civil-from-days algorithm).
pub fn format_utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3_600,
        rem % 3_600 / 60,
        rem % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_known_instants() {
        assert_eq!(format_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(format_utc(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(format_utc(1_767_225_599), "2025-12-31T23:59:59Z");
    }

    #[test]
    fn new_record_has_uuid_and_equal_times() {
        let r = RecordBase::new_at("2026-01-01T00:00:00Z");
        assert!(Uuid::parse_str(&r.id).is_ok());
        assert_eq!(r.created_at, r.updated_at);
        assert_eq!(r.deleted_at, None);
        assert!(!r.is_deleted());
    }

    #[test]
    fn real_clock_gives_iso_utc() {
        let r = RecordBase::new();
        assert_eq!(r.created_at.len(), 20);
        assert!(r.created_at.ends_with('Z'));
    }

    #[test]
    fn ids_are_unique() {
        let a = RecordBase::new_at("t");
        let b = RecordBase::new_at("t");
        assert_ne!(a.id, b.id);
    }

    #[test]
    fn touch_and_soft_delete_set_times() {
        let mut r = RecordBase::new_at("2026-01-01T00:00:00Z");
        r.touch_at("2026-01-02T00:00:00Z");
        assert_eq!(r.updated_at, "2026-01-02T00:00:00Z");
        assert_eq!(r.created_at, "2026-01-01T00:00:00Z");
        r.soft_delete_at("2026-01-03T00:00:00Z");
        assert_eq!(r.deleted_at.as_deref(), Some("2026-01-03T00:00:00Z"));
        assert!(r.is_deleted());
    }
}
