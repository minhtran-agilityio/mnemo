// The file import's summaries (#29, LIB-03): background work through the run queue, the first
// `Priority::Background` caller. The links are already stored (storage::imports); this makes
// the summary of each waiting link, in file order, with at most `MAX_CONCURRENT_RUNS` runs at a
// time and no fixed batch size.
//
// Each worker thread takes the next waiting link and runs the normal first summary of a stored
// bookmark (`ai::bookmark_save::summarize_import`: the page is read again, and the link is filed
// into a folder as a guess, as on a new save, #26), with a `BackgroundRunner`, so the run gets
// the queue, the run row and the AI gate, and the bookmark gets every rule of a normal summary. The end of the run gives the link's end: done; failed (the AI run failed, or
// the page could not be read); removed (the owner deleted the bookmark); or it stays waiting
// (AI off, at the usage limit, the pause line, background work paused by the owner, or this
// import's Pause), and the worker stops.
//
// The import waits by itself while the AI gate holds background work and goes on by itself
// when the gate opens again: the AI control's listener calls `kick`. Pause stops this import
// only (its runs are cancelled, their links stay waiting); Continue runs it again and, while
// the gate still holds AI, keeps waiting and shows the reason. Nothing passes the limit: every
// run goes through the queue's gate.
//
// Locks: this worker's own mutex is never held while storage, the queue or the AI control is
// called, so it adds no lock order. `kick` is cheap (one storage read) because the control's
// listener calls it on every change.

use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::ai_control::{Decision, DenyReason};
use super::queue::{BackgroundRunner, Priority, RunQueue, MAX_CONCURRENT_RUNS};
use crate::ai::bookmark_save::{self, BookmarkStore, SaveContext, SaveError, SaveResult};
use crate::ai::cancel::CancelToken;
use crate::ai::fetch::PageReader;
use crate::ai::limits;
use crate::storage::bookmarks::{Held, SavedBookmark, SummaryStatus};
use crate::storage::imports::{
    read_import_file, ImportFile, ImportItem, ImportLimits, ImportPreview, ImportState, ImportView,
    ItemState,
};
use crate::storage::{Storage, StorageError};

/// An import as the screen shows it: the stored import and, while it runs with links waiting
/// and the AI gate holds background work, why it waits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportStatus {
    #[serde(flatten)]
    pub import: ImportView,
    pub wait_reason: Option<DenyReason>,
    /// While AI may run but a fault holds the import (rule 1, honest failure): why, and in how
    /// many seconds it tries again.
    pub retry: Option<ImportRetry>,
    /// The most summaries made at one time (`MAX_CONCURRENT_RUNS`), for the screen's text.
    pub max_runs: usize,
}

/// Why the import waits although AI may run: the last run ended with a fault.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Fault {
    /// Claude Code could not be started.
    Unavailable,
    /// Mnemo could not read or save the import.
    Storage,
    /// A run ended with no result and no one stopped it.
    Other,
}

/// The fault the import waits on; it tries again by itself after a short wait.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRetry {
    pub reason: Fault,
}

/// The limits of reading an import file, from the config module.
pub const IMPORT_LIMITS: ImportLimits = ImportLimits {
    max_file_bytes: limits::IMPORT_MAX_FILE_BYTES,
    max_entries: limits::IMPORT_MAX_ENTRIES,
    max_title_chars: limits::IMPORT_MAX_TITLE_CHARS,
};

/// How long a worker waits after `faults` faults in a row: `IMPORT_RETRY_FIRST`, doubled after
/// each further fault, at most `IMPORT_RETRY_MOST`.
fn retry_delay(faults: u32) -> Duration {
    let doublings = faults.saturating_sub(1).min(16);
    limits::IMPORT_RETRY_FIRST
        .saturating_mul(1 << doublings)
        .min(limits::IMPORT_RETRY_MOST)
}

/// Gets the import after every change. The app sends it to the UI as `import-changed`.
pub type ImportNotifier = Arc<dyn Fn(&ImportStatus) + Send + Sync>;
/// Gets each bookmark the summaries change. The app sends it as `bookmark-changed`.
pub type BookmarkNotifier = Arc<dyn Fn(&SavedBookmark) + Send + Sync>;

/// What the import needs: the app's storage, the page reader, the run queue and the two events.
pub struct ImportDeps {
    pub store: Arc<dyn BookmarkStore>,
    pub reader: Arc<dyn PageReader>,
    pub queue: RunQueue,
    pub notify: ImportNotifier,
    pub bookmark_changed: BookmarkNotifier,
}

#[derive(Default)]
struct Workers {
    /// Live worker threads.
    count: usize,
    /// This import's Pause token. A Pause sets it and puts a fresh one in its place.
    stop: CancelToken,
    /// Items a worker is making now.
    taken: HashSet<String>,
    /// Items whose bookmark the owner's own summary is reading: left until that ends.
    owner_reading: HashSet<String>,
    /// How many owner summaries have ended (and other clears of `owner_reading`). A worker
    /// notes it before it looks at a bookmark, and holds the item for the owner only when no
    /// owner run ended in between, so an item is never held after its owner run ended.
    owner_ended: u64,
    /// Faults in a row (see `wait_after_fault`); an ended link, a new import and Continue set
    /// it back to 0.
    faults: u32,
    /// One entry per worker that waits after a fault: its key and why. The screen shows the
    /// newest while any worker still waits.
    retries: Vec<(u64, Fault)>,
    /// The key of the next entry in `retries`.
    next_retry: u64,
    /// Counts the changes that end a fault wait early: the background gate opening again, a
    /// new import, Continue on a paused import.
    wake: u64,
    /// The background gate as the control listener last saw it (open = may run).
    gate_open: Option<bool>,
}

struct Inner {
    deps: ImportDeps,
    workers: Mutex<Workers>,
    /// Held while an import change is written, read back and sent, so the events go out in the
    /// order of the changes (two workers never send an older count after a newer one).
    report: Mutex<()>,
}

/// The import worker. Clones share one.
#[derive(Clone)]
pub struct ImportWorker(Arc<Inner>);

/// How one link's summary ended.
enum Outcome {
    /// The item ends with this state.
    End(ItemState),
    /// The owner's own summary is reading it: leave it to that run.
    OwnerReading,
    /// It stays waiting; the next item may go on (the owner changed the card during the run).
    Again,
    /// It stays waiting and the worker stops: AI may not run now, or the import was paused.
    Stop,
    /// It stays waiting and the worker waits before the import goes on: a fault.
    Fault(Fault),
}

/// One storage call through the bookmark store, with its own result.
fn on_storage<T>(
    store: &dyn BookmarkStore,
    work: impl FnOnce(&mut Storage) -> Result<T, StorageError>,
) -> Result<T, SaveError> {
    let mut work = Some(work);
    let mut out = None;
    store.with_storage(&mut |s| {
        if let Some(work) = work.take() {
            out = Some(work(s)?);
        }
        Ok(Held::Lost(None))
    })?;
    out.ok_or(SaveError::NotFound)
}

impl ImportWorker {
    /// A worker that goes on by itself whenever the AI control changes (it holds itself only
    /// weakly in the control's listener).
    pub fn new(deps: ImportDeps) -> Self {
        let control = deps.queue.control();
        let inner = Arc::new(Inner {
            deps,
            workers: Mutex::new(Workers::default()),
            report: Mutex::new(()),
        });
        let weak: Weak<Inner> = Arc::downgrade(&inner);
        control.subscribe(Arc::new(move || {
            if let Some(inner) = weak.upgrade() {
                let worker = ImportWorker(inner);
                let open = worker.held_by().is_none();
                worker.gate_seen(open);
                worker.kick();
            }
        }));
        ImportWorker(inner)
    }

    fn workers(&self) -> MutexGuard<'_, Workers> {
        self.0.workers.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn store(&self) -> &dyn BookmarkStore {
        self.0.deps.store.as_ref()
    }

    /// The background gate now: `None` when background work may run.
    fn held_by(&self) -> Option<DenyReason> {
        let control = self.0.deps.queue.control();
        match control.may_run(Priority::Background, control.now()) {
            Decision::Allow => None,
            Decision::Deny { reason } => Some(reason),
        }
    }

    /// Whether the owner's own AI may run. The card says "AI off" only when it may not: a
    /// Pause, or the gate holding only background work (the pause line), leaves it at "no
    /// summary yet", since the owner may still summarize it.
    fn owner_ai_on(&self) -> bool {
        let control = self.0.deps.queue.control();
        matches!(
            control.may_run(Priority::Owner, control.now()),
            Decision::Allow
        )
    }

    /// The import with why it waits. Called with no storage lock held: the control's lock may
    /// wait on a storage write.
    fn status_of(&self, import: ImportView) -> ImportStatus {
        let open = import.state == ImportState::Running && import.waiting > 0;
        let wait_reason = if open { self.held_by() } else { None };
        let retry = if open && wait_reason.is_none() {
            self.workers()
                .retries
                .last()
                .map(|&(_, reason)| ImportRetry { reason })
        } else {
            None
        };
        ImportStatus {
            import,
            wait_reason,
            retry,
            max_runs: MAX_CONCURRENT_RUNS,
        }
    }

    /// Writes one import change (`change` gives the import after it), then sends the import
    /// with why it waits, in the order of the changes. Lock order: `report`, then storage or
    /// the AI control; nothing that holds those takes `report`.
    fn publish(
        &self,
        change: impl FnOnce(&mut Storage) -> Result<ImportView, StorageError>,
    ) -> Result<ImportStatus, SaveError> {
        let _order = self.0.report.lock().unwrap_or_else(|e| e.into_inner());
        let view = on_storage(self.store(), change)?;
        let status = self.status_of(view);
        (self.0.deps.notify)(&status);
        Ok(status)
    }

    /// The newest import with why it waits, or `None` when there was none.
    pub fn status(&self) -> Result<Option<ImportStatus>, SaveError> {
        let latest = on_storage(self.store(), |s| s.latest_import())?;
        Ok(latest.map(|v| self.status_of(v)))
    }

    /// What importing `file` would do. Writes nothing.
    pub fn preview(&self, file: &ImportFile) -> Result<ImportPreview, SaveError> {
        on_storage(self.store(), |s| s.preview_import(file))
    }

    /// Reads the file at `path` and says what importing it would do. Writes nothing.
    pub fn preview_file(&self, path: &Path) -> Result<ImportPreview, SaveError> {
        let file = read_import_file(path, IMPORT_LIMITS)?;
        self.preview(&file)
    }

    /// Reads the file at `path` again and imports it (`start`).
    pub fn start_file(&self, path: &Path, with_summaries: bool) -> Result<ImportStatus, SaveError> {
        let file = read_import_file(path, IMPORT_LIMITS)?;
        self.start(&file, with_summaries)
    }

    /// Stores the links of `file` at once and, with summaries, starts making them.
    pub fn start(
        &self,
        file: &ImportFile,
        with_summaries: bool,
    ) -> Result<ImportStatus, SaveError> {
        // A worker of an earlier, ended import that still waits after a fault ends its wait and
        // stops: its token is cancelled before the new import is stored, so no worker of the new
        // import can get the old token. While an import is unfinished the start is refused, and
        // its runs are left alone.
        let latest = on_storage(self.store(), |s| s.latest_import())?;
        let ended = latest
            .map(|v| matches!(v.state, ImportState::Finished | ImportState::Stopped))
            .unwrap_or(true);
        if ended {
            self.cancel_runs(true);
        }
        let status = self.publish(|s| s.start_import(file, with_summaries))?;
        let view = &status.import;
        log::info!(
            "import {} stored {} links ({} repeats in the file, {} already saved, {} not links)",
            view.base.id,
            view.added,
            view.repeats_in_file,
            view.already_saved,
            view.not_links
        );
        // The new import starts with no faults counted.
        self.fresh_tries();
        self.kick();
        Ok(status)
    }

    /// The control listener saw the background gate `open` or not. A fault wait ends early
    /// only when the gate opens again (Claude Code or AI may work again), not on every usage
    /// reading or tick.
    fn gate_seen(&self, open: bool) {
        let mut w = self.workers();
        if open && w.gate_open == Some(false) {
            w.wake = w.wake.wrapping_add(1);
        }
        w.gate_open = Some(open);
    }

    /// Counts no faults and ends a fault wait: for a new import and for Continue.
    fn fresh_tries(&self) {
        let mut w = self.workers();
        w.faults = 0;
        w.wake = w.wake.wrapping_add(1);
    }

    /// Lets every item held for an owner run go (see `Workers::owner_ended`).
    fn release_owner_holds(&self) {
        let mut w = self.workers();
        w.owner_reading.clear();
        w.owner_ended += 1;
    }

    /// Holds `item` for the owner's own run, unless an owner run ended since the worker noted
    /// `seen` (then the item is free again). Says whether it holds it.
    fn hold_for_owner(&self, item: &str, seen: u64) -> bool {
        let mut w = self.workers();
        if w.owner_ended != seen {
            return false;
        }
        w.owner_reading.insert(item.to_string());
        true
    }

    /// Whether `id` names the newest import: only it can have runs, so only it may cancel them.
    fn is_latest(&self, id: &str) -> Result<bool, SaveError> {
        let latest = on_storage(self.store(), |s| s.latest_import())?;
        Ok(latest.is_some_and(|v| v.base.id == id))
    }

    /// Cancels the runs of this import and gives later workers a fresh token.
    fn cancel_runs(&self, clear_owner_holds: bool) {
        let mut w = self.workers();
        w.stop.cancel();
        w.stop = CancelToken::default();
        if clear_owner_holds {
            w.owner_reading.clear();
            w.owner_ended += 1;
        }
    }

    /// The owner's Pause: this import stops taking links and its runs are cancelled (their links
    /// stay waiting). Other AI work goes on.
    pub fn pause(&self, id: &str) -> Result<ImportStatus, SaveError> {
        let current = self.is_latest(id)?;
        let status = self.publish(|s| s.pause_import(id))?;
        // An older import has no runs: its id never cancels the runs of the newest one.
        if current {
            self.cancel_runs(false);
        }
        log::info!("import {id} paused by the owner");
        Ok(status)
    }

    /// The owner's "Stop here": the import ends now. Its runs are cancelled and its links with no
    /// summary yet stay link only ("Summarize later" on each card); another file may be imported.
    pub fn stop(&self, id: &str) -> Result<ImportStatus, SaveError> {
        let current = self.is_latest(id)?;
        let status = self.publish(|s| s.stop_import(id))?;
        if current {
            self.cancel_runs(true);
        }
        log::info!("import {id} stopped by the owner");
        Ok(status)
    }

    /// The owner's Continue: a paused import runs again. While the AI gate holds background
    /// work it keeps waiting and the status says why; it goes on by itself when AI may run.
    pub fn resume(&self, id: &str) -> Result<ImportStatus, SaveError> {
        // Only Continue on the newest import, paused, starts the tries afresh.
        let paused = on_storage(self.store(), |s| s.latest_import())?
            .is_some_and(|v| v.base.id == id && v.state == ImportState::Paused);
        let status = self.publish(|s| s.continue_import(id))?;
        self.release_owner_holds();
        if paused {
            self.fresh_tries();
        }
        log::info!("import {id} continued by the owner");
        self.kick();
        Ok(status)
    }

    /// The owner's own summary of a bookmark ended: a link of the import it held may go on.
    pub fn owner_summary_ended(&self) {
        self.release_owner_holds();
        self.kick();
    }

    /// Starts workers while the newest import runs, links wait that no worker or owner run
    /// holds, the AI gate allows background work, and fewer than `MAX_CONCURRENT_RUNS` live.
    /// Safe to call at any time and from any thread.
    pub fn kick(&self) {
        let latest = match on_storage(self.store(), |s| s.latest_import()) {
            Ok(Some(v)) => v,
            Ok(None) => return,
            Err(e) => {
                log::error!("the import could not be read: {e:?}");
                return;
            }
        };
        if latest.state != ImportState::Running || latest.waiting == 0 {
            return;
        }
        if self.held_by().is_some() {
            // The screen shows why it waits.
            let id = latest.base.id;
            if let Err(e) = self.publish(|s| s.get_import(&id)) {
                log::error!("the import could not be read: {e:?}");
            }
            return;
        }
        let waiting = latest.waiting as usize;
        let mut started = Vec::new();
        {
            let mut w = self.workers();
            let free = waiting.saturating_sub(w.owner_reading.len());
            while w.count < MAX_CONCURRENT_RUNS && w.count < free {
                w.count += 1;
                started.push(w.stop.clone());
            }
        }
        for stop in started {
            let worker = self.clone();
            let id = latest.base.id.clone();
            let spawned = std::thread::Builder::new()
                .name("mnemo-import".to_string())
                .spawn(move || worker.work(&id, &stop));
            if let Err(e) = spawned {
                log::error!("could not start an import worker: {e}");
                self.workers().count -= 1;
            }
        }
    }

    /// One worker: takes links until none is free, the import stops running, or a run says AI
    /// may not run now. On its way out it kicks, so a Pause and Continue during its last run
    /// does not leave the import without workers. After a fault it first waits (`retry_delay`),
    /// so a storage that keeps failing never makes workers start again and again.
    fn work(&self, id: &str, stop: &CancelToken) {
        while let Some(item) = self.take(id, stop) {
            // Noted before the run, so a wake during the run still ends a fault wait after it.
            let (seen, woken) = {
                let w = self.workers();
                (w.owner_ended, w.wake)
            };
            let outcome = self.make(&item, stop);
            // The end is saved before the item leaves `taken`, so the other worker cannot take
            // a link whose end is not written yet.
            let saved = match outcome {
                Outcome::End(state) => {
                    on_storage(self.store(), |s| s.end_import_item(&item.id, state))
                        .map(|_| ())
                        .map_err(|e| {
                            log::error!("import {id}: the end of a link could not be saved: {e:?}")
                        })
                }
                _ => Ok(()),
            };
            if matches!(outcome, Outcome::OwnerReading) {
                self.hold_for_owner(&item.id, seen);
            }
            {
                let mut w = self.workers();
                w.taken.remove(&item.id);
                if matches!(outcome, Outcome::End(_)) && saved.is_ok() {
                    w.faults = 0;
                }
            }
            if saved.is_err() {
                self.wait_after_fault(id, stop, Fault::Storage, woken);
                break;
            }
            match self.publish(|s| s.finish_import_if_done(id)) {
                Ok(status) => {
                    let view = &status.import;
                    if view.state == ImportState::Finished {
                        log::info!(
                            "import {id} finished: {} done, {} failed",
                            view.done,
                            view.failed
                        );
                    }
                }
                Err(e) => log::error!("import {id} could not be read: {e:?}"),
            }
            match outcome {
                Outcome::Stop => break,
                Outcome::Fault(fault) => {
                    self.wait_after_fault(id, stop, fault, woken);
                    break;
                }
                _ => {}
            }
        }
        self.workers().count -= 1;
        self.kick();
    }

    /// Waits `retry_delay` for this fault in a row. The wait ends early when the import is
    /// paused or stopped, a new import starts, the owner presses Continue on it, or the
    /// background gate opens again since `woken` was noted. The worker still counts as live
    /// meanwhile, so no other worker starts in its place. The screen says why it waits.
    fn wait_after_fault(&self, id: &str, stop: &CancelToken, fault: Fault, woken: u64) {
        let delay;
        let end;
        let key;
        {
            let mut w = self.workers();
            w.faults = w.faults.saturating_add(1);
            delay = retry_delay(w.faults);
            end = Instant::now() + delay;
            key = w.next_retry;
            w.next_retry = w.next_retry.wrapping_add(1);
            w.retries.push((key, fault));
        }
        log::warn!("import {id}: a link stopped with a fault ({fault:?}), waiting {delay:?}");
        self.show(id);
        loop {
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() || stop.is_cancelled() || self.workers().wake != woken {
                break;
            }
            std::thread::sleep(left.min(limits::QUEUED_CANCEL_POLL));
        }
        self.workers().retries.retain(|&(k, _)| k != key);
        self.show(id);
    }

    /// Sends the import as it is now.
    fn show(&self, id: &str) {
        if let Err(e) = self.publish(|s| s.get_import(id)) {
            log::error!("import {id} could not be read: {e:?}");
        }
    }

    /// The next waiting link no one holds, in file order, while the import runs and AI may run.
    fn take(&self, id: &str, stop: &CancelToken) -> Option<ImportItem> {
        if stop.is_cancelled() || self.held_by().is_some() {
            return None;
        }
        let held = {
            let w = self.workers();
            w.taken.len() + w.owner_reading.len()
        };
        let limit = u32::try_from(held + 1).unwrap_or(u32::MAX);
        let found = on_storage(self.store(), |s| {
            if s.get_import(id)?.state != ImportState::Running {
                return Ok(Vec::new());
            }
            s.waiting_import_items(id, limit)
        });
        let items = match found {
            Ok(items) => items,
            Err(e) => {
                log::error!("import {id}: the waiting links could not be read: {e:?}");
                return None;
            }
        };
        let mut w = self.workers();
        let next = items
            .into_iter()
            .find(|i| !w.taken.contains(&i.id) && !w.owner_reading.contains(&i.id))?;
        w.taken.insert(next.id.clone());
        Some(next)
    }

    /// The end a link has already, from its bookmark as it is now; `None` when its summary is
    /// still to make.
    fn known_end(&self, item: &ImportItem) -> Result<Option<Outcome>, SaveError> {
        let b = on_storage(self.store(), |s| {
            s.get_saved_bookmark_any(&item.bookmark_id)
        })?;
        Ok(match b {
            None => Some(Outcome::End(ItemState::Removed)),
            Some(b) if b.base.deleted_at.is_some() => Some(Outcome::End(ItemState::Removed)),
            Some(b) => match b.summary_status {
                SummaryStatus::Done => Some(Outcome::End(ItemState::Done)),
                // Imported links start pending: only the owner's own run reads a page this way.
                SummaryStatus::Unreadable | SummaryStatus::NotReached => {
                    Some(Outcome::End(ItemState::Failed))
                }
                SummaryStatus::Reading => Some(Outcome::OwnerReading),
                SummaryStatus::Pending | SummaryStatus::AiOff => None,
            },
        })
    }

    /// Makes the summary of one link with the normal summary of a stored bookmark.
    fn make(&self, item: &ImportItem, stop: &CancelToken) -> Outcome {
        match self.known_end(item) {
            Ok(Some(end)) => return end,
            Ok(None) => {}
            Err(e) => {
                log::error!(
                    "import link {}: its bookmark could not be read: {e:?}",
                    item.id
                );
                return Outcome::Fault(Fault::Storage);
            }
        }
        // The gate is looked at again just before the page read: a run it would hold reads
        // nothing.
        if self.held_by().is_some() {
            return Outcome::Stop;
        }
        let deps = &self.0.deps;
        let runner = BackgroundRunner::new(deps.queue.clone(), stop.clone());
        let ai_on = || self.owner_ai_on();
        let emit = |b: &SavedBookmark| (deps.bookmark_changed)(b);
        let ctx = SaveContext {
            store: deps.store.as_ref(),
            reader: deps.reader.as_ref(),
            runner: &runner,
            ai_on: &ai_on,
            emit: &emit,
        };
        let result = bookmark_save::summarize_import(&ctx, &item.bookmark_id);
        // Held or stopped, from the run's own runner: not a fault. A run the queue could not
        // take is a storage fault, not "Claude Code could not be started".
        let stopped = stop.is_cancelled() || runner.held_by_gate();
        match result {
            Ok(result) => match outcome_of(&result, stopped) {
                Outcome::Fault(Fault::Unavailable) if runner.queue_failed() => {
                    Outcome::Fault(Fault::Storage)
                }
                outcome => outcome,
            },
            Err(SaveError::NotFound) => Outcome::End(ItemState::Removed),
            // Claimed in between by the owner's own run, or summarized by it.
            Err(SaveError::Invalid(_)) => match self.known_end(item) {
                Ok(Some(end)) => end,
                Ok(None) => Outcome::Again,
                Err(_) => Outcome::Fault(Fault::Storage),
            },
            Err(e) => {
                log::error!("import link {}: storage failed: {e:?}", item.id);
                Outcome::Fault(Fault::Storage)
            }
        }
    }
}

/// The end of one link from the summary's result (decision 8: failed is an AI run that failed
/// or a page that could not be read; AI off counts as waiting).
/// `stopped`: the import's Pause or Stop here, or the AI gate, ended the run.
fn outcome_of(result: &SaveResult, stopped: bool) -> Outcome {
    let b = &result.bookmark;
    if b.base.deleted_at.is_some() {
        return Outcome::End(ItemState::Removed);
    }
    if let Some(problem) = &result.ai_error {
        return match problem.code {
            // AI may not run now: the link stays waiting, the gate starts it again.
            "usage_limit" | "ai_off" => Outcome::Stop,
            "cancelled" if stopped => Outcome::Stop,
            // Cancelled by no one: a fault.
            "cancelled" => Outcome::Fault(Fault::Other),
            // Claude Code could not be started (the card says AI off): the link stays waiting
            // and the import tries again after a wait.
            "unavailable" => Outcome::Fault(Fault::Unavailable),
            // The run failed, or the site was not reached.
            _ => Outcome::End(ItemState::Failed),
        };
    }
    match b.summary_status {
        SummaryStatus::Done => Outcome::End(ItemState::Done),
        SummaryStatus::Unreadable | SummaryStatus::NotReached => Outcome::End(ItemState::Failed),
        // AI went off before the run.
        SummaryStatus::AiOff => Outcome::Stop,
        // The owner changed the card during the run: it stays waiting for the next pass.
        SummaryStatus::Pending | SummaryStatus::Reading => Outcome::Again,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    use super::*;
    use crate::ai::fake::{FakeResult, FakeRunner};
    use crate::ai::fetch::{FetchError, PageText};
    use crate::ai::runner::{AiError, AiOutput, AiRunner, AiTask};
    use crate::scheduler::ai_control::testing::open_control;
    use crate::scheduler::ai_control::AiControl;
    use crate::scheduler::queue::{Notifier, RunEvent, RunLog, RunLogError};
    use crate::storage::imports::PausedBy;
    use crate::storage::runs::RunEnd;
    use crate::storage::testing::TempDir;

    const GOOD: &str = r#"{"summary":"The page explains one thing.","tags":["example"],"reason":"It may help later."}"#;
    const PAGE: &str = "This page explains one thing in enough words for the reader to accept it as a real page of text, with a second sentence so that it is long enough.";
    const WAIT: Duration = Duration::from_secs(20);

    /// A page reader that gives one page for every link, or "unreadable" for links with "bad".
    #[derive(Default)]
    struct Pages {
        reads: AtomicUsize,
        /// Runs during each read (for example: the gate closes while the page is read).
        during_read: Mutex<Option<Box<dyn Fn() + Send>>>,
    }
    impl PageReader for Pages {
        fn read(&self, url: &str) -> Result<PageText, FetchError> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            if let Some(hook) = self.during_read.lock().unwrap().as_ref() {
                hook();
            }
            if url.contains("bad") {
                return Err(FetchError::NotText);
            }
            Ok(PageText {
                title: url.contains("titled").then(|| "Page title".to_string()),
                text: PAGE.to_string(),
                cut: false,
            })
        }
    }

    /// Counts runs in memory.
    #[derive(Default)]
    struct Log {
        next: AtomicUsize,
        ends: Mutex<Vec<RunEnd>>,
        /// The task name of each run, in the order the queue started them.
        started: Mutex<Vec<String>>,
        /// When set, the queue cannot record a new run (a storage problem).
        fail: std::sync::atomic::AtomicBool,
    }
    impl RunLog for Log {
        fn enqueue(&self, task_type: &str) -> Result<String, RunLogError> {
            if self.fail.load(Ordering::SeqCst) {
                return Err(RunLogError("disk I/O error".to_string()));
            }
            Ok(format!(
                "{task_type}:{}",
                self.next.fetch_add(1, Ordering::SeqCst)
            ))
        }
        fn start(&self, id: &str) -> Result<(), RunLogError> {
            let name = id.split(':').next().unwrap_or_default().to_string();
            self.started.lock().unwrap().push(name);
            Ok(())
        }
        fn finish(&self, _: &str, end: &RunEnd, _: Option<i64>) -> Result<(), RunLogError> {
            self.ends.lock().unwrap().push(end.clone());
            Ok(())
        }
    }

    /// Wraps a runner: counts the runs at the same time and the most seen, and can hold runs
    /// until released.
    struct Gauge {
        inner: Arc<dyn AiRunner>,
        now: AtomicUsize,
        most: AtomicUsize,
        hold: Mutex<bool>,
        /// When set, every run gives this error (a run no one cancelled, Claude Code missing).
        fail: Mutex<Option<AiError>>,
        /// Every run that started.
        runs: AtomicUsize,
    }
    impl AiRunner for Gauge {
        fn run_task(&self, task: &AiTask, cancel: &CancelToken) -> Result<AiOutput, AiError> {
            self.runs.fetch_add(1, Ordering::SeqCst);
            if let Some(e) = self.fail.lock().unwrap().clone() {
                return Err(e);
            }
            let n = self.now.fetch_add(1, Ordering::SeqCst) + 1;
            self.most.fetch_max(n, Ordering::SeqCst);
            while *self.hold.lock().unwrap() && !cancel.is_cancelled() {
                std::thread::sleep(Duration::from_millis(2));
            }
            std::thread::sleep(Duration::from_millis(2));
            let r = if cancel.is_cancelled() {
                Err(AiError::Cancelled)
            } else {
                self.inner.run_task(task, cancel)
            };
            self.now.fetch_sub(1, Ordering::SeqCst);
            r
        }
    }

    struct World {
        worker: ImportWorker,
        store: Arc<Mutex<Storage>>,
        fake: Arc<FakeRunner>,
        gauge: Arc<Gauge>,
        control: Arc<AiControl>,
        queue: RunQueue,
        log: Arc<Log>,
        dir: TempDir,
        events: Mutex<mpsc::Receiver<ImportStatus>>,
        pages: Arc<Pages>,
    }

    struct Shared(Arc<Mutex<Storage>>);
    impl BookmarkStore for Shared {
        fn with_storage(
            &self,
            call: &mut dyn FnMut(&mut Storage) -> Result<Held, StorageError>,
        ) -> Result<Held, SaveError> {
            self.0.with_storage(call)
        }
    }

    fn world(default: FakeResult) -> World {
        let dir = TempDir::new();
        let storage = Storage::open(&dir.path().join("mnemo.db")).unwrap();
        let store = Arc::new(Mutex::new(storage));
        let fake = Arc::new(FakeRunner::new(default));
        let gauge = Arc::new(Gauge {
            inner: fake.clone(),
            now: AtomicUsize::new(0),
            most: AtomicUsize::new(0),
            hold: Mutex::new(false),
            fail: Mutex::new(None),
            runs: AtomicUsize::new(0),
        });
        let control = open_control();
        let pages = Arc::new(Pages::default());
        let log = Arc::new(Log::default());
        let notify: Notifier = Arc::new(|_: &RunEvent| {});
        let queue = RunQueue::new(gauge.clone(), log.clone(), notify, control.clone());
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let worker = ImportWorker::new(ImportDeps {
            store: Arc::new(Shared(store.clone())),
            reader: pages.clone(),
            queue: queue.clone(),
            notify: Arc::new(move |s: &ImportStatus| {
                let _ = tx.lock().unwrap().send(s.clone());
            }),
            bookmark_changed: Arc::new(|_: &SavedBookmark| {}),
        });
        World {
            worker,
            store,
            fake,
            gauge,
            control,
            queue,
            log,
            dir,
            events: Mutex::new(rx),
            pages,
        }
    }

    impl World {
        fn file(&self, name: &str, lines: &[String]) -> ImportFile {
            let p = self.dir.path().join(name);
            std::fs::write(&p, lines.join("\n")).unwrap();
            read_import_file(&p, IMPORT_LIMITS).unwrap()
        }

        fn links(&self, n: usize) -> ImportFile {
            let lines: Vec<String> = (1..=n)
                .map(|i| format!("https://example.org/import/page-{i}"))
                .collect();
            self.file("links.txt", &lines)
        }

        fn now(&self) -> ImportStatus {
            self.worker.status().unwrap().unwrap()
        }

        /// Waits until the import shows `check`, and gives it.
        fn until(&self, what: &str, check: impl Fn(&ImportStatus) -> bool) -> ImportStatus {
            let end = Instant::now() + WAIT;
            loop {
                let s = self.now();
                if check(&s) {
                    return s;
                }
                assert!(Instant::now() < end, "timed out waiting for {what}: {s:?}");
                std::thread::sleep(Duration::from_millis(5));
            }
        }

        /// No run is going and no worker is live.
        fn settled(&self) {
            let end = Instant::now() + WAIT;
            while self.worker.workers().count > 0 || self.gauge.now.load(Ordering::SeqCst) > 0 {
                assert!(Instant::now() < end, "the workers did not stop");
                std::thread::sleep(Duration::from_millis(5));
            }
        }

        fn counts(s: &ImportStatus) -> (u32, u32, u32) {
            (s.import.done, s.import.waiting, s.import.failed)
        }

        /// The id of the one bookmark whose link holds `of`.
        fn statuses_ids(&self, of: &str) -> String {
            let s = self.store.lock().unwrap();
            let page = s
                .list_bookmark_cards(&crate::storage::PageRequest {
                    after: None,
                    limit: 100,
                })
                .unwrap();
            page.items
                .into_iter()
                .find(|b| b.url.contains(of))
                .map(|b| b.base.id)
                .unwrap()
        }

        fn statuses(&self, of: &str) -> Vec<SummaryStatus> {
            let s = self.store.lock().unwrap();
            let page = s
                .list_bookmark_cards(&crate::storage::PageRequest {
                    after: None,
                    limit: 100,
                })
                .unwrap();
            page.items
                .into_iter()
                .filter(|b| b.url.contains(of))
                .map(|b| b.summary_status)
                .collect()
        }
    }

    #[test]
    fn a_file_of_50_links_imports_in_batches_through_the_queue_and_shows_progress_to_the_end() {
        let w = world(FakeResult::Valid(GOOD.into()));
        let file = read_import_file(
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../tests/acceptance/fixtures/lib-03-bookmarks-export.html"),
            IMPORT_LIMITS,
        )
        .unwrap();
        let first = w.worker.start(&file, true).unwrap();
        assert_eq!(first.import.added, 50);
        let end = w.until("the end", |s| s.import.state == ImportState::Finished);
        assert_eq!(World::counts(&end), (50, 0, 0));
        assert_eq!(w.fake.starts(), 50);
        // Progress went out while it ran, with done going up one link at a time.
        let seen: Vec<u32> = w
            .events
            .lock()
            .unwrap()
            .try_iter()
            .map(|s| s.import.done)
            .collect();
        assert!(seen.len() >= 50, "progress events: {seen:?}");
        assert!(seen.windows(2).all(|p| p[1] >= p[0]));
        w.settled();
        assert!(w
            .statuses("example.org")
            .iter()
            .all(|s| *s == SummaryStatus::Done));
    }

    #[test]
    fn import_summaries_run_as_background_work_at_most_two_at_a_time_and_owner_tasks_go_first() {
        let w = world(FakeResult::Valid(GOOD.into()));
        *w.gauge.hold.lock().unwrap() = true;
        w.worker.start(&w.links(6), true).unwrap();
        let end = Instant::now() + WAIT;
        while w.gauge.now.load(Ordering::SeqCst) < 2 {
            assert!(Instant::now() < end);
            std::thread::sleep(Duration::from_millis(2));
        }
        // An owner task waits for a free slot and takes it before the next link.
        let owner = w
            .queue
            .submit(
                Priority::Owner,
                AiTask {
                    name: "test_prompt".into(),
                    prompt: "x".into(),
                    schema: "{}".into(),
                    tools: vec![],
                    model: "haiku".into(),
                    effort: None,
                    timeout: Duration::from_secs(5),
                },
            )
            .unwrap();
        *w.gauge.hold.lock().unwrap() = false;
        owner.done.recv_timeout(WAIT).unwrap().unwrap();
        let s = w.until("the end", |s| s.import.state == ImportState::Finished);
        assert_eq!(World::counts(&s), (6, 0, 0));
        assert_eq!(w.gauge.most.load(Ordering::SeqCst), 2);
        let names = w.log.started.lock().unwrap().clone();
        let owner_at = names.iter().position(|n| n == "test_prompt").unwrap();
        // Two links were running when the owner task came; it ran before the other four.
        assert_eq!(owner_at, 2, "run order: {names:?}");
    }

    #[test]
    fn import_progress_counts_done_waiting_and_failed_when_a_page_is_unreadable_or_a_run_fails() {
        let w = world(FakeResult::Valid(GOOD.into()));
        w.fake.push(FakeResult::ExitError(1));
        let lines = vec![
            "https://example.org/import/run-fails".to_string(),
            "https://example.org/import/bad-page".to_string(),
            "https://example.org/import/good".to_string(),
        ];
        // Two workers: the fake's failed answer goes to whichever link runs first.
        w.worker.start(&w.file("mixed.txt", &lines), true).unwrap();
        let s = w.until("the end", |s| s.import.state == ImportState::Finished);
        assert_eq!(World::counts(&s), (1, 0, 2));
        // Each failed card keeps its own buttons: the failed run "Summarize later", the bad
        // page "Paste the text".
        assert_eq!(w.statuses("bad-page"), [SummaryStatus::Unreadable]);
        let failed_run = w.statuses("run-fails");
        let good = w.statuses("/good");
        assert!(
            (failed_run == [SummaryStatus::Pending] && good == [SummaryStatus::Done])
                || (failed_run == [SummaryStatus::Done] && good == [SummaryStatus::Pending]),
            "{failed_run:?} {good:?}"
        );
    }

    #[test]
    fn the_import_waits_at_the_usage_limit_with_the_reason_and_continue_keeps_waiting_and_never_goes_past_the_limit(
    ) {
        let w = world(FakeResult::Valid(GOOD.into()));
        // The third run hits the usage limit.
        w.fake.push(FakeResult::Valid(GOOD.into()));
        w.fake.push(FakeResult::Valid(GOOD.into()));
        w.fake.push(FakeResult::UsageLimit);
        let id = w.worker.start(&w.links(10), true).unwrap().import.base.id;
        let s = w.until("the limit", |s| s.wait_reason == Some(DenyReason::Limit));
        w.settled();
        let s_now = w.now();
        assert_eq!(s_now.import.state, ImportState::Running);
        assert_eq!(s_now.wait_reason, Some(DenyReason::Limit));
        assert_eq!(s_now.import.failed, 0, "a limit is not a failure: {s:?}");
        assert_eq!(s_now.import.done + s_now.import.waiting, 10);
        let runs = w.fake.starts();
        // The link at the limit is waiting again, link only, with "Summarize later".
        assert!(w.statuses("example.org").iter().all(|st| matches!(
            st,
            SummaryStatus::Done | SummaryStatus::Pending | SummaryStatus::AiOff
        )));
        // Continue while AI is still held: the reason shows, nothing runs.
        let c = w.worker.resume(&id).unwrap();
        assert_eq!(c.wait_reason, Some(DenyReason::Limit));
        std::thread::sleep(Duration::from_millis(150));
        w.settled();
        assert_eq!(w.fake.starts(), runs, "a run went past the limit");
        // The owner pauses; the limit lifts (Resume in Settings); the import stays paused.
        w.worker.pause(&id).unwrap();
        w.control.resume().unwrap();
        std::thread::sleep(Duration::from_millis(150));
        assert_eq!(w.fake.starts(), runs);
        assert_eq!(w.now().import.paused_by, Some(PausedBy::Owner));
        // Continue now goes on to the end.
        w.worker.resume(&id).unwrap();
        let end = w.until("the end", |s| s.import.state == ImportState::Finished);
        assert_eq!(World::counts(&end), (10, 0, 0));
    }

    #[test]
    fn the_import_waits_at_the_pause_line_and_goes_on_by_itself_when_ai_may_run_again() {
        let w = world(FakeResult::Valid(GOOD.into()));
        w.control.pause().unwrap();
        w.worker.start(&w.links(3), true).unwrap();
        let s = w.until("the reason", |s| {
            s.wait_reason == Some(DenyReason::OwnerPause)
        });
        assert_eq!(World::counts(&s), (0, 3, 0));
        assert_eq!(w.fake.starts(), 0);
        w.control.resume().unwrap();
        let end = w.until("the end", |s| s.import.state == ImportState::Finished);
        assert_eq!(World::counts(&end), (3, 0, 0));
    }

    #[test]
    fn import_links_are_filed_into_the_folder_the_summary_names_and_a_link_the_owner_moved_stays() {
        const FILED: &str = r#"{"summary":"The page explains one thing.","tags":["example"],"reason":"It may help later.","folder":"Dev tools","folder_reason":"It is about a tool."}"#;
        let w = world(FakeResult::Valid(FILED.into()));
        let (dev, mine) = {
            let mut s = w.store.lock().unwrap();
            (
                s.create_folder("Dev tools").unwrap().id,
                s.create_folder("Mine").unwrap().id,
            )
        };
        // Held at the pause line, so the owner can move one link before its summary runs.
        w.control.pause().unwrap();
        w.worker.start(&w.links(3), true).unwrap();
        w.until("the reason", |s| {
            s.wait_reason == Some(DenyReason::OwnerPause)
        });
        let cards = |store: &Arc<Mutex<Storage>>| {
            store
                .lock()
                .unwrap()
                .list_bookmark_cards(&crate::storage::PageRequest {
                    after: None,
                    limit: 100,
                })
                .unwrap()
                .items
        };
        let moved = cards(&w.store)
            .into_iter()
            .find(|b| b.url.ends_with("page-1"))
            .unwrap();
        w.store
            .lock()
            .unwrap()
            .move_bookmark(&moved.base.id, &mine)
            .unwrap();
        w.control.resume().unwrap();
        w.until("the end", |s| s.import.state == ImportState::Finished);
        w.settled();
        for b in cards(&w.store)
            .into_iter()
            .filter(|b| b.url.contains("/import/"))
        {
            assert_eq!(b.summary_status, SummaryStatus::Done);
            if b.base.id == moved.base.id {
                assert_eq!(
                    (b.folder_id.as_str(), b.folder_is_guess),
                    (mine.as_str(), false)
                );
            } else {
                assert_eq!(
                    (b.folder_id.as_str(), b.folder_is_guess),
                    (dev.as_str(), true)
                );
                assert_eq!(b.folder_reason.as_deref(), Some("It is about a tool."));
            }
        }
    }

    #[test]
    fn with_ai_off_the_import_counts_its_links_as_waiting_and_goes_on_when_ai_is_on() {
        let w = world(FakeResult::Valid(GOOD.into()));
        w.control.set_enabled(false).unwrap();
        w.worker.start(&w.links(2), true).unwrap();
        let s = w.until("the reason", |s| s.wait_reason == Some(DenyReason::Off));
        assert_eq!(World::counts(&s), (0, 2, 0));
        w.control.set_enabled(true).unwrap();
        let end = w.until("the end", |s| s.import.state == ImportState::Finished);
        assert_eq!(World::counts(&end), (2, 0, 0));
    }

    #[test]
    fn pause_by_the_owner_stops_the_import_runs_keeps_links_waiting_and_continue_resumes_it() {
        let w = world(FakeResult::Valid(GOOD.into()));
        *w.gauge.hold.lock().unwrap() = true;
        let id = w.worker.start(&w.links(5), true).unwrap().import.base.id;
        let end = Instant::now() + WAIT;
        while w.gauge.now.load(Ordering::SeqCst) < 2 {
            assert!(Instant::now() < end);
            std::thread::sleep(Duration::from_millis(2));
        }
        let p = w.worker.pause(&id).unwrap();
        assert_eq!(
            (p.import.state, p.import.paused_by),
            (ImportState::Paused, Some(PausedBy::Owner))
        );
        w.settled();
        *w.gauge.hold.lock().unwrap() = false;
        let s = w.now();
        assert_eq!(World::counts(&s), (0, 5, 0));
        assert_eq!(s.wait_reason, None);
        // The stopped runs wrote no summary; their cards are back to "no summary yet".
        assert!(w
            .statuses("example.org")
            .iter()
            .all(|st| *st == SummaryStatus::Pending));
        assert!(w.log.ends.lock().unwrap().contains(&RunEnd::Cancelled));
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(w.fake.starts(), 0, "a paused import started a run");
        // Continue runs it to the end.
        let c = w.worker.resume(&id).unwrap();
        assert_eq!(c.import.state, ImportState::Running);
        let end = w.until("the end", |s| s.import.state == ImportState::Finished);
        assert_eq!(World::counts(&end), (5, 0, 0));
    }

    #[test]
    fn stop_here_ends_the_import_at_once_and_its_links_stay_link_only_with_summarize_later() {
        let w = world(FakeResult::Valid(GOOD.into()));
        *w.gauge.hold.lock().unwrap() = true;
        let id = w.worker.start(&w.links(6), true).unwrap().import.base.id;
        let end = Instant::now() + WAIT;
        while w.gauge.now.load(Ordering::SeqCst) < 2 {
            assert!(Instant::now() < end);
            std::thread::sleep(Duration::from_millis(2));
        }
        let s = w.worker.stop(&id).unwrap();
        assert_eq!(s.import.state, ImportState::Stopped);
        assert_eq!(s.wait_reason, None);
        w.settled();
        *w.gauge.hold.lock().unwrap() = false;
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(w.fake.starts(), 0, "a stopped import started a run");
        let after = w.now();
        assert_eq!(World::counts(&after), (0, 0, 0));
        assert_eq!(after.import.state, ImportState::Stopped);
        // All six links are kept, link only, each with "Summarize later".
        let cards = w.statuses("example.org");
        assert_eq!(cards.len(), 6);
        assert!(cards.iter().all(|st| *st == SummaryStatus::Pending));
        // Continue does not bring it back; a new file can be imported.
        assert_eq!(
            w.worker.resume(&id).unwrap().import.state,
            ImportState::Stopped
        );
        let next = w.file("next.txt", &["https://example.net/next".to_string()]);
        let s2 = w.worker.start(&next, true).unwrap();
        assert_ne!(s2.import.base.id, id);
        let end = w.until("the new import's end", |s| {
            s.import.state == ImportState::Finished
        });
        assert_eq!(World::counts(&end), (1, 0, 0));
    }

    #[test]
    fn pause_and_continue_during_the_last_runs_still_leave_workers_to_finish_the_import() {
        let w = world(FakeResult::Valid(GOOD.into()));
        *w.gauge.hold.lock().unwrap() = true;
        let id = w.worker.start(&w.links(4), true).unwrap().import.base.id;
        let end = Instant::now() + WAIT;
        while w.gauge.now.load(Ordering::SeqCst) < 2 {
            assert!(Instant::now() < end);
            std::thread::sleep(Duration::from_millis(2));
        }
        w.worker.pause(&id).unwrap();
        w.worker.resume(&id).unwrap();
        *w.gauge.hold.lock().unwrap() = false;
        let end = w.until("the end", |s| s.import.state == ImportState::Finished);
        assert_eq!(World::counts(&end), (4, 0, 0));
    }

    #[test]
    fn after_a_restart_the_import_shows_as_paused_with_its_counts_and_continue_resumes_it() {
        let w = world(FakeResult::Valid(GOOD.into()));
        w.fake.push(FakeResult::Valid(GOOD.into()));
        w.fake.push(FakeResult::Valid(GOOD.into()));
        w.fake.push(FakeResult::UsageLimit);
        w.worker.start(&w.links(8), true).unwrap();
        w.until("the limit", |s| s.wait_reason == Some(DenyReason::Limit));
        w.settled();
        let before = w.now();
        // Quit: the app stops, the storage is opened again by the next start.
        let db = w.dir.path().join("mnemo.db");
        let reopened = Storage::open(&db).unwrap();
        let after = reopened.latest_import().unwrap().unwrap();
        assert_eq!(
            (after.state, after.paused_by),
            (ImportState::Paused, Some(PausedBy::Closed))
        );
        assert_eq!(
            (after.done, after.waiting, after.failed, after.added),
            (
                before.import.done,
                before.import.waiting,
                before.import.failed,
                8
            )
        );
        assert!(after.waiting > 0);
        // A new worker on the reopened storage does nothing until Continue.
        drop(w.store.lock().unwrap());
        *w.store.lock().unwrap() = reopened;
        w.control.resume().unwrap();
        w.worker.kick();
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(w.now().import.state, ImportState::Paused);
        w.worker.resume(&after.base.id).unwrap();
        let end = w.until("the end", |s| s.import.state == ImportState::Finished);
        assert_eq!(World::counts(&end), (8, 0, 0));
    }

    #[test]
    fn an_import_link_the_owner_deleted_is_removed_and_one_the_owner_summarized_is_done() {
        let w = world(FakeResult::Valid(GOOD.into()));
        w.control.pause().unwrap();
        let id = w.worker.start(&w.links(3), true).unwrap().import.base.id;
        {
            let mut s = w.store.lock().unwrap();
            let items = s.waiting_import_items(&id, 3).unwrap();
            s.delete::<crate::storage::items::Bookmark>(&items[0].bookmark_id)
                .unwrap();
        }
        w.control.resume().unwrap();
        let end = w.until("the end", |s| s.import.state == ImportState::Finished);
        assert_eq!(World::counts(&end), (2, 0, 0));
        // The deleted link is counted apart: it is not "saved as link only".
        assert_eq!(end.import.removed, 1);
        assert_eq!(w.fake.starts(), 2);
    }

    #[test]
    fn an_owner_run_that_ends_before_the_worker_holds_the_link_never_leaves_it_held() {
        let w = world(FakeResult::Valid(GOOD.into()));
        // The worker noted the count, saw the bookmark reading, and the owner's run ended
        // before it could hold the link: the link stays free, so the import can finish.
        let seen = w.worker.workers().owner_ended;
        w.worker.owner_summary_ended();
        assert!(!w.worker.hold_for_owner("item-1", seen));
        assert!(w.worker.workers().owner_reading.is_empty());
        // With no owner run ended in between, the link is held for the owner's run.
        let seen = w.worker.workers().owner_ended;
        assert!(w.worker.hold_for_owner("item-1", seen));
        assert!(w.worker.workers().owner_reading.contains("item-1"));
    }

    #[test]
    fn a_fault_makes_the_import_wait_before_it_goes_on_and_never_restarts_workers_in_a_loop() {
        let w = world(FakeResult::Valid(GOOD.into()));
        // Every run ends cancelled while AI may run: no one paused it, so it is a fault.
        *w.gauge.fail.lock().unwrap() = Some(AiError::Cancelled);
        let id = w.worker.start(&w.links(3), true).unwrap().import.base.id;
        std::thread::sleep(Duration::from_millis(600));
        let runs = w.gauge.runs.load(Ordering::SeqCst);
        assert!(runs <= MAX_CONCURRENT_RUNS, "{runs} runs in 600 ms");
        assert_eq!(World::counts(&w.now()), (0, 3, 0));
        // A Pause ends the wait at once.
        w.worker.pause(&id).unwrap();
        w.settled();
    }

    #[test]
    fn while_it_waits_after_a_fault_the_import_says_why_and_a_control_change_ends_the_wait() {
        let w = world(FakeResult::Valid(GOOD.into()));
        *w.gauge.fail.lock().unwrap() = Some(AiError::Unavailable);
        w.worker.start(&w.links(1), true).unwrap();
        // Honest failure: the status names the fault and when it tries again, never "making".
        let s = w.until("the retry", |s| s.retry.is_some());
        assert_eq!(
            s.retry,
            Some(ImportRetry {
                reason: Fault::Unavailable
            })
        );
        assert_eq!(s.wait_reason, None);
        // Claude Code works again; the background gate opening again ends the wait at once.
        *w.gauge.fail.lock().unwrap() = None;
        let at = Instant::now();
        w.control.pause().unwrap();
        w.control.resume().unwrap();
        let end = w.until("the end", |s| s.import.state == ImportState::Finished);
        assert!(
            at.elapsed() < limits::IMPORT_RETRY_FIRST,
            "the wait did not end early"
        );
        assert_eq!(World::counts(&end), (1, 0, 0));
        assert_eq!(end.retry, None);
    }

    #[test]
    fn a_new_import_and_continue_count_no_earlier_faults() {
        let w = world(FakeResult::Valid(GOOD.into()));
        w.control.pause().unwrap();
        w.worker.workers().faults = 9;
        let id = w.worker.start(&w.links(1), true).unwrap().import.base.id;
        assert_eq!(w.worker.workers().faults, 0);
        w.worker.pause(&id).unwrap();
        w.worker.workers().faults = 9;
        w.worker.resume(&id).unwrap();
        assert_eq!(w.worker.workers().faults, 0);
    }

    #[test]
    fn a_worker_waiting_after_a_fault_of_an_ended_import_does_not_hold_back_the_next_import() {
        let w = world(FakeResult::Valid(GOOD.into()));
        *w.gauge.fail.lock().unwrap() = Some(AiError::Unavailable);
        let old = w.worker.start(&w.links(1), true).unwrap().import.base.id;
        w.until("the retry", |s| s.retry.is_some());
        // The owner summarized the link meanwhile, so the old import can finish with the
        // worker still in its wait.
        {
            let s = w.store.lock().unwrap();
            let item = s.waiting_import_items(&old, 1).unwrap().remove(0);
            s.end_import_item(&item.id, ItemState::Done).unwrap();
            s.finish_import_if_done(&old).unwrap();
        }
        *w.gauge.fail.lock().unwrap() = None;
        *w.gauge.hold.lock().unwrap() = true;
        let file = w.file(
            "next.txt",
            &[
                "https://example.org/next/1".to_string(),
                "https://example.org/next/2".to_string(),
            ],
        );
        w.worker.start(&file, true).unwrap();
        // Both runs start at once: the old wait ended and freed its place.
        let end = Instant::now() + Duration::from_secs(3);
        while w.gauge.now.load(Ordering::SeqCst) < 2 {
            assert!(Instant::now() < end, "the old wait held a place");
            std::thread::sleep(Duration::from_millis(5));
        }
        *w.gauge.hold.lock().unwrap() = false;
        w.until("the end", |s| s.import.state == ImportState::Finished);
    }

    #[test]
    fn a_run_the_gate_withdrew_is_a_stop_and_one_cancelled_by_no_one_is_a_fault() {
        let w = world(FakeResult::Valid(GOOD.into()));
        w.control.pause().unwrap();
        let id = w.worker.start(&w.links(1), true).unwrap().import.base.id;
        let s = w.store.lock().unwrap();
        let item = s.waiting_import_items(&id, 1).unwrap().remove(0);
        let bookmark = s
            .get_saved_bookmark_any(&item.bookmark_id)
            .unwrap()
            .unwrap();
        drop(s);
        let cancelled = SaveResult {
            bookmark,
            ai_error: Some(bookmark_save::Problem {
                code: "cancelled",
                message: "The run was cancelled.".to_string(),
            }),
            already_saved: false,
        };
        // Decided from the run's own runner, not from a second look at the gate.
        assert!(matches!(outcome_of(&cancelled, true), Outcome::Stop));
        assert!(matches!(
            outcome_of(&cancelled, false),
            Outcome::Fault(Fault::Other)
        ));
    }

    #[test]
    fn summarize_later_on_an_imported_link_keeps_the_title_from_the_file() {
        let w = world(FakeResult::Valid(GOOD.into()));
        let p = w.dir.path().join("titles.html");
        std::fs::write(
            &p,
            "<DL><p>\n<DT><A HREF=\"https://example.org/import/titled-1\">File title</A>\n</DL>\n",
        )
        .unwrap();
        let file = read_import_file(&p, IMPORT_LIMITS).unwrap();
        // Imported without summaries: the owner uses "Summarize later" on the card.
        w.worker.start(&file, false).unwrap();
        let id = w.statuses_ids("/import/titled-1");
        let store = Shared(w.store.clone());
        let pages = Pages::default();
        let ai_on = || true;
        let emit = |_: &SavedBookmark| {};
        let ctx = SaveContext {
            store: &store,
            reader: &pages,
            runner: w.fake.as_ref(),
            ai_on: &ai_on,
            emit: &emit,
        };
        let done = bookmark_save::summarize(&ctx, &id, None).unwrap();
        assert_eq!(done.bookmark.summary_status, SummaryStatus::Done);
        assert_eq!(done.bookmark.title.as_deref(), Some("File title"));
        assert!(w.store.lock().unwrap().is_imported_bookmark(&id).unwrap());
    }

    #[test]
    fn only_the_background_gate_opening_again_ends_a_fault_wait() {
        let w = world(FakeResult::Valid(GOOD.into()));
        let wake = || w.worker.workers().wake;
        let before = wake();
        // Usage readings and ticks with the gate open change nothing.
        w.worker.gate_seen(true);
        w.worker.gate_seen(true);
        assert_eq!(wake(), before);
        // Closed, then open again: the wait ends.
        w.worker.gate_seen(false);
        assert_eq!(wake(), before);
        w.worker.gate_seen(true);
        assert_eq!(wake(), before + 1);
    }

    #[test]
    fn a_wake_during_the_run_still_ends_the_wait_after_it() {
        let w = world(FakeResult::Valid(GOOD.into()));
        w.control.pause().unwrap();
        let id = w.worker.start(&w.links(1), true).unwrap().import.base.id;
        // Noted before the run; the gate opened again during the run.
        let woken = w.worker.workers().wake;
        w.worker.gate_seen(false);
        w.worker.gate_seen(true);
        let at = Instant::now();
        w.worker
            .wait_after_fault(&id, &CancelToken::default(), Fault::Other, woken);
        assert!(
            at.elapsed() < limits::IMPORT_RETRY_FIRST,
            "the wake was lost"
        );
        assert!(w.worker.workers().retries.is_empty());
    }

    #[test]
    fn continue_with_the_id_of_an_import_that_is_not_paused_keeps_the_fault_count() {
        let w = world(FakeResult::Valid(GOOD.into()));
        w.control.pause().unwrap();
        let old = w
            .worker
            .start(
                &w.file("old.txt", &["https://example.org/old".to_string()]),
                false,
            )
            .unwrap()
            .import
            .base
            .id;
        let id = w.worker.start(&w.links(1), true).unwrap().import.base.id;
        w.worker.workers().faults = 3;
        w.worker.resume(&old).unwrap();
        // Continue on a running import is no new start either.
        w.worker.resume(&id).unwrap();
        assert_eq!(w.worker.workers().faults, 3);
    }

    #[test]
    fn the_retry_line_stays_while_any_worker_still_waits() {
        let w = world(FakeResult::Valid(GOOD.into()));
        *w.gauge.hold.lock().unwrap() = true;
        w.worker.start(&w.links(3), true).unwrap();
        w.worker.workers().retries = vec![(1, Fault::Storage), (2, Fault::Unavailable)];
        assert_eq!(
            w.now().retry,
            Some(ImportRetry {
                reason: Fault::Unavailable
            })
        );
        // One worker's wait ends: the other still waits, and the line stays.
        w.worker.workers().retries.retain(|&(k, _)| k != 2);
        assert_eq!(
            w.now().retry,
            Some(ImportRetry {
                reason: Fault::Storage
            })
        );
        w.worker.workers().retries.clear();
        assert_eq!(w.now().retry, None);
        *w.gauge.hold.lock().unwrap() = false;
        w.until("the end", |s| s.import.state == ImportState::Finished);
    }

    #[test]
    fn a_run_the_queue_cannot_record_is_a_storage_fault_not_claude_code_missing() {
        let w = world(FakeResult::Valid(GOOD.into()));
        w.log.fail.store(true, Ordering::SeqCst);
        let id = w.worker.start(&w.links(1), true).unwrap().import.base.id;
        let s = w.until("the retry", |s| s.retry.is_some());
        assert_eq!(
            s.retry,
            Some(ImportRetry {
                reason: Fault::Storage
            })
        );
        w.worker.pause(&id).unwrap();
        w.settled();
    }

    #[test]
    fn ai_turned_off_while_an_import_run_is_queued_is_not_a_fault() {
        let w = world(FakeResult::Valid(GOOD.into()));
        // Two owner runs fill the queue, so the import's run waits in it.
        *w.gauge.hold.lock().unwrap() = true;
        let owner: Vec<_> = (0..2)
            .map(|i| {
                w.queue
                    .submit(
                        Priority::Owner,
                        crate::ai::bookmark_save::task_for(None, &format!("{PAGE} {i}"), &[]),
                    )
                    .unwrap()
            })
            .collect();
        let end = Instant::now() + WAIT;
        while w.gauge.now.load(Ordering::SeqCst) < 2 {
            assert!(Instant::now() < end, "the owner runs did not start");
            std::thread::sleep(Duration::from_millis(2));
        }
        let runner = BackgroundRunner::new(w.queue.clone(), CancelToken::default());
        let control = w.control.clone();
        let off = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            control.set_enabled(false).unwrap();
        });
        let r = runner.run_task(
            &crate::ai::bookmark_save::task_for(None, PAGE, &[]),
            &CancelToken::default(),
        );
        off.join().unwrap();
        assert_eq!(r, Err(AiError::Cancelled));
        assert!(runner.held_by_gate(), "AI off was taken for a fault");
        *w.gauge.hold.lock().unwrap() = false;
        for t in owner {
            let _ = t.done.recv_timeout(WAIT);
        }
    }

    #[test]
    fn the_gate_closing_during_the_page_read_is_a_stop_not_a_fault() {
        let w = world(FakeResult::Valid(GOOD.into()));
        w.control.pause().unwrap();
        let id = w.worker.start(&w.links(1), true).unwrap().import.base.id;
        let item = w
            .store
            .lock()
            .unwrap()
            .waiting_import_items(&id, 1)
            .unwrap()
            .remove(0);
        // Paused by the owner first, so no worker takes the link when the gate opens.
        w.worker.pause(&id).unwrap();
        w.control.resume().unwrap();
        w.settled();
        assert_eq!(w.pages.reads.load(Ordering::SeqCst), 0);
        // The gate is open when the link is taken and closes while its page is read.
        let control = w.control.clone();
        *w.pages.during_read.lock().unwrap() = Some(Box::new(move || {
            let _ = control.pause();
        }));
        assert!(matches!(
            w.worker.make(&item, &CancelToken::default()),
            Outcome::Stop
        ));
        assert_eq!(w.pages.reads.load(Ordering::SeqCst), 1);
        assert_eq!(w.worker.workers().faults, 0);
        assert_eq!(w.statuses("/import/"), vec![SummaryStatus::Pending]);
        let waiting = w.store.lock().unwrap().get_import(&id).unwrap().waiting;
        assert_eq!(waiting, 1);
    }

    #[test]
    fn a_refused_start_never_cancels_the_running_imports_runs() {
        let w = world(FakeResult::Valid(GOOD.into()));
        *w.gauge.hold.lock().unwrap() = true;
        w.worker.start(&w.links(2), true).unwrap();
        let end = Instant::now() + WAIT;
        while w.gauge.now.load(Ordering::SeqCst) < 2 {
            assert!(Instant::now() < end, "the runs did not start");
            std::thread::sleep(Duration::from_millis(2));
        }
        let other = w.file("other.txt", &["https://example.org/other".to_string()]);
        assert!(w.worker.start(&other, true).is_err());
        // Longer than the queue's cancel poll, so a cancel would have reached the runs.
        std::thread::sleep(limits::QUEUED_CANCEL_POLL * 6);
        assert_eq!(w.gauge.now.load(Ordering::SeqCst), 2, "a run was cancelled");
        *w.gauge.hold.lock().unwrap() = false;
        let done = w.until("the end", |s| s.import.state == ImportState::Finished);
        assert_eq!(World::counts(&done), (2, 0, 0));
        // No run was cancelled and started again.
        assert_eq!(w.gauge.runs.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn the_wait_after_faults_doubles_up_to_the_most() {
        assert_eq!(retry_delay(1), limits::IMPORT_RETRY_FIRST);
        assert_eq!(retry_delay(2), limits::IMPORT_RETRY_FIRST * 2);
        assert_eq!(retry_delay(40), limits::IMPORT_RETRY_MOST);
    }

    #[test]
    fn claude_code_that_cannot_start_keeps_the_link_waiting_as_its_card_says_ai_off() {
        let w = world(FakeResult::Valid(GOOD.into()));
        *w.gauge.fail.lock().unwrap() = Some(AiError::Unavailable);
        let id = w.worker.start(&w.links(1), true).unwrap().import.base.id;
        let end = Instant::now() + WAIT;
        while w.gauge.runs.load(Ordering::SeqCst) == 0 {
            assert!(Instant::now() < end, "no run started");
            std::thread::sleep(Duration::from_millis(5));
        }
        w.worker.pause(&id).unwrap();
        w.settled();
        assert_eq!(World::counts(&w.now()), (0, 1, 0));
        assert_eq!(w.statuses("/import/"), vec![SummaryStatus::AiOff]);
    }

    #[test]
    fn a_link_taken_while_the_background_gate_holds_ai_reads_no_page_and_its_card_stays_pending() {
        let w = world(FakeResult::Valid(GOOD.into()));
        // The pause line holds background work; the owner's own AI is still on.
        w.control.pause().unwrap();
        let id = w.worker.start(&w.links(1), true).unwrap().import.base.id;
        let item = w
            .store
            .lock()
            .unwrap()
            .waiting_import_items(&id, 1)
            .unwrap()
            .remove(0);
        assert!(matches!(
            w.worker.make(&item, &CancelToken::default()),
            Outcome::Stop
        ));
        assert_eq!(w.pages.reads.load(Ordering::SeqCst), 0, "a page was read");
        assert_eq!(w.statuses("/import/"), vec![SummaryStatus::Pending]);
    }

    #[test]
    fn the_card_says_ai_off_only_when_the_owners_own_ai_is_off() {
        let w = world(FakeResult::Valid(GOOD.into()));
        assert!(w.worker.owner_ai_on());
        // The pause line holds only background work: the owner may still summarize.
        w.control.pause().unwrap();
        assert!(w.worker.held_by().is_some());
        assert!(w.worker.owner_ai_on());
        w.control.resume().unwrap();
        w.control.set_enabled(false).unwrap();
        assert!(!w.worker.owner_ai_on());
    }

    #[test]
    fn pause_or_stop_with_the_id_of_an_older_import_never_cancels_the_running_import() {
        let w = world(FakeResult::Valid(GOOD.into()));
        let old = w
            .worker
            .start(
                &w.file("old.txt", &["https://example.org/old".to_string()]),
                false,
            )
            .unwrap()
            .import
            .base
            .id;
        *w.gauge.hold.lock().unwrap() = true;
        w.worker.start(&w.links(2), true).unwrap();
        let end = Instant::now() + WAIT;
        while w.gauge.now.load(Ordering::SeqCst) < 2 {
            assert!(Instant::now() < end, "the runs did not start");
            std::thread::sleep(Duration::from_millis(2));
        }
        // Both calls answer with the old import as it is: finished, untouched.
        let paused = w.worker.pause(&old).unwrap();
        assert_eq!(paused.import.state, ImportState::Finished);
        let stopped = w.worker.stop(&old).unwrap();
        assert_eq!(stopped.import.state, ImportState::Finished);
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(w.gauge.now.load(Ordering::SeqCst), 2, "a run was cancelled");
        *w.gauge.hold.lock().unwrap() = false;
        let end = w.until("the end", |s| s.import.state == ImportState::Finished);
        assert_eq!(World::counts(&end), (2, 0, 0));
        assert_eq!(w.gauge.runs.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn an_imported_title_survives_the_summary_and_a_link_with_none_gets_the_page_title() {
        let w = world(FakeResult::Valid(GOOD.into()));
        let p = w.dir.path().join("titles.html");
        std::fs::write(
            &p,
            "<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n\
             <DT><A HREF=\"https://example.org/import/titled-1\">File title</A>\n\
             <DT><A HREF=\"https://example.org/import/titled-2\"></A>\n</DL>\n",
        )
        .unwrap();
        let file = read_import_file(&p, IMPORT_LIMITS).unwrap();
        w.worker.start(&file, true).unwrap();
        w.until("the end", |s| s.import.state == ImportState::Finished);
        w.settled();
        let s = w.store.lock().unwrap();
        let mut titles: Vec<(String, Option<String>)> = s
            .list_bookmark_cards(&crate::storage::PageRequest {
                after: None,
                limit: 10,
            })
            .unwrap()
            .items
            .into_iter()
            .map(|b| (b.url, b.title))
            .collect();
        titles.sort();
        assert_eq!(
            titles,
            vec![
                (
                    "https://example.org/import/titled-1".to_string(),
                    Some("File title".to_string())
                ),
                (
                    "https://example.org/import/titled-2".to_string(),
                    Some("Page title".to_string())
                ),
            ]
        );
    }

    #[test]
    fn a_line_that_is_not_a_link_does_not_stop_the_import_and_the_rest_are_summarized() {
        let w = world(FakeResult::Valid(GOOD.into()));
        let lines = vec![
            "https://example.org/import/a".to_string(),
            "this line is not a link".to_string(),
            "https://example.org/import/b".to_string(),
        ];
        let s = w.worker.start(&w.file("l.txt", &lines), true).unwrap();
        assert_eq!(s.import.not_links, 1);
        let end = w.until("the end", |s| s.import.state == ImportState::Finished);
        assert_eq!(World::counts(&end), (2, 0, 0));
    }

    #[test]
    fn an_import_without_summaries_starts_no_run_and_keeps_the_links_link_only() {
        let w = world(FakeResult::Valid(GOOD.into()));
        let s = w.worker.start(&w.links(4), false).unwrap();
        assert_eq!(s.import.state, ImportState::Finished);
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(w.fake.starts(), 0);
        assert!(w
            .statuses("example.org")
            .iter()
            .all(|st| *st == SummaryStatus::Pending));
    }
}
