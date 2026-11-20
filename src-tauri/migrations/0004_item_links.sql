-- Migration 4: one shared, undirected link between two items of any type (#14).
-- The core stores each pair once, smaller (kind, id) first, and checks that both
-- ends exist. There is no foreign key because an end can be in any item table.
-- Deletes are soft; adding a removed link again clears deleted_at.
CREATE TABLE item_link (
    id         TEXT PRIMARY KEY NOT NULL,
    a_kind     TEXT NOT NULL CHECK (a_kind IN ('bookmark', 'note', 'idea', 'project', 'task', 'event', 'run', 'memory')),
    a_id       TEXT NOT NULL,
    b_kind     TEXT NOT NULL CHECK (b_kind IN ('bookmark', 'note', 'idea', 'project', 'task', 'event', 'run', 'memory')),
    b_id       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NULL,
    UNIQUE (a_kind, a_id, b_kind, b_id),
    CHECK (a_kind <> b_kind OR a_id <> b_id)
);
CREATE INDEX idx_item_link_a ON item_link (a_kind, a_id);
CREATE INDEX idx_item_link_b ON item_link (b_kind, b_id);
