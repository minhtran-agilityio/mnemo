// Commands the UI can call through Tauri's invoke bridge, and the state they share.

use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::ai::health::{self, AiHealth};
use crate::ai::runner::AiRunner;
use crate::storage::items::{
    Bookmark, BookmarkInput, Event, EventInput, Idea, IdeaInput, Memory, MemoryInput, Note,
    NoteInput, Project, ProjectInput, Run, RunInput, Task, TaskInput,
};
use crate::storage::links::Link;
use crate::storage::record::{Cursor, Page};
use crate::storage::{Item, ItemRef, PageRequest, Storage, StorageError};

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
    // Read by the AI features of issue #19 and later; today only the mode is read.
    #[expect(dead_code, reason = "read by the AI features of issue #19")]
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
item_commands!(
    Idea,
    IdeaInput,
    add_idea,
    get_idea,
    list_ideas,
    update_idea,
    delete_idea
);
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
            runner: crate::ai::runner::select_runner(true),
            fake: true,
        };
        let real = AiRunnerState {
            runner: crate::ai::runner::select_runner(false),
            fake: false,
        };
        assert_eq!(fake.mode(), AiMode::Fake);
        assert_eq!(real.mode(), AiMode::Real);
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
