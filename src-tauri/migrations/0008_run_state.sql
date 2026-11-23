-- Run states for the AI run queue (#22). SQLite cannot change a CHECK or make a column
-- NULL-able in place, so the run table is rebuilt: create the new table, copy every row,
-- drop the old one, rename. No column is renamed and outcome is kept.
--
-- state:      waiting (queued), running, done, failed or cancelled.
-- started_at: NULL while the run waits; created_at is the time it was queued.
-- ended_at:   set when the run reaches an end state (done, failed, cancelled).
-- outcome:    kept from version 7 and consistent with state (done=ok, failed, cancelled).
-- Old rows: ok->done, failed->failed, cancelled->cancelled. An old row with no outcome was
-- going when the app stopped; it becomes running, and the start of the app then marks it
-- failed with "app closed". ended_at of an old ended row is its last update time.
CREATE TABLE run_new (
    id          TEXT PRIMARY KEY NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT NULL,
    task_type   TEXT NOT NULL,
    state       TEXT NOT NULL CHECK (state IN ('waiting', 'running', 'done', 'failed', 'cancelled')),
    started_at  TEXT NULL,
    ended_at    TEXT NULL,
    duration_ms INTEGER NULL CHECK (duration_ms IS NULL OR duration_ms >= 0),
    outcome     TEXT NULL CHECK (outcome IS NULL OR outcome IN ('ok', 'failed', 'cancelled')),
    error       TEXT NULL
);

INSERT INTO run_new (id, created_at, updated_at, deleted_at, task_type, state, started_at,
                     ended_at, duration_ms, outcome, error)
SELECT id, created_at, updated_at, deleted_at, task_type,
       CASE outcome
           WHEN 'ok' THEN 'done'
           WHEN 'failed' THEN 'failed'
           WHEN 'cancelled' THEN 'cancelled'
           ELSE 'running'
       END,
       started_at,
       CASE WHEN outcome IS NULL THEN NULL ELSE updated_at END,
       duration_ms, outcome, error
FROM run;

DROP TABLE run;
ALTER TABLE run_new RENAME TO run;

CREATE INDEX idx_run_list ON run (deleted_at, created_at, id);
CREATE INDEX idx_run_state ON run (state);
