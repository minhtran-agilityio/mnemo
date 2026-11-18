-- Migration 2: the settings table, one row per setting key. Values are text; the
-- caller decides what a value means. updated_at is UTC ISO 8601, set by the core.
CREATE TABLE settings (
    key        TEXT PRIMARY KEY NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
