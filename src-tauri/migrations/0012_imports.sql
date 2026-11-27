-- Migration 12: import old links from a file (#29, LIB-03). Additive only.
--
-- import_run: one import of one file. Its state survives a restart: an import left running by an
--     app that closed opens as paused (paused_by 'closed'); the owner's Pause sets 'owner'.
--     stopped: the owner pressed "Stop here" and the import ended early; a new import may start.
--     file_name is the base name of the file only, never its path. The counts are the ones the
--     import found when it started: entries read, links added, repeats inside the file, links
--     already saved, and entries that are not links. Done, waiting and failed are counted from
--     import_item, so they cannot drift.
-- import_item: one added link whose summary the import makes as background work, in file order.
--     waiting: no summary yet (also while AI is off or at the limit); done: summary stored;
--     failed: the AI run failed or the page could not be read; removed: the owner deleted the
--     bookmark during the import; stopped: the import was stopped first, so the link stays link
--     only ("Summarize later" on its card).
CREATE TABLE import_run (
    id TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL,
    file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
    state TEXT NOT NULL CHECK (state IN ('running', 'paused', 'finished', 'stopped')),
    paused_by TEXT NULL CHECK (paused_by IN ('owner', 'closed')),
    with_summaries INTEGER NOT NULL CHECK (with_summaries IN (0, 1)),
    found INTEGER NOT NULL CHECK (found >= 0),
    added INTEGER NOT NULL CHECK (added >= 0),
    repeats_in_file INTEGER NOT NULL CHECK (repeats_in_file >= 0),
    already_saved INTEGER NOT NULL CHECK (already_saved >= 0),
    not_links INTEGER NOT NULL CHECK (not_links >= 0),
    CHECK ((state = 'paused') = (paused_by IS NOT NULL))
);
CREATE INDEX idx_import_run_latest ON import_run (created_at) WHERE deleted_at IS NULL;

CREATE TABLE import_item (
    id TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL,
    import_id TEXT NOT NULL REFERENCES import_run (id),
    bookmark_id TEXT NOT NULL REFERENCES bookmark (id),
    position INTEGER NOT NULL CHECK (position >= 0),
    state TEXT NOT NULL CHECK (state IN ('waiting', 'done', 'failed', 'removed', 'stopped')),
    UNIQUE (import_id, position)
);
CREATE INDEX idx_import_item_state ON import_item (import_id, state, position);
