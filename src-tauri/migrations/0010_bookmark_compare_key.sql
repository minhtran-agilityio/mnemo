-- Migration 10: the duplicate check when saving a link (#28, LIB-02).
--
-- bookmark.compare_key: the link as a plain-code rule compares it (see storage/link_key.rs): the
--     scheme, the host in lower case without "www.", a trailing dot or a default port, the path
--     with its letter case and no trailing slash, the query without utm_*, fbclid and gclid, and
--     no fragment. NULL until the Rust step at open fills it (rows saved before this migration),
--     and NULL for a link that cannot be parsed.
-- idx_bookmark_compare_key: not unique, so old duplicates stay as they are, and partial, so a
--     soft-deleted bookmark never blocks a new save of the same link. One indexed query finds the
--     live bookmark of a link.
-- No column is renamed.
ALTER TABLE bookmark ADD COLUMN compare_key TEXT NULL;
CREATE INDEX idx_bookmark_compare_key ON bookmark (compare_key) WHERE deleted_at IS NULL;
