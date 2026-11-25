-- Migration 9: save a link with summary and tags (#25, BM-01).
--
-- bookmark.site:           the host of the link (for example "example.org"), NULL when unknown.
-- bookmark.summary_status: where the summary stands.
--     pending    stored, no summary yet (the save is starting, or the AI run gave no answer)
--     reading    Mnemo is reading the page or waiting on the AI run
--     unreadable the page could not be read: link only, summary NULL
--     ai_off     AI was off, paused or at the limit: link only, summary later
--     done       the summary, the tags and the reason are stored
-- Old rows: done when they have a summary, else pending (never read, so "no summary yet").
-- No column is renamed.
ALTER TABLE bookmark ADD COLUMN site TEXT NULL;
ALTER TABLE bookmark ADD COLUMN summary_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (summary_status IN ('pending', 'reading', 'unreadable', 'ai_off', 'done'));
UPDATE bookmark SET summary_status = CASE WHEN summary IS NULL THEN 'pending' ELSE 'done' END;

-- Tags of a bookmark, shaped like note_label (migration 6). A tag is a top label
-- (label.parent_id NULL). Removing a tag is a soft delete; adding it again clears deleted_at.
-- The REFERENCES clauses document intent only; the core checks that both ends are live.
CREATE TABLE bookmark_label (
    id          TEXT PRIMARY KEY NOT NULL,
    bookmark_id TEXT NOT NULL REFERENCES bookmark (id),
    label_id    TEXT NOT NULL REFERENCES label (id),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT NULL,
    UNIQUE (bookmark_id, label_id)
);
CREATE INDEX idx_bookmark_label_label ON bookmark_label (label_id);
CREATE INDEX idx_bookmark_label_bookmark ON bookmark_label (bookmark_id);
