// The AI control (#23): the one "may I run?" gate. Every AI feature asks `AiControl::may_run`
// before it queues a task, and the `RunQueue` asks it again before each start. The answer is
// Allow, or Deny with a reason the UI shows: off (the master switch), limit (a run hit the usage
// limit), threshold (usage is at or above the pause line) or owner pause (the owner paused
// background work).
//
// The state is cached in memory behind one mutex and written through to storage (the six
// `ai_*` settings keys, `storage::ai_control`) on each change; a failed write leaves the cache
// as it was. `may_run` only reads the cache, so the queue can ask it under its own lock.
//
// Lock order: the queue's lock, then this control's lock, then the app storage. Listeners (the
// queue's dispatch, the UI event) are called after this control's lock is let go.

use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use super::queue::Priority;
use crate::ai::usage::{percent_of, UsageReading, UsageWindow};
use crate::storage::ai_control::{
    StoredAiControl, StoredPause, StoredPauseReason, StoredReading, StoredWindow,
};

/// The usage percent at which the screen warns, when the owner set none.
pub const DEFAULT_WARN_AT: i64 = 60;
/// The usage percent at which background work pauses, when the owner set none.
pub const DEFAULT_PAUSE_AT: i64 = 95;
/// The lowest and highest value the owner may set for either line.
pub const THRESHOLD_MIN: i64 = 1;
pub const THRESHOLD_MAX: i64 = 100;
/// The plain message for thresholds that break the rule.
pub const THRESHOLDS_MESSAGE: &str =
    "Warn and pause must be whole numbers from 1 to 100, and warn must be lower than pause.";

/// How long each usage window is. A window with no reset time stops counting this long after
/// it was read, so an old reading cannot hold background work forever.
pub const FIVE_HOUR_SECS: i64 = 5 * 60 * 60;
pub const SEVEN_DAY_SECS: i64 = 7 * 24 * 60 * 60;

/// The longest the resume timer sleeps before it looks at the wall clock again. A sleeping
/// machine stops the sleep clock, so one long sleep could wake hours late.
const TIMER_STEP: Duration = Duration::from_secs(30);

/// Why AI work may not start. Sent to the UI as `off`, `limit`, `threshold` or `owner_pause`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DenyReason {
    /// The owner turned AI off.
    Off,
    /// A run hit the usage limit: owner and background work are held.
    Limit,
    /// Usage is at or above the owner's pause line: background work waits.
    Threshold,
    /// The owner paused background work.
    OwnerPause,
}

/// The answer of `may_run`. Sent to the UI as `{"kind":"allow"}` or
/// `{"kind":"deny","reason":"..."}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Decision {
    Allow,
    Deny { reason: DenyReason },
}

impl Decision {
    fn deny(reason: DenyReason) -> Decision {
        Decision::Deny { reason }
    }
}

/// Why the control could not change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ControlError {
    /// The thresholds break the rule (`THRESHOLDS_MESSAGE`).
    InvalidThresholds,
    /// The change could not be saved; nothing changed.
    Storage(String),
    /// The stored state could not be read at start, so nothing can change.
    Unavailable,
}

impl fmt::Display for ControlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ControlError::InvalidThresholds => write!(f, "{THRESHOLDS_MESSAGE}"),
            ControlError::Storage(e) => write!(f, "the AI control could not be saved: {e}"),
            ControlError::Unavailable => write!(f, "the AI control could not be read at start"),
        }
    }
}

impl std::error::Error for ControlError {}

/// Why the store could not read or write. The text is for the log only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ControlStoreError(pub String);

/// Where the control keeps its state: the `storage::ai_control` functions behind the app's one
/// storage. Given to the control, so tests use a temporary database without Tauri.
pub trait ControlStore: Send + Sync {
    fn load(&self) -> Result<StoredAiControl, ControlStoreError>;
    fn save_enabled(&self, on: bool) -> Result<(), ControlStoreError>;
    fn save_thresholds(&self, warn_at: i64, pause_at: i64) -> Result<(), ControlStoreError>;
    fn save_pause(&self, pause: Option<&StoredPause>) -> Result<(), ControlStoreError>;
    fn save_reading(&self, reading: &StoredReading) -> Result<(), ControlStoreError>;
}

/// The time now, in Unix seconds. Tests pass a clock they set.
pub type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

/// The wall clock.
pub fn system_clock() -> Clock {
    Arc::new(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX))
            .unwrap_or(0)
    })
}

/// Called after every change of the control.
pub type Listener = Arc<dyn Fn() + Send + Sync>;

/// True for whole numbers 1..=100 with warn lower than pause.
pub fn thresholds_valid(warn_at: i64, pause_at: i64) -> bool {
    let in_range = |v: i64| (THRESHOLD_MIN..=THRESHOLD_MAX).contains(&v);
    in_range(warn_at) && in_range(pause_at) && warn_at < pause_at
}

/// One window as the screen gets it. `percent` is `None` when the window has reset (or is too
/// old) and so says nothing now. The percent is **Unverified** (see `ai::usage`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowNow {
    pub percent: Option<i64>,
    pub resets_at: Option<i64>,
    pub status: Option<String>,
}

/// A copy of the control's state at one moment, for the screen.
#[derive(Debug, Clone, PartialEq)]
pub struct ControlSnapshot {
    /// False when the stored state could not be read at start (AI then stays off).
    pub available: bool,
    pub enabled: bool,
    pub warn_at: i64,
    pub pause_at: i64,
    /// The pause in force now; a limit pause whose time has passed is not shown.
    pub pause: Option<StoredPause>,
    /// What `may_run` answers a background task now.
    pub background_gate: Decision,
    /// True when the usage level is at or above the warn line.
    pub warn: bool,
    /// The higher percent of the two windows that still count, if any.
    pub level: Option<i64>,
    /// When the stored reading was taken; `None` when there is none.
    pub read_at: Option<i64>,
    pub five_hour: Option<WindowNow>,
    pub seven_day: Option<WindowNow>,
}

struct State {
    available: bool,
    enabled: bool,
    warn_at: i64,
    pause_at: i64,
    pause: Option<StoredPause>,
    /// The stored reading (both windows, merged window by window).
    reading: Option<StoredReading>,
    /// Counts readings; a run notes it at start, so a limit error uses only later readings.
    reading_seq: u64,
    /// The latest reading as read (with the event's own status and time), kept in memory.
    last_reading: Option<(u64, UsageReading)>,
    /// Bumped on every pause change, so an older resume timer does nothing.
    timer_gen: u64,
}

/// The gate. Shared as `Arc<AiControl>` by the queue, the commands and the usage sink.
pub struct AiControl {
    store: Arc<dyn ControlStore>,
    clock: Clock,
    state: Mutex<State>,
    listeners: Mutex<Vec<Listener>>,
    timer_step: Duration,
    me: Weak<AiControl>,
}

/// The percent of a window that still counts at `now`: its reset time has not passed, or, with
/// no reset time, the window is younger than its own length.
fn live_percent(window: &StoredWindow, read_at: i64, length: i64, now: i64) -> Option<i64> {
    let utilization = window.utilization?;
    let alive = match window.resets_at {
        Some(reset) => now < reset,
        None => now < window.read_at.unwrap_or(read_at).saturating_add(length),
    };
    alive.then(|| percent_of(utilization))
}

fn window_now(window: &StoredWindow, read_at: i64, length: i64, now: i64) -> WindowNow {
    WindowNow {
        percent: live_percent(window, read_at, length, now),
        resets_at: window.resets_at,
        status: window.status.clone(),
    }
}

impl State {
    /// The higher percent of the windows that still count.
    fn level(&self, now: i64) -> Option<i64> {
        let reading = self.reading.as_ref()?;
        let five = reading
            .five_hour
            .as_ref()
            .and_then(|w| live_percent(w, reading.read_at, FIVE_HOUR_SECS, now));
        let seven = reading
            .seven_day
            .as_ref()
            .and_then(|w| live_percent(w, reading.read_at, SEVEN_DAY_SECS, now));
        five.max(seven)
    }

    /// The pause in force at `now`. A limit pause whose time has passed is lifted, even before
    /// the timer saves that.
    fn pause_now(&self, now: i64) -> Option<StoredPause> {
        self.pause.filter(|p| !limit_lifted(p, now))
    }

    fn decide(&self, priority: Priority, now: i64) -> Decision {
        if !self.available || !self.enabled {
            return Decision::deny(DenyReason::Off);
        }
        match self.pause_now(now).map(|p| p.reason) {
            Some(StoredPauseReason::Limit) => return Decision::deny(DenyReason::Limit),
            Some(StoredPauseReason::Owner) if priority == Priority::Background => {
                return Decision::deny(DenyReason::OwnerPause)
            }
            _ => {}
        }
        if priority == Priority::Background && self.level(now).is_some_and(|l| l >= self.pause_at) {
            return Decision::deny(DenyReason::Threshold);
        }
        Decision::Allow
    }
}

/// True for a limit pause whose stored time has come.
fn limit_lifted(pause: &StoredPause, now: i64) -> bool {
    pause.reason == StoredPauseReason::Limit && pause.until.is_some_and(|until| now >= until)
}

fn stored_window(window: &UsageWindow, now: i64) -> StoredWindow {
    StoredWindow {
        utilization: window.utilization,
        resets_at: window.resets_at,
        status: window.status.clone(),
        read_at: Some(now),
    }
}

/// A new window replaces the old one only when it has a usage number.
fn merge_window(
    new: Option<&UsageWindow>,
    old: Option<&StoredWindow>,
    now: i64,
) -> Option<StoredWindow> {
    match new.filter(|w| w.utilization.is_some()) {
        Some(w) => Some(stored_window(w, now)),
        None => old.cloned(),
    }
}

impl AiControl {
    /// Reads the stored state and builds the gate. When the state cannot be read, the gate
    /// fails closed: every task gets Off, because the owner may have turned AI off before.
    pub fn new(store: Arc<dyn ControlStore>, clock: Clock) -> Arc<AiControl> {
        Self::with_timer_step(store, clock, TIMER_STEP)
    }

    /// `new` with the longest sleep of the resume timer. Tests use a short one.
    pub fn with_timer_step(
        store: Arc<dyn ControlStore>,
        clock: Clock,
        timer_step: Duration,
    ) -> Arc<AiControl> {
        let state = match store.load() {
            Ok(stored) => {
                let (warn_at, pause_at) = match (stored.warn_at, stored.pause_at) {
                    (None, None) => (DEFAULT_WARN_AT, DEFAULT_PAUSE_AT),
                    (w, p) => {
                        let (w, p) = (w.unwrap_or(DEFAULT_WARN_AT), p.unwrap_or(DEFAULT_PAUSE_AT));
                        if thresholds_valid(w, p) {
                            (w, p)
                        } else {
                            log::warn!(
                                "the stored AI thresholds break the rule; the defaults are used"
                            );
                            (DEFAULT_WARN_AT, DEFAULT_PAUSE_AT)
                        }
                    }
                };
                State {
                    available: true,
                    enabled: stored.enabled,
                    warn_at,
                    pause_at,
                    pause: stored.pause,
                    reading: stored.usage_last,
                    reading_seq: 0,
                    last_reading: None,
                    timer_gen: 0,
                }
            }
            Err(e) => {
                log::error!(
                    "could not read the AI control settings; AI stays off: {}",
                    e.0
                );
                State {
                    available: false,
                    enabled: false,
                    warn_at: DEFAULT_WARN_AT,
                    pause_at: DEFAULT_PAUSE_AT,
                    pause: None,
                    reading: None,
                    reading_seq: 0,
                    last_reading: None,
                    timer_gen: 0,
                }
            }
        };
        let control = Arc::new_cyclic(|me| AiControl {
            store,
            clock,
            state: Mutex::new(state),
            listeners: Mutex::new(Vec::new()),
            timer_step,
            me: me.clone(),
        });
        // A limit pause stored by an earlier start: lift it now when its time passed, else wait
        // for its time.
        let now = control.now();
        let timer = {
            let mut st = control.lock();
            control.settle(&mut st, now);
            st.pause
                .filter(|p| p.reason == StoredPauseReason::Limit)
                .and_then(|p| p.until)
                .map(|until| (st.timer_gen, until))
        };
        if let Some((generation, until)) = timer {
            control.arm_timer(generation, until);
        }
        control
    }

    /// The time now on the control's clock.
    pub fn now(&self) -> i64 {
        (self.clock)()
    }

    /// A poisoned lock is taken over: the state is plain data and stays usable.
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// May a task of `priority` start at `now`? Only reads; never writes and never calls a
    /// listener, so the queue may ask it while it holds its own lock.
    pub fn may_run(&self, priority: Priority, now: i64) -> Decision {
        self.lock().decide(priority, now)
    }

    /// True when usage is at or above the warn line (for the screen's banner only).
    pub fn warn(&self, now: i64) -> bool {
        let st = self.lock();
        st.level(now).is_some_and(|l| l >= st.warn_at)
    }

    /// How many usage readings have arrived. A run notes this when it starts.
    pub fn reading_seq(&self) -> u64 {
        self.lock().reading_seq
    }

    /// Adds a listener, called after every change (and when a limit pause lifts).
    pub fn subscribe(&self, listener: Listener) {
        self.listeners
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(listener);
    }

    fn notify(&self) {
        let listeners: Vec<Listener> = self
            .listeners
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        for listener in listeners {
            listener();
        }
    }

    /// Saves the lift of a limit pause whose time has come. A failed write is logged; the pause
    /// still counts as lifted (see `State::pause_now`) and the next change tries again.
    fn settle(&self, st: &mut State, now: i64) {
        if let Some(pause) = st.pause.filter(|p| limit_lifted(p, now)) {
            match self.store.save_pause(None) {
                Ok(()) => {
                    log::info!("the usage limit pause lifted at its reset time");
                    st.pause = None;
                    st.timer_gen += 1;
                }
                Err(e) => log::error!(
                    "could not save the lift of the limit pause (until {:?}): {}",
                    pause.until,
                    e.0
                ),
            }
        }
    }

    /// Runs one change under the lock: first the lift of a passed limit pause, then `change`,
    /// which writes the store first and the cache only after the write worked. Then the timer
    /// (when `change` returns a limit time) and the listeners, outside the lock.
    fn change(
        &self,
        now: i64,
        change: impl FnOnce(&mut State, &dyn ControlStore) -> Result<Option<i64>, ControlError>,
    ) -> Result<(), ControlError> {
        let timer = {
            let mut st = self.lock();
            if !st.available {
                return Err(ControlError::Unavailable);
            }
            self.settle(&mut st, now);
            change(&mut st, self.store.as_ref())?.map(|until| (st.timer_gen, until))
        };
        if let Some((generation, until)) = timer {
            self.arm_timer(generation, until);
        }
        self.notify();
        Ok(())
    }

    fn save_pause(
        st: &mut State,
        store: &dyn ControlStore,
        pause: Option<StoredPause>,
    ) -> Result<(), ControlError> {
        store
            .save_pause(pause.as_ref())
            .map_err(|e| ControlError::Storage(e.0))?;
        st.pause = pause;
        st.timer_gen += 1;
        Ok(())
    }

    /// The master switch. Off denies every task; the queue then ends every waiting run as
    /// cancelled, and running runs finish.
    pub fn set_enabled(&self, on: bool) -> Result<(), ControlError> {
        self.change(self.now(), |st, store| {
            store
                .save_enabled(on)
                .map_err(|e| ControlError::Storage(e.0))?;
            st.enabled = on;
            Ok(None)
        })
    }

    /// Sets the warn and pause lines: whole numbers 1 to 100, warn lower than pause.
    pub fn set_thresholds(&self, warn_at: i64, pause_at: i64) -> Result<(), ControlError> {
        if !thresholds_valid(warn_at, pause_at) {
            return Err(ControlError::InvalidThresholds);
        }
        self.change(self.now(), |st, store| {
            store
                .save_thresholds(warn_at, pause_at)
                .map_err(|e| ControlError::Storage(e.0))?;
            st.warn_at = warn_at;
            st.pause_at = pause_at;
            Ok(None)
        })
    }

    /// The owner pauses background work. Owner tasks still run. A limit pause in force stays
    /// (it holds owner tasks too).
    pub fn pause(&self) -> Result<(), ControlError> {
        let now = self.now();
        self.change(now, |st, store| {
            if st.pause_now(now).is_some() {
                return Ok(None);
            }
            let owner = StoredPause {
                reason: StoredPauseReason::Owner,
                until: None,
            };
            Self::save_pause(st, store, Some(owner))?;
            Ok(None)
        })
    }

    /// Lifts any pause at once, the limit pause included.
    pub fn resume(&self) -> Result<(), ControlError> {
        self.change(self.now(), |st, store| {
            Self::save_pause(st, store, None)?;
            Ok(None)
        })
    }

    /// A usage reading arrived (from the runner's sink). Times in the past or implausibly far
    /// ahead are dropped; each window with a usage number replaces the stored one. A failed
    /// write is logged and keeps the stored reading; the reading still counts for a limit error.
    pub fn on_usage_reading(&self, mut reading: UsageReading, now: i64) {
        reading.keep_plausible_resets(now);
        let result = self.change(now, |st, store| {
            st.reading_seq += 1;
            st.last_reading = Some((st.reading_seq, reading.clone()));
            let old = st.reading.as_ref();
            let merged = StoredReading {
                read_at: now,
                five_hour: merge_window(
                    reading.five_hour.as_ref(),
                    old.and_then(|r| r.five_hour.as_ref()),
                    now,
                ),
                seven_day: merge_window(
                    reading.seven_day.as_ref(),
                    old.and_then(|r| r.seven_day.as_ref()),
                    now,
                ),
            };
            let has_usage = reading
                .five_hour
                .iter()
                .chain(reading.seven_day.iter())
                .any(|w| w.utilization.is_some());
            if has_usage {
                match store.save_reading(&merged) {
                    Ok(()) => st.reading = Some(merged),
                    Err(e) => log::error!("could not save the usage reading: {}", e.0),
                }
            }
            Ok(None)
        });
        if let Err(e) = result {
            log::error!("a usage reading was not used: {e}");
        }
    }

    /// A run that started when `reading_seq` was `since_seq` ended at the usage limit. Owner and
    /// background work are held. The pause lifts at the reset time of the window that hit the
    /// limit, taken only from a reading that arrived after the run started and only when it is
    /// in the future; otherwise only Resume lifts it. No time is ever guessed.
    pub fn on_limit_error(&self, since_seq: u64, now: i64) {
        let result = self.change(now, |st, store| {
            let found = st
                .last_reading
                .as_ref()
                .filter(|(seq, _)| *seq > since_seq)
                .and_then(|(_, r)| r.limit_reset(now));
            // A limit pause already in force keeps a known time when this run gives none.
            let kept = st
                .pause_now(now)
                .filter(|p| p.reason == StoredPauseReason::Limit)
                .and_then(|p| p.until);
            let until = found.or(kept);
            let limit = StoredPause {
                reason: StoredPauseReason::Limit,
                until,
            };
            Self::save_pause(st, store, Some(limit))?;
            log::info!(
                "AI work is held at the usage limit ({})",
                if until.is_some() {
                    "until the window resets"
                } else {
                    "until Resume"
                }
            );
            Ok(until)
        });
        if let Err(e) = result {
            log::error!("could not save the usage limit pause: {e}");
        }
    }

    /// Saves the lift of a passed limit pause and tells the listeners. The resume timer calls
    /// it; it is safe to call at any time.
    pub fn tick(&self) {
        {
            let mut st = self.lock();
            if st.available {
                let now = self.now();
                self.settle(&mut st, now);
            }
        }
        self.notify();
    }

    /// One thread waits for the reset time, looking at the wall clock at least every
    /// `timer_step`, then lifts the pause. A newer pause change makes it stop doing anything.
    fn arm_timer(&self, generation: u64, until: i64) {
        let me = self.me.clone();
        let step = self.timer_step;
        let spawned = std::thread::Builder::new()
            .name("mnemo-ai-resume".into())
            .spawn(move || loop {
                let Some(control) = me.upgrade() else {
                    return;
                };
                if control.lock().timer_gen != generation {
                    return;
                }
                let now = control.now();
                if now >= until {
                    control.tick();
                    return;
                }
                let left = Duration::from_secs(u64::try_from(until - now).unwrap_or(0));
                drop(control);
                std::thread::sleep(left.min(step));
            });
        if let Err(e) = spawned {
            log::error!("could not start the resume timer of the limit pause: {e}");
        }
    }

    /// The state at `now`, for the screen.
    pub fn snapshot(&self, now: i64) -> ControlSnapshot {
        let st = self.lock();
        let level = st.level(now);
        let reading = st.reading.as_ref();
        ControlSnapshot {
            available: st.available,
            enabled: st.enabled,
            warn_at: st.warn_at,
            pause_at: st.pause_at,
            pause: st.pause_now(now),
            background_gate: st.decide(Priority::Background, now),
            warn: level.is_some_and(|l| l >= st.warn_at),
            level,
            read_at: reading.map(|r| r.read_at),
            five_hour: reading.and_then(|r| {
                r.five_hour
                    .as_ref()
                    .map(|w| window_now(w, r.read_at, FIVE_HOUR_SECS, now))
            }),
            seven_day: reading.and_then(|r| {
                r.seven_day
                    .as_ref()
                    .map(|w| window_now(w, r.read_at, SEVEN_DAY_SECS, now))
            }),
        }
    }
}

/// A control on an in-memory store, for tests of the queue and the commands.
#[cfg(test)]
pub(crate) mod testing {
    use super::*;

    /// Keeps the stored state in memory.
    pub struct MemoryStore(Mutex<StoredAiControl>);

    impl MemoryStore {
        fn get(&self) -> MutexGuard<'_, StoredAiControl> {
            self.0.lock().unwrap_or_else(|e| e.into_inner())
        }
    }

    impl ControlStore for MemoryStore {
        fn load(&self) -> Result<StoredAiControl, ControlStoreError> {
            Ok(self.get().clone())
        }
        fn save_enabled(&self, on: bool) -> Result<(), ControlStoreError> {
            self.get().enabled = on;
            Ok(())
        }
        fn save_thresholds(&self, warn_at: i64, pause_at: i64) -> Result<(), ControlStoreError> {
            let mut s = self.get();
            s.warn_at = Some(warn_at);
            s.pause_at = Some(pause_at);
            Ok(())
        }
        fn save_pause(&self, pause: Option<&StoredPause>) -> Result<(), ControlStoreError> {
            self.get().pause = pause.copied();
            Ok(())
        }
        fn save_reading(&self, reading: &StoredReading) -> Result<(), ControlStoreError> {
            self.get().usage_last = Some(reading.clone());
            Ok(())
        }
    }

    /// A control with nothing stored (AI on, default lines) and the wall clock.
    pub fn open_control() -> Arc<AiControl> {
        let store = MemoryStore(Mutex::new(StoredAiControl {
            enabled: true,
            warn_at: None,
            pause_at: None,
            pause: None,
            usage_last: None,
        }));
        AiControl::new(Arc::new(store), system_clock())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering};

    use crate::storage::testing::{open_temp, TempDir};
    use crate::storage::Storage;

    const NOW: i64 = 1_794_990_000;
    const HOUR: i64 = 60 * 60;

    /// The control's store on a temporary database. `fail` makes every write fail.
    pub(super) struct TestStore {
        storage: Mutex<Storage>,
        pub(super) fail: AtomicBool,
        _dir: TempDir,
    }

    impl TestStore {
        pub(super) fn new() -> Arc<TestStore> {
            let (storage, dir) = open_temp();
            Arc::new(TestStore {
                storage: Mutex::new(storage),
                fail: AtomicBool::new(false),
                _dir: dir,
            })
        }

        pub(super) fn storage(&self) -> MutexGuard<'_, Storage> {
            self.storage.lock().unwrap_or_else(|e| e.into_inner())
        }

        fn check(&self) -> Result<(), ControlStoreError> {
            if self.fail.load(Ordering::SeqCst) {
                Err(ControlStoreError("disk full".into()))
            } else {
                Ok(())
            }
        }
    }

    fn err(e: crate::storage::StorageError) -> ControlStoreError {
        ControlStoreError(e.to_string())
    }

    impl ControlStore for TestStore {
        fn load(&self) -> Result<StoredAiControl, ControlStoreError> {
            self.storage().ai_control_settings().map_err(err)
        }
        fn save_enabled(&self, on: bool) -> Result<(), ControlStoreError> {
            self.check()?;
            self.storage().set_ai_enabled(on).map_err(err)
        }
        fn save_thresholds(&self, warn_at: i64, pause_at: i64) -> Result<(), ControlStoreError> {
            self.check()?;
            self.storage()
                .set_ai_thresholds(warn_at, pause_at)
                .map_err(err)
        }
        fn save_pause(&self, pause: Option<&StoredPause>) -> Result<(), ControlStoreError> {
            self.check()?;
            self.storage().set_ai_pause(pause).map_err(err)
        }
        fn save_reading(&self, reading: &StoredReading) -> Result<(), ControlStoreError> {
            self.check()?;
            self.storage().set_ai_usage_last(reading).map_err(err)
        }
    }

    /// A clock the test sets.
    pub(super) fn test_clock(start: i64) -> (Clock, Arc<AtomicI64>) {
        let at = Arc::new(AtomicI64::new(start));
        let read = at.clone();
        (Arc::new(move || read.load(Ordering::SeqCst)), at)
    }

    fn control() -> (Arc<AiControl>, Arc<TestStore>, Arc<AtomicI64>) {
        let store = TestStore::new();
        let (clock, at) = test_clock(NOW);
        (AiControl::new(store.clone(), clock), store, at)
    }

    /// A reading with these percents (0..100) and reset times.
    pub(super) fn reading(
        five: Option<(f64, Option<i64>)>,
        seven: Option<(f64, Option<i64>)>,
    ) -> UsageReading {
        let window = |w: Option<(f64, Option<i64>)>| {
            w.map(|(p, resets_at)| UsageWindow {
                utilization: Some(p / 100.0),
                resets_at,
                status: Some("allowed".into()),
            })
        };
        UsageReading {
            five_hour: window(five),
            seven_day: window(seven),
            status: Some("allowed".into()),
            ..UsageReading::default()
        }
    }

    const OWNER: Priority = Priority::Owner;
    const BACKGROUND: Priority = Priority::Background;
    const ALLOW: Decision = Decision::Allow;
    fn deny(reason: DenyReason) -> Decision {
        Decision::Deny { reason }
    }

    #[test]
    fn ai_control_deny_reasons_serialise_as_snake_case_for_the_ui() {
        let json = |d: Decision| serde_json::to_value(d).unwrap();
        assert_eq!(json(ALLOW), serde_json::json!({"kind": "allow"}));
        for (reason, word) in [
            (DenyReason::Off, "off"),
            (DenyReason::Limit, "limit"),
            (DenyReason::Threshold, "threshold"),
            (DenyReason::OwnerPause, "owner_pause"),
        ] {
            assert_eq!(
                json(deny(reason)),
                serde_json::json!({"kind": "deny", "reason": word})
            );
        }
    }

    #[test]
    fn ai_control_defaults_are_60_and_95_from_the_one_config_place() {
        assert_eq!((DEFAULT_WARN_AT, DEFAULT_PAUSE_AT), (60, 95));
        let (c, _store, _at) = control();
        let s = c.snapshot(NOW);
        assert_eq!((s.warn_at, s.pause_at), (60, 95));
        assert!(s.enabled);
        assert_eq!(c.may_run(OWNER, NOW), ALLOW);
        assert_eq!(c.may_run(BACKGROUND, NOW), ALLOW);
    }

    #[test]
    fn ai_control_switch_off_denies_owner_and_background_with_reason_off() {
        let (c, store, _at) = control();
        c.set_enabled(false).unwrap();
        assert_eq!(c.may_run(OWNER, NOW), deny(DenyReason::Off));
        assert_eq!(c.may_run(BACKGROUND, NOW), deny(DenyReason::Off));
        // Stored: a new control on the same storage is off too.
        let (clock, _) = test_clock(NOW);
        let again = AiControl::new(store.clone(), clock);
        assert_eq!(again.may_run(OWNER, NOW), deny(DenyReason::Off));
        c.set_enabled(true).unwrap();
        assert_eq!(c.may_run(OWNER, NOW), ALLOW);
    }

    #[test]
    fn ai_control_at_or_above_the_pause_line_background_gets_threshold_and_owner_runs() {
        let (c, _store, _at) = control();
        c.on_usage_reading(reading(Some((95.0, Some(NOW + HOUR))), None), NOW);
        assert_eq!(c.may_run(BACKGROUND, NOW), deny(DenyReason::Threshold));
        assert_eq!(c.may_run(OWNER, NOW), ALLOW);
        c.on_usage_reading(reading(Some((99.0, Some(NOW + HOUR))), None), NOW);
        assert_eq!(c.may_run(BACKGROUND, NOW), deny(DenyReason::Threshold));
    }

    #[test]
    fn ai_control_below_the_pause_line_both_run() {
        let (c, _store, _at) = control();
        c.on_usage_reading(
            reading(Some((94.0, Some(NOW + HOUR))), Some((10.0, None))),
            NOW,
        );
        assert_eq!(c.may_run(BACKGROUND, NOW), ALLOW);
        assert_eq!(c.may_run(OWNER, NOW), ALLOW);
        // With no reading at all there is no threshold denial (the run count is shown).
        let (fresh, _s, _a) = control();
        assert_eq!(fresh.may_run(BACKGROUND, NOW), ALLOW);
    }

    #[test]
    fn ai_control_the_higher_window_drives_the_pause_line_and_the_warning() {
        let (c, _store, _at) = control();
        c.set_thresholds(50, 90).unwrap();
        // The seven_day window is the higher one.
        c.on_usage_reading(
            reading(
                Some((20.0, Some(NOW + HOUR))),
                Some((91.0, Some(NOW + 48 * HOUR))),
            ),
            NOW,
        );
        assert_eq!(c.may_run(BACKGROUND, NOW), deny(DenyReason::Threshold));
        assert_eq!(c.snapshot(NOW).level, Some(91));
        // The five_hour window is the higher one, between warn and pause.
        c.on_usage_reading(
            reading(
                Some((64.0, Some(NOW + HOUR))),
                Some((41.0, Some(NOW + 48 * HOUR))),
            ),
            NOW,
        );
        assert_eq!(c.may_run(BACKGROUND, NOW), ALLOW);
        assert!(c.warn(NOW));
        assert_eq!(c.snapshot(NOW).level, Some(64));
        c.on_usage_reading(
            reading(Some((49.0, Some(NOW + HOUR))), Some((10.0, None))),
            NOW,
        );
        assert!(!c.warn(NOW));
    }

    #[test]
    fn ai_control_a_window_that_has_reset_or_is_too_old_no_longer_counts() {
        let (c, _store, at) = control();
        c.on_usage_reading(reading(Some((97.0, Some(NOW + HOUR))), None), NOW);
        assert_eq!(
            c.may_run(BACKGROUND, NOW + HOUR - 1),
            deny(DenyReason::Threshold)
        );
        at.store(NOW + HOUR, Ordering::SeqCst);
        assert_eq!(c.may_run(BACKGROUND, NOW + HOUR), ALLOW);
        assert_eq!(c.snapshot(NOW + HOUR).five_hour.unwrap().percent, None);
        // No reset time: the window stops counting one window length after it was read.
        let (c, _store, _at) = control();
        c.on_usage_reading(reading(None, Some((96.0, None))), NOW);
        assert_eq!(
            c.may_run(BACKGROUND, NOW + SEVEN_DAY_SECS - 1),
            deny(DenyReason::Threshold)
        );
        assert_eq!(c.may_run(BACKGROUND, NOW + SEVEN_DAY_SECS), ALLOW);
    }

    #[test]
    fn ai_control_a_reading_with_one_window_keeps_the_other_and_is_stored_with_read_at() {
        let (c, store, _at) = control();
        c.on_usage_reading(
            reading(
                Some((30.0, Some(NOW + HOUR))),
                Some((70.0, Some(NOW + 48 * HOUR))),
            ),
            NOW,
        );
        c.on_usage_reading(reading(Some((40.0, Some(NOW + HOUR))), None), NOW + 60);
        let stored = store
            .storage()
            .ai_control_settings()
            .unwrap()
            .usage_last
            .unwrap();
        assert_eq!(stored.read_at, NOW + 60);
        assert_eq!(stored.five_hour.as_ref().unwrap().utilization, Some(0.4));
        assert_eq!(stored.seven_day.as_ref().unwrap().utilization, Some(0.7));
        assert_eq!(stored.seven_day.as_ref().unwrap().read_at, Some(NOW));
        assert_eq!(c.snapshot(NOW + 60).level, Some(70));
    }

    #[test]
    fn ai_control_limit_error_holds_owner_and_pauses_background_with_reason_limit() {
        let (c, store, _at) = control();
        let seq = c.reading_seq();
        let mut r = reading(Some((100.0, Some(NOW + 2 * HOUR))), Some((40.0, None)));
        r.five_hour.as_mut().unwrap().status = Some("rejected".into());
        c.on_usage_reading(r, NOW);
        c.on_limit_error(seq, NOW);
        assert_eq!(c.may_run(OWNER, NOW), deny(DenyReason::Limit));
        assert_eq!(c.may_run(BACKGROUND, NOW), deny(DenyReason::Limit));
        // Stored in the settings keys.
        let stored = store
            .storage()
            .ai_control_settings()
            .unwrap()
            .pause
            .unwrap();
        assert_eq!(stored.reason, StoredPauseReason::Limit);
        assert_eq!(stored.until, Some(NOW + 2 * HOUR));
    }

    #[test]
    fn ai_control_limit_pause_lifts_at_resets_at_with_an_injected_clock() {
        let (c, store, at) = control();
        let seq = c.reading_seq();
        let mut r = reading(None, Some((100.0, Some(NOW + 3 * HOUR))));
        r.seven_day.as_mut().unwrap().status = Some("rejected".into());
        c.on_usage_reading(r, NOW);
        c.on_limit_error(seq, NOW);
        // Before resetsAt: denied. At resetsAt: allowed, before the timer saves the lift.
        assert_eq!(
            c.may_run(OWNER, NOW + 3 * HOUR - 1),
            deny(DenyReason::Limit)
        );
        assert_eq!(c.may_run(OWNER, NOW + 3 * HOUR), ALLOW);
        assert_eq!(c.may_run(BACKGROUND, NOW + 3 * HOUR + 5), ALLOW);
        // The timer (here called at once) saves the lift once the clock has passed.
        at.store(NOW + 3 * HOUR, Ordering::SeqCst);
        c.tick();
        assert_eq!(store.storage().ai_control_settings().unwrap().pause, None);
    }

    #[test]
    fn ai_control_limit_pause_resets_at_lifts_by_the_timer_and_tells_listeners() {
        let store = TestStore::new();
        let (clock, at) = test_clock(NOW);
        let c = AiControl::with_timer_step(store.clone(), clock, Duration::from_millis(5));
        let heard = Arc::new(AtomicUsize::new(0));
        let h = heard.clone();
        c.subscribe(Arc::new(move || {
            h.fetch_add(1, Ordering::SeqCst);
        }));
        let seq = c.reading_seq();
        let mut r = reading(Some((100.0, Some(NOW + 60))), None);
        r.five_hour.as_mut().unwrap().status = Some("rejected".into());
        c.on_usage_reading(r, NOW);
        c.on_limit_error(seq, NOW);
        std::thread::sleep(Duration::from_millis(50));
        assert!(store
            .storage()
            .ai_control_settings()
            .unwrap()
            .pause
            .is_some());
        let before = heard.load(Ordering::SeqCst);
        at.store(NOW + 60, Ordering::SeqCst);
        let end = std::time::Instant::now() + Duration::from_secs(5);
        while store
            .storage()
            .ai_control_settings()
            .unwrap()
            .pause
            .is_some()
        {
            assert!(
                std::time::Instant::now() < end,
                "the timer did not lift the pause"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
        let end = std::time::Instant::now() + Duration::from_secs(5);
        while heard.load(Ordering::SeqCst) == before {
            assert!(
                std::time::Instant::now() < end,
                "the listeners were not told"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn ai_control_with_no_reset_time_only_resume_lifts_the_limit_pause() {
        let (c, store, _at) = control();
        // A limit error with no reading at all.
        c.on_limit_error(c.reading_seq(), NOW);
        assert_eq!(
            store
                .storage()
                .ai_control_settings()
                .unwrap()
                .pause
                .unwrap()
                .until,
            None
        );
        let far = NOW + 365 * 24 * HOUR;
        assert_eq!(c.may_run(OWNER, far), deny(DenyReason::Limit));
        // A reading from before the run started is never used for its time.
        let mut old = reading(Some((100.0, Some(NOW + HOUR))), None);
        old.five_hour.as_mut().unwrap().status = Some("rejected".into());
        let (c2, _s2, _a2) = control();
        c2.on_usage_reading(old, NOW);
        c2.on_limit_error(c2.reading_seq(), NOW);
        assert_eq!(c2.may_run(OWNER, NOW + 2 * HOUR), deny(DenyReason::Limit));
        // A reading of the run that names no limit window gives no time either: no guess.
        let (c3, _s3, _a3) = control();
        let seq = c3.reading_seq();
        c3.on_usage_reading(reading(Some((80.0, Some(NOW + HOUR))), None), NOW);
        c3.on_limit_error(seq, NOW);
        assert_eq!(c3.may_run(OWNER, NOW + 2 * HOUR), deny(DenyReason::Limit));
        c.resume().unwrap();
        assert_eq!(c.may_run(OWNER, far), ALLOW);
    }

    #[test]
    fn ai_control_resume_lifts_the_limit_pause_at_once() {
        let (c, store, _at) = control();
        let seq = c.reading_seq();
        let mut r = reading(Some((100.0, Some(NOW + 4 * HOUR))), None);
        r.five_hour.as_mut().unwrap().status = Some("rejected".into());
        c.on_usage_reading(r, NOW);
        c.on_limit_error(seq, NOW);
        assert_eq!(c.may_run(BACKGROUND, NOW), deny(DenyReason::Limit));
        c.resume().unwrap();
        assert_eq!(c.may_run(OWNER, NOW), ALLOW);
        assert_eq!(store.storage().ai_control_settings().unwrap().pause, None);
    }

    #[test]
    fn ai_control_manual_owner_pause_holds_background_and_lets_owner_tasks_run() {
        let (c, store, _at) = control();
        c.pause().unwrap();
        assert_eq!(c.may_run(BACKGROUND, NOW), deny(DenyReason::OwnerPause));
        assert_eq!(c.may_run(OWNER, NOW), ALLOW);
        assert_eq!(
            store.storage().ai_control_settings().unwrap().pause,
            Some(StoredPause {
                reason: StoredPauseReason::Owner,
                until: None
            })
        );
        // It never lifts by time; Resume lifts it.
        assert_eq!(
            c.may_run(BACKGROUND, NOW + 400 * 24 * HOUR),
            deny(DenyReason::OwnerPause)
        );
        c.resume().unwrap();
        assert_eq!(c.may_run(BACKGROUND, NOW), ALLOW);
    }

    #[test]
    fn ai_control_thresholds_outside_1_to_100_or_warn_not_below_pause_are_rejected() {
        let (c, store, _at) = control();
        for (warn, pause) in [(0, 95), (60, 101), (60, 60), (95, 60), (-1, 50), (1, 0)] {
            assert_eq!(
                c.set_thresholds(warn, pause),
                Err(ControlError::InvalidThresholds),
                "{warn}/{pause}"
            );
        }
        assert_eq!(
            ControlError::InvalidThresholds.to_string(),
            THRESHOLDS_MESSAGE
        );
        assert_eq!(store.storage().ai_control_settings().unwrap().warn_at, None);
        c.set_thresholds(1, 100).unwrap();
        assert_eq!(
            (c.snapshot(NOW).warn_at, c.snapshot(NOW).pause_at),
            (1, 100)
        );
    }

    #[test]
    fn ai_control_a_failed_storage_write_leaves_the_state_unchanged() {
        let (c, store, _at) = control();
        store.fail.store(true, Ordering::SeqCst);
        assert!(matches!(
            c.set_enabled(false),
            Err(ControlError::Storage(_))
        ));
        assert!(matches!(
            c.set_thresholds(10, 20),
            Err(ControlError::Storage(_))
        ));
        assert!(matches!(c.pause(), Err(ControlError::Storage(_))));
        let s = c.snapshot(NOW);
        assert!(s.enabled);
        assert_eq!((s.warn_at, s.pause_at), (60, 95));
        assert_eq!(s.pause, None);
        assert_eq!(c.may_run(BACKGROUND, NOW), ALLOW);
    }

    #[test]
    fn ai_control_unreadable_storage_at_start_fails_closed_with_reason_off() {
        struct Broken;
        impl ControlStore for Broken {
            fn load(&self) -> Result<StoredAiControl, ControlStoreError> {
                Err(ControlStoreError("no database".into()))
            }
            fn save_enabled(&self, _: bool) -> Result<(), ControlStoreError> {
                Err(ControlStoreError("no database".into()))
            }
            fn save_thresholds(&self, _: i64, _: i64) -> Result<(), ControlStoreError> {
                Err(ControlStoreError("no database".into()))
            }
            fn save_pause(&self, _: Option<&StoredPause>) -> Result<(), ControlStoreError> {
                Err(ControlStoreError("no database".into()))
            }
            fn save_reading(&self, _: &StoredReading) -> Result<(), ControlStoreError> {
                Err(ControlStoreError("no database".into()))
            }
        }
        let (clock, _) = test_clock(NOW);
        let c = AiControl::new(Arc::new(Broken), clock);
        assert_eq!(c.may_run(OWNER, NOW), deny(DenyReason::Off));
        assert_eq!(c.set_enabled(true), Err(ControlError::Unavailable));
        assert!(!c.snapshot(NOW).available);
    }

    #[test]
    fn ai_control_a_stored_limit_pause_whose_time_passed_lifts_at_start() {
        let store = TestStore::new();
        store
            .storage()
            .set_ai_pause(Some(&StoredPause {
                reason: StoredPauseReason::Limit,
                until: Some(NOW - 10),
            }))
            .unwrap();
        let (clock, _) = test_clock(NOW);
        let c = AiControl::new(store.clone(), clock);
        assert_eq!(c.may_run(OWNER, NOW), ALLOW);
        assert_eq!(store.storage().ai_control_settings().unwrap().pause, None);
        // A stored time still ahead keeps the pause.
        store
            .storage()
            .set_ai_pause(Some(&StoredPause {
                reason: StoredPauseReason::Limit,
                until: Some(NOW + HOUR),
            }))
            .unwrap();
        let (clock, _) = test_clock(NOW);
        let c = AiControl::new(store.clone(), clock);
        assert_eq!(c.may_run(OWNER, NOW), deny(DenyReason::Limit));
    }

    #[test]
    fn ai_control_listeners_hear_every_change_after_the_lock_is_let_go() {
        let (c, _store, _at) = control();
        let heard = Arc::new(AtomicUsize::new(0));
        let (h, me) = (heard.clone(), Arc::downgrade(&c));
        // A listener that asks the gate again would deadlock if it ran under the lock.
        c.subscribe(Arc::new(move || {
            if let Some(c) = me.upgrade() {
                let _ = c.may_run(BACKGROUND, NOW);
            }
            h.fetch_add(1, Ordering::SeqCst);
        }));
        c.set_enabled(false).unwrap();
        c.set_enabled(true).unwrap();
        c.set_thresholds(10, 20).unwrap();
        c.pause().unwrap();
        c.resume().unwrap();
        c.on_usage_reading(reading(Some((5.0, None)), None), NOW);
        c.on_limit_error(0, NOW);
        assert_eq!(heard.load(Ordering::SeqCst), 7);
    }

    // ---- The queue asks the gate (RunQueue + FakeRunner) ----

    use crate::ai::cancel::CancelToken;
    use crate::ai::fake::{FakeResult, FakeRunner};
    use crate::ai::runner::{AiError, AiOutput, AiRunner, AiTask};
    use crate::scheduler::queue::{Notifier, RunLog, RunLogError, RunQueue, RunTicket};
    use crate::storage::items::{Run, RunState};
    use crate::storage::record::now_iso;
    use crate::storage::runs::RunEnd;

    const WAIT: Duration = Duration::from_secs(5);
    const SETTLE: Duration = Duration::from_millis(150);

    /// The run log on a temporary database.
    struct StoreLog {
        storage: Mutex<Storage>,
        _dir: TempDir,
    }

    impl StoreLog {
        fn new() -> Arc<StoreLog> {
            let (storage, dir) = open_temp();
            Arc::new(StoreLog {
                storage: Mutex::new(storage),
                _dir: dir,
            })
        }
        fn state(&self, id: &str) -> RunState {
            let s = self.storage.lock().unwrap();
            s.get::<Run>(id).unwrap().state
        }
    }

    fn log_err(e: crate::storage::StorageError) -> RunLogError {
        RunLogError(e.to_string())
    }

    impl RunLog for StoreLog {
        fn enqueue(&self, task_type: &str) -> Result<String, RunLogError> {
            let s = self.storage.lock().unwrap();
            Ok(s.enqueue_run(task_type, &now_iso())
                .map_err(log_err)?
                .base
                .id)
        }
        fn start(&self, id: &str) -> Result<(), RunLogError> {
            let s = self.storage.lock().unwrap();
            s.start_run(id, &now_iso()).map_err(log_err)
        }
        fn finish(&self, id: &str, end: &RunEnd, ms: Option<i64>) -> Result<(), RunLogError> {
            let s = self.storage.lock().unwrap();
            s.finish_run(id, end, ms, &now_iso()).map_err(log_err)
        }
    }

    fn task(name: &str) -> AiTask {
        AiTask {
            name: name.into(),
            prompt: "p".into(),
            schema: String::new(),
            tools: vec![],
            model: "m".into(),
            effort: None,
            timeout: Duration::from_secs(5),
        }
    }

    fn valid() -> FakeResult {
        FakeResult::Valid(r#"{"answer":"hi"}"#.into())
    }

    /// A gate with a settable clock, a queue on `runner`, and the run log.
    fn gated(
        runner: Arc<dyn AiRunner>,
    ) -> (RunQueue, Arc<AiControl>, Arc<StoreLog>, Arc<AtomicI64>) {
        let (clock, at) = test_clock(NOW);
        let control = AiControl::with_timer_step(TestStore::new(), clock, Duration::from_millis(5));
        let log = StoreLog::new();
        let notify: Notifier = Arc::new(|_| {});
        let queue = RunQueue::new(runner, log.clone(), notify, control.clone());
        (queue, control, log, at)
    }

    fn done(ticket: &RunTicket) -> Result<AiOutput, AiError> {
        ticket.done.recv_timeout(WAIT).expect("the run did not end")
    }

    fn still_waiting(ticket: &RunTicket) {
        assert!(
            ticket.done.recv_timeout(SETTLE).is_err(),
            "the run ended but should still wait"
        );
    }

    /// A runner that holds each run until its gate opens, then answers; it counts starts.
    #[derive(Default)]
    struct HoldRunner {
        open: AtomicBool,
        starts: AtomicUsize,
    }

    impl AiRunner for HoldRunner {
        fn run_task(&self, _: &AiTask, _: &CancelToken) -> Result<AiOutput, AiError> {
            self.starts.fetch_add(1, Ordering::SeqCst);
            while !self.open.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(2));
            }
            Ok(AiOutput {
                structured_output: "{}".into(),
            })
        }
    }

    #[test]
    fn ai_control_queue_asks_the_gate_before_each_start_and_a_denied_task_never_starts_a_process() {
        let fake = Arc::new(FakeRunner::new(valid()));
        let (q, control, log, _at) = gated(fake.clone());
        control.pause().unwrap();
        let background = q.submit(Priority::Background, task("bg")).unwrap();
        still_waiting(&background);
        assert_eq!(fake.starts(), 0, "a denied task started a process");
        assert_eq!(log.state(&background.id), RunState::Waiting);
        // The owner task is allowed and starts; the background one still waits.
        assert!(done(&q.submit(Priority::Owner, task("owner")).unwrap()).is_ok());
        assert_eq!(fake.starts(), 1);
        still_waiting(&background);
        // Resume: the gate allows it and the queue starts it.
        control.resume().unwrap();
        assert!(done(&background).is_ok());
        assert_eq!(fake.starts(), 2);
    }

    #[test]
    fn ai_control_switch_off_gives_zero_process_starts_and_reason_off_for_owner_and_background() {
        let fake = Arc::new(FakeRunner::new(valid()));
        let (q, control, log, _at) = gated(fake.clone());
        control.set_enabled(false).unwrap();
        assert_eq!(control.may_run(OWNER, NOW), deny(DenyReason::Off));
        assert_eq!(control.may_run(BACKGROUND, NOW), deny(DenyReason::Off));
        // Even a task submitted without asking first never starts: it ends cancelled.
        let owner = q.submit(Priority::Owner, task("owner")).unwrap();
        let background = q.submit(Priority::Background, task("bg")).unwrap();
        assert_eq!(done(&owner), Err(AiError::Cancelled));
        assert_eq!(done(&background), Err(AiError::Cancelled));
        assert_eq!(fake.starts(), 0);
        assert_eq!(log.state(&owner.id), RunState::Cancelled);
        assert_eq!(log.state(&background.id), RunState::Cancelled);
    }

    #[test]
    fn ai_control_switch_off_cancels_every_waiting_run_and_lets_the_running_runs_finish() {
        let runner = Arc::new(HoldRunner::default());
        let (q, control, log, _at) = gated(runner.clone());
        let a = q.submit(Priority::Owner, task("a")).unwrap();
        let b = q.submit(Priority::Background, task("b")).unwrap();
        let c = q.submit(Priority::Owner, task("c")).unwrap();
        let d = q.submit(Priority::Background, task("d")).unwrap();
        let end = std::time::Instant::now() + WAIT;
        while runner.starts.load(Ordering::SeqCst) < 2 {
            assert!(std::time::Instant::now() < end, "two runs did not start");
            std::thread::sleep(Duration::from_millis(2));
        }
        control.set_enabled(false).unwrap();
        // Every waiting run ends as cancelled at once; the running ones are not stopped.
        assert_eq!(done(&c), Err(AiError::Cancelled));
        assert_eq!(done(&d), Err(AiError::Cancelled));
        assert_eq!(log.state(&c.id), RunState::Cancelled);
        assert_eq!(log.state(&d.id), RunState::Cancelled);
        still_waiting(&a);
        assert_eq!(log.state(&a.id), RunState::Running);
        // Nothing new starts, even with both slots busy.
        let late = q.submit(Priority::Background, task("late")).unwrap();
        assert_eq!(done(&late), Err(AiError::Cancelled));
        runner.open.store(true, Ordering::SeqCst);
        assert!(done(&a).is_ok());
        assert!(done(&b).is_ok());
        assert_eq!(log.state(&a.id), RunState::Done);
        assert_eq!(log.state(&b.id), RunState::Done);
        assert_eq!(runner.starts.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn ai_control_queue_at_the_pause_line_a_background_task_waits_and_an_owner_task_runs() {
        let fake = Arc::new(FakeRunner::new(valid()));
        let (q, control, log, _at) = gated(fake.clone());
        let sink_control = control.clone();
        fake.set_sink(Arc::new(move |r| {
            sink_control.on_usage_reading(r, NOW);
        }));
        // An owner run reads usage at 96%: above the pause line of 95.
        fake.push_reading(reading(Some((96.0, Some(NOW + HOUR))), Some((20.0, None))));
        assert!(done(&q.submit(Priority::Owner, task("first")).unwrap()).is_ok());
        let background = q.submit(Priority::Background, task("bg")).unwrap();
        still_waiting(&background);
        assert_eq!(log.state(&background.id), RunState::Waiting);
        assert_eq!(fake.starts(), 1);
        // An owner task still runs at the pause line.
        assert!(done(&q.submit(Priority::Owner, task("owner")).unwrap()).is_ok());
        assert_eq!(fake.starts(), 2);
        still_waiting(&background);
        // A lower reading brings usage below the line: the background task starts.
        control.on_usage_reading(reading(Some((40.0, Some(NOW + HOUR))), None), NOW);
        assert!(done(&background).is_ok());
        assert_eq!(fake.starts(), 3);
    }

    #[test]
    fn ai_control_queue_a_fake_limit_result_pauses_background_and_holds_owner_until_resets_at() {
        let fake = Arc::new(FakeRunner::new(valid()));
        let (q, control, log, at) = gated(fake.clone());
        let sink_control = control.clone();
        fake.set_sink(Arc::new(move |r| {
            sink_control.on_usage_reading(r, NOW);
        }));
        let mut limit = reading(Some((100.0, Some(NOW + HOUR))), Some((60.0, None)));
        limit.five_hour.as_mut().unwrap().status = Some("rejected".into());
        limit.status = Some("rejected".into());
        fake.push_reading(limit);
        fake.push(FakeResult::UsageLimit);
        let first = q.submit(Priority::Owner, task("first")).unwrap();
        assert_eq!(done(&first), Err(AiError::UsageLimit));
        // Owner and background are held, with reason Limit.
        assert_eq!(control.may_run(OWNER, NOW), deny(DenyReason::Limit));
        assert_eq!(control.may_run(BACKGROUND, NOW), deny(DenyReason::Limit));
        let background = q.submit(Priority::Background, task("bg")).unwrap();
        still_waiting(&background);
        // An owner task that reaches the queue anyway ends at once with the limit, no process.
        let owner = q.submit(Priority::Owner, task("owner")).unwrap();
        assert_eq!(done(&owner), Err(AiError::UsageLimit));
        assert_eq!(log.state(&owner.id), RunState::Failed);
        assert_eq!(fake.starts(), 1);
        // At resetsAt the timer lifts the pause and the background task starts.
        at.store(NOW + HOUR, Ordering::SeqCst);
        assert!(done(&background).is_ok());
        assert_eq!(fake.starts(), 2);
        assert_eq!(control.may_run(OWNER, NOW + HOUR), ALLOW);
    }

    #[test]
    fn ai_control_queue_a_limit_with_no_reset_time_waits_for_resume() {
        let fake = Arc::new(FakeRunner::new(valid()));
        let (q, control, _log, at) = gated(fake.clone());
        fake.push(FakeResult::UsageLimit);
        assert_eq!(
            done(&q.submit(Priority::Owner, task("first")).unwrap()),
            Err(AiError::UsageLimit)
        );
        let background = q.submit(Priority::Background, task("bg")).unwrap();
        at.store(NOW + 30 * 24 * HOUR, Ordering::SeqCst);
        control.tick();
        still_waiting(&background);
        control.resume().unwrap();
        assert!(done(&background).is_ok());
    }
}
