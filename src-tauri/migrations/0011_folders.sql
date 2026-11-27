-- Migration 11: folders for bookmarks (#26, BM-02).
--
-- folder:  a flat list of folders, with a UUID id, soft delete (deleted_at) and the two times of every
--     record. The fixed default folder "Unsorted" is the row with is_default = 1 and the fixed id
--     below; the core refuses to rename or delete it. A name is unique among the live folders,
--     ignoring case (the partial unique index), and "Unsorted" is taken by the default row.
-- bookmark.folder_id:       the folder the bookmark is in. NOT NULL with Unsorted as the default, so a row
--     written by any older path (the generic bookmark add, a save before the AI answers) is in Unsorted.
--     No REFERENCES clause (SQLite refuses one on an added column with a default): the core checks that
--     the folder is live.
-- bookmark.folder_reason:   why the app chose the folder, NULL when the app did not choose it.
-- bookmark.folder_is_guess: 1 when the app chose the folder (shown as a guess); 0 for Unsorted by default
--     and for a folder the owner picked (a move clears the reason and the flag).
-- Old rows: every old bookmark, deleted ones too, is in Unsorted. No column is renamed.
CREATE TABLE folder (
    id         TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL,
    name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1))
);
CREATE UNIQUE INDEX idx_folder_name ON folder (name COLLATE NOCASE) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_folder_default ON folder (is_default) WHERE is_default = 1;

INSERT INTO folder (id, created_at, updated_at, deleted_at, name, is_default)
VALUES ('00000000-0000-4000-8000-000000000001', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 'Unsorted', 1);

ALTER TABLE bookmark ADD COLUMN folder_id TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';
ALTER TABLE bookmark ADD COLUMN folder_reason TEXT NULL;
ALTER TABLE bookmark ADD COLUMN folder_is_guess INTEGER NOT NULL DEFAULT 0 CHECK (folder_is_guess IN (0, 1));
CREATE INDEX idx_bookmark_folder ON bookmark (folder_id) WHERE deleted_at IS NULL;
