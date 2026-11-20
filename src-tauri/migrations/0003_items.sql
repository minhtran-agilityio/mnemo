-- Migration 3: one table per item type (#14). Every table has the shared base:
-- a UUID text id, created_at and updated_at (UTC ISO 8601, set by the core) and a
-- soft-delete mark deleted_at (NULL while the item is live). NULL means unknown.
-- Each table starts with only the fields its roadmap feature names; later features
-- add columns with new migrations. The list index serves "live rows, newest first".

CREATE TABLE bookmark (
    id              TEXT PRIMARY KEY NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT NULL,
    url             TEXT NOT NULL,
    title           TEXT NULL,
    -- NULL when the page could not be read (honest failure).
    summary         TEXT NULL,
    reason          TEXT NULL,
    -- 1 when the app wrote the reason: it is shown as a guess.
    reason_is_guess INTEGER NOT NULL DEFAULT 0 CHECK (reason_is_guess IN (0, 1))
);
CREATE INDEX idx_bookmark_list ON bookmark (deleted_at, created_at, id);

-- body is Markdown.
CREATE TABLE note (
    id         TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL,
    body       TEXT NOT NULL
);
CREATE INDEX idx_note_list ON note (deleted_at, created_at, id);

CREATE TABLE idea (
    id         TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL,
    title      TEXT NOT NULL,
    stage      TEXT NOT NULL DEFAULT 'spark'
               CHECK (stage IN ('spark', 'shape', 'ready', 'project'))
);
CREATE INDEX idx_idea_list ON idea (deleted_at, created_at, id);

-- status is free text (1 to 40 characters, checked by the core) until PROJ-01 names its values.
CREATE TABLE project (
    id         TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL,
    title      TEXT NOT NULL,
    status     TEXT NOT NULL
);
CREATE INDEX idx_project_list ON project (deleted_at, created_at, id);

-- A task is done when done_at is set.
CREATE TABLE task (
    id         TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL,
    title      TEXT NOT NULL,
    done_at    TEXT NULL
);
CREATE INDEX idx_task_list ON task (deleted_at, created_at, id);

-- starts_at and ends_at are UTC ISO 8601; the core checks ends_at >= starts_at.
CREATE TABLE event (
    id         TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL,
    title      TEXT NOT NULL,
    starts_at  TEXT NOT NULL,
    ends_at    TEXT NOT NULL
);
CREATE INDEX idx_event_list ON event (deleted_at, created_at, id);

-- One row per AI run. outcome is NULL while the run is going. No token fields, ever.
CREATE TABLE run (
    id          TEXT PRIMARY KEY NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT NULL,
    task_type   TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    duration_ms INTEGER NULL CHECK (duration_ms IS NULL OR duration_ms >= 0),
    outcome     TEXT NULL CHECK (outcome IS NULL OR outcome IN ('ok', 'failed', 'cancelled')),
    error       TEXT NULL
);
CREATE INDEX idx_run_list ON run (deleted_at, created_at, id);

-- Memory (first used by AGT-03): the base fields plus one text body (owner-confirmed).
CREATE TABLE memory (
    id         TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL,
    body       TEXT NOT NULL
);
CREATE INDEX idx_memory_list ON memory (deleted_at, created_at, id);
