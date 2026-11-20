# How Mnemo shares the database between writers (DATA-01, #15)

1. The window and each background job open their own connection to the one SQLite file. There is no single writer queue.
2. The file is in WAL mode, so a reader never blocks a writer and a writer never blocks a reader.
3. Writers take turns. A writer that finds the file locked waits up to 5 seconds, so a short lock does not fail the save.
4. A write that changes more than one row starts as `BEGIN IMMEDIATE`: it takes its turn first and then does all its work, so it cannot fail half way with "database is locked".
5. `src-tauri/src/storage/concurrency.rs` proves it: two writers save 100 records each, on one table and on two tables, and a reader runs while a record is updated. Nothing is lost and no save fails. It runs in `npm test`. Two separate app processes on one file are out of scope (one copy of the app only, #9).
