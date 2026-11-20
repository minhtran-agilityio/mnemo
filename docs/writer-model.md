# How Mnemo shares the database between writers (DATA-01, #15)

1. The window and each background job open their own connection to the one SQLite file. There is no single writer queue.
2. The file is in WAL mode, so a reader never blocks a writer and a writer never blocks a reader.
3. Writers take turns. A writer that finds the file locked waits up to 5 seconds, so a short lock does not fail the save. `synchronous` is NORMAL, so a commit does not wait for the disk on every write and the lock is held for a short time.
4. A write that changes more than one row starts as `BEGIN IMMEDIATE`: it takes its turn first and then does all its work, so it cannot fail half way with "database is locked".
5. `src-tauri/src/storage/concurrency.rs` proves it on the connection `Storage::open` returns, with no setting changed: two writers save 100 records each, on one table and on two tables, and a reader runs while a record is updated. Nothing is lost and no save fails. It runs in `npm test`. It does not cover a disk that stalls a commit for more than 5 seconds, and it does not cover two app processes on one file (one copy of the app only, #9).
