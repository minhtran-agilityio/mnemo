//! The run log of the AI queue: one `run` row per run, moved from waiting to running to one
//! end state. Each function is one parameterised statement. The caller gives the time, so
//! tests do not depend on the clock.

use rusqlite::params;

use super::error::StorageError;
use super::items::{invalid, optional_text, Run, RunInput, RunState};
use super::Storage;

/// The error text of a run that was waiting or running when the app stopped.
pub const APP_CLOSED: &str = "app closed";

/// How a run ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunEnd {
    /// The run gave an answer.
    Done,
    /// The run failed. The text is Mnemo's own message for the error, never raw output.
    Failed(String),
    /// The run was cancelled before it gave an answer.
    Cancelled,
}

impl RunEnd {
    /// The end state this ending writes.
    pub fn state(&self) -> RunState {
        match self {
            RunEnd::Done => RunState::Done,
            RunEnd::Failed(_) => RunState::Failed,
            RunEnd::Cancelled => RunState::Cancelled,
        }
    }
}

const START_SQL: &str = "UPDATE run SET state = 'running', started_at = ?2, updated_at = ?2 \
     WHERE id = ?1 AND deleted_at IS NULL AND state = 'waiting'";

// A run that never started keeps a NULL duration: it is unknown, not zero.
const FINISH_SQL: &str = "UPDATE run SET state = ?3, outcome = ?4, error = ?5, ended_at = ?2, \
     updated_at = ?2, duration_ms = CASE WHEN started_at IS NULL THEN NULL ELSE ?6 END \
     WHERE id = ?1 AND deleted_at IS NULL AND state IN ('waiting', 'running')";

// Every row, deleted or not, so no row is ever left in running or waiting. The duration
// stays NULL: the time from the start to now would count the hours the app was closed.
const FAIL_INTERRUPTED_SQL: &str =
    "UPDATE run SET state = 'failed', outcome = 'failed', error = ?2, ended_at = ?1, \
     updated_at = ?1 WHERE state IN ('running', 'waiting')";

// Every row that started at or after the boundary, deleted or not: a deleted run still used
// the limit. A run that waited and was cancelled never started, so it is not counted. No index
// covers started_at; this runs when Settings > AI opens, on a table of a few rows a day.
const COUNT_STARTED_SQL: &str = "SELECT \
     COALESCE(SUM(CASE WHEN started_at >= ?1 THEN 1 ELSE 0 END), 0), \
     COALESCE(SUM(CASE WHEN started_at >= ?2 THEN 1 ELSE 0 END), 0) \
     FROM run WHERE started_at IS NOT NULL AND started_at >= min(?1, ?2)";

/// How many runs started today and this week.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunCounts {
    pub today: i64,
    pub week: i64,
}

impl Storage {
    /// Counts the runs that started at or after `today_start` and at or after `week_start` (UTC
    /// ISO 8601, the same form as `started_at`). The caller sets the boundaries.
    pub fn count_started_runs_since(
        &self,
        today_start: &str,
        week_start: &str,
    ) -> Result<RunCounts, StorageError> {
        let (today, week) =
            self.conn
                .query_row(COUNT_STARTED_SQL, params![today_start, week_start], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
                })?;
        Ok(RunCounts { today, week })
    }

    /// Writes a new run row in state waiting, with no start time. `now` is the queue time.
    pub fn enqueue_run(&self, task_type: &str, now: &str) -> Result<Run, StorageError> {
        self.add_at::<Run>(
            now,
            &RunInput {
                task_type: task_type.to_string(),
                state: RunState::Waiting,
                started_at: None,
                ended_at: None,
                duration_ms: None,
                outcome: None,
                error: None,
            },
        )
    }

    /// Moves a waiting run to running and sets its start time. A run that is not waiting is
    /// refused and left as it is.
    pub fn start_run(&self, id: &str, now: &str) -> Result<(), StorageError> {
        let changed = self.conn.execute(START_SQL, params![id, now])?;
        if changed == 0 {
            return Err(invalid(
                "The run is not waiting, so it cannot start.".to_string(),
            ));
        }
        Ok(())
    }

    /// Ends a waiting or running run: sets its end state, outcome, end time, the error text
    /// (failed only) and the duration (only when the run started). A run that already ended
    /// is refused and left as it is.
    pub fn finish_run(
        &self,
        id: &str,
        end: &RunEnd,
        duration_ms: Option<i64>,
        now: &str,
    ) -> Result<(), StorageError> {
        let error = match end {
            RunEnd::Failed(text) => Some(text.clone()),
            RunEnd::Done | RunEnd::Cancelled => None,
        };
        optional_text("error", &error)?;
        if duration_ms.is_some_and(|d| d < 0) {
            return Err(invalid("The duration cannot be negative.".to_string()));
        }
        let state = end.state();
        let outcome = state.outcome().map(|o| o.as_str());
        let changed = self.conn.execute(
            FINISH_SQL,
            params![id, now, state, outcome, error, duration_ms],
        )?;
        if changed == 0 {
            return Err(invalid(
                "The run is not waiting or running, so it cannot end.".to_string(),
            ));
        }
        Ok(())
    }

    /// Marks every run left in running or waiting as failed with the error "app closed". It
    /// runs when storage opens, before any queue exists, so only rows of a closed app match.
    /// The end time of such a row is the time of this call. Returns how many rows changed.
    pub fn fail_interrupted_runs(&self, now: &str) -> Result<usize, StorageError> {
        Ok(self
            .conn
            .execute(FAIL_INTERRUPTED_SQL, params![now, APP_CLOSED])?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::items::RunOutcome;
    use crate::storage::testing::{open_temp, TempDir};

    const T0: &str = "2026-01-01T00:00:00Z";
    const T1: &str = "2026-01-01T00:00:01Z";
    const T2: &str = "2026-01-01T00:00:03Z";

    #[test]
    fn count_started_runs_today_and_this_week_from_the_run_table() {
        let (mut s, _dir) = open_temp();
        let week = "2026-11-16T00:00:00Z";
        let today = "2026-11-23T00:00:00Z";
        let started = |s: &Storage, at: &str| {
            let id = s.enqueue_run("summary", at).unwrap().base.id;
            s.start_run(&id, at).unwrap();
            s.finish_run(&id, &RunEnd::Done, Some(1), at).unwrap();
            id
        };
        started(&s, "2026-11-15T23:59:59Z"); // last week
        started(&s, "2026-11-16T00:00:00Z"); // this week, at the boundary
        started(&s, "2026-11-20T10:00:00Z"); // this week
        started(&s, "2026-11-23T08:00:00Z"); // today
        let deleted = started(&s, "2026-11-23T09:00:00Z"); // today, then deleted
        s.delete_at::<Run>("2026-11-23T09:30:00Z", &deleted)
            .unwrap();
        // Waiting, and cancelled while waiting: they never started.
        s.enqueue_run("summary", "2026-11-23T10:00:00Z").unwrap();
        let cancelled = s
            .enqueue_run("summary", "2026-11-23T10:00:00Z")
            .unwrap()
            .base
            .id;
        s.finish_run(&cancelled, &RunEnd::Cancelled, None, "2026-11-23T10:01:00Z")
            .unwrap();
        let got = s.count_started_runs_since(today, week).unwrap();
        assert_eq!(got, RunCounts { today: 2, week: 4 });
        // The week holds today; with no runs both are 0.
        let (empty, _d) = open_temp();
        assert_eq!(
            empty.count_started_runs_since(today, week).unwrap(),
            RunCounts { today: 0, week: 0 }
        );
    }

    #[test]
    fn runs_enqueue_writes_one_waiting_row_without_start() {
        let (s, _dir) = open_temp();
        let run = s.enqueue_run("summary", T0).unwrap();
        let got: Run = s.get(&run.base.id).unwrap();
        assert_eq!(got.state, RunState::Waiting);
        assert_eq!(got.task_type, "summary");
        assert_eq!(got.base.created_at, T0);
        assert_eq!(
            (
                got.started_at,
                got.ended_at,
                got.duration_ms,
                got.outcome,
                got.error
            ),
            (None, None, None, None, None)
        );
        // A blank task type is refused and writes nothing.
        assert!(matches!(
            s.enqueue_run(" ", T0),
            Err(StorageError::Invalid(_))
        ));
    }

    #[test]
    fn runs_start_moves_waiting_to_running_and_refuses_others() {
        let (s, _dir) = open_temp();
        let id = s.enqueue_run("summary", T0).unwrap().base.id;
        s.start_run(&id, T1).unwrap();
        let got: Run = s.get(&id).unwrap();
        assert_eq!(got.state, RunState::Running);
        assert_eq!(got.started_at.as_deref(), Some(T1));
        assert_eq!(got.base.updated_at, T1);
        // A running run cannot start again, and an unknown id is refused.
        assert!(matches!(
            s.start_run(&id, T2),
            Err(StorageError::Invalid(_))
        ));
        assert!(matches!(
            s.start_run("no-such-run", T2),
            Err(StorageError::Invalid(_))
        ));
        let got: Run = s.get(&id).unwrap();
        assert_eq!(got.started_at.as_deref(), Some(T1));
    }

    #[test]
    fn runs_finish_sets_end_state_outcome_error_and_duration() {
        let (s, _dir) = open_temp();
        let cases = [
            (RunEnd::Done, RunState::Done, RunOutcome::Ok, None),
            (
                RunEnd::Failed("the AI run timed out".into()),
                RunState::Failed,
                RunOutcome::Failed,
                Some("the AI run timed out"),
            ),
            (
                RunEnd::Cancelled,
                RunState::Cancelled,
                RunOutcome::Cancelled,
                None,
            ),
        ];
        for (end, state, outcome, error) in cases {
            let id = s.enqueue_run("summary", T0).unwrap().base.id;
            s.start_run(&id, T1).unwrap();
            s.finish_run(&id, &end, Some(1500), T2).unwrap();
            let got: Run = s.get(&id).unwrap();
            assert_eq!(got.state, state);
            assert_eq!(got.outcome, Some(outcome));
            assert_eq!(got.error.as_deref(), error);
            assert_eq!(got.ended_at.as_deref(), Some(T2));
            assert_eq!(got.duration_ms, Some(1500));
            // An ended run cannot end again; the row stays as it was.
            assert!(matches!(
                s.finish_run(&id, &RunEnd::Done, Some(9), T2),
                Err(StorageError::Invalid(_))
            ));
            assert_eq!(s.get::<Run>(&id).unwrap(), got);
        }
        // A negative duration and an empty error text are refused.
        let id = s.enqueue_run("summary", T0).unwrap().base.id;
        assert!(s.finish_run(&id, &RunEnd::Done, Some(-1), T2).is_err());
        assert!(s
            .finish_run(&id, &RunEnd::Failed(String::new()), None, T2)
            .is_err());
        assert_eq!(s.get::<Run>(&id).unwrap().state, RunState::Waiting);
    }

    #[test]
    fn runs_finish_of_a_waiting_run_has_no_duration() {
        let (s, _dir) = open_temp();
        let id = s.enqueue_run("summary", T0).unwrap().base.id;
        s.finish_run(&id, &RunEnd::Cancelled, Some(10), T1).unwrap();
        let got: Run = s.get(&id).unwrap();
        assert_eq!(got.state, RunState::Cancelled);
        assert_eq!(got.outcome, Some(RunOutcome::Cancelled));
        assert_eq!(got.started_at, None);
        assert_eq!(got.duration_ms, None);
        assert_eq!(got.ended_at.as_deref(), Some(T1));
    }

    #[test]
    fn runs_fail_interrupted_turns_only_waiting_and_running_rows_into_failed() {
        let (s, _dir) = open_temp();
        let waiting = s.enqueue_run("a", T0).unwrap().base.id;
        let running = s.enqueue_run("b", T0).unwrap().base.id;
        s.start_run(&running, T1).unwrap();
        let done = s.enqueue_run("c", T0).unwrap().base.id;
        s.start_run(&done, T1).unwrap();
        s.finish_run(&done, &RunEnd::Done, Some(5), T1).unwrap();
        let before = s.get::<Run>(&done).unwrap();
        assert_eq!(s.fail_interrupted_runs(T2).unwrap(), 2);
        for id in [&waiting, &running] {
            let got: Run = s.get(id).unwrap();
            assert_eq!(got.state, RunState::Failed);
            assert_eq!(got.outcome, Some(RunOutcome::Failed));
            assert_eq!(got.error.as_deref(), Some(APP_CLOSED));
            assert_eq!(got.ended_at.as_deref(), Some(T2));
            assert_eq!(got.duration_ms, None);
        }
        assert_eq!(s.get::<Run>(&done).unwrap(), before);
        assert_eq!(s.fail_interrupted_runs(T2).unwrap(), 0);
    }

    #[test]
    fn queue_recovery_on_reopen_fails_running_and_waiting_rows() {
        let dir = TempDir::new();
        let path = dir.path().join("mnemo.db");
        let (waiting, running, done) = {
            let s = Storage::open(&path).unwrap();
            let waiting = s.enqueue_run("a", T0).unwrap().base.id;
            let running = s.enqueue_run("b", T0).unwrap().base.id;
            s.start_run(&running, T1).unwrap();
            let done = s.enqueue_run("c", T0).unwrap().base.id;
            s.start_run(&done, T1).unwrap();
            s.finish_run(&done, &RunEnd::Done, Some(5), T1).unwrap();
            (waiting, running, done)
        };
        let s = Storage::open(&path).unwrap();
        for id in [&waiting, &running] {
            let got: Run = s.get(id).unwrap();
            assert_eq!(got.state, RunState::Failed, "{id}");
            assert_eq!(got.outcome, Some(RunOutcome::Failed));
            assert_eq!(got.error.as_deref(), Some(APP_CLOSED));
            assert!(got.ended_at.is_some());
        }
        let left: i64 = s
            .conn
            .query_row(
                "SELECT count(*) FROM run WHERE state IN ('running', 'waiting')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(left, 0);
        let kept: Run = s.get(&done).unwrap();
        assert_eq!(
            (kept.state, kept.error, kept.ended_at.as_deref()),
            (RunState::Done, None, Some(T1))
        );
    }
}
