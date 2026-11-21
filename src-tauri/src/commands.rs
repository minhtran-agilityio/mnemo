// Commands the UI can call through Tauri's invoke bridge, and the state they share.

use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::ai::claude::error_kind;
use crate::ai::health::{self, AiHealth};
use crate::ai::runner::{AiError, AiRunner};
use crate::ai::test_prompt;
use crate::storage::files::OrphanReport;
use crate::storage::ideas::{Idea, IdeaInput, IdeaProject};
use crate::storage::items::{
    Bookmark, BookmarkInput, Event, EventInput, Memory, MemoryInput, Note, NoteInput, Project,
    ProjectInput, Run, RunInput, Task, TaskInput,
};
use crate::storage::labels::{
    ChangePage, ChangePageRequest, DeleteLabelOutcome, Label, LabelledNote,
};
use crate::storage::links::Link;
use crate::storage::record::{Cursor, Page};
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
pub struct AppStorage(Result<Mutex<Storage>, StartupError>);

impl AppStorage {
    pub fn new(opened: Result<Storage, StartupError>) -> Self {
        AppStorage(opened.map(Mutex::new))
    }

    /// Locks the database, or returns `storage_unavailable` when it was not opened.
    /// A lock poisoned by an earlier panic is recovered after rolling back any
    /// transaction the panicking code left open.
    pub fn get(&self) -> Result<MutexGuard<'_, Storage>, AppError> {
        match &self.0 {
            Ok(m) => match m.lock() {
                Ok(guard) => Ok(guard),
                Err(poisoned) => {
                    // An earlier command panicked while holding the lock. Roll back what
                    // it left open, then carry on with the last committed state.
                    let guard = poisoned.into_inner();
                    guard.recover_after_panic().map_err(|_| AppError {
                        code: "storage_unavailable",
                        message: "Mnemo could not recover its data file after an error. Nothing was deleted. Quit Mnemo and start it again.".to_string(),
                    })?;
                    m.clear_poison();
                    Ok(guard)
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

/// The runner every AI feature uses, and which kind it is. Chosen once at start from
/// `MNEMO_FAKE_AI`.
pub struct AiRunnerState {
    pub runner: Arc<dyn AiRunner>,
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
    };
    AppError {
        code: error_kind(error),
        message: message.to_string(),
    }
}

/// Runs the test prompt on this thread and times it. The command calls this on a blocking thread.
fn run_test_prompt_with(runner: &dyn AiRunner) -> Result<TestPromptResult, AppError> {
    let started = std::time::Instant::now();
    let answer = test_prompt::run(runner).map_err(|e| ai_failed(&e))?;
    Ok(TestPromptResult {
        answer,
        duration_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
    })
}

/// Sends one tiny fixed prompt through the selected runner (the fake with `MNEMO_FAKE_AI=1`).
/// A real run uses Claude usage. It runs on a blocking thread, never on the main thread.
#[tauri::command]
pub async fn run_test_prompt(app: tauri::AppHandle) -> Result<TestPromptResult, AppError> {
    let runner = app.state::<AiRunnerState>().runner.clone();
    tauri::async_runtime::spawn_blocking(move || run_test_prompt_with(runner.as_ref()))
        .await
        .unwrap_or_else(|e| {
            log::error!("the test prompt did not finish: {e}");
            Err(AppError {
                code: "task_failed",
                message: "The test prompt did not finish.".to_string(),
            })
        })
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

fn write_setting(storage: &AppStorage, key: &str, value: &str) -> Result<(), AppError> {
    check_setting_key(key)?;
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
item_commands!(Run, RunInput, add_run, get_run, list_runs, update_run, delete_run);
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

    #[test]
    fn ai_mode_serialises_as_fake_or_real_and_follows_the_state() {
        assert_eq!(serde_json::to_string(&AiMode::Fake).unwrap(), "\"fake\"");
        assert_eq!(serde_json::to_string(&AiMode::Real).unwrap(), "\"real\"");
        let fake = AiRunnerState {
            runner: crate::ai::runner::select_runner(true, None, None),
            fake: true,
        };
        let real = AiRunnerState {
            runner: crate::ai::runner::select_runner(false, None, None),
            fake: false,
        };
        assert_eq!(fake.mode(), AiMode::Fake);
        assert_eq!(real.mode(), AiMode::Real);
    }

    #[test]
    fn test_prompt_command_with_the_fake_gives_the_fake_answer() {
        let runner = crate::ai::runner::select_runner(true, None, None);
        let got = run_test_prompt_with(runner.as_ref()).unwrap();
        assert_eq!(got.answer, "Fake answer: AI is in test mode.");
        let json = serde_json::to_value(&got).unwrap();
        assert!(json.get("durationMs").is_some());
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
        assert_eq!(codes.len(), 5);
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
}
