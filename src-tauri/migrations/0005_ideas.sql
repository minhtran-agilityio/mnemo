-- Migration 5: ideas with stages (#34). An idea gets a text, a source (a saved item
-- or a web link), a "why" line and an outline; its tags live in their own table.
-- All new columns are NULL for unknown, so every idea of version 4 is kept as it is.
-- The core checks the values and sets the stage from four plain checks (see ideas.rs).
ALTER TABLE idea ADD COLUMN body TEXT NULL;
-- A saved item as the source: its type and id. NULL when the source is a link or unknown.
ALTER TABLE idea ADD COLUMN source_kind TEXT NULL
    CHECK (source_kind IS NULL OR source_kind IN ('bookmark', 'note'));
ALTER TABLE idea ADD COLUMN source_id TEXT NULL;
-- A web link as the source. NULL when the source is a saved item or unknown.
ALTER TABLE idea ADD COLUMN source_url TEXT NULL;
ALTER TABLE idea ADD COLUMN why TEXT NULL;
-- The outline is plain text, one point per line.
ALTER TABLE idea ADD COLUMN outline TEXT NULL;

-- One row per tag of an idea. Removing a tag is a soft delete; adding it again brings
-- the same row back. #31 unifies tags across item types later.
CREATE TABLE idea_tag (
    id         TEXT PRIMARY KEY NOT NULL,
    idea_id    TEXT NOT NULL REFERENCES idea (id),
    tag        TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL,
    UNIQUE (idea_id, tag)
);
CREATE INDEX idx_idea_tag_tag ON idea_tag (tag, deleted_at);
