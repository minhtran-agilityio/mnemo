// The AI run queue: at most `MAX_CONCURRENT_RUNS` runs at the same time, owner tasks before
// background tasks, first in first out inside each class. Every run has one row in the run
// log (waiting, running, then done, failed or cancelled) and every state change is sent to
// the notifier (the app sends it to the UI as the `run-state` event).
//
// One mutex guards the two waiting lines and the map of running runs. The run log and the
// notifier are called outside that mutex, so the queue never holds its lock across SQLite or
// the UI. Each started run gets its own thread; a guard on that thread ends the row and frees
// the slot even when the runner panics.

use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

use serde::Serialize;

use crate::ai::cancel::CancelToken;
use crate::ai::runner::{AiError, AiOutput, AiRunner, AiTask};
use crate::storage::items::RunState;
use crate::storage::runs::RunEnd;

/// The most AI runs at the same time. Owner-confirmed: one constant, kept here.
pub const MAX_CONCURRENT_RUNS: usize = 2;

/// The error text of a run whose runner stopped without an answer (it panicked).
pub const STOPPED_UNEXPECTEDLY: &str = "the run stopped unexpectedly";

/// Which waiting line a task joins. Priority only decides which waiting task takes a free
/// slot: a running background run is never stopped for an owner task.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Priority {
    /// Something the owner asked for and waits on.
    Owner,
    /// A job the app runs on its own. Phase 5 (AGT-01) adds the first caller.
    #[allow(dead_code)]
    Background,
}

/// Why the run log could not write a row. The text is for the log only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunLogError(pub String);

impl fmt::Display for RunLogError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for RunLogError {}

/// Where the queue writes its rows: the `storage::runs` functions behind the one storage the
/// app holds. Given to the queue, so tests use a temporary database without Tauri.
pub trait RunLog: Send + Sync {
    /// Writes a new waiting row and returns its id.
    fn enqueue(&self, task_type: &str) -> Result<String, RunLogError>;
    /// Moves the row from waiting to running.
    fn start(&self, id: &str) -> Result<(), RunLogError>;
    /// Writes the end of the run. `duration_ms` is `None` for a run that never started.
    fn finish(&self, id: &str, end: &RunEnd, duration_ms: Option<i64>) -> Result<(), RunLogError>;
}

/// One run state change. It holds the run id, the task name and the state, and nothing else:
/// no prompt, no path and no error output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEvent {
    pub id: String,
    pub task_type: String,
    pub state: RunState,
}

/// Gets every run state change. The app sends it to the UI.
pub type Notifier = Arc<dyn Fn(&RunEvent) + Send + Sync>;

/// What `RunQueue::cancel` did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelOutcome {
    /// The run was waiting: it left the queue and no process started.
    Removed,
    /// The run is running: its cancel token is set, and it ends as cancelled shortly.
    Signalled,
    /// No waiting or running run has this id.
    NotActive,
}

/// What a submitted run gives back: its row id and, when it ends, its result. The sender is
/// dropped without a result only when the runner stopped unexpectedly.
pub struct RunTicket {
    pub id: String,
    pub done: mpsc::Receiver<Result<AiOutput, AiError>>,
}

struct Job {
    id: String,
    task: AiTask,
    reply: mpsc::Sender<Result<AiOutput, AiError>>,
}

#[derive(Default)]
struct State {
    owner: VecDeque<Job>,
    background: VecDeque<Job>,
    running: HashMap<String, CancelToken>,
}

struct Inner {
    runner: Arc<dyn AiRunner>,
    log: Arc<dyn RunLog>,
    notify: Notifier,
    state: Mutex<State>,
}

/// The queue. Clones share one queue.
#[derive(Clone)]
pub struct RunQueue(Arc<Inner>);

impl RunQueue {
    pub fn new(runner: Arc<dyn AiRunner>, log: Arc<dyn RunLog>, notify: Notifier) -> Self {
        RunQueue(Arc::new(Inner {
            runner,
            log,
            notify,
            state: Mutex::new(State::default()),
        }))
    }

    /// Adds a task: writes its waiting row, sends the waiting event, and starts it when a slot
    /// is free. Fails, and starts nothing, when the row cannot be written.
    ///
    /// The run log locks the app's storage, so never call this while holding the storage lock.
    pub fn submit(&self, priority: Priority, task: AiTask) -> Result<RunTicket, RunLogError> {
        let inner = &self.0;
        let id = inner.log.enqueue(&task.name)?;
        // The waiting event goes out before the job can be started, so it always comes first.
        inner.emit(&id, &task.name, RunState::Waiting);
        let (reply, done) = mpsc::channel();
        let job = Job {
            id: id.clone(),
            task,
            reply,
        };
        {
            let mut state = inner.lock();
            match priority {
                Priority::Owner => state.owner.push_back(job),
                Priority::Background => state.background.push_back(job),
            }
        }
        dispatch(inner);
        Ok(RunTicket { id, done })
    }

    /// Cancels a waiting or running run. A waiting run leaves the queue at once and ends as
    /// cancelled without a process; a running run is signalled and its process is killed.
    ///
    /// The run log locks the app's storage, so never call this while holding the storage lock.
    pub fn cancel(&self, id: &str) -> CancelOutcome {
        let inner = &self.0;
        let removed = {
            let mut state = inner.lock();
            if let Some(token) = state.running.get(id) {
                token.cancel();
                return CancelOutcome::Signalled;
            }
            let at_owner = state.owner.iter().position(|j| j.id == id);
            let at_background = state.background.iter().position(|j| j.id == id);
            match (at_owner, at_background) {
                (Some(i), _) => state.owner.remove(i),
                (None, Some(i)) => state.background.remove(i),
                (None, None) => None,
            }
        };
        let Some(job) = removed else {
            return CancelOutcome::NotActive;
        };
        inner.record_end(&job.id, &job.task.name, &RunEnd::Cancelled, None);
        let _ = job.reply.send(Err(AiError::Cancelled));
        CancelOutcome::Removed
    }
}

impl Inner {
    /// A poisoned lock is taken over: the state is a plain queue and stays usable.
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn emit(&self, id: &str, task_type: &str, state: RunState) {
        (self.notify)(&RunEvent {
            id: id.to_string(),
            task_type: task_type.to_string(),
            state,
        });
    }

    /// Writes the end of a run and sends its end event. A failed write is logged and the
    /// event still goes out; the queue carries on.
    fn record_end(&self, id: &str, task_type: &str, end: &RunEnd, duration_ms: Option<i64>) {
        if let Err(e) = self.log.finish(id, end, duration_ms) {
            log::error!("could not write the end of AI run {id} ({task_type}): {e}");
        }
        self.emit(id, task_type, end.state());
    }
}

/// Starts waiting jobs while a slot is free: owner jobs first, each line in order.
fn dispatch(inner: &Arc<Inner>) {
    let started: Vec<(Job, CancelToken)> = {
        let mut state = inner.lock();
        let mut started = Vec::new();
        while state.running.len() < MAX_CONCURRENT_RUNS {
            let Some(job) = state
                .owner
                .pop_front()
                .or_else(|| state.background.pop_front())
            else {
                break;
            };
            let token = CancelToken::default();
            state.running.insert(job.id.clone(), token.clone());
            started.push((job, token));
        }
        started
    };
    for (job, token) in started {
        start(inner, job, token);
    }
}

/// Writes the start of one job and runs it on a thread of its own.
fn start(inner: &Arc<Inner>, job: Job, token: CancelToken) {
    if let Err(e) = inner.log.start(&job.id) {
        log::error!(
            "could not write the start of AI run {} ({}): {e}",
            job.id,
            job.task.name
        );
    }
    inner.emit(&job.id, &job.task.name, RunState::Running);
    let Job { id, task, reply } = job;
    let mut slot = Slot {
        inner: inner.clone(),
        id,
        task_type: task.name.clone(),
        reply: Some(reply),
        started: Instant::now(),
        freed: false,
    };
    let runner = inner.runner.clone();
    let name = format!("mnemo-run-{}", slot.task_type);
    // If the thread cannot start, the closure (and the slot in it) is dropped: the slot
    // guard then ends the run as failed and frees its place.
    let spawned = std::thread::Builder::new().name(name).spawn(move || {
        // A cancel that came after the dispatch but before this point starts no process.
        let result = if token.is_cancelled() {
            Err(AiError::Cancelled)
        } else {
            runner.run_task(&task, &token)
        };
        slot.end(result);
    });
    if let Err(e) = spawned {
        log::error!("could not start a thread for an AI run: {e}");
    }
}

/// One running run. Dropping it frees the slot and starts the next job; when the run gave no
/// result (the runner panicked or its thread never started), the row ends as failed first.
struct Slot {
    inner: Arc<Inner>,
    id: String,
    task_type: String,
    /// Taken when the run ends normally.
    reply: Option<mpsc::Sender<Result<AiOutput, AiError>>>,
    started: Instant,
    /// True once the run left the running map.
    freed: bool,
}

impl Slot {
    /// Takes the run out of the running map, so a cancel after this point finds no run.
    fn free(&mut self) {
        if !self.freed {
            self.freed = true;
            self.inner.lock().running.remove(&self.id);
        }
    }

    fn duration_ms(&self) -> Option<i64> {
        Some(i64::try_from(self.started.elapsed().as_millis()).unwrap_or(i64::MAX))
    }

    /// Writes the end of the run and hands the result to the caller.
    fn end(&mut self, result: Result<AiOutput, AiError>) {
        let Some(reply) = self.reply.take() else {
            return;
        };
        let end = match &result {
            Ok(_) => RunEnd::Done,
            Err(AiError::Cancelled) => RunEnd::Cancelled,
            // Mnemo's own text for the error, never output of the process.
            Err(e) => RunEnd::Failed(e.to_string()),
        };
        self.inner
            .record_end(&self.id, &self.task_type, &end, self.duration_ms());
        // Out of the running map before the caller hears the result, so a cancel sent after
        // the result says the run is no longer active. The next job starts on drop.
        self.free();
        // The caller may have stopped waiting; the row is written either way.
        let _ = reply.send(result);
    }
}

impl Drop for Slot {
    fn drop(&mut self) {
        if self.reply.take().is_some() {
            log::error!(
                "AI run {} ({}) stopped without a result",
                self.id,
                self.task_type
            );
            let end = RunEnd::Failed(STOPPED_UNEXPECTEDLY.to_string());
            self.inner
                .record_end(&self.id, &self.task_type, &end, self.duration_ms());
        }
        self.free();
        dispatch(&self.inner);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::time::Duration;

    use crate::ai::fake::{FakeResult, FakeRunner};
    use crate::storage::items::{Run, RunOutcome};
    use crate::storage::record::now_iso;
    use crate::storage::testing::{open_temp, TempDir};
    use crate::storage::{PageRequest, Storage};

    const WAIT: Duration = Duration::from_secs(5);

    /// The run log on a temporary database, as the app's log is on the real one.
    struct TestLog {
        storage: Mutex<Storage>,
        _dir: TempDir,
    }

    impl TestLog {
        fn new() -> Arc<TestLog> {
            let (storage, dir) = open_temp();
            Arc::new(TestLog {
                storage: Mutex::new(storage),
                _dir: dir,
            })
        }

        fn storage(&self) -> MutexGuard<'_, Storage> {
            self.storage.lock().unwrap_or_else(|e| e.into_inner())
        }

        fn row(&self, id: &str) -> Run {
            self.storage().get::<Run>(id).unwrap()
        }

        fn rows(&self) -> Vec<Run> {
            self.storage()
                .list::<Run>(
                    &PageRequest {
                        limit: 100,
                        after: None,
                    },
                    true,
                )
                .unwrap()
                .items
        }
    }

    fn log_error(e: crate::storage::StorageError) -> RunLogError {
        RunLogError(e.to_string())
    }

    impl RunLog for TestLog {
        fn enqueue(&self, task_type: &str) -> Result<String, RunLogError> {
            let run = self
                .storage()
                .enqueue_run(task_type, &now_iso())
                .map_err(log_error)?;
            Ok(run.base.id)
        }
        fn start(&self, id: &str) -> Result<(), RunLogError> {
            self.storage().start_run(id, &now_iso()).map_err(log_error)
        }
        fn finish(
            &self,
            id: &str,
            end: &RunEnd,
            duration_ms: Option<i64>,
        ) -> Result<(), RunLogError> {
            self.storage()
                .finish_run(id, end, duration_ms, &now_iso())
                .map_err(log_error)
        }
    }

    /// What the scripted runner does for one task name.
    enum Plan {
        /// Gives this result at once.
        Give(Result<AiOutput, AiError>),
        /// Waits until the gate opens (then gives a good answer) or the run is cancelled.
        Hold(Arc<AtomicBool>),
        /// Panics, as a broken runner would.
        Panic,
    }

    /// A runner whose behaviour is set per task name, so which run gets which result never
    /// depends on thread timing. It counts how many runs are inside it at once.
    #[derive(Default)]
    struct ScriptRunner {
        plans: Mutex<HashMap<String, Plan>>,
        called: Mutex<Vec<String>>,
        now: AtomicUsize,
        most: AtomicUsize,
    }

    fn valid() -> Result<AiOutput, AiError> {
        Ok(AiOutput {
            structured_output: r#"{"answer":"hi"}"#.into(),
        })
    }

    impl ScriptRunner {
        fn give(&self, name: &str, result: Result<AiOutput, AiError>) {
            self.plans
                .lock()
                .unwrap()
                .insert(name.into(), Plan::Give(result));
        }

        /// Holds the run of `name` until the returned gate is opened.
        fn hold(&self, name: &str) -> Arc<AtomicBool> {
            let gate = Arc::new(AtomicBool::new(false));
            self.plans
                .lock()
                .unwrap()
                .insert(name.into(), Plan::Hold(gate.clone()));
            gate
        }

        fn called(&self) -> Vec<String> {
            self.called.lock().unwrap().clone()
        }
    }

    impl AiRunner for ScriptRunner {
        fn run_task(&self, task: &AiTask, cancel: &CancelToken) -> Result<AiOutput, AiError> {
            let now = self.now.fetch_add(1, Ordering::SeqCst) + 1;
            self.most.fetch_max(now, Ordering::SeqCst);
            self.called.lock().unwrap().push(task.name.clone());
            // The plan is read and the lock let go before anything can panic or block.
            let (gate, panics) = match self.plans.lock().unwrap().get(&task.name) {
                Some(Plan::Give(result)) => (Err(result.clone()), false),
                Some(Plan::Hold(gate)) => (Ok(gate.clone()), false),
                Some(Plan::Panic) => (Err(valid()), true),
                None => (Err(valid()), false),
            };
            if panics {
                self.now.fetch_sub(1, Ordering::SeqCst);
                panic!("scripted runner panic");
            }
            let result = match gate {
                Err(result) => result,
                Ok(gate) => loop {
                    if cancel.is_cancelled() {
                        break Err(AiError::Cancelled);
                    }
                    if gate.load(Ordering::SeqCst) {
                        break valid();
                    }
                    std::thread::sleep(Duration::from_millis(2));
                },
            };
            self.now.fetch_sub(1, Ordering::SeqCst);
            result
        }
    }

    fn task(name: &str) -> AiTask {
        AiTask {
            name: name.into(),
            prompt: format!("secret prompt of {name}"),
            schema: r#"{"type":"object"}"#.into(),
            tools: vec![],
            model: "haiku".into(),
            effort: None,
            timeout: Duration::from_secs(30),
        }
    }

    /// A queue with a collecting notifier: every event arrives on the returned channel.
    fn queue(runner: Arc<dyn AiRunner>, log: Arc<TestLog>) -> (RunQueue, mpsc::Receiver<RunEvent>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let notify: Notifier = Arc::new(move |e: &RunEvent| {
            let _ = tx.lock().unwrap().send(e.clone());
        });
        (RunQueue::new(runner, log, notify), rx)
    }

    /// Waits for the next event in `state` and gives its task name. Earlier events in other
    /// states are skipped.
    fn next_in(events: &mpsc::Receiver<RunEvent>, state: RunState) -> String {
        loop {
            let e = events
                .recv_timeout(WAIT)
                .unwrap_or_else(|_| panic!("no {state:?} event came"));
            if e.state == state {
                return e.task_type;
            }
        }
    }

    /// Polls `check` until it is true; fails after `WAIT`.
    fn eventually(what: &str, check: impl Fn() -> bool) {
        let end = Instant::now() + WAIT;
        while !check() {
            assert!(Instant::now() < end, "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    fn wait(ticket: &RunTicket) -> Result<AiOutput, AiError> {
        ticket
            .done
            .recv_timeout(WAIT)
            .expect("the run gave no result")
    }

    #[test]
    fn queue_runs_at_most_two_of_five() {
        let runner = Arc::new(ScriptRunner::default());
        let gates: Vec<_> = (0..5).map(|i| runner.hold(&format!("t{i}"))).collect();
        let log = TestLog::new();
        let (q, events) = queue(runner.clone(), log.clone());
        let tickets: Vec<_> = (0..5)
            .map(|i| {
                q.submit(Priority::Background, task(&format!("t{i}")))
                    .unwrap()
            })
            .collect();
        // Two start; the other three wait while both slots are held.
        assert_eq!(next_in(&events, RunState::Running), "t0");
        assert_eq!(next_in(&events, RunState::Running), "t1");
        eventually("two runs inside the runner", || {
            runner.now.load(Ordering::SeqCst) == 2
        });
        assert!(!matches!(
            events.recv_timeout(Duration::from_millis(200)),
            Ok(e) if e.state == RunState::Running
        ));
        assert_eq!(runner.most.load(Ordering::SeqCst), 2);
        for gate in &gates {
            gate.store(true, Ordering::SeqCst);
        }
        for t in &tickets {
            assert!(wait(t).is_ok());
        }
        assert!(runner.most.load(Ordering::SeqCst) <= MAX_CONCURRENT_RUNS);
        let rows = log.rows();
        assert_eq!(rows.len(), 5);
        assert!(rows.iter().all(|r| r.state == RunState::Done));
    }

    #[test]
    fn queue_owner_task_starts_before_three_waiting_background() {
        let runner = Arc::new(ScriptRunner::default());
        let gate_a = runner.hold("bg-a");
        let gate_b = runner.hold("bg-b");
        let log = TestLog::new();
        let (q, events) = queue(runner.clone(), log.clone());
        let a = q.submit(Priority::Background, task("bg-a")).unwrap();
        let b = q.submit(Priority::Background, task("bg-b")).unwrap();
        assert_eq!(next_in(&events, RunState::Running), "bg-a");
        assert_eq!(next_in(&events, RunState::Running), "bg-b");
        // Three background tasks wait, then the owner task comes in behind them.
        let waiting: Vec<_> = ["bg-c", "bg-d", "bg-e"]
            .iter()
            .map(|n| q.submit(Priority::Background, task(n)).unwrap())
            .collect();
        let owner = q.submit(Priority::Owner, task("owner")).unwrap();
        // No pre-emption: both background runs are still running.
        assert_eq!(log.row(&a.id).state, RunState::Running);
        assert_eq!(log.row(&b.id).state, RunState::Running);
        gate_a.store(true, Ordering::SeqCst);
        assert_eq!(next_in(&events, RunState::Running), "owner");
        assert!(wait(&owner).is_ok());
        for name in ["bg-c", "bg-d", "bg-e"] {
            assert_eq!(next_in(&events, RunState::Running), name);
        }
        gate_b.store(true, Ordering::SeqCst);
        for t in waiting.iter().chain([&a, &b]) {
            assert!(wait(t).is_ok());
        }
        assert_eq!(log.row(&b.id).state, RunState::Done);
    }

    #[test]
    fn queue_fifo_inside_each_class() {
        let runner = Arc::new(ScriptRunner::default());
        let hold_1 = runner.hold("hold-1");
        let hold_2 = runner.hold("hold-2");
        let log = TestLog::new();
        let (q, events) = queue(runner.clone(), log.clone());
        let mut tickets = vec![
            q.submit(Priority::Background, task("hold-1")).unwrap(),
            q.submit(Priority::Background, task("hold-2")).unwrap(),
        ];
        assert_eq!(next_in(&events, RunState::Running), "hold-1");
        assert_eq!(next_in(&events, RunState::Running), "hold-2");
        for (p, name) in [
            (Priority::Background, "bg-1"),
            (Priority::Owner, "owner-1"),
            (Priority::Background, "bg-2"),
            (Priority::Owner, "owner-2"),
            (Priority::Background, "bg-3"),
        ] {
            tickets.push(q.submit(p, task(name)).unwrap());
        }
        // One slot frees; the other stays held, so the waiting tasks run one at a time.
        hold_1.store(true, Ordering::SeqCst);
        let order: Vec<String> = (0..5)
            .map(|_| next_in(&events, RunState::Running))
            .collect();
        assert_eq!(order, ["owner-1", "owner-2", "bg-1", "bg-2", "bg-3"]);
        hold_2.store(true, Ordering::SeqCst);
        for t in &tickets {
            assert!(wait(t).is_ok());
        }
    }

    #[test]
    fn queue_writes_one_row_per_run_with_end_state_and_error() {
        let runner = Arc::new(ScriptRunner::default());
        runner.give("good", valid());
        runner.give("slow", Err(AiError::Timeout));
        runner.give("stopped", Err(AiError::Cancelled));
        let log = TestLog::new();
        let (q, _events) = queue(runner.clone(), log.clone());
        let good = q.submit(Priority::Owner, task("good")).unwrap();
        let slow = q.submit(Priority::Owner, task("slow")).unwrap();
        let stopped = q.submit(Priority::Owner, task("stopped")).unwrap();
        assert!(wait(&good).is_ok());
        assert_eq!(wait(&slow), Err(AiError::Timeout));
        assert_eq!(wait(&stopped), Err(AiError::Cancelled));
        assert_eq!(log.rows().len(), 3, "one row per run");
        let cases = [
            (&good, RunState::Done, RunOutcome::Ok, None),
            (
                &slow,
                RunState::Failed,
                RunOutcome::Failed,
                Some("the AI run timed out"),
            ),
            (&stopped, RunState::Cancelled, RunOutcome::Cancelled, None),
        ];
        for (ticket, state, outcome, error) in cases {
            let row = log.row(&ticket.id);
            assert_eq!(row.state, state);
            assert_eq!(row.outcome, Some(outcome));
            assert_eq!(row.error.as_deref(), error);
            assert!(row.started_at.is_some());
            assert!(row.ended_at.is_some());
            assert!(row.duration_ms.is_some_and(|d| d >= 0));
            // The row never holds the prompt.
            assert!(!format!("{row:?}").contains("secret prompt"));
        }
    }

    #[test]
    fn queue_cancel_waiting_run_starts_no_process() {
        let runner = Arc::new(ScriptRunner::default());
        let hold_1 = runner.hold("hold-1");
        let hold_2 = runner.hold("hold-2");
        let log = TestLog::new();
        let (q, events) = queue(runner.clone(), log.clone());
        let h1 = q.submit(Priority::Owner, task("hold-1")).unwrap();
        let h2 = q.submit(Priority::Owner, task("hold-2")).unwrap();
        assert_eq!(next_in(&events, RunState::Running), "hold-1");
        assert_eq!(next_in(&events, RunState::Running), "hold-2");
        let victim = q.submit(Priority::Owner, task("victim")).unwrap();
        assert_eq!(q.cancel(&victim.id), CancelOutcome::Removed);
        assert_eq!(wait(&victim), Err(AiError::Cancelled));
        assert_eq!(next_in(&events, RunState::Cancelled), "victim");
        assert_eq!(q.cancel(&victim.id), CancelOutcome::NotActive);
        hold_1.store(true, Ordering::SeqCst);
        hold_2.store(true, Ordering::SeqCst);
        assert!(wait(&h1).is_ok());
        assert!(wait(&h2).is_ok());
        assert!(!runner.called().contains(&"victim".to_string()));
        let row = log.row(&victim.id);
        assert_eq!(row.state, RunState::Cancelled);
        assert_eq!(row.outcome, Some(RunOutcome::Cancelled));
        assert_eq!((row.started_at, row.duration_ms), (None, None));
        assert!(row.ended_at.is_some());
    }

    #[test]
    fn queue_cancel_running_fake_run_ends_cancelled() {
        let fake = Arc::new(FakeRunner::new(FakeResult::BlockUntilCancelled));
        let log = TestLog::new();
        let (q, events) = queue(fake, log.clone());
        let ticket = q.submit(Priority::Owner, task("blocked")).unwrap();
        assert_eq!(next_in(&events, RunState::Running), "blocked");
        let asked = Instant::now();
        assert_eq!(q.cancel(&ticket.id), CancelOutcome::Signalled);
        assert_eq!(
            ticket.done.recv_timeout(Duration::from_secs(2)),
            Ok(Err(AiError::Cancelled))
        );
        assert!(asked.elapsed() < Duration::from_secs(2));
        assert_eq!(next_in(&events, RunState::Cancelled), "blocked");
        let row = log.row(&ticket.id);
        assert_eq!(row.state, RunState::Cancelled);
        assert_eq!(row.outcome, Some(RunOutcome::Cancelled));
        assert_eq!(row.error, None);
        assert!(row.started_at.is_some() && row.ended_at.is_some());
        assert_eq!(q.cancel(&ticket.id), CancelOutcome::NotActive);
    }

    #[test]
    fn queue_events_carry_only_id_task_and_state() {
        let runner = Arc::new(ScriptRunner::default());
        let log = TestLog::new();
        let (q, events) = queue(runner, log);
        let ticket = q.submit(Priority::Owner, task("summary")).unwrap();
        assert!(wait(&ticket).is_ok());
        let mut seen = Vec::new();
        while seen.len() < 3 {
            seen.push(events.recv_timeout(WAIT).expect("an event is missing"));
        }
        // One event per state change, in order, for this run.
        let states: Vec<RunState> = seen.iter().map(|e| e.state).collect();
        assert_eq!(
            states,
            [RunState::Waiting, RunState::Running, RunState::Done]
        );
        for e in &seen {
            assert_eq!(
                (e.id.as_str(), e.task_type.as_str()),
                (ticket.id.as_str(), "summary")
            );
            let json = serde_json::to_value(e).unwrap();
            let mut keys: Vec<&str> = json
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect();
            keys.sort_unstable();
            assert_eq!(keys, ["id", "state", "taskType"]);
            assert!(!json.to_string().contains("secret prompt"));
        }
        assert_eq!(
            serde_json::to_value(&seen[2]).unwrap()["state"],
            serde_json::json!("done")
        );
    }

    #[test]
    fn queue_runner_panic_fails_the_row_and_frees_the_slot() {
        let runner = Arc::new(ScriptRunner::default());
        runner
            .plans
            .lock()
            .unwrap()
            .insert("broken".into(), Plan::Panic);
        let log = TestLog::new();
        let (q, events) = queue(runner, log.clone());
        let broken = q.submit(Priority::Owner, task("broken")).unwrap();
        // The result channel closes without a result.
        assert!(broken.done.recv_timeout(WAIT).is_err());
        assert_eq!(next_in(&events, RunState::Failed), "broken");
        let row = log.row(&broken.id);
        assert_eq!(row.state, RunState::Failed);
        assert_eq!(row.error.as_deref(), Some(STOPPED_UNEXPECTEDLY));
        // The slot is free again: two more runs still finish.
        let next: Vec<_> = ["after-1", "after-2", "after-3"]
            .iter()
            .map(|n| q.submit(Priority::Owner, task(n)).unwrap())
            .collect();
        for t in &next {
            assert!(wait(t).is_ok());
        }
    }

    #[test]
    fn queue_submit_fails_and_starts_nothing_when_the_row_cannot_be_written() {
        struct BrokenLog;
        impl RunLog for BrokenLog {
            fn enqueue(&self, _: &str) -> Result<String, RunLogError> {
                Err(RunLogError("storage is not open".into()))
            }
            fn start(&self, _: &str) -> Result<(), RunLogError> {
                Ok(())
            }
            fn finish(&self, _: &str, _: &RunEnd, _: Option<i64>) -> Result<(), RunLogError> {
                Ok(())
            }
        }
        let runner = Arc::new(ScriptRunner::default());
        let notify: Notifier = Arc::new(|_: &RunEvent| {});
        let q = RunQueue::new(runner.clone(), Arc::new(BrokenLog), notify);
        assert!(q.submit(Priority::Owner, task("x")).is_err());
        assert!(runner.called().is_empty());
    }
}
