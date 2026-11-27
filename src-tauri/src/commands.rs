// Commands the UI can call through Tauri's invoke bridge, and the state they share.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::ai::bookmark_save::{self, BookmarkStore, SaveContext, SaveError, SaveResult};
use crate::ai::claude::error_kind;
use crate::ai::fetch::HttpReader;
use crate::ai::health::{self, AiHealth};
use crate::ai::models::{self, AiModelTable, ModelChoices, ModelError, ModelRow};
use crate::ai::runner::AiError;
use crate::ai::test_prompt;
use crate::scheduler::ai_control::{
    AiControl, ControlError, ControlStore, ControlStoreError, Decision, DenyReason, WindowNow,
    THRESHOLDS_MESSAGE,
};
use crate::scheduler::queue::{
    CancelOutcome, Priority, QueuedRunner, RunLog, RunLogError, RunQueue,
};
use crate::storage::ai_control::{StoredAiControl, StoredPause, StoredReading};
use crate::storage::bookmarks::{Held, SavedBookmark};
use crate::storage::export::{ExportError, ExportSummary, FolderState};
use crate::storage::files::OrphanReport;
use crate::storage::folders::Folder;
use crate::storage::ideas::{Idea, IdeaInput, IdeaProject};
use crate::storage::items::{
    Bookmark, BookmarkInput, Event, EventInput, Memory, MemoryInput, Note, NoteInput, Project,
    ProjectInput, Run, Task, TaskInput,
};
use crate::storage::labels::{
    ChangePage, ChangePageRequest, DeleteLabelOutcome, Label, LabelledNote,
};
use crate::storage::links::Link;
use crate::storage::record::{format_utc, now_iso, Cursor, Page};
use crate::storage::runs::RunEnd;
use crate::storage::{FileRecord, Item, ItemRef, PageRequest, Storage, StorageError};

/// The one error shape every command returns: a stable machine `code` and a plain
/// `message`. It never carries file paths, stack traces or raw error text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppError {
    pub code: &'static str,
    pub message: String,
}

/// Why storage could not be opened at start. `code` is safe to show in the UI;
/// `detail` is the full reason and only goes to the terminal.
#[derive(Debug, Clone)]
pub struct StartupError {
    pub code: &'static str,
    pub detail: String,
}

/// The storage the commands use: the open database, or why it could not be opened.
/// It is always registered, so a command gets an error back instead of a panic.
pub struct AppStorage {
    db: Result<Mutex<Storage>, StartupError>,
    /// True while an export copies its files without the storage lock. Reset refuses
    /// to run then. It is set and read only while the lock is held, so they cannot overlap.
    exporting: AtomicBool,
}

/// Clears the export-in-progress flag when the export ends, also on a panic.
struct ExportingFlag<'a>(&'a AtomicBool);

impl Drop for ExportingFlag<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl AppStorage {
    pub fn new(opened: Result<Storage, StartupError>) -> Self {
        AppStorage {
            db: opened.map(Mutex::new),
            exporting: AtomicBool::new(false),
        }
    }

    /// Exports into a new folder inside `folder`. The records are written under the
    /// storage lock; the file copy runs after it is released, so reads and saves are not
    /// held up. Reset is refused until the copy ends.
    fn export(&self, folder: &str, now: &str) -> Result<ExportSummary, AppError> {
        let (job, _running) = {
            let guard = self.get()?;
            if self.exporting.swap(true, Ordering::SeqCst) {
                return Err(AppError {
                    code: "export_running",
                    message: "An export is already running. Wait for it to finish.".to_string(),
                });
            }
            let running = ExportingFlag(&self.exporting);
            (
                guard
                    .export_begin(std::path::Path::new(folder), now)
                    .map_err(export_failed)?,
                running,
            )
        };
        job.finish().map_err(export_failed)
    }

    /// A storage that a failed Reset left without a database answers every call with
    /// `storage_unavailable`, not with a table error from an empty database.
    fn usable(guard: MutexGuard<'_, Storage>) -> Result<MutexGuard<'_, Storage>, AppError> {
        if guard.is_unavailable() {
            return Err(AppError {
                code: "storage_unavailable",
                message: "Mnemo could not open its data file again after a reset. Quit Mnemo and start it again.".to_string(),
            });
        }
        Ok(guard)
    }

    /// Locks the database, or returns `storage_unavailable` when it was not opened.
    /// A lock poisoned by an earlier panic is recovered after rolling back any
    /// transaction the panicking code left open.
    pub fn get(&self) -> Result<MutexGuard<'_, Storage>, AppError> {
        match &self.db {
            Ok(m) => match m.lock() {
                Ok(guard) => Self::usable(guard),
                Err(poisoned) => {
                    // An earlier command panicked while holding the lock. Roll back what
                    // it left open, then carry on with the last committed state.
                    let guard = poisoned.into_inner();
                    guard.recover_after_panic().map_err(|_| AppError {
                        code: "storage_unavailable",
                        message: "Mnemo could not recover its data file after an error. Nothing was deleted. Quit Mnemo and start it again.".to_string(),
                    })?;
                    m.clear_poison();
                    Self::usable(guard)
                }
            },
            Err(_) => Err(AppError {
                code: "storage_unavailable",
                message: "Mnemo could not open its data file when it started. Nothing was deleted. Quit Mnemo and start it again.".to_string(),
            }),
        }
    }
}

/// Whether AI answers come from the real `claude -p` runner or from the fake test runner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AiMode {
    Real,
    Fake,
}

/// Which kind of runner the app uses, chosen once at start from `MNEMO_FAKE_AI`. Every AI
/// run goes through the `RunQueue`, which holds the runner itself.
pub struct AiRunnerState {
    pub fake: bool,
}

impl AiRunnerState {
    pub fn mode(&self) -> AiMode {
        if self.fake {
            AiMode::Fake
        } else {
            AiMode::Real
        }
    }
}

/// Says whether AI is fake, so Settings can show it.
#[tauri::command]
pub fn get_ai_mode(state: tauri::State<'_, AiRunnerState>) -> AiMode {
    state.mode()
}

/// The answer of the test prompt and how long it took.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestPromptResult {
    pub answer: String,
    pub duration_ms: u64,
}

/// What the owner is told when a run gave no answer. The text says what happened and never
/// holds output from Claude Code; the UI adds that nothing changed and what to do next. The
/// `code` is the kind of the error.
fn ai_failed(error: &AiError) -> AppError {
    let message = match error {
        AiError::Timeout => "Claude did not answer in time.",
        AiError::UsageLimit => "Claude is at its usage limit.",
        AiError::SchemaMismatch => "Claude answered, but not in the shape Mnemo asked for.",
        AiError::ExitError { .. } => "Claude Code stopped with an error.",
        AiError::Unavailable => "Claude Code could not be started.",
        AiError::Cancelled => "The run was cancelled.",
    };
    AppError {
        code: error_kind(error),
        message: message.to_string(),
    }
}

fn test_prompt_unfinished() -> AppError {
    AppError {
        code: "task_failed",
        message: "The test prompt did not finish.".to_string(),
    }
}

/// What a feature tells the owner when the AI control refuses a task before it is queued. Only
/// off and the limit refuse an owner task.
fn ai_refused(reason: DenyReason) -> AppError {
    match reason {
        DenyReason::Off => AppError {
            code: "ai_off",
            message: "AI is off, so this did not run. Turn AI on in Settings > AI.".to_string(),
        },
        DenyReason::Limit => AppError {
            code: "ai_limit",
            message: "Claude is at its usage limit, so Mnemo is holding AI work until the limit resets or you choose Resume in Settings > AI.".to_string(),
        },
        DenyReason::Threshold | DenyReason::OwnerPause => AppError {
            code: "ai_paused",
            message: "Background AI work is paused, so this did not run.".to_string(),
        },
    }
}

/// Asks the AI control whether an owner task may run now. Every AI feature calls this before
/// it queues (the queue asks again before the start).
fn ask_ai_control(control: &AiControl, priority: Priority) -> Result<(), AppError> {
    match control.may_run(priority, control.now()) {
        Decision::Allow => Ok(()),
        Decision::Deny { reason } => Err(ai_refused(reason)),
    }
}

/// Runs the test prompt through the queue as an owner task, waits for it on this thread and
/// times it. It asks the AI control first: a refused prompt writes no run row. The command
/// calls this on a blocking thread.
fn run_test_prompt_with(
    queue: &RunQueue,
    control: &AiControl,
) -> Result<TestPromptResult, AppError> {
    ask_ai_control(control, Priority::Owner)?;
    let started = std::time::Instant::now();
    let ticket = queue
        .submit(Priority::Owner, test_prompt::task())
        .map_err(|e| {
            log::error!("the test prompt could not be queued: {e}");
            AppError {
                code: "storage_unavailable",
                message: "Mnemo could not record the run in its data file, so it did not start. Nothing was changed.".to_string(),
            }
        })?;
    // The queue always answers, unless the runner stopped without a result.
    let output = ticket.done.recv().map_err(|_| {
        log::error!("the test prompt run {} stopped without a result", ticket.id);
        test_prompt_unfinished()
    })?;
    let answer = output
        .and_then(|o| test_prompt::answer(&o))
        .map_err(|e| ai_failed(&e))?;
    Ok(TestPromptResult {
        answer,
        duration_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
    })
}

/// Sends one tiny fixed prompt through the run queue and the selected runner (the fake with
/// `MNEMO_FAKE_AI=1`). A real run uses Claude usage. It runs on a blocking thread, never on
/// the main thread.
#[tauri::command]
pub async fn run_test_prompt(app: tauri::AppHandle) -> Result<TestPromptResult, AppError> {
    let queue = app.state::<RunQueue>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || run_test_prompt_with(&queue, &queue.control()))
        .await
        .unwrap_or_else(|e| {
            log::error!("the test prompt did not finish: {e}");
            Err(test_prompt_unfinished())
        })
}

/// The longest run id the cancel command takes. Run ids are UUIDs (36 characters).
const MAX_RUN_ID_LEN: usize = 100;

fn cancel_run_with(queue: &RunQueue, id: &str) -> Result<(), AppError> {
    if id.trim().is_empty() || id.len() > MAX_RUN_ID_LEN {
        return Err(AppError {
            code: "invalid_input",
            message: "The run id must be 1 to 100 characters.".to_string(),
        });
    }
    match queue.cancel(id) {
        CancelOutcome::Removed | CancelOutcome::Signalled => Ok(()),
        CancelOutcome::NotActive => Err(AppError {
            code: "run_not_active",
            message: "This run is not waiting or running, so there is nothing to cancel."
                .to_string(),
        }),
    }
}

/// Cancels a waiting or running AI run. A waiting run leaves the queue; a running run's
/// process is stopped. The run's row ends as cancelled.
#[tauri::command]
pub async fn cancel_run(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    let queue = app.state::<RunQueue>().inner().clone();
    cancel_run_blocking(queue, id).await
}

/// Cancelling a waiting run writes its row, so it runs on a blocking thread.
async fn cancel_run_blocking(queue: RunQueue, id: String) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || cancel_run_with(&queue, &id))
        .await
        .unwrap_or_else(|e| {
            log::error!("the cancel did not finish: {e}");
            Err(AppError {
                code: "task_failed",
                message: "The cancel did not finish.".to_string(),
            })
        })
}

fn run_log_failed(e: StorageError) -> RunLogError {
    RunLogError(e.to_string())
}

// The run log writes through the one storage the commands use. Each call locks it briefly.
fn log_enqueue(storage: &AppStorage, task_type: &str) -> Result<String, RunLogError> {
    let storage = storage.get().map_err(|e| RunLogError(e.message))?;
    let run = storage
        .enqueue_run(task_type, &now_iso())
        .map_err(run_log_failed)?;
    Ok(run.base.id)
}

fn log_start(storage: &AppStorage, id: &str) -> Result<(), RunLogError> {
    let storage = storage.get().map_err(|e| RunLogError(e.message))?;
    storage.start_run(id, &now_iso()).map_err(run_log_failed)
}

fn log_finish(
    storage: &AppStorage,
    id: &str,
    end: &RunEnd,
    duration_ms: Option<i64>,
) -> Result<(), RunLogError> {
    let storage = storage.get().map_err(|e| RunLogError(e.message))?;
    storage
        .finish_run(id, end, duration_ms, &now_iso())
        .map_err(run_log_failed)
}

/// The run queue's log in the app: the `run` table behind the managed `AppStorage`.
pub struct AppRunLog(pub tauri::AppHandle);

impl RunLog for AppRunLog {
    fn enqueue(&self, task_type: &str) -> Result<String, RunLogError> {
        log_enqueue(&self.0.state::<AppStorage>(), task_type)
    }

    fn start(&self, id: &str) -> Result<(), RunLogError> {
        log_start(&self.0.state::<AppStorage>(), id)
    }

    fn finish(&self, id: &str, end: &RunEnd, duration_ms: Option<i64>) -> Result<(), RunLogError> {
        log_finish(&self.0.state::<AppStorage>(), id, end, duration_ms)
    }
}

fn control_store_failed(e: StorageError) -> ControlStoreError {
    ControlStoreError(e.to_string())
}

fn locked(storage: &AppStorage) -> Result<MutexGuard<'_, Storage>, ControlStoreError> {
    storage.get().map_err(|e| ControlStoreError(e.message))
}

// The AI control's store writes through the one storage the commands use. Each call locks it
// briefly. The control calls these under its own lock (lock order: control, then storage), so
// no command may call the control while it holds the storage.
fn control_load(storage: &AppStorage) -> Result<StoredAiControl, ControlStoreError> {
    locked(storage)?
        .ai_control_settings()
        .map_err(control_store_failed)
}

/// The AI control's store in the app: the `ai_*` settings keys behind the managed `AppStorage`.
pub struct AppControlStore(pub tauri::AppHandle);

impl ControlStore for AppControlStore {
    fn load(&self) -> Result<StoredAiControl, ControlStoreError> {
        control_load(&self.0.state::<AppStorage>())
    }

    fn save_enabled(&self, on: bool) -> Result<(), ControlStoreError> {
        locked(&self.0.state::<AppStorage>())?
            .set_ai_enabled(on)
            .map_err(control_store_failed)
    }

    fn save_thresholds(&self, warn_at: i64, pause_at: i64) -> Result<(), ControlStoreError> {
        locked(&self.0.state::<AppStorage>())?
            .set_ai_thresholds(warn_at, pause_at)
            .map_err(control_store_failed)
    }

    fn save_pause(&self, pause: Option<&StoredPause>) -> Result<(), ControlStoreError> {
        locked(&self.0.state::<AppStorage>())?
            .set_ai_pause(pause)
            .map_err(control_store_failed)
    }

    fn save_reading(&self, reading: &StoredReading) -> Result<(), ControlStoreError> {
        locked(&self.0.state::<AppStorage>())?
            .set_ai_usage_last(reading)
            .map_err(control_store_failed)
    }
}

/// Returns a fixed reply so the UI can prove the Rust core is reachable.
#[tauri::command]
pub fn ping() -> String {
    "pong from the Rust core".to_string()
}

const MAX_KEY_LEN: usize = 100;
const MAX_VALUE_LEN: usize = 1000;

fn invalid_setting(message: &str) -> AppError {
    AppError {
        code: "invalid_setting",
        message: message.to_string(),
    }
}

/// A setting key is 1 to 100 characters of a-z, 0-9, underscore, dot or hyphen.
fn check_setting_key(key: &str) -> Result<(), AppError> {
    let ok = !key.is_empty()
        && key.len() <= MAX_KEY_LEN
        && key
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '.' | '-'));
    if ok {
        Ok(())
    } else {
        Err(invalid_setting(
            "The setting name must be 1 to 100 characters: a-z, 0-9, underscore, dot or hyphen.",
        ))
    }
}

/// The error the UI sees for a storage failure. The reason stays out of the message.
fn storage_failed(e: StorageError) -> AppError {
    log::error!("settings storage call failed: {e}");
    AppError {
        code: "storage_error",
        message: "Mnemo could not read or save its settings. Nothing was deleted.".to_string(),
    }
}

fn read_setting(storage: &AppStorage, key: &str) -> Result<Option<String>, AppError> {
    check_setting_key(key)?;
    storage.get()?.get_setting(key).map_err(storage_failed)
}

/// The AI control keys (`ai_*`) belong to the AI control: it caches them, so a write from the
/// generic command would not reach it. They are changed through the AI control commands only.
/// Reading them stays allowed.
const AI_CONTROL_KEY_PREFIX: &str = "ai_";

fn write_setting(storage: &AppStorage, key: &str, value: &str) -> Result<(), AppError> {
    check_setting_key(key)?;
    if key.starts_with(AI_CONTROL_KEY_PREFIX) {
        return Err(invalid_setting(
            "AI settings are changed in Settings > AI, not with this command.",
        ));
    }
    if value.len() > MAX_VALUE_LEN {
        return Err(invalid_setting("The setting value is too long."));
    }
    storage
        .get()?
        .set_setting(key, value)
        .map_err(storage_failed)
}

/// The result of a blocking task. A task that failed to finish (it panicked or was
/// cancelled) gives a coded error without the reason; the reason goes to the log.
fn task_result<T>(joined: Result<Result<T, AppError>, tauri::Error>) -> Result<T, AppError> {
    joined.map_err(|e| {
        log::error!("storage task did not finish: {e}");
        AppError {
            code: "storage_error",
            message: "Mnemo could not finish reading or saving. Nothing was deleted.".to_string(),
        }
    })?
}

/// Runs `work` on a blocking thread, so the storage lock and SQLite I/O never hold up
/// the main thread. A thread that failed gives the same coded error as a storage failure.
async fn off_main_thread<T, F>(app: tauri::AppHandle, work: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(&AppStorage) -> Result<T, AppError> + Send + 'static,
{
    task_result(
        tauri::async_runtime::spawn_blocking(move || {
            let storage = app.state::<AppStorage>();
            work(&storage)
        })
        .await,
    )
}

/// The value saved under `key`, or null when it was never saved.
#[tauri::command]
pub async fn get_setting(app: tauri::AppHandle, key: String) -> Result<Option<String>, AppError> {
    off_main_thread(app, move |storage| read_setting(storage, &key)).await
}

/// Saves `value` under `key`, replacing an earlier value.
#[tauri::command]
pub async fn set_setting(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), AppError> {
    off_main_thread(app, move |storage| write_setting(storage, &key, &value)).await
}

/// The usage the AI control screen shows: the last usage reading, or, when there is none,
/// Mnemo's own run count.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum UsageView {
    /// The last reading: when it was read and both windows (a window that has reset has no
    /// percent). The percent is **Unverified** (see `ai::usage`).
    Reading {
        #[serde(rename = "readAt")]
        read_at: i64,
        #[serde(rename = "fiveHour")]
        five_hour: Option<WindowNow>,
        #[serde(rename = "sevenDay")]
        seven_day: Option<WindowNow>,
    },
    /// No reading yet: how many Mnemo runs started today and this week.
    Runs { today: i64, week: i64 },
}

/// What Settings > AI shows, read from the core after every change.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiControlView {
    pub enabled: bool,
    pub warn_at: i64,
    pub pause_at: i64,
    /// The pause in force: `{ reason: "limit" | "owner", until }`, or null.
    pub pause: Option<StoredPause>,
    /// What the gate answers a background task now.
    pub background_gate: Decision,
    /// True when usage is at or above the warn line.
    pub warn: bool,
    pub usage: UsageView,
}

/// The longest a week can be from its first day to today, with an hour of slack for a clock
/// change.
const MAX_WEEK_SPAN_SECS: i64 = 7 * 24 * 60 * 60 + 60 * 60;

/// Local midnight today and local Monday 00:00, as Unix seconds, sent by the UI (display logic
/// belongs there). The core checks `0 <= week_start <= today_start <= now`.
fn check_day_bounds(today_start: i64, week_start: i64, now: i64) -> Result<(), AppError> {
    let ok = week_start >= 0
        && week_start <= today_start
        && today_start <= now
        && today_start - week_start <= MAX_WEEK_SPAN_SECS;
    if ok {
        Ok(())
    } else {
        Err(AppError {
            code: "invalid_input",
            message: "The start of today and of this week must be times in the past, today within this week.".to_string(),
        })
    }
}

/// The error the UI sees when the AI control could not change. Nothing changed.
fn control_failed(error: ControlError) -> AppError {
    match error {
        ControlError::InvalidThresholds => AppError {
            code: "invalid_input",
            message: THRESHOLDS_MESSAGE.to_string(),
        },
        ControlError::Storage(e) => {
            log::error!("the AI control could not be saved: {e}");
            AppError {
                code: "storage_error",
                message: "Mnemo could not save the AI setting. Nothing changed.".to_string(),
            }
        }
        ControlError::Unavailable => control_unavailable(),
    }
}

fn control_unavailable() -> AppError {
    AppError {
        code: "storage_unavailable",
        message: "Mnemo could not read its AI settings when it started, so AI stays off. Nothing was deleted. Quit Mnemo and start it again.".to_string(),
    }
}

/// The screen's view. The control is read first and let go before storage is locked (lock
/// order: control, then storage).
fn ai_control_view(
    control: &AiControl,
    storage: &AppStorage,
    today_start: i64,
    week_start: i64,
) -> Result<AiControlView, AppError> {
    let now = control.now();
    check_day_bounds(today_start, week_start, now)?;
    let snap = control.snapshot(now);
    if !snap.available {
        return Err(control_unavailable());
    }
    let usage = match snap.read_at {
        Some(read_at) => UsageView::Reading {
            read_at,
            five_hour: snap.five_hour,
            seven_day: snap.seven_day,
        },
        None => {
            // Both bounds are checked to be 0 or more above.
            let iso = |secs: i64| format_utc(u64::try_from(secs).unwrap_or(0));
            let counts = storage
                .get()?
                .count_started_runs_since(&iso(today_start), &iso(week_start))
                .map_err(storage_failed)?;
            UsageView::Runs {
                today: counts.today,
                week: counts.week,
            }
        }
    };
    Ok(AiControlView {
        enabled: snap.enabled,
        warn_at: snap.warn_at,
        pause_at: snap.pause_at,
        pause: snap.pause,
        background_gate: snap.background_gate,
        warn: snap.warn,
        usage,
    })
}

/// Makes one change to the AI control, then reads the new view. Runs on a blocking thread: a
/// change writes to storage, and switching AI off ends the waiting runs.
async fn change_ai_control<F>(
    app: tauri::AppHandle,
    today_start: i64,
    week_start: i64,
    change: F,
) -> Result<AiControlView, AppError>
where
    F: FnOnce(&AiControl) -> Result<(), ControlError> + Send + 'static,
{
    let control = app.state::<RunQueue>().control();
    off_main_thread(app, move |storage| {
        check_day_bounds(today_start, week_start, control.now())?;
        change(&control).map_err(control_failed)?;
        ai_control_view(&control, storage, today_start, week_start)
    })
    .await
}

/// The AI control for Settings > AI: the switch, the lines, the pause and the usage (the last
/// reading, or Mnemo's run count today and this week).
#[tauri::command]
pub async fn get_ai_control(
    app: tauri::AppHandle,
    today_start: i64,
    week_start: i64,
) -> Result<AiControlView, AppError> {
    change_ai_control(app, today_start, week_start, |_| Ok(())).await
}

/// The master switch. Off: nothing new starts, waiting runs end as cancelled, and running runs
/// finish.
#[tauri::command]
pub async fn set_ai_enabled(
    app: tauri::AppHandle,
    on: bool,
    today_start: i64,
    week_start: i64,
) -> Result<AiControlView, AppError> {
    change_ai_control(app, today_start, week_start, move |c| c.set_enabled(on)).await
}

/// Sets the warn and pause lines: whole numbers 1 to 100, warn lower than pause.
#[tauri::command]
pub async fn set_ai_thresholds(
    app: tauri::AppHandle,
    warn: i64,
    pause: i64,
    today_start: i64,
    week_start: i64,
) -> Result<AiControlView, AppError> {
    change_ai_control(app, today_start, week_start, move |c| {
        c.set_thresholds(warn, pause)
    })
    .await
}

/// Pauses background AI work. The owner's own tasks still run.
#[tauri::command]
pub async fn pause_background(
    app: tauri::AppHandle,
    today_start: i64,
    week_start: i64,
) -> Result<AiControlView, AppError> {
    change_ai_control(app, today_start, week_start, |c| c.pause()).await
}

/// Lifts any pause at once, the usage limit pause included.
#[tauri::command]
pub async fn resume_ai(
    app: tauri::AppHandle,
    today_start: i64,
    week_start: i64,
) -> Result<AiControlView, AppError> {
    change_ai_control(app, today_start, week_start, |c| c.resume()).await
}

/// Gives the runner the owner's model row for a task from the app storage. A run starts only
/// after the queue wrote its row, so storage was open then; if it is lost before the run starts,
/// the run uses the code default instead of failing.
pub struct StoredChoices(pub tauri::AppHandle);

impl ModelChoices for StoredChoices {
    fn row(&self, task: &str) -> Option<ModelRow> {
        match self.0.state::<AppStorage>().get() {
            Ok(storage) => models::row_for(&storage, task),
            Err(_) => models::default_row(task),
        }
    }
}

/// The error the UI sees for an export that did not finish. The reason goes to the log.
/// The message says only what is true about the export folder.
fn export_failed(e: ExportError) -> AppError {
    match e {
        ExportError::Target(message) => AppError {
            code: "export_target_invalid",
            message,
        },
        ExportError::Failed { cause, folder } => {
            log::error!("export failed: {cause}");
            let about_folder = match folder {
                FolderState::NotCreated => "No export folder was made.",
                FolderState::Removed => "The partly written export folder was removed.",
                FolderState::Left => {
                    "The partly written export folder could not be removed; delete it yourself."
                }
            };
            AppError {
                code: "export_failed",
                message: format!(
                    "Mnemo could not finish the export. Your data is unchanged. {about_folder}"
                ),
            }
        }
    }
}

/// The error the UI sees when a model row was not changed. An unknown value is the owner's
/// mistake and has its own code; a storage failure uses the same words as every setting.
fn model_failed(e: ModelError) -> AppError {
    match e {
        ModelError::Storage(inner) => storage_failed(inner),
        other => AppError {
            code: "invalid_ai_model",
            message: other.to_string(),
        },
    }
}

fn list_ai_models_with(storage: &AppStorage) -> Result<AiModelTable, AppError> {
    let guard = storage.get()?;
    Ok(models::table(&guard))
}

fn set_ai_model_with(
    storage: &AppStorage,
    feature: &str,
    model: &str,
    effort: &str,
) -> Result<AiModelTable, AppError> {
    let guard = storage.get()?;
    models::set_row(&guard, feature, model, effort).map_err(model_failed)
}

fn reset_ai_models_with(storage: &AppStorage) -> Result<AiModelTable, AppError> {
    let guard = storage.get()?;
    models::reset_rows(&guard).map_err(model_failed)
}

/// The model and effort of every AI feature, with the allowed values.
#[tauri::command]
pub async fn list_ai_models(app: tauri::AppHandle) -> Result<AiModelTable, AppError> {
    off_main_thread(app, list_ai_models_with).await
}

/// Saves the model and effort of one feature. An unknown value changes nothing.
#[tauri::command]
pub async fn set_ai_model(
    app: tauri::AppHandle,
    feature: String,
    model: String,
    effort: String,
) -> Result<AiModelTable, AppError> {
    off_main_thread(app, move |s| {
        set_ai_model_with(s, &feature, &model, &effort)
    })
    .await
}

fn export_item(storage: &AppStorage, folder: &str, now: &str) -> Result<ExportSummary, AppError> {
    storage.export(folder, now)
}

/// Exports every live record into a new dated export folder inside `folder` (storage names it).
#[tauri::command]
pub async fn export_data(app: tauri::AppHandle, folder: String) -> Result<ExportSummary, AppError> {
    off_main_thread(app, move |storage| {
        export_item(storage, &folder, &crate::storage::record::now_iso())
    })
    .await
}

/// Puts every feature back to its default model and effort.
#[tauri::command]
pub async fn reset_ai_models(app: tauri::AppHandle) -> Result<AiModelTable, AppError> {
    off_main_thread(app, reset_ai_models_with).await
}

fn reset_item(storage: &AppStorage, confirm: &str) -> Result<(), AppError> {
    let mut guard = storage.get()?;
    if storage.exporting.load(Ordering::SeqCst) {
        return Err(AppError {
            code: "export_running",
            message: "An export is running. Wait for it to finish, then reset.".to_string(),
        });
    }
    guard.reset(confirm).map_err(|e| match e {
        StorageError::Invalid(message) => AppError {
            code: "reset_not_confirmed",
            message,
        },
        other => {
            log::error!("reset failed: {other}");
            AppError {
                code: "reset_failed",
                message: "Mnemo could not delete everything. Some data may be left. Mnemo is reloading to show what is left; if errors continue, quit Mnemo and start it again.".to_string(),
            }
        }
    })
}

/// Deletes all data and the files folder when `confirm` is exactly `RESET`.
#[tauri::command]
pub async fn reset_data(app: tauri::AppHandle, confirm: String) -> Result<(), AppError> {
    let control = app.state::<RunQueue>().control();
    off_main_thread(app, move |storage| {
        let result = reset_item(storage, &confirm);
        // A reset that ran, in full or part way, deleted the `ai_*` keys: the AI control reads
        // the fresh storage, so it does not keep (or write back) the old switch, pause and
        // reading. `reset_item` has let go of the storage lock here (lock order: control, then
        // storage).
        if !matches!(&result, Err(e) if e.code == "export_running" || e.code == "reset_not_confirmed")
        {
            control.reload();
        }
        result
    })
    .await
}

/// Where the data lives and the one-line copy commands that back it up.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataFolderInfo {
    pub path: String,
    pub macos_command: String,
    pub ubuntu_command: String,
}

fn path_unknown() -> AppError {
    AppError {
        code: "open_folder_failed",
        message: "Mnemo could not find its data folder.".to_string(),
    }
}

#[tauri::command]
pub fn data_folder_info(app: tauri::AppHandle) -> Result<DataFolderInfo, AppError> {
    let paths = crate::system::paths::app_paths(&app).map_err(|e| {
        log::error!("data folder path: {e}");
        path_unknown()
    })?;
    let c = crate::system::paths::backup_commands(&paths.data_dir);
    Ok(DataFolderInfo {
        path: paths.data_dir.to_string_lossy().into_owned(),
        macos_command: c.macos,
        ubuntu_command: c.ubuntu,
    })
}

/// Opens the data folder in the system file manager.
#[tauri::command]
pub async fn open_data_folder(app: tauri::AppHandle) -> Result<(), AppError> {
    let paths = crate::system::paths::app_paths(&app).map_err(|e| {
        log::error!("data folder path: {e}");
        path_unknown()
    })?;
    crate::system::paths::open_folder(&app, &paths.data_dir).map_err(|e| {
        log::error!("could not open the data folder: {e}");
        AppError {
            code: "open_folder_failed",
            message: "Mnemo could not open the data folder. Open it from your file manager."
                .to_string(),
        }
    })
}

/// The latest Claude Code check, kept in memory only. `None` until the first check ends.
/// It holds only a state and a fixed message, never output from Claude Code.
#[derive(Default)]
pub struct AiHealthState(Mutex<AiHealthSlot>);

#[derive(Default)]
struct AiHealthSlot {
    /// The number given to the most recently started check.
    started: u64,
    /// The number of the check whose result is kept.
    applied: u64,
    value: Option<AiHealth>,
}

impl AiHealthState {
    fn slot(&self) -> MutexGuard<'_, AiHealthSlot> {
        // A lock poisoned by a panic is recovered: the value is plain data.
        self.0.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// The latest result.
    pub fn get(&self) -> Option<AiHealth> {
        self.slot().value.clone()
    }

    /// Numbers a check as it starts. Checks end in any order, but the one that started last wins.
    pub fn begin(&self) -> u64 {
        let mut slot = self.slot();
        slot.started += 1;
        slot.started
    }

    /// Keeps the result of check `seq` unless a check that started later already ended.
    /// Returns whether it was kept.
    pub fn finish(&self, seq: u64, value: AiHealth) -> bool {
        let mut slot = self.slot();
        if seq <= slot.applied {
            return false;
        }
        slot.applied = seq;
        slot.value = Some(value);
        true
    }

    #[cfg(test)]
    fn set(&self, value: AiHealth) {
        let seq = self.begin();
        self.finish(seq, value);
    }
}

/// Runs the check on a blocking thread and keeps the result. It never fails the caller:
/// a check that could not finish is reported as a Version problem, not as Ready.
pub async fn refresh_ai_health(app: tauri::AppHandle) -> AiHealth {
    let seq = app.state::<AiHealthState>().begin();
    let found = tauri::async_runtime::spawn_blocking(health::check_system)
        .await
        .unwrap_or_else(|e| {
            log::error!("the Claude Code check did not finish: {e}");
            AiHealth::of(health::AiState::VersionProblem)
        });
    log::info!("Claude Code check: {:?}", found.state);
    app.state::<AiHealthState>().finish(seq, found.clone());
    found
}

/// The latest Claude Code check, or null while the first one is still running.
#[tauri::command]
pub fn get_ai_health(state: tauri::State<'_, AiHealthState>) -> Option<AiHealth> {
    state.get()
}

/// Checks Claude Code again (the "Check again" button) and returns the new result.
#[tauri::command]
pub async fn check_ai_health(app: tauri::AppHandle) -> Result<AiHealth, AppError> {
    Ok(refresh_ai_health(app).await)
}

// ---- Items and links ----

/// The arguments of every list command: page size (1 to 100), where the page starts
/// (null for the first page) and whether deleted items are included.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListArgs {
    pub limit: u32,
    #[serde(default)]
    pub after: Option<Cursor>,
    #[serde(default)]
    pub include_deleted: bool,
}

/// The error the UI sees for an item or link call. A missing record and refused input
/// keep their own codes; any other reason stays in the log.
fn item_failed(e: StorageError) -> AppError {
    match e {
        StorageError::NotFound { kind } => AppError {
            code: "not_found",
            message: format!("There is no such {kind}. It may have been deleted."),
        },
        StorageError::Invalid(message) => AppError {
            code: "invalid_input",
            message,
        },
        other => {
            log::error!("item storage call failed: {other}");
            AppError {
                code: "storage_error",
                message: "Mnemo could not read or save this item. Nothing was deleted.".to_string(),
            }
        }
    }
}

/// The error the UI sees for a file call. Size and name problems keep their own codes
/// and plain messages; any other reason stays in the log.
fn file_failed(e: StorageError) -> AppError {
    match e {
        StorageError::FileTooLarge { .. } => AppError {
            code: "file_too_large",
            message: e.to_string(),
        },
        StorageError::InvalidFileName => AppError {
            code: "invalid_file_name",
            message: e.to_string(),
        },
        StorageError::FileMissing => AppError {
            code: "file_missing",
            message: e.to_string(),
        },
        StorageError::NotFound { .. } => AppError {
            code: "file_not_found",
            message: "There is no such file. It may have been deleted.".to_string(),
        },
        StorageError::Invalid(message) => AppError {
            code: "invalid_input",
            message,
        },
        other => {
            log::error!("file storage call failed: {other}");
            AppError {
                code: "storage_error",
                message: "Mnemo could not read or save this file. Nothing was deleted.".to_string(),
            }
        }
    }
}

/// The header that carries the file's original name, percent-encoded by the UI.
const FILE_NAME_HEADER: &str = "x-mnemo-file-name";

fn invalid_file_input(message: &str) -> AppError {
    AppError {
        code: "invalid_input",
        message: message.to_string(),
    }
}

/// Decodes `%XX` escapes as UTF-8 text. Bad escapes or bad UTF-8 give `None`.
fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// A file id must look like a UUID before storage is touched, so a path such as
/// `../mnemo.db` is refused here.
fn check_file_id(id: &str) -> Result<(), AppError> {
    if crate::storage::files::is_file_id(id) {
        Ok(())
    } else {
        Err(file_failed(StorageError::InvalidFileName))
    }
}

fn save_file_item(
    storage: &AppStorage,
    encoded_name: Option<&str>,
    bytes: &[u8],
) -> Result<FileRecord, AppError> {
    let name = encoded_name
        .and_then(percent_decode)
        .ok_or_else(|| invalid_file_input("The file name was missing or not readable."))?;
    storage.get()?.save_file(&name, bytes).map_err(file_failed)
}

fn get_file_item(storage: &AppStorage, id: &str) -> Result<FileRecord, AppError> {
    check_file_id(id)?;
    storage.get()?.get_file(id).map_err(file_failed)
}

fn read_file_item(storage: &AppStorage, id: &str) -> Result<Vec<u8>, AppError> {
    check_file_id(id)?;
    storage.get()?.read_file(id).map_err(file_failed)
}

fn delete_file_item(storage: &AppStorage, id: &str) -> Result<(), AppError> {
    check_file_id(id)?;
    storage.get()?.delete_file(id).map_err(file_failed)
}

fn orphan_report_item(storage: &AppStorage) -> Result<OrphanReport, AppError> {
    storage.get()?.orphan_report().map_err(file_failed)
}

/// Saves a file. The request body is the raw bytes; the original name is in the
/// `x-mnemo-file-name` header, percent-encoded.
#[tauri::command]
pub async fn add_file(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<FileRecord, AppError> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(invalid_file_input("The file must be sent as raw bytes."));
    };
    let bytes = bytes.clone();
    let name = request
        .headers()
        .get(FILE_NAME_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    off_main_thread(app, move |s| save_file_item(s, name.as_deref(), &bytes)).await
}

/// The details of a saved file.
#[tauri::command]
pub async fn get_file(app: tauri::AppHandle, id: String) -> Result<FileRecord, AppError> {
    off_main_thread(app, move |s| get_file_item(s, &id)).await
}

/// The bytes of a saved file, as a raw reply. Only a file id is accepted, never a path.
#[tauri::command]
pub async fn read_file(
    app: tauri::AppHandle,
    id: String,
) -> Result<tauri::ipc::Response, AppError> {
    let bytes = off_main_thread(app, move |s| read_file_item(s, &id)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Soft-deletes a saved file. The file stays on disk.
#[tauri::command]
pub async fn delete_file(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    off_main_thread(app, move |s| delete_file_item(s, &id)).await
}

/// Lists files in the folder that no row owns. It deletes nothing.
#[tauri::command]
pub async fn file_orphan_report(app: tauri::AppHandle) -> Result<OrphanReport, AppError> {
    off_main_thread(app, orphan_report_item).await
}

fn add_item<T: Item>(storage: &AppStorage, input: &T::Input) -> Result<T, AppError> {
    storage.get()?.add::<T>(input).map_err(item_failed)
}

fn get_item<T: Item>(storage: &AppStorage, id: &str) -> Result<T, AppError> {
    storage.get()?.get::<T>(id).map_err(item_failed)
}

fn list_items<T: Item>(storage: &AppStorage, args: &ListArgs) -> Result<Page<T>, AppError> {
    let page = PageRequest {
        limit: args.limit,
        after: args.after.clone(),
    };
    storage
        .get()?
        .list::<T>(&page, args.include_deleted)
        .map_err(item_failed)
}

fn update_item<T: Item>(storage: &AppStorage, id: &str, input: &T::Input) -> Result<T, AppError> {
    storage.get()?.update::<T>(id, input).map_err(item_failed)
}

fn delete_item<T: Item>(storage: &AppStorage, id: &str) -> Result<(), AppError> {
    storage.get()?.delete::<T>(id).map_err(item_failed)
}

/// The five commands of one item type. Each runs off the main thread and calls one
/// storage function; checks of the fields happen in storage before any write.
macro_rules! item_commands {
    ($rec:ty, $input:ty, $add:ident, $get:ident, $list:ident, $update:ident, $delete:ident) => {
        /// Adds an item. The core sets its id and times.
        #[tauri::command]
        pub async fn $add(app: tauri::AppHandle, input: $input) -> Result<$rec, AppError> {
            off_main_thread(app, move |s| add_item::<$rec>(s, &input)).await
        }

        /// The live item with this id.
        #[tauri::command]
        pub async fn $get(app: tauri::AppHandle, id: String) -> Result<$rec, AppError> {
            off_main_thread(app, move |s| get_item::<$rec>(s, &id)).await
        }

        /// One page of items, newest first.
        #[tauri::command]
        pub async fn $list(app: tauri::AppHandle, args: ListArgs) -> Result<Page<$rec>, AppError> {
            off_main_thread(app, move |s| list_items::<$rec>(s, &args)).await
        }

        /// Replaces every field of a live item.
        #[tauri::command]
        pub async fn $update(
            app: tauri::AppHandle,
            id: String,
            input: $input,
        ) -> Result<$rec, AppError> {
            off_main_thread(app, move |s| update_item::<$rec>(s, &id, &input)).await
        }

        /// Soft deletes an item and removes its links.
        #[tauri::command]
        pub async fn $delete(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
            off_main_thread(app, move |s| delete_item::<$rec>(s, &id)).await
        }
    };
}

item_commands!(
    Bookmark,
    BookmarkInput,
    add_bookmark,
    get_bookmark,
    list_bookmarks,
    update_bookmark,
    delete_bookmark
);
item_commands!(
    Note,
    NoteInput,
    add_note,
    get_note,
    list_notes,
    update_note,
    delete_note
);
// Ideas (#34) have their own storage functions: tags live in their own table and the
// stage follows four plain checks, so the generic item engine does not fit them.

/// Adds an idea with its tags. The core sets its stage from the checks.
#[tauri::command]
pub async fn add_idea(app: tauri::AppHandle, input: IdeaInput) -> Result<Idea, AppError> {
    off_main_thread(app, move |s| s.get()?.add_idea(&input).map_err(item_failed)).await
}

/// The live idea with this id, with its tags, checks and project.
#[tauri::command]
pub async fn get_idea(app: tauri::AppHandle, id: String) -> Result<Idea, AppError> {
    off_main_thread(app, move |s| s.get()?.get_idea(&id).map_err(item_failed)).await
}

/// One page of ideas, newest first.
#[tauri::command]
pub async fn list_ideas(app: tauri::AppHandle, args: ListArgs) -> Result<Page<Idea>, AppError> {
    off_main_thread(app, move |s| {
        let page = PageRequest {
            limit: args.limit,
            after: args.after.clone(),
        };
        s.get()?
            .list_ideas(&page, args.include_deleted)
            .map_err(item_failed)
    })
    .await
}

/// Replaces every field of a live idea, tags included. The stage follows the checks.
#[tauri::command]
pub async fn update_idea(
    app: tauri::AppHandle,
    id: String,
    input: IdeaInput,
) -> Result<Idea, AppError> {
    off_main_thread(app, move |s| {
        s.get()?.update_idea(&id, &input).map_err(item_failed)
    })
    .await
}

/// Soft deletes an idea and removes its links.
#[tauri::command]
pub async fn delete_idea(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    off_main_thread(app, move |s| s.get()?.delete_idea(&id).map_err(item_failed)).await
}

/// "Turn into project", at any stage: adds a project, links idea and project, and moves
/// the idea to the stage Project.
#[tauri::command]
pub async fn turn_idea_into_project(
    app: tauri::AppHandle,
    id: String,
) -> Result<IdeaProject, AppError> {
    off_main_thread(app, move |s| {
        s.get()?.turn_idea_into_project(&id).map_err(item_failed)
    })
    .await
}
item_commands!(
    Project,
    ProjectInput,
    add_project,
    get_project,
    list_projects,
    update_project,
    delete_project
);
item_commands!(
    Task,
    TaskInput,
    add_task,
    get_task,
    list_tasks,
    update_task,
    delete_task
);
item_commands!(
    Event,
    EventInput,
    add_event,
    get_event,
    list_events,
    update_event,
    delete_event
);
// Run rows belong to the run queue (it adds them, moves them through their states and ends
// them), so the UI can only read them. Cancelling goes through `cancel_run`.

/// The live run with this id.
#[tauri::command]
pub async fn get_run(app: tauri::AppHandle, id: String) -> Result<Run, AppError> {
    off_main_thread(app, move |s| get_item::<Run>(s, &id)).await
}

/// One page of runs, newest first.
#[tauri::command]
pub async fn list_runs(app: tauri::AppHandle, args: ListArgs) -> Result<Page<Run>, AppError> {
    off_main_thread(app, move |s| list_items::<Run>(s, &args)).await
}
item_commands!(
    Memory,
    MemoryInput,
    add_memory,
    get_memory,
    list_memories,
    update_memory,
    delete_memory
);

fn link_add(storage: &AppStorage, a: &ItemRef, b: &ItemRef) -> Result<Link, AppError> {
    storage.get()?.add_link(a, b).map_err(item_failed)
}

fn link_list(
    storage: &AppStorage,
    item: &ItemRef,
    page: &PageRequest,
) -> Result<Page<Link>, AppError> {
    storage.get()?.list_links(item, page).map_err(item_failed)
}

fn link_remove(storage: &AppStorage, id: &str) -> Result<(), AppError> {
    storage.get()?.remove_link(id).map_err(item_failed)
}

/// Links two live items of any type. Linking a linked pair again returns that link.
#[tauri::command]
pub async fn add_link(app: tauri::AppHandle, a: ItemRef, b: ItemRef) -> Result<Link, AppError> {
    off_main_thread(app, move |s| link_add(s, &a, &b)).await
}

/// One page of the live links of an item, each naming the item at the other end.
#[tauri::command]
pub async fn list_links(
    app: tauri::AppHandle,
    item: ItemRef,
    page: PageRequest,
) -> Result<Page<Link>, AppError> {
    off_main_thread(app, move |s| link_list(s, &item, &page)).await
}

/// Removes a link.
#[tauri::command]
pub async fn remove_link(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    off_main_thread(app, move |s| link_remove(s, &id)).await
}

// ---- Labels and labelled notes (#33) ----

fn label_create(
    storage: &AppStorage,
    parent_id: Option<&str>,
    name: &str,
) -> Result<Label, AppError> {
    storage
        .get()?
        .create_label(parent_id, name)
        .map_err(item_failed)
}

fn label_rename(storage: &AppStorage, id: &str, name: &str) -> Result<Label, AppError> {
    storage.get()?.rename_label(id, name).map_err(item_failed)
}

fn label_move(storage: &AppStorage, id: &str, parent_id: Option<&str>) -> Result<Label, AppError> {
    storage
        .get()?
        .move_label(id, parent_id)
        .map_err(item_failed)
}

fn label_delete(storage: &AppStorage, id: &str) -> Result<DeleteLabelOutcome, AppError> {
    storage.get()?.delete_label(id).map_err(item_failed)
}

fn label_delete_count(storage: &AppStorage, id: &str) -> Result<u32, AppError> {
    storage
        .get()?
        .count_notes_moving_on_delete(id)
        .map_err(item_failed)
}

fn label_list(storage: &AppStorage) -> Result<Vec<Label>, AppError> {
    storage.get()?.list_labels().map_err(item_failed)
}

fn labelled_note_save(
    storage: &AppStorage,
    id: Option<&str>,
    body: &str,
    label_ids: &[String],
) -> Result<LabelledNote, AppError> {
    storage
        .get()?
        .save_labelled_note(id, body, label_ids)
        .map_err(item_failed)
}

fn labelled_note_list(
    storage: &AppStorage,
    label_id: Option<&str>,
    page: &ChangePageRequest,
) -> Result<ChangePage<LabelledNote>, AppError> {
    storage
        .get()?
        .list_labelled_notes(label_id, page)
        .map_err(item_failed)
}

/// Creates a label under `parent_id` (null: a top label).
#[tauri::command]
pub async fn create_label(
    app: tauri::AppHandle,
    parent_id: Option<String>,
    name: String,
) -> Result<Label, AppError> {
    off_main_thread(app, move |s| label_create(s, parent_id.as_deref(), &name)).await
}

/// Renames a label.
#[tauri::command]
pub async fn rename_label(
    app: tauri::AppHandle,
    id: String,
    name: String,
) -> Result<Label, AppError> {
    off_main_thread(app, move |s| label_rename(s, &id, &name)).await
}

/// Moves a label under `parent_id` (null: to the top).
#[tauri::command]
pub async fn move_label(
    app: tauri::AppHandle,
    id: String,
    parent_id: Option<String>,
) -> Result<Label, AppError> {
    off_main_thread(app, move |s| label_move(s, &id, parent_id.as_deref())).await
}

/// Deletes a label: its notes get the parent label and its child labels move up.
#[tauri::command]
pub async fn delete_label(
    app: tauri::AppHandle,
    id: String,
) -> Result<DeleteLabelOutcome, AppError> {
    off_main_thread(app, move |s| label_delete(s, &id)).await
}

/// How many notes deleting a label would move to its parent label (0 for a top label).
#[tauri::command]
pub async fn count_label_delete_moves(app: tauri::AppHandle, id: String) -> Result<u32, AppError> {
    off_main_thread(app, move |s| label_delete_count(s, &id)).await
}

/// Every live label, flat with its parent id.
#[tauri::command]
pub async fn list_labels(app: tauri::AppHandle) -> Result<Vec<Label>, AppError> {
    off_main_thread(app, label_list).await
}

/// Adds a note (`id` null) or replaces a note's text, with at least one label.
#[tauri::command]
pub async fn save_labelled_note(
    app: tauri::AppHandle,
    id: Option<String>,
    body: String,
    label_ids: Vec<String>,
) -> Result<LabelledNote, AppError> {
    off_main_thread(app, move |s| {
        labelled_note_save(s, id.as_deref(), &body, &label_ids)
    })
    .await
}

/// One page of notes, newest change first: of a label and its child labels, or all (null).
#[tauri::command]
pub async fn list_labelled_notes(
    app: tauri::AppHandle,
    label_id: Option<String>,
    page: ChangePageRequest,
) -> Result<ChangePage<LabelledNote>, AppError> {
    off_main_thread(app, move |s| {
        labelled_note_list(s, label_id.as_deref(), &page)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn ping_returns_pong() {
        assert_eq!(ping(), "pong from the Rust core");
    }

    fn temp_storage() -> (Storage, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("mnemo-appstorage-{}", uuid::Uuid::new_v4()));
        (Storage::open(&dir.join("mnemo.db")).unwrap(), dir)
    }

    fn app_storage() -> (AppStorage, std::path::PathBuf) {
        let (s, dir) = temp_storage();
        (AppStorage::new(Ok(s)), dir)
    }

    #[test]
    fn reset_with_a_wrong_word_gives_reset_not_confirmed_and_keeps_data() {
        let (state, dir) = app_storage();
        state
            .get()
            .unwrap()
            .add::<Note>(&NoteInput {
                body: "keep".into(),
            })
            .unwrap();
        for word in ["", "reset", "RESET "] {
            let err = reset_item(&state, word).unwrap_err();
            assert_eq!(err.code, "reset_not_confirmed");
            assert!(!err.message.contains('/'));
        }
        let page = state
            .get()
            .unwrap()
            .list::<Note>(
                &PageRequest {
                    limit: 10,
                    after: None,
                },
                false,
            )
            .unwrap();
        assert_eq!(page.items.len(), 1);
        reset_item(&state, "RESET").unwrap();
        let page = state
            .get()
            .unwrap()
            .list::<Note>(
                &PageRequest {
                    limit: 10,
                    after: None,
                },
                false,
            )
            .unwrap();
        assert!(page.items.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn export_with_a_missing_folder_gives_export_target_invalid() {
        let (state, dir) = app_storage();
        let missing = dir.join("nope");
        let err =
            export_item(&state, &missing.to_string_lossy(), "2026-11-21T12:00:00Z").unwrap_err();
        assert_eq!(err.code, "export_target_invalid");
        assert!(!err.message.contains('/'));
        assert!(!missing.exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn export_failed_messages_match_what_happened_to_the_folder() {
        use crate::storage::export::{ExportError, FolderState};
        let msg = |folder| {
            export_failed(ExportError::Failed {
                cause: StorageError::FileMissing,
                folder,
            })
        };
        let none = msg(FolderState::NotCreated);
        assert_eq!(none.code, "export_failed");
        assert!(none.message.contains("No export folder was made"));
        assert!(!none.message.contains("was removed"));
        assert!(msg(FolderState::Removed).message.contains("was removed"));
        let left = msg(FolderState::Left);
        assert!(left.message.contains("could not be removed"));
        assert!(!left.message.contains("was removed"));
        // A database error with an Invalid-looking cause is not a bad target.
        let other = export_failed(ExportError::Failed {
            cause: StorageError::Invalid("x".into()),
            folder: FolderState::Removed,
        });
        assert_eq!(other.code, "export_failed");
    }

    #[test]
    fn export_does_not_hold_the_storage_lock_while_finishing() {
        let (state, dir) = app_storage();
        let job = {
            let g = state.get().unwrap();
            g.export_begin(&dir, "2026-11-21T12:00:00Z").unwrap()
        };
        // The guard is gone: another caller can lock while the copy is still to do.
        assert!(state.get().is_ok());
        assert!(job.finish().is_ok());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn reset_is_refused_while_an_export_is_copying_and_allowed_after() {
        let (state, dir) = app_storage();
        // Same steps as `export`, paused after the lock is released and before the copy.
        let job = {
            let g = state.get().unwrap();
            state.exporting.store(true, Ordering::SeqCst);
            g.export_begin(&dir, "2026-11-21T12:00:00Z").unwrap()
        };
        let err = reset_item(&state, "RESET").unwrap_err();
        assert_eq!(err.code, "export_running");
        assert!(err.message.contains("Wait for it to finish"));
        // Reads and saves are not held up by the copy.
        assert!(state.get().is_ok());
        let second = state.export(&dir.to_string_lossy(), "2026-11-21T12:00:01Z");
        assert_eq!(second.unwrap_err().code, "export_running");
        assert!(job.finish().is_ok());
        state.exporting.store(false, Ordering::SeqCst);
        reset_item(&state, "RESET").unwrap();
        // A whole export clears the flag by itself.
        state
            .export(&dir.to_string_lossy(), "2026-11-21T12:00:02Z")
            .unwrap();
        reset_item(&state, "RESET").unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn storage_that_lost_its_database_after_a_failed_reset_says_unavailable() {
        let (state, dir) = app_storage();
        {
            let mut g = state.get().unwrap();
            g.break_for_test();
            let err = g.reset("RESET").unwrap_err();
            assert!(matches!(err, StorageError::Open(_)));
        }
        let err = state.get().err().expect("unavailable");
        assert_eq!(err.code, "storage_unavailable");
        assert!(!err.message.contains("no such table"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn export_through_the_command_layer_makes_the_folder() {
        let (state, dir) = app_storage();
        let sum = export_item(&state, &dir.to_string_lossy(), "2026-11-21T12:00:00Z").unwrap();
        assert!(std::path::Path::new(&sum.folder).join("notes").is_dir());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn read_file_refuses_a_dotdot_request() {
        let (state, dir) = app_storage();
        std::fs::write(dir.join("outside.txt"), b"secret").unwrap();
        for bad in [
            "../mnemo.db",
            "../outside.txt",
            "/etc/passwd",
            "a/b",
            "a\\b",
            "..",
        ] {
            for err in [
                read_file_item(&state, bad).unwrap_err(),
                get_file_item(&state, bad).unwrap_err(),
                delete_file_item(&state, bad).unwrap_err(),
            ] {
                assert_eq!(err.code, "invalid_file_name", "{bad}");
                assert!(!err.message.contains('/'), "{}", err.message);
            }
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn file_commands_save_read_delete_end_to_end() {
        let (state, dir) = app_storage();
        let bytes: Vec<u8> = (0..=255u8).collect();
        let name = "caf%C3%A9%20photo.png";
        let rec = save_file_item(&state, Some(name), &bytes).unwrap();
        assert_eq!(rec.original_name, "caf\u{e9} photo.png");
        assert_eq!(get_file_item(&state, &rec.id).unwrap(), rec);
        assert_eq!(read_file_item(&state, &rec.id).unwrap(), bytes);
        assert!(orphan_report_item(&state).unwrap().files.is_empty());
        delete_file_item(&state, &rec.id).unwrap();
        assert_eq!(
            read_file_item(&state, &rec.id).unwrap_err().code,
            "file_not_found"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_file_lost_from_disk_gives_file_missing_not_deleted() {
        let (state, dir) = app_storage();
        let rec = save_file_item(&state, Some("a.png"), b"png").unwrap();
        std::fs::remove_dir_all(dir.join("files")).unwrap();
        let err = read_file_item(&state, &rec.id).unwrap_err();
        assert_eq!(err.code, "file_missing");
        assert!(
            !err.message.contains("may have been deleted"),
            "{}",
            err.message
        );
        assert!(
            !err.message.contains('/'),
            "no path may reach the UI: {}",
            err.message
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn add_file_over_the_limit_gives_file_too_large() {
        let (state, dir) = app_storage();
        state
            .get()
            .unwrap()
            .set_setting("files.max_bytes", "10")
            .unwrap();
        let err = save_file_item(&state, Some("big.bin"), &[1u8; 11]).unwrap_err();
        assert_eq!(err.code, "file_too_large");
        assert!(err.message.contains("10 bytes"), "{}", err.message);
        assert!(orphan_report_item(&state).unwrap().files.is_empty());
        assert_eq!(
            save_file_item(&state, None, b"x").unwrap_err().code,
            "invalid_input"
        );
        assert_eq!(
            save_file_item(&state, Some("%ZZ"), b"x").unwrap_err().code,
            "invalid_input"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn percent_decode_round_trips_utf8_names() {
        assert_eq!(percent_decode("plain.png").as_deref(), Some("plain.png"));
        assert_eq!(
            percent_decode("na%C3%AFve%20%E2%9C%93.txt").as_deref(),
            Some("na\u{ef}ve \u{2713}.txt")
        );
        assert_eq!(percent_decode("%"), None);
        assert_eq!(percent_decode("%4"), None);
        assert_eq!(percent_decode("%GG"), None);
        assert_eq!(percent_decode("%FF"), None);
    }

    #[test]
    fn task_result_passes_the_value_and_the_work_error_through() {
        assert_eq!(task_result(Ok(Ok(5))).unwrap(), 5);
        let err = task_result::<()>(Ok(Err(AppError {
            code: "invalid_setting",
            message: "bad".into(),
        })))
        .err()
        .unwrap();
        assert_eq!(err.code, "invalid_setting");
    }

    #[test]
    fn a_panicking_blocking_task_gives_a_coded_error_without_the_detail() {
        let joined: Result<Result<(), AppError>, tauri::Error> =
            tauri::async_runtime::block_on(tauri::async_runtime::spawn_blocking(|| {
                panic!("secret detail at /home/someone/mnemo.db")
            }));
        let err = task_result(joined).err().unwrap();
        assert_eq!(err.code, "storage_error");
        assert!(
            !err.message.contains('/') && !err.message.contains("secret"),
            "no detail may reach the UI: {}",
            err.message
        );
    }

    #[test]
    fn app_storage_gives_the_database_when_it_opened() {
        let (storage, dir) = temp_storage();
        assert!(AppStorage::new(Ok(storage)).get().is_ok());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn app_storage_returns_a_coded_error_without_the_detail() {
        let state = AppStorage::new(Err(StartupError {
            code: "open",
            detail: "unable to open /home/someone/secret/mnemo.db".into(),
        }));
        let err = state.get().err().unwrap();
        assert_eq!(err.code, "storage_unavailable");
        assert!(
            !err.message.contains('/'),
            "no path may reach the UI: {}",
            err.message
        );
    }

    #[test]
    fn app_storage_recovers_from_a_poisoned_lock() {
        let (storage, dir) = temp_storage();
        let state = std::sync::Arc::new(AppStorage::new(Ok(storage)));
        let s2 = state.clone();
        let _ = std::thread::spawn(move || {
            let _guard = s2.get().unwrap();
            panic!("a command panicked while holding storage");
        })
        .join();
        assert!(state.get().is_ok());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn setting_commands_write_then_read_through_app_storage() {
        let (storage, dir) = temp_storage();
        let state = AppStorage::new(Ok(storage));
        assert_eq!(read_setting(&state, "sidebar_collapsed").unwrap(), None);
        write_setting(&state, "sidebar_collapsed", "true").unwrap();
        write_setting(&state, "sidebar_collapsed", "false").unwrap();
        assert_eq!(
            read_setting(&state, "sidebar_collapsed")
                .unwrap()
                .as_deref(),
            Some("false")
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn setting_commands_give_storage_unavailable_when_the_database_did_not_open() {
        let state = AppStorage::new(Err(StartupError {
            code: "open",
            detail: "x".into(),
        }));
        assert_eq!(
            read_setting(&state, "k").unwrap_err().code,
            "storage_unavailable"
        );
        assert_eq!(
            write_setting(&state, "k", "v").unwrap_err().code,
            "storage_unavailable"
        );
    }

    #[test]
    fn setting_commands_refuse_a_bad_key_or_a_too_long_value() {
        let (storage, dir) = temp_storage();
        let state = AppStorage::new(Ok(storage));
        for bad in ["", "Has Space", "a/b", &"k".repeat(101)] {
            assert_eq!(
                read_setting(&state, bad).unwrap_err().code,
                "invalid_setting"
            );
            assert_eq!(
                write_setting(&state, bad, "v").unwrap_err().code,
                "invalid_setting"
            );
        }
        assert_eq!(
            write_setting(&state, "k", &"v".repeat(1001))
                .unwrap_err()
                .code,
            "invalid_setting"
        );
        assert_eq!(read_setting(&state, "k").unwrap(), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    const NOW: i64 = 1_794_990_000;
    const DAY: i64 = 24 * 60 * 60;

    fn clock_at(t: i64) -> crate::scheduler::ai_control::Clock {
        Arc::new(move || t)
    }

    #[test]
    fn set_setting_refuses_ai_control_keys_and_still_reads_them() {
        let (state, dir) = app_storage();
        for key in ["ai_enabled", "ai_pause_reason", "ai_usage_last"] {
            let err = write_setting(&state, key, "false").unwrap_err();
            assert_eq!(err.code, "invalid_setting");
            assert!(err.message.contains("Settings > AI"));
        }
        state.get().unwrap().set_ai_enabled(false).unwrap();
        assert_eq!(
            read_setting(&state, "ai_enabled").unwrap().as_deref(),
            Some("false")
        );
        // Other keys are not touched by the rule.
        write_setting(&state, "air_quality", "1").unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ai_control_view_counts_mnemo_runs_today_and_this_week_with_no_reading() {
        let (state, dir) = app_storage();
        let control = crate::scheduler::ai_control::testing::open_control_at(clock_at(NOW));
        let today = NOW - 3600;
        let week = today - 2 * DAY;
        {
            let s = state.get().unwrap();
            for at in [today + 60, today - DAY, week - 60] {
                let iso = format_utc(at as u64);
                let id = s.enqueue_run("summary", &iso).unwrap().base.id;
                s.start_run(&id, &iso).unwrap();
            }
        }
        let view = ai_control_view(&control, &state, today, week).unwrap();
        assert_eq!(view.usage, UsageView::Runs { today: 1, week: 2 });
        let json = serde_json::to_value(&view).unwrap();
        assert_eq!(
            json["usage"],
            serde_json::json!({"kind": "runs", "today": 1, "week": 2})
        );
        assert_eq!(json["enabled"], true);
        assert_eq!(
            (json["warnAt"].clone(), json["pauseAt"].clone()),
            (60.into(), 95.into())
        );
        assert!(json["pause"].is_null());
        assert_eq!(json["backgroundGate"], serde_json::json!({"kind": "allow"}));
        assert_eq!(json["warn"], false);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ai_control_view_gives_the_reading_and_no_percent_for_a_window_that_reset() {
        let (state, dir) = app_storage();
        let control = crate::scheduler::ai_control::testing::open_control_at(clock_at(NOW));
        let window = |u: f64, resets_at: i64| crate::ai::usage::UsageWindow {
            utilization: Some(u),
            resets_at: Some(resets_at),
            status: Some("allowed".into()),
        };
        // Read an hour ago: the 5-hour window reset since, the 7-day one did not.
        control.on_usage_reading(
            crate::ai::usage::UsageReading {
                five_hour: Some(window(0.97, NOW - 60)),
                seven_day: Some(window(0.64, NOW + 3 * DAY)),
                ..Default::default()
            },
            NOW - 3600,
        );
        let view = ai_control_view(&control, &state, NOW - 600, NOW - DAY).unwrap();
        let json = serde_json::to_value(&view).unwrap();
        assert_eq!(json["usage"]["kind"], "reading");
        assert_eq!(json["usage"]["readAt"], NOW - 3600);
        assert!(json["usage"]["fiveHour"]["percent"].is_null());
        assert_eq!(json["usage"]["sevenDay"]["percent"], 64);
        assert_eq!(json["usage"]["sevenDay"]["resetsAt"], NOW + 3 * DAY);
        assert_eq!(json["warn"], true);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ai_control_view_shows_the_limit_pause_and_the_gate_reason() {
        let (state, dir) = app_storage();
        let control = crate::scheduler::ai_control::testing::open_control_at(clock_at(NOW));
        control.on_limit_error(control.reading_seq(), NOW);
        let json =
            serde_json::to_value(ai_control_view(&control, &state, NOW - 60, NOW - 60).unwrap())
                .unwrap();
        assert_eq!(
            json["pause"],
            serde_json::json!({"reason": "limit", "until": null})
        );
        assert_eq!(
            json["backgroundGate"],
            serde_json::json!({"kind": "deny", "reason": "limit"})
        );
        control.resume().unwrap();
        control.pause().unwrap();
        let json =
            serde_json::to_value(ai_control_view(&control, &state, NOW - 60, NOW - 60).unwrap())
                .unwrap();
        assert_eq!(json["pause"]["reason"], "owner");
        assert_eq!(json["backgroundGate"]["reason"], "owner_pause");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ai_control_view_rejects_bad_day_boundaries() {
        let (state, dir) = app_storage();
        let control = crate::scheduler::ai_control::testing::open_control_at(clock_at(NOW));
        for (today, week) in [
            (NOW + DAY, NOW),
            (NOW - DAY, NOW - 60),
            (NOW - 60, -5),
            (NOW - 60, NOW - 9 * DAY),
        ] {
            assert_eq!(
                ai_control_view(&control, &state, today, week)
                    .unwrap_err()
                    .code,
                "invalid_input",
                "{today} {week}"
            );
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ai_control_errors_have_stable_codes_and_the_plain_threshold_message() {
        let control = crate::scheduler::ai_control::testing::open_control_at(clock_at(NOW));
        let err = control_failed(control.set_thresholds(95, 60).unwrap_err());
        assert_eq!(err.code, "invalid_input");
        assert_eq!(
            err.message,
            "Warn and pause must be whole numbers from 1 to 100, and warn must be lower than pause."
        );
        let err = control_failed(ControlError::Storage("disk /home/x full".into()));
        assert_eq!(err.code, "storage_error");
        assert!(!err.message.contains('/'));
        assert_eq!(
            control_failed(ControlError::Unavailable).code,
            "storage_unavailable"
        );
    }

    #[test]
    fn ai_mode_serialises_as_fake_or_real_and_follows_the_state() {
        assert_eq!(serde_json::to_string(&AiMode::Fake).unwrap(), "\"fake\"");
        assert_eq!(serde_json::to_string(&AiMode::Real).unwrap(), "\"real\"");
        let fake = AiRunnerState { fake: true };
        let real = AiRunnerState { fake: false };
        assert_eq!(fake.mode(), AiMode::Fake);
        assert_eq!(real.mode(), AiMode::Real);
    }

    /// The run log of the tests: the same functions as the app's, on a temporary storage.
    struct StorageLog(AppStorage);

    impl RunLog for StorageLog {
        fn enqueue(&self, task_type: &str) -> Result<String, RunLogError> {
            log_enqueue(&self.0, task_type)
        }
        fn start(&self, id: &str) -> Result<(), RunLogError> {
            log_start(&self.0, id)
        }
        fn finish(
            &self,
            id: &str,
            end: &RunEnd,
            duration_ms: Option<i64>,
        ) -> Result<(), RunLogError> {
            log_finish(&self.0, id, end, duration_ms)
        }
    }

    /// A queue on `runner` and a temporary storage, as the app builds it.
    fn test_queue(
        runner: Arc<dyn crate::ai::runner::AiRunner>,
    ) -> (RunQueue, Arc<StorageLog>, std::path::PathBuf) {
        let (storage, dir) = app_storage();
        let log = Arc::new(StorageLog(storage));
        let notify: crate::scheduler::queue::Notifier = Arc::new(|_| {});
        let control = crate::scheduler::ai_control::testing::open_control();
        (
            RunQueue::new(runner, log.clone(), notify, control),
            log,
            dir,
        )
    }

    #[test]
    fn test_prompt_command_with_the_fake_gives_the_fake_answer() {
        let (queue, _log, dir) = test_queue(crate::ai::runner::select_runner(true, None, None));
        let got = run_test_prompt_with(&queue, &queue.control()).unwrap();
        assert_eq!(got.answer, "Fake answer: AI is in test mode.");
        let json = serde_json::to_value(&got).unwrap();
        assert!(json.get("durationMs").is_some());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_prompt_through_the_queue_leaves_one_done_run_row() {
        let (queue, log, dir) = test_queue(crate::ai::runner::select_runner(true, None, None));
        run_test_prompt_with(&queue, &queue.control()).unwrap();
        let storage = log.0.get().unwrap();
        let rows = storage
            .list::<Run>(
                &PageRequest {
                    limit: 10,
                    after: None,
                },
                true,
            )
            .unwrap()
            .items;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].task_type, "test_prompt");
        assert_eq!(rows[0].state, crate::storage::items::RunState::Done);
        assert!(rows[0].ended_at.is_some());
        drop(storage);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_prompt_gives_the_runner_error_and_writes_it_to_the_row() {
        let fake = Arc::new(crate::ai::fake::FakeRunner::new(
            crate::ai::fake::FakeResult::Timeout,
        ));
        let (queue, log, dir) = test_queue(fake);
        let err = run_test_prompt_with(&queue, &queue.control()).unwrap_err();
        assert_eq!(err.code, "timeout");
        let storage = log.0.get().unwrap();
        let page = PageRequest {
            limit: 10,
            after: None,
        };
        let rows = storage.list::<Run>(&page, true).unwrap().items;
        assert_eq!(rows[0].error.as_deref(), Some("the AI run timed out"));
        drop(storage);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_prompt_reports_storage_unavailable_and_starts_no_run() {
        let fake = Arc::new(crate::ai::fake::FakeRunner::new(
            crate::ai::fake::FakeResult::Timeout,
        ));
        let log = Arc::new(StorageLog(AppStorage::new(Err(StartupError {
            code: "open",
            detail: "x".into(),
        }))));
        let notify: crate::scheduler::queue::Notifier = Arc::new(|_| {});
        let control = crate::scheduler::ai_control::testing::open_control();
        let queue = RunQueue::new(fake.clone(), log, notify, control);
        let err = run_test_prompt_with(&queue, &queue.control()).unwrap_err();
        assert_eq!(err.code, "storage_unavailable");
        assert!(fake.requests().is_empty());
    }

    /// The number of run rows in the queue's storage.
    fn run_rows(log: &StorageLog) -> usize {
        let storage = log.0.get().unwrap();
        let page = PageRequest {
            limit: 10,
            after: None,
        };
        storage.list::<Run>(&page, true).unwrap().items.len()
    }

    #[test]
    fn test_prompt_asks_the_gate_first_and_is_refused_with_ai_off_and_no_run_row() {
        let fake = Arc::new(crate::ai::fake::FakeRunner::new(
            crate::ai::fake::FakeResult::Timeout,
        ));
        let (queue, log, dir) = test_queue(fake.clone());
        let control = queue.control();
        control.set_enabled(false).unwrap();
        let err = run_test_prompt_with(&queue, &control).unwrap_err();
        assert_eq!(err.code, "ai_off");
        assert!(err.message.contains("AI is off"), "{}", err.message);
        assert_eq!(run_rows(&log), 0, "a refused prompt wrote a run row");
        assert_eq!(fake.starts(), 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_prompt_at_the_usage_limit_is_refused_with_ai_limit_and_a_plain_message() {
        let fake = Arc::new(crate::ai::fake::FakeRunner::new(
            crate::ai::fake::FakeResult::UsageLimit,
        ));
        let (queue, log, dir) = test_queue(fake.clone());
        let control = queue.control();
        // The first prompt hits the limit; that holds owner tasks.
        assert_eq!(
            run_test_prompt_with(&queue, &control).unwrap_err().code,
            "usage_limit"
        );
        let err = run_test_prompt_with(&queue, &control).unwrap_err();
        assert_eq!(err.code, "ai_limit");
        assert!(err.message.contains("usage limit") && err.message.contains("Resume"));
        assert!(!err.message.contains('{'), "no raw output: {}", err.message);
        assert_eq!(run_rows(&log), 1);
        assert_eq!(fake.starts(), 1);
        // A manual pause holds only background work: the owner's prompt runs after Resume.
        control.resume().unwrap();
        control.pause().unwrap();
        fake.push(crate::ai::fake::FakeResult::Valid(
            r#"{"answer":"hi"}"#.into(),
        ));
        assert_eq!(run_test_prompt_with(&queue, &control).unwrap().answer, "hi");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn cancel_run_checks_the_id_and_says_when_the_run_is_not_active() {
        let (queue, _log, dir) = test_queue(crate::ai::runner::select_runner(true, None, None));
        assert_eq!(
            cancel_run_with(&queue, " ").unwrap_err().code,
            "invalid_input"
        );
        assert_eq!(
            cancel_run_with(&queue, &"x".repeat(101)).unwrap_err().code,
            "invalid_input"
        );
        assert_eq!(
            cancel_run_with(&queue, "no-such-run").unwrap_err().code,
            "run_not_active"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn cancel_run_blocking_runs_the_cancel_on_a_blocking_thread() {
        let (queue, _log, dir) = test_queue(crate::ai::runner::select_runner(true, None, None));
        let err = tauri::async_runtime::block_on(cancel_run_blocking(queue, "no-such-run".into()))
            .unwrap_err();
        assert_eq!(err.code, "run_not_active");
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Every task gets the same fixed row, standing in for the owner's Settings choice.
    struct FixedChoice(ModelRow);

    impl ModelChoices for FixedChoice {
        fn row(&self, _task: &str) -> Option<ModelRow> {
            Some(self.0)
        }
    }

    #[test]
    fn the_app_queue_runs_the_test_prompt_with_the_owners_model_and_effort() {
        let fake = Arc::new(crate::ai::fake::FakeRunner::new(
            crate::ai::fake::FakeResult::Valid(r#"{"answer":"Hi"}"#.into()),
        ));
        let mut row = models::default_row("test_prompt").unwrap();
        row.model = models::AiModel::Opus;
        row.effort = models::AiEffort::High;
        let (queue, _log, dir) =
            test_queue(models::app_runner(fake.clone(), Arc::new(FixedChoice(row))));
        run_test_prompt_with(&queue, &queue.control()).unwrap();
        let seen = fake.requests();
        assert_eq!(seen[0].model, "opus");
        assert_eq!(seen[0].effort.as_deref(), Some("high"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn cancel_run_stops_a_running_run() {
        let fake = Arc::new(crate::ai::fake::FakeRunner::new(
            crate::ai::fake::FakeResult::BlockUntilCancelled,
        ));
        let (queue, _log, dir) = test_queue(fake);
        let ticket = queue.submit(Priority::Owner, test_prompt::task()).unwrap();
        cancel_run_with(&queue, &ticket.id).unwrap();
        assert_eq!(
            ticket
                .done
                .recv_timeout(std::time::Duration::from_secs(2))
                .unwrap(),
            Err(AiError::Cancelled)
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_prompt_errors_have_a_code_and_a_plain_message_without_output() {
        let errors = [
            AiError::Timeout,
            AiError::UsageLimit,
            AiError::SchemaMismatch,
            AiError::ExitError { code: Some(1) },
            AiError::ExitError { code: None },
            AiError::Unavailable,
            AiError::Cancelled,
        ];
        let mut codes = Vec::new();
        for e in &errors {
            let app = ai_failed(e);
            assert!(!app.code.is_empty());
            assert!(!app.message.is_empty());
            assert!(app.message.ends_with('.'));
            assert!(!app.message.contains("code "));
            codes.push(app.code);
        }
        assert_eq!(ai_failed(&AiError::UsageLimit).code, "usage_limit");
        assert_eq!(
            ai_failed(&AiError::ExitError { code: None }).code,
            "exit_error"
        );
        codes.sort_unstable();
        codes.dedup();
        assert_eq!(codes.len(), 6);
        assert_eq!(ai_failed(&AiError::Cancelled).code, "cancelled");
    }

    #[test]
    fn ai_health_state_is_empty_until_set_then_keeps_the_latest() {
        let state = AiHealthState::default();
        assert_eq!(state.get(), None);
        state.set(AiHealth::of(health::AiState::NotInstalled));
        state.set(AiHealth::of(health::AiState::Ready));
        assert_eq!(state.get().map(|h| h.state), Some(health::AiState::Ready));
    }

    #[test]
    fn a_slow_older_check_does_not_overwrite_a_newer_result() {
        let state = AiHealthState::default();
        let startup = state.begin();
        let manual = state.begin();
        assert!(state.finish(manual, AiHealth::of(health::AiState::Ready)));
        // The startup check ends last, with an older answer: it is dropped.
        assert!(!state.finish(startup, AiHealth::of(health::AiState::NotInstalled)));
        assert_eq!(state.get().map(|h| h.state), Some(health::AiState::Ready));
    }

    #[test]
    fn ai_health_state_survives_a_poisoned_lock() {
        let state = std::sync::Arc::new(AiHealthState::default());
        let other = state.clone();
        let _ = std::thread::spawn(move || {
            let _guard = other.0.lock().unwrap();
            panic!("poison the lock");
        })
        .join();
        state.set(AiHealth::of(health::AiState::NotSignedIn));
        assert_eq!(
            state.get().map(|h| h.state),
            Some(health::AiState::NotSignedIn)
        );
    }

    fn bookmark_input(url: &str, title: Option<&str>) -> BookmarkInput {
        BookmarkInput {
            url: url.into(),
            title: title.map(Into::into),
            summary: None,
            reason: None,
            reason_is_guess: false,
        }
    }

    fn first_page() -> ListArgs {
        ListArgs {
            limit: 10,
            after: None,
            include_deleted: false,
        }
    }

    /// The same five calls the UI test makes (ui/src/shared/items.test.ts), run through
    /// the functions the commands call, on a temporary database.
    #[test]
    fn bookmark_commands_add_get_list_update_delete_end_to_end() {
        let (storage, dir) = temp_storage();
        let state = AppStorage::new(Ok(storage));

        // The same JSON the UI test sends (ADD_INPUT and UPDATE_INPUT in items.test.ts).
        let add_input: BookmarkInput = serde_json::from_str(
            r#"{"url":"https://example.com","title":null,"summary":null,"reason":null,"reasonIsGuess":false}"#,
        )
        .unwrap();
        let update_input: BookmarkInput = serde_json::from_str(
            r#"{"url":"https://example.com/docs","title":"Docs","summary":null,"reason":null,"reasonIsGuess":false}"#,
        )
        .unwrap();
        let added: Bookmark = add_item::<Bookmark>(&state, &add_input).unwrap();
        assert_eq!(added.url, "https://example.com");
        assert_eq!(added.base.created_at, added.base.updated_at);
        let id = added.base.id.clone();

        assert_eq!(get_item::<Bookmark>(&state, &id).unwrap(), added);

        let page = list_items::<Bookmark>(&state, &first_page()).unwrap();
        assert_eq!(page.items, vec![added.clone()]);
        assert_eq!(page.next, None);

        let updated = update_item::<Bookmark>(&state, &id, &update_input).unwrap();
        assert_eq!(updated.title.as_deref(), Some("Docs"));
        assert_eq!(updated.base.created_at, added.base.created_at);

        delete_item::<Bookmark>(&state, &id).unwrap();
        assert_eq!(
            get_item::<Bookmark>(&state, &id).unwrap_err().code,
            "not_found"
        );
        assert!(list_items::<Bookmark>(&state, &first_page())
            .unwrap()
            .items
            .is_empty());
        let with_deleted = ListArgs {
            include_deleted: true,
            ..first_page()
        };
        let kept = list_items::<Bookmark>(&state, &with_deleted).unwrap().items;
        assert_eq!(kept.len(), 1);
        assert!(kept[0].base.deleted_at.is_some());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn link_commands_add_list_and_remove() {
        let (storage, dir) = temp_storage();
        let state = AppStorage::new(Ok(storage));
        let n: Note = add_item::<Note>(&state, &NoteInput { body: "n".into() }).unwrap();
        let t: Task = add_item::<Task>(
            &state,
            &TaskInput {
                title: "t".into(),
                done: false,
            },
        )
        .unwrap();
        let note = ItemRef {
            kind: crate::storage::items::ItemKind::Note,
            id: n.base.id,
        };
        let task = ItemRef {
            kind: crate::storage::items::ItemKind::Task,
            id: t.base.id,
        };
        let link = link_add(&state, &note, &task).unwrap();
        let page = PageRequest {
            limit: 10,
            after: None,
        };
        assert_eq!(
            link_list(&state, &task, &page).unwrap().items[0].other,
            note
        );
        link_remove(&state, &link.id).unwrap();
        assert!(link_list(&state, &note, &page).unwrap().items.is_empty());
        assert_eq!(link_remove(&state, &link.id).unwrap_err().code, "not_found");
        assert_eq!(
            link_add(&state, &note, &note).unwrap_err().code,
            "invalid_input"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The calls the label and labelled-note commands make, on a temporary database.
    #[test]
    fn label_commands_create_save_list_move_and_delete_end_to_end() {
        let (storage, dir) = temp_storage();
        let state = AppStorage::new(Ok(storage));
        let work = label_create(&state, None, "Work").unwrap();
        let plans = label_create(&state, Some(&work.base.id), "Plans").unwrap();
        assert_eq!(
            label_create(&state, None, "work").unwrap_err().code,
            "invalid_input"
        );
        let refused = labelled_note_save(&state, None, "text", &[]).unwrap_err();
        assert_eq!(refused.code, "invalid_input");
        assert_eq!(refused.message, "A note needs at least one label.");
        let saved =
            labelled_note_save(&state, None, "# Plan", std::slice::from_ref(&plans.base.id))
                .unwrap();
        let page = ChangePageRequest {
            limit: 10,
            after: None,
        };
        let listed = labelled_note_list(&state, Some(&work.base.id), &page).unwrap();
        assert_eq!(listed.items, vec![saved.clone()]);
        let json = serde_json::to_value(&listed).unwrap();
        assert_eq!(json["items"][0]["note"]["body"], "# Plan");
        assert_eq!(json["items"][0]["labelIds"][0], plans.base.id.as_str());
        assert_eq!(
            label_move(&state, &work.base.id, Some(&plans.base.id))
                .unwrap_err()
                .code,
            "invalid_input"
        );
        let renamed = label_rename(&state, &plans.base.id, "Goals").unwrap();
        assert_eq!(renamed.name, "Goals");
        let out = label_delete(&state, &plans.base.id).unwrap();
        assert_eq!(out.moved_notes, 1);
        assert_eq!(
            serde_json::to_value(&out).unwrap()["parentId"],
            work.base.id.as_str()
        );
        let labels = label_list(&state).unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(
            serde_json::to_value(&labels[0]).unwrap()["parentId"],
            serde_json::Value::Null
        );
        assert_eq!(
            label_delete(&state, &plans.base.id).unwrap_err().code,
            "not_found"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn item_errors_map_to_stable_codes_without_detail() {
        let nf = item_failed(StorageError::NotFound { kind: "bookmark" });
        assert_eq!(nf.code, "not_found");
        assert!(nf.message.contains("bookmark"));
        let inv = item_failed(StorageError::Invalid("The title cannot be empty.".into()));
        assert_eq!(inv.code, "invalid_input");
        assert_eq!(inv.message, "The title cannot be empty.");
        for e in [
            StorageError::Database("disk I/O error at /home/someone/mnemo.db".into()),
            StorageError::Open("/home/someone".into()),
            StorageError::MigrationFailed {
                number: 3,
                reason: "x".into(),
            },
            StorageError::SchemaTooNew {
                found: 9,
                supported: 4,
            },
        ] {
            let err = item_failed(e);
            assert_eq!(err.code, "storage_error");
            assert!(!err.message.contains('/'), "{}", err.message);
        }
    }

    #[test]
    fn item_commands_refuse_bad_input_and_give_storage_unavailable_without_a_database() {
        let (storage, dir) = temp_storage();
        let state = AppStorage::new(Ok(storage));
        assert_eq!(
            add_item::<Bookmark>(&state, &bookmark_input("not a link", None))
                .unwrap_err()
                .code,
            "invalid_input"
        );
        let too_big = ListArgs {
            limit: 101,
            ..first_page()
        };
        assert_eq!(
            list_items::<Note>(&state, &too_big).unwrap_err().code,
            "invalid_input"
        );
        let _ = std::fs::remove_dir_all(dir);

        let closed = AppStorage::new(Err(StartupError {
            code: "open",
            detail: "x".into(),
        }));
        assert_eq!(
            add_item::<Note>(&closed, &NoteInput { body: "n".into() })
                .unwrap_err()
                .code,
            "storage_unavailable"
        );
        assert_eq!(
            list_items::<Memory>(&closed, &first_page())
                .unwrap_err()
                .code,
            "storage_unavailable"
        );
        assert_eq!(
            delete_item::<Run>(&closed, "x").unwrap_err().code,
            "storage_unavailable"
        );
    }

    fn row_of(table: &AiModelTable, feature: &str) -> (String, String) {
        let r = table.rows.iter().find(|r| r.feature == feature).unwrap();
        (r.model.value().to_string(), r.effort.value().to_string())
    }

    #[test]
    fn set_ai_model_with_an_unknown_model_gives_invalid_ai_model_and_keeps_the_row() {
        let (state, dir) = app_storage();
        set_ai_model_with(&state, "save", "sonnet", "high").unwrap();
        let err = set_ai_model_with(&state, "save", "gpt-4", "low").unwrap_err();
        assert_eq!(err.code, "invalid_ai_model");
        assert!(err.message.contains("gpt-4"));
        let table = list_ai_models_with(&state).unwrap();
        assert_eq!(row_of(&table, "save"), ("sonnet".into(), "high".into()));
        let err = set_ai_model_with(&state, "save", "opus", "xhigh").unwrap_err();
        assert_eq!(err.code, "invalid_ai_model");
        let err = set_ai_model_with(&state, "nope", "opus", "low").unwrap_err();
        assert_eq!(err.code, "invalid_ai_model");
        let table = list_ai_models_with(&state).unwrap();
        assert_eq!(row_of(&table, "save"), ("sonnet".into(), "high".into()));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ai_model_commands_list_set_reset_end_to_end() {
        let (state, dir) = app_storage();
        let first = list_ai_models_with(&state).unwrap();
        assert_eq!(first.rows.len(), models::DEFAULTS.len());
        assert_eq!(row_of(&first, "save"), ("haiku".into(), "low".into()));
        let set = set_ai_model_with(&state, "ask", "opus", "high").unwrap();
        assert_eq!(row_of(&set, "ask"), ("opus".into(), "high".into()));
        assert_eq!(list_ai_models_with(&state).unwrap(), set);
        let reset = reset_ai_models_with(&state).unwrap();
        assert_eq!(row_of(&reset, "ask"), ("sonnet".into(), "medium".into()));
        assert_eq!(reset.rows, models::DEFAULTS.to_vec());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ai_model_error_message_has_no_path_or_debug_text() {
        let (state, dir) = app_storage();
        let mut errors = vec![
            set_ai_model_with(&state, "save", "gpt-4", "low").unwrap_err(),
            set_ai_model_with(&state, "save", "opus", "xhigh").unwrap_err(),
            set_ai_model_with(&state, "nope", "opus", "low").unwrap_err(),
        ];
        let closed = AppStorage::new(Err(StartupError {
            code: "x",
            detail: "/secret/path".into(),
        }));
        errors.push(list_ai_models_with(&closed).unwrap_err());
        for e in errors {
            for bad in ["/", "\\", "Error", "panicked", "Storage(", "{", "secret"] {
                assert!(!e.message.contains(bad), "{} has {bad}", e.message);
            }
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}

// ---- Save a link (#25, BM-01) ----

/// The event sent with the bookmark after each step of a save or a summary.
pub const BOOKMARK_EVENT: &str = "bookmark-changed";

/// The longest bookmark id the commands take. Ids are UUIDs (36 characters).
const MAX_BOOKMARK_ID_LEN: usize = 100;

impl BookmarkStore for AppStorage {
    fn with_storage(
        &self,
        call: &mut dyn FnMut(&mut Storage) -> Result<Held, StorageError>,
    ) -> Result<Held, SaveError> {
        let mut guard = self.get().map_err(|e| SaveError::Unavailable(e.message))?;
        Ok(call(&mut guard)?)
    }
}

/// The error the UI sees for a save or a summary.
fn save_failed(e: SaveError) -> AppError {
    match e {
        SaveError::Invalid(message) => AppError {
            code: "invalid_input",
            message,
        },
        SaveError::NotFound => AppError {
            code: "not_found",
            message: "There is no such bookmark. It may have been deleted.".to_string(),
        },
        SaveError::Unavailable(message) => AppError {
            code: "storage_unavailable",
            message,
        },
        SaveError::Storage(detail) => {
            log::error!("bookmark storage call failed: {detail}");
            AppError {
                code: "storage_error",
                message: "Mnemo could not save this bookmark. Nothing was deleted.".to_string(),
            }
        }
    }
}

/// Runs one step of save a link on this (blocking) thread: the app's storage, the real page
/// reader, the run queue as the AI runner, the AI control, and the `bookmark-changed` event.
fn with_save_context<T>(
    app: &tauri::AppHandle,
    work: impl FnOnce(&SaveContext<'_>) -> Result<T, SaveError>,
) -> Result<T, AppError> {
    use tauri::Emitter;
    let storage = app.state::<AppStorage>();
    let queue = app.state::<RunQueue>().inner().clone();
    let control = queue.control();
    let runner = QueuedRunner(queue);
    let reader = HttpReader::default();
    let ai_on = || {
        matches!(
            control.may_run(Priority::Owner, control.now()),
            Decision::Allow
        )
    };
    let emit = |b: &SavedBookmark| {
        if let Err(e) = app.emit(BOOKMARK_EVENT, b) {
            log::error!("could not send the bookmark event of {}: {e}", b.base.id);
        }
    };
    let ctx = SaveContext {
        store: storage.inner(),
        reader: &reader,
        runner: &runner,
        ai_on: &ai_on,
        emit: &emit,
    };
    work(&ctx).map_err(save_failed)
}

fn check_bookmark_id(id: &str) -> Result<(), AppError> {
    if id.trim().is_empty() || id.len() > MAX_BOOKMARK_ID_LEN {
        return Err(AppError {
            code: "invalid_input",
            message: "That is not a bookmark id.".to_string(),
        });
    }
    Ok(())
}

/// Saves a link: stores it at once, then reads the page and asks Claude for a summary, tags
/// and a reason. Progress goes out as `bookmark-changed` events. A page that cannot be read, AI
/// off, or a failed run still keeps the link (see the status of the returned bookmark).
#[tauri::command]
pub async fn save_link(app: tauri::AppHandle, url: String) -> Result<SaveResult, AppError> {
    task_result(
        tauri::async_runtime::spawn_blocking(move || {
            with_save_context(&app, |ctx| bookmark_save::save_link(ctx, &url))
        })
        .await,
    )
}

/// Makes the summary of a stored bookmark: from `pasted_text` ("Paste the text") or by reading
/// the page again ("Summarize later").
#[tauri::command]
pub async fn summarize_bookmark(
    app: tauri::AppHandle,
    id: String,
    pasted_text: Option<String>,
) -> Result<SaveResult, AppError> {
    check_bookmark_id(&id)?;
    task_result(
        tauri::async_runtime::spawn_blocking(move || {
            with_save_context(&app, |ctx| {
                bookmark_save::summarize(ctx, &id, pasted_text.as_deref())
            })
        })
        .await,
    )
}

/// One page of bookmarks with their site, summary status and tags, newest first.
#[tauri::command]
pub async fn list_bookmark_cards(
    app: tauri::AppHandle,
    page: PageRequest,
) -> Result<Page<SavedBookmark>, AppError> {
    off_main_thread(app, move |storage| {
        storage
            .get()?
            .list_bookmark_cards(&page)
            .map_err(item_failed)
    })
    .await
}

// ---- Folders, Move and Undo (#26, BM-02) ----
// Each command runs one storage function. Only the owner calls them: a save never makes a folder.

/// The live folders with their bookmark counts, by name, Unsorted last.
#[tauri::command]
pub async fn list_folders(app: tauri::AppHandle) -> Result<Vec<Folder>, AppError> {
    off_main_thread(app, move |storage| {
        storage.get()?.list_folders().map_err(item_failed)
    })
    .await
}

/// Creates a folder with this name.
#[tauri::command]
pub async fn create_folder(app: tauri::AppHandle, name: String) -> Result<Folder, AppError> {
    off_main_thread(app, move |storage| {
        storage.get()?.create_folder(&name).map_err(item_failed)
    })
    .await
}

/// Renames a folder. Unsorted is refused.
#[tauri::command]
pub async fn rename_folder(
    app: tauri::AppHandle,
    id: String,
    name: String,
) -> Result<Folder, AppError> {
    check_bookmark_id(&id)?;
    off_main_thread(app, move |storage| {
        storage
            .get()?
            .rename_folder(&id, &name)
            .map_err(item_failed)
    })
    .await
}

/// Deletes a folder; its bookmarks move to Unsorted. Gives how many live bookmarks moved.
/// Unsorted is refused.
#[tauri::command]
pub async fn delete_folder(app: tauri::AppHandle, id: String) -> Result<u32, AppError> {
    check_bookmark_id(&id)?;
    off_main_thread(app, move |storage| {
        storage.get()?.delete_folder(&id).map_err(item_failed)
    })
    .await
}

/// Moves a bookmark to a folder. The last move or delete can be taken back with `undo_last`.
#[tauri::command]
pub async fn move_bookmark(
    app: tauri::AppHandle,
    id: String,
    folder_id: String,
) -> Result<SavedBookmark, AppError> {
    check_bookmark_id(&id)?;
    check_bookmark_id(&folder_id)?;
    off_main_thread(app, move |storage| {
        storage
            .get()?
            .move_bookmark(&id, &folder_id)
            .map_err(item_failed)
    })
    .await
}

/// Deletes a bookmark (it is kept, marked deleted). The last move or delete can be taken back
/// with `undo_last`.
#[tauri::command]
pub async fn delete_saved_bookmark(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    check_bookmark_id(&id)?;
    off_main_thread(app, move |storage| {
        storage
            .get()?
            .delete_saved_bookmark(&id)
            .map(|_| ())
            .map_err(item_failed)
    })
    .await
}

/// Takes back the last bookmark move or delete (one step, held in memory until the app closes).
/// Gives the bookmark as it is now.
#[tauri::command]
pub async fn undo_last(app: tauri::AppHandle) -> Result<SavedBookmark, AppError> {
    off_main_thread(app, move |storage| {
        storage.get()?.undo_last().map_err(item_failed)
    })
    .await
}

#[cfg(test)]
mod bookmark_command_tests {
    use super::*;
    use crate::ai::fake::{FakeResult, FakeRunner};
    use crate::ai::fetch::{FetchError, PageReader, PageText};
    use crate::storage::bookmarks::SummaryStatus;

    struct Unreadable;
    impl PageReader for Unreadable {
        fn read(&self, _url: &str) -> Result<PageText, FetchError> {
            Err(FetchError::TooLittleText)
        }
    }

    fn app_storage() -> (AppStorage, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("mnemo-bm-cmd-{}", uuid::Uuid::new_v4()));
        let s = Storage::open(&dir.join("mnemo.db")).unwrap();
        (AppStorage::new(Ok(s)), dir)
    }

    #[test]
    fn save_link_through_the_app_storage_keeps_an_unreadable_link_and_lists_it() {
        let (state, dir) = app_storage();
        let runner = FakeRunner::new(FakeResult::Timeout);
        let ai_on = || true;
        let emit = |_: &SavedBookmark| {};
        let ctx = SaveContext {
            store: &state,
            reader: &Unreadable,
            runner: &runner,
            ai_on: &ai_on,
            emit: &emit,
        };
        let got = bookmark_save::save_link(&ctx, "https://example.org/x").unwrap();
        assert_eq!(got.bookmark.summary_status, SummaryStatus::Unreadable);
        let page = state
            .get()
            .unwrap()
            .list_bookmark_cards(&PageRequest {
                limit: 10,
                after: None,
            })
            .unwrap();
        assert_eq!(page.items.len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_save_with_no_storage_gives_storage_unavailable_without_a_path() {
        let state = AppStorage::new(Err(StartupError {
            code: "open",
            detail: "unable to open /home/someone/mnemo.db".into(),
        }));
        let runner = FakeRunner::new(FakeResult::Timeout);
        let ai_on = || true;
        let emit = |_: &SavedBookmark| {};
        let ctx = SaveContext {
            store: &state,
            reader: &Unreadable,
            runner: &runner,
            ai_on: &ai_on,
            emit: &emit,
        };
        let err = save_failed(bookmark_save::save_link(&ctx, "https://example.org/").unwrap_err());
        assert_eq!(err.code, "storage_unavailable");
        assert!(!err.message.contains('/'));
    }

    #[test]
    fn save_errors_map_to_stable_codes_and_hide_storage_detail() {
        assert_eq!(
            save_failed(SaveError::Invalid("Bad link.".into())).code,
            "invalid_input"
        );
        assert_eq!(save_failed(SaveError::NotFound).code, "not_found");
        let e = save_failed(SaveError::Storage("disk I/O error at /x/y".into()));
        assert_eq!(e.code, "storage_error");
        assert!(!e.message.contains("/x/y"));
    }

    #[test]
    fn a_bookmark_id_must_be_given_and_short() {
        assert!(check_bookmark_id("4b1f").is_ok());
        assert!(check_bookmark_id(" ").is_err());
        assert!(check_bookmark_id(&"a".repeat(101)).is_err());
    }
}
