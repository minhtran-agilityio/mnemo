-- Migration 5: one row per image or attached file kept in the files folder beside the database (#16).
-- The row holds the original name for display and the name the file has on disk (a UUID plus
-- an optional extension). Only the core builds a path from stored_name; no path is stored.
-- Deletes are soft: the file on disk stays until the owner removes it.
CREATE TABLE file (
    id            TEXT PRIMARY KEY NOT NULL,
    original_name TEXT NOT NULL,
    stored_name   TEXT NOT NULL UNIQUE,
    size_bytes    INTEGER NOT NULL CHECK (size_bytes >= 0),
    mime          TEXT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    deleted_at    TEXT NULL
);
