// Usage readings: the share of the plan's usage windows already used, read from the
// `rate_limit_event` that `claude -p` prints (stream-json lines, and elements of the json output
// array on macOS). The scheduler's AI control (`scheduler::ai_control`) stores the last reading
// and decides from it.
//
// What was seen (spike-02, docs/spikes/spike-02-claude-p.md, Claude Code 2.1.327):
// `rate_limit_info` holds `status`, `resetsAt`, `rateLimitType` and `unifiedWindows` with
// `five_hour` and `seven_day`, each with `utilization`, `resetsAt` (Unix seconds) and `status`.
//
// **Unverified** (owner decision 1 on #23): the scale of `utilization`. It is read as a fraction
// 0..1 and shown as `round(utilization * 100)` percent; 0.1 may in fact mean 0.1%. The owner
// compares a live value with the claude.ai usage page, then pins the scale in a unit test here
// and in the spike doc. Until then the UI marks every percent "Unverified".
//
// A field with an unexpected type is dropped on its own: a bad usage line never fails a run and
// never hides a `rejected` status (the event itself is read loosely, see `claude::Event`).

use std::sync::Arc;

use serde_json::Value;

/// The latest a `resetsAt` may be: a window is at most 7 days long, plus one day of slack. A time
/// further away, or one in the past, is dropped (no time is ever guessed).
pub const MAX_RESET_AHEAD_SECS: i64 = 8 * 24 * 60 * 60;

/// One usage window as read. Each field is `None` when it was missing or not the expected type.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct UsageWindow {
    /// The used share, read as a fraction 0..1 (**Unverified** scale).
    pub utilization: Option<f64>,
    /// When the window resets, in Unix seconds.
    pub resets_at: Option<i64>,
    /// For example "allowed" or "rejected".
    pub status: Option<String>,
}

impl UsageWindow {
    /// The used share as a whole percent: `round(utilization * 100)`. **Unverified** scale.
    pub fn percent(&self) -> Option<i64> {
        self.utilization.map(percent_of)
    }

    fn from_value(value: &Value) -> Option<UsageWindow> {
        let window = UsageWindow {
            utilization: value
                .get("utilization")
                .and_then(Value::as_f64)
                .filter(|u| u.is_finite() && *u >= 0.0),
            resets_at: value.get("resetsAt").and_then(as_seconds),
            status: value
                .get("status")
                .and_then(Value::as_str)
                .map(str::to_string),
        };
        (window != UsageWindow::default()).then_some(window)
    }

    /// Drops a reset time that is not in `now ..= now + MAX_RESET_AHEAD_SECS`.
    fn keep_plausible_reset(&mut self, now: i64) {
        self.resets_at = self.resets_at.filter(|t| plausible_reset(*t, now));
    }
}

/// `round(utilization * 100)`, as a whole percent. **Unverified** scale.
pub fn percent_of(utilization: f64) -> i64 {
    // Far above any real value, so the cast never saturates in a way that matters.
    (utilization * 100.0).round().clamp(0.0, 1_000_000.0) as i64
}

/// True when `t` is in the future and at most `MAX_RESET_AHEAD_SECS` away.
pub fn plausible_reset(t: i64, now: i64) -> bool {
    t > now && t <= now.saturating_add(MAX_RESET_AHEAD_SECS)
}

/// A whole number of seconds; a number with a fraction is cut to whole seconds.
fn as_seconds(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| {
        value
            .as_f64()
            .filter(|f| f.is_finite() && f.abs() < 1e15)
            .map(|f| f as i64)
    })
}

/// One reading: both windows, plus the event's own status, reset time and limit type (the window
/// the event is about). Read from the `rate_limit_info` of a `rate_limit_event`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct UsageReading {
    pub five_hour: Option<UsageWindow>,
    pub seven_day: Option<UsageWindow>,
    /// `rate_limit_info.status`.
    pub status: Option<String>,
    /// `rate_limit_info.resetsAt`: the reset of the window named by `limit_type`.
    pub resets_at: Option<i64>,
    /// `rate_limit_info.rateLimitType`, for example "five_hour".
    pub limit_type: Option<String>,
}

impl UsageReading {
    /// The reading in a `rate_limit_info` value, or `None` when it holds no usage number and no
    /// reset time. Fields that are missing or of the wrong type are left out.
    pub fn from_rate_limit_info(info: &Value) -> Option<UsageReading> {
        let windows = info.get("unifiedWindows");
        let window = |key: &str| {
            windows
                .and_then(|w| w.get(key))
                .and_then(UsageWindow::from_value)
        };
        let reading = UsageReading {
            five_hour: window("five_hour"),
            seven_day: window("seven_day"),
            status: info
                .get("status")
                .and_then(Value::as_str)
                .map(str::to_string),
            resets_at: info.get("resetsAt").and_then(as_seconds),
            limit_type: info
                .get("rateLimitType")
                .and_then(Value::as_str)
                .map(str::to_string),
        };
        reading.has_data().then_some(reading)
    }

    /// True when a window has a usage number, or the event has a reset time.
    pub fn has_data(&self) -> bool {
        self.windows().any(|w| w.utilization.is_some()) || self.resets_at.is_some()
    }

    fn windows(&self) -> impl Iterator<Item = &UsageWindow> {
        self.five_hour.iter().chain(self.seven_day.iter())
    }

    /// Drops every reset time that is in the past or implausibly far away, as of `now`.
    pub fn keep_plausible_resets(&mut self, now: i64) {
        for window in [&mut self.five_hour, &mut self.seven_day]
            .into_iter()
            .flatten()
        {
            window.keep_plausible_reset(now);
        }
        self.resets_at = self.resets_at.filter(|t| plausible_reset(*t, now));
    }

    /// The reset time of the window that hit the limit, when the reading knows it and it is
    /// still ahead of `now`. The window is the one whose status is "rejected"; else the one at or
    /// above 100% (the higher one). The event's own `resetsAt` is the fallback, only when the
    /// event itself says "rejected". Never a guessed time.
    pub fn limit_reset(&self, now: i64) -> Option<i64> {
        let windows: Vec<&UsageWindow> = self.windows().collect();
        let rejected = windows
            .iter()
            .copied()
            .find(|w| w.status.as_deref() == Some("rejected"));
        let full = || {
            windows
                .iter()
                .copied()
                .filter(|w| w.utilization.is_some_and(|u| u >= 1.0))
                .max_by(|a, b| {
                    a.utilization
                        .partial_cmp(&b.utilization)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
        };
        let hit = rejected.or_else(full);
        let from_window = hit.and_then(|w| w.resets_at);
        let from_event = (self.status.as_deref() == Some("rejected"))
            .then_some(self.resets_at)
            .flatten();
        from_window
            .or(from_event)
            .filter(|t| plausible_reset(*t, now))
    }
}

/// Where readings go as they are read. The app's sink stores them in the AI control.
pub type UsageSink = Arc<dyn Fn(UsageReading) + Send + Sync>;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const NOW: i64 = 1_794_990_000;

    /// The `rate_limit_info` the spike saw (Ubuntu, stream-json), shape only.
    fn spike_info() -> Value {
        json!({
            "status": "allowed",
            "resetsAt": 1_794_999_600,
            "rateLimitType": "five_hour",
            "unifiedWindows": {
                "five_hour": {"utilization": 0.1, "resetsAt": 1_794_999_600, "status": "allowed"},
                "seven_day": {"utilization": 0.12, "resetsAt": 1_795_557_600, "status": "allowed"}
            }
        })
    }

    #[test]
    fn usage_reading_reads_five_hour_and_seven_day_utilization_and_resets_at() {
        let r = UsageReading::from_rate_limit_info(&spike_info()).unwrap();
        let five = r.five_hour.unwrap();
        let seven = r.seven_day.unwrap();
        assert_eq!(five.utilization, Some(0.1));
        assert_eq!(five.resets_at, Some(1_794_999_600));
        assert_eq!(five.status.as_deref(), Some("allowed"));
        assert_eq!(seven.utilization, Some(0.12));
        assert_eq!(seven.resets_at, Some(1_795_557_600));
        assert_eq!(r.limit_type.as_deref(), Some("five_hour"));
        assert_eq!(r.resets_at, Some(1_794_999_600));
    }

    #[test]
    fn usage_window_percent_is_utilization_times_100_rounded_unverified_scale() {
        // Unverified scale (owner decision 1): read as a fraction 0..1.
        let w = |u| UsageWindow {
            utilization: Some(u),
            ..UsageWindow::default()
        };
        assert_eq!(w(0.1).percent(), Some(10));
        assert_eq!(w(0.125).percent(), Some(13));
        assert_eq!(w(0.95).percent(), Some(95));
        assert_eq!(w(1.0).percent(), Some(100));
        assert_eq!(UsageWindow::default().percent(), None);
    }

    #[test]
    fn usage_reading_with_missing_windows_reads_what_is_there() {
        let only_five =
            json!({"status": "allowed", "unifiedWindows": {"five_hour": {"utilization": 0.4}}});
        let r = UsageReading::from_rate_limit_info(&only_five).unwrap();
        assert_eq!(r.five_hour.unwrap().percent(), Some(40));
        assert!(r.seven_day.is_none());
        // Only a status: no usage number and no time, so no reading.
        assert!(UsageReading::from_rate_limit_info(&json!({"status": "allowed"})).is_none());
        assert!(UsageReading::from_rate_limit_info(&json!({})).is_none());
    }

    #[test]
    fn usage_reading_drops_fields_of_the_wrong_type_and_keeps_the_rest() {
        let bad = json!({
            "status": "rejected",
            "resetsAt": "soon",
            "unifiedWindows": {
                "five_hour": {"utilization": "high", "resetsAt": 1_794_999_600, "status": 7},
                "seven_day": {"utilization": 0.5, "resetsAt": "x"},
                "other": 3
            }
        });
        let r = UsageReading::from_rate_limit_info(&bad).unwrap();
        let five = r.five_hour.unwrap();
        assert_eq!(five.utilization, None);
        assert_eq!(five.resets_at, Some(1_794_999_600));
        assert_eq!(five.status, None);
        let seven = r.seven_day.unwrap();
        assert_eq!(seven.utilization, Some(0.5));
        assert_eq!(seven.resets_at, None);
        assert_eq!(r.resets_at, None);
        // A windows value that is not an object gives no windows, and no panic.
        let odd = json!({"unifiedWindows": [1, 2], "resetsAt": 1_794_999_600});
        let r = UsageReading::from_rate_limit_info(&odd).unwrap();
        assert!(r.five_hour.is_none() && r.seven_day.is_none());
        // Negative or non-finite usage is not a usage number.
        let neg = json!({"unifiedWindows": {"five_hour": {"utilization": -0.2}}});
        assert!(UsageReading::from_rate_limit_info(&neg).is_none());
    }

    #[test]
    fn usage_reading_drops_an_implausible_resets_at() {
        let mut r = UsageReading::from_rate_limit_info(&json!({
            "resetsAt": NOW - 10,
            "unifiedWindows": {
                "five_hour": {"utilization": 0.2, "resetsAt": NOW + 3600},
                "seven_day": {"utilization": 0.3, "resetsAt": NOW + MAX_RESET_AHEAD_SECS + 1}
            }
        }))
        .unwrap();
        r.keep_plausible_resets(NOW);
        assert_eq!(r.five_hour.as_ref().unwrap().resets_at, Some(NOW + 3600));
        assert_eq!(
            r.seven_day.as_ref().unwrap().resets_at,
            None,
            "too far ahead"
        );
        assert_eq!(r.resets_at, None, "in the past");
        // Milliseconds by mistake would be far in the future: dropped, never guessed.
        assert!(!plausible_reset(NOW * 1000, NOW));
    }

    #[test]
    fn usage_reading_limit_reset_is_the_rejected_window_then_the_full_one_never_a_guess() {
        let at = |five: Value, seven: Value, top: Value| {
            UsageReading::from_rate_limit_info(&json!({
                "status": top["status"], "resetsAt": top["resetsAt"],
                "unifiedWindows": {"five_hour": five, "seven_day": seven}
            }))
            .unwrap()
            .limit_reset(NOW)
        };
        // The rejected window decides, even when the other is fuller.
        assert_eq!(
            at(
                json!({"utilization": 0.9, "resetsAt": NOW + 100, "status": "allowed"}),
                json!({"utilization": 1.0, "resetsAt": NOW + 200, "status": "rejected"}),
                json!({})
            ),
            Some(NOW + 200)
        );
        // No status: the window at or above 100%.
        assert_eq!(
            at(
                json!({"utilization": 1.02, "resetsAt": NOW + 100}),
                json!({"utilization": 0.3, "resetsAt": NOW + 200}),
                json!({})
            ),
            Some(NOW + 100)
        );
        // No window hit the limit, but the event says rejected: its own resetsAt.
        assert_eq!(
            at(
                json!({"utilization": 0.5}),
                json!({"utilization": 0.3}),
                json!({"status": "rejected", "resetsAt": NOW + 300})
            ),
            Some(NOW + 300)
        );
        // Nothing says which window, or its time is gone: no time.
        assert_eq!(
            at(
                json!({"utilization": 0.5, "resetsAt": NOW + 100}),
                json!({"utilization": 0.3}),
                json!({})
            ),
            None
        );
        assert_eq!(
            at(
                json!({"utilization": 1.0, "resetsAt": NOW - 1, "status": "rejected"}),
                json!({"utilization": 0.3}),
                json!({})
            ),
            None
        );
    }
}
