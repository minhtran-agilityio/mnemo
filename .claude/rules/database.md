---
paths:
  - "src-tauri/src/storage/**"
  - "src-tauri/migrations/**"
  - "**/*.sql"
---

# Data and storage rules (SQLite)

All data lives in one SQLite file on the owner's machine. Images and attachments are plain files in a folder next to it.

## Access
- Only the `storage` module opens the database or the attachments folder. The UI, `ai`, `scheduler` and `system` call its public functions.
- `storage` exposes a small, named set of functions per item type (add, get, list, update, delete, search). Callers never build SQL or file paths.
- The SQLite library and schema are details of `storage`. Changing them must not change any caller.

## Engine settings
- Enable WAL mode and a busy timeout at open, so the window and background jobs can write at the same time.
- Writes that change more than one row run in one transaction.
- Required test: 100 concurrent saves lose no record.
- On a corrupt or unreadable file, stop with a clear error. Never replace it with an empty database.

## Records (ready for sync later)
- Every item has a UUID primary key, never an auto-increment ID. IDs are never reused.
- Every item has `created_at` and `updated_at`, UTC ISO 8601, set by the core, never by the UI.
- Deletes are soft: set `deleted_at`. Normal queries exclude deleted rows.
- Use `NULL` for unknown, distinct from an empty string or zero. A failed AI summary is stored empty with the error recorded in `run`, never with invented text.
- Validate every record before writing; never write a partially valid one.
- Notes are Markdown stored in SQLite. Images and files are stored on disk; the database holds only their relative path.

## Search
- Full-text search uses SQLite FTS5 (Everything, Ask Mnemo). Keep FTS tables in sync in the same transaction as the source row.
- No embeddings and no vector store. Search and the graph use plain code rules.

## Schema changes
- Every change is a numbered migration that runs automatically when the app opens, inside a transaction, and records the schema version.
- Never edit a migration that has shipped; add a new one. Additive changes first, removals later; never rename a column in one step.
- Each migration has a test that runs it on a database built by the previous version.
- Installing a newer app over an older one keeps all data.

## Queries
- Parameterised queries only. Never build SQL with string formatting.
- Add an index for every column used in a frequent filter or lookup.
- List functions paginate; never load an unbounded table into one command response.

## Export and backup
- Export writes every item type to plain files (Markdown and JSON) in a folder the owner chooses. Backup is copying the data folder.
- Never put the SQLite file in Dropbox or another sync folder. There is no sync in version 1.
- User data and test databases with real content stay out of git.
