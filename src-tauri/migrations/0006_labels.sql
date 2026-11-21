-- Migration 6: nested labels for notes (#33). A label has one optional parent label
-- (NULL for a top label). A note carries one or more labels through note_label.
-- Base fields as in migration 3: UUID text id, created_at and updated_at (UTC ISO 8601,
-- set by the core) and the soft-delete mark deleted_at (NULL while live).
-- The REFERENCES clauses document intent only; the core checks that both ends are live.

CREATE TABLE label (
    id         TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL,
    name       TEXT NOT NULL,
    parent_id  TEXT NULL REFERENCES label (id)
);
-- A live name is unique per parent, ignoring case. SQLite treats NULLs as distinct in a
-- UNIQUE index, so top labels (parent_id NULL) get their own index.
CREATE UNIQUE INDEX uq_label_child ON label (parent_id, name COLLATE NOCASE)
    WHERE deleted_at IS NULL AND parent_id IS NOT NULL;
CREATE UNIQUE INDEX uq_label_top ON label (name COLLATE NOCASE)
    WHERE deleted_at IS NULL AND parent_id IS NULL;
CREATE INDEX idx_label_parent ON label (parent_id);

-- Removing a label from a note is a soft delete; adding it again clears deleted_at.
CREATE TABLE note_label (
    id         TEXT PRIMARY KEY NOT NULL,
    note_id    TEXT NOT NULL REFERENCES note (id),
    label_id   TEXT NOT NULL REFERENCES label (id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL,
    UNIQUE (note_id, label_id)
);
CREATE INDEX idx_note_label_label ON note_label (label_id);
CREATE INDEX idx_note_label_note ON note_label (note_id);

-- Serves the note list ordered by last change, newest first.
CREATE INDEX idx_note_changed ON note (deleted_at, updated_at, id);
