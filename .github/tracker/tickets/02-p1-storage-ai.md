=== ISSUE DATA-01a
title: [DATA-01] Storage module: one SQLite file, WAL mode and migrations
type: Feature
labels: priority:critical, area:data
milestone: P1.3 Storage
---
**Phase:** P1 · **Roadmap status:** not started · **Size:** M (guess) · **Blocked by:** {{SETUP-01}}

## Goal
One safe place for all data. Only one module opens the database, so there is one place to test well.

## Proposed change
- The `storage` module in the Rust core opens one SQLite file in the Mnemo data folder, in WAL mode. WAL is a write mode that lets a reader and a writer work at the same time.
- A migration runner: each change to the tables is a numbered migration file. Migrations run by themselves when the app starts. The current number is stored in the database.
- A shared base for every record: a UUID as the ID (not a growing number), a created time, a last-changed time, and a soft-delete mark. These fields make sync possible later.
- A rule that only `storage` may use the SQLite library. Enforce it with a test or a lint check on imports.
- The database file is created on first start. A file that cannot be opened gives a plain error screen and does not delete anything.

## Acceptance criteria
- [ ] First start creates the database with WAL mode on. A test reads the mode back.
- [ ] A new migration added to the folder runs once on the next start and never again. A test proves it.
- [ ] A failed migration leaves the database as it was before (it runs in a transaction) and reports the error.
- [ ] The check fails if code outside `storage` imports the SQLite library.
- [ ] Tests run on a temporary database file, never on the real data folder.

## Out of scope
- Tables for each item type ({{DATA-01b}}).
- Word search tables (FTS5). They come with {{LIB-01}}.
- Sync between machines. Not in version 1.
- Encryption of the database.

## Evidence and links
- Roadmap, DATA-01 and DEC-03: {{ROADMAP}}
- Architecture, "DEC-03: lưu trữ": {{ARCH}}
- Warning from the architecture: do not put the SQLite file in Dropbox or another synced folder. Say this in the README.

=== ISSUE DATA-01b
title: [DATA-01] Tables and add, read, list, update, delete for each item type
type: Feature
labels: priority:critical, area:data
milestone: P1.3 Storage
---
**Phase:** P1 · **Roadmap status:** not started · **Size:** L (guess) · **Blocked by:** {{DATA-01a}}

## Goal
Each item type has the same five actions with tests, so feature tickets in P2 to P4 only add screens and rules, not storage plumbing.

## Proposed change
- Migrations and storage functions for the item types the roadmap lists: bookmarks, notes, ideas, projects, tasks, events, runs and memory.
- For each type: add, read one, list, update, delete. Delete is a soft delete. List never returns deleted records unless asked.
- Start each table with the fields its roadmap feature names. Later feature tickets add fields with new migrations. Do not guess fields for screens that are not built yet.
- A shared way to link two items of any type (for example a bookmark used in a project), because ideas, projects and Today all link items.
- Tauri commands that expose the five actions to the UI, one set per type.

## Acceptance criteria
- [ ] Each of the 8 types has a test for add, read, list, update and delete.
- [ ] Update changes the last-changed time. Delete sets the soft-delete mark and keeps the row.
- [ ] IDs are UUIDs. A test creates 1,000 records and finds no repeated ID.
- [ ] A link between two items can be added, listed from both sides and removed.
- [ ] The UI can call each action through a command. One UI test covers one type end to end with a temporary database.

## Out of scope
- Screens.
- Folders, labels, kanban cards and goals. Their tables come with their own features ({{BM-02}}, {{NOTE-01}}, {{PROJ-02}}, {{DAY-04}}).
- Search ({{LIB-01}}) and the graph (KNOW-02).

## Evidence and links
- Roadmap, DATA-01 (acceptance: "Each item type has add, read, list, update and delete"): {{ROADMAP}}
- Architecture, "Quy tắc code và test", rule 2: {{ARCH}}
- Note: "memory" is first used in P5 (AGT-03). It is in this ticket because the roadmap lists it. If its fields are unclear now, create only the base fields and say so in the pull request.

=== ISSUE DATA-01c
title: [DATA-01] Two-writer safety test: 100 parallel saves lose nothing
type: Feature
labels: priority:high, area:data
milestone: P1.3 Storage
---
**Phase:** P1 · **Roadmap status:** not started · **Size:** S (guess) · **Blocked by:** {{DATA-01b}}

## Goal
Prove that the window and a background job can write at the same time with no lost record. This is an exit check for Phase 1.

## Proposed change
- Decide and document how the core shares the database between writers (for example one writer connection with a queue, plus reader connections). Set a busy timeout so a short lock waits and does not fail.
- A test with two writers that each do 100 saves at the same time, on the same table and on different tables.
- A test where one writer updates a record while another reads the list.
- The test is part of the normal `check` command and runs in CI on both systems.

## Acceptance criteria
- [ ] After two writers do 100 parallel saves each, the table holds exactly 200 records with the right content.
- [ ] No write returns a "database is locked" error to the caller.
- [ ] The test passes 20 times in a row on Mac and on Ubuntu. Paste the loop result in the pull request.
- [ ] `docs/` has five lines that explain the writer model in plain words.

## Out of scope
- Two separate app processes on one database. {{APP-01}} allows one copy of the app only.
- Speed tuning.

## Evidence and links
- Roadmap, P1 exit ("100 parallel writes lose nothing") and DATA-01: {{ROADMAP}}
- Architecture, "DEC-03" (two writers at once): {{ARCH}}

=== ISSUE DATA-01d
title: [DATA-01] Image and attachment files beside the database
type: Feature
labels: priority:medium, area:data
milestone: P1.3 Storage
---
**Phase:** P1 · **Roadmap status:** not started · **Size:** S (guess) · **Blocked by:** {{DATA-01a}}

## Goal
Images and attached files are plain files in one folder beside the database. The database keeps only the path. Project pages and card details need this in P3.

## Proposed change
- A files folder inside the Mnemo data folder.
- Storage functions: save a file (copy it in under a new UUID name, keep the original name in the database), read it, soft-delete it.
- A size limit per file, with a plain message when a file is too large. Start with 20 MB and make it a setting.
- A Tauri command that gives the UI a safe way to show an image from the folder.
- A clean-up function that lists files with no database row. It only reports. It deletes nothing by itself.

## Acceptance criteria
- [ ] A saved image can be read back and is byte-for-byte the same.
- [ ] Two files with the same original name do not overwrite each other.
- [ ] A file over the limit is refused with a plain message.
- [ ] The UI cannot read a file outside the files folder through the command (test with a `../` path).
- [ ] The clean-up report lists a planted orphan file and deletes nothing.

## Out of scope
- PDF reading and video (LATER-01, LATER-02).
- Thumbnails.

## Evidence and links
- Roadmap, DATA-01 ("Images are files beside it"): {{ROADMAP}}
- Architecture, "DEC-03" (images and attachments): {{ARCH}}
- The 20 MB limit is a guess by the author of this ticket, not a decision of the owner.

=== ISSUE DATA-02
title: [DATA-02] Export, backup and reset
type: Feature
labels: priority:medium, area:data
milestone: P1.3 Storage
---
**Phase:** P1 · **Roadmap status:** partly prototyped (v36, reset only) · **Size:** S (guess) · **Blocked by:** {{DATA-01b}}, {{APP-03b}}

## Goal
The owner can always take the data out as plain files, copy it as a backup, and start again from empty, without losing anything by accident.

## Proposed change
- A "Data" section in Settings with three actions: Export, Open data folder, Reset.
- Export writes every item type to a folder the owner picks: Markdown for notes, JSON for the other types, and a copy of the files folder.
- Backup is documented as one copy command for the data folder, shown in the Data section. The app must be closed first, or the copy must use the SQLite backup function.
- Reset asks first, with a plain sentence that says what will be deleted, and asks the owner to type a word to confirm.

## Acceptance criteria
- [ ] Export writes every item type. A test compares the count of records in the database with the count in the export.
- [ ] Soft-deleted records are not exported.
- [ ] Reset does nothing until the owner confirms. Cancel leaves all data in place.
- [ ] After Reset, the app starts like a first start.
- [ ] A backup copy put back in place opens with all data. The steps are written in the README.

## Out of scope
- Import from an export.
- Scheduled backups.
- Sync.

## Evidence and links
- Roadmap, DATA-02: {{ROADMAP}}
- Architecture, "DEC-03" (export to Markdown and JSON, backup is a folder copy): {{ARCH}}

=== ISSUE AI-01a
title: [AI-01] Find Claude Code and check it at start
type: Feature
labels: priority:high, area:ai
milestone: P1.4 AI runner
---
**Phase:** P1 · **Roadmap status:** prototyped (v66, v103) · **Size:** S (guess) · **Blocked by:** {{SETUP-01}}

## Goal
Mnemo knows at start whether AI can run, and tells the owner in plain words how to fix it when it cannot. Saving and reading still work either way.

## Proposed change
- At start, the `ai` module looks for the `claude` program (on the PATH and in the usual install places on macOS and Linux).
- It runs one cheap check: the program exists, its version, and whether it is signed in.
- The result is one of: Ready, Not installed, Not signed in, Version problem. It is kept in memory and shown in Settings, in the AI section, with a "Check again" button.
- For each state that is not Ready, a plain message says what to do (for example "Open a terminal and run `claude`, then sign in").
- Mnemo never opens a Claude sign-in screen and never reads the token file.

## Acceptance criteria
- [ ] With Claude Code installed and signed in, the state is Ready on Mac and on Ubuntu.
- [ ] With `claude` removed from the PATH, the state is Not installed and the message says how to install it.
- [ ] With Claude Code signed out, the state is Not signed in. Unverified: how to detect this without a paid run. Use the result of {{SPIKE-02}}.
- [ ] In every state the app opens and all screens that do not need AI work.
- [ ] No token and no account email is written to the log or the database.

## Out of scope
- Installing Claude Code for the owner.
- Running real tasks ({{AI-01b}}).
- API key mode (LAST-01).

## Evidence and links
- Roadmap, AI-01: {{ROADMAP}}
- Architecture, "DEC-04", the paragraph on `--bare` and the check at start: {{ARCH}}
- Risk from the architecture: a future Claude Code version may make bare mode the default for `-p`. The version check exists to catch this.

=== ISSUE AI-01b
title: [AI-01] Run contract: one claude -p process per task with JSON output
type: Feature
labels: priority:critical, area:ai
milestone: P1.4 AI runner
---
**Phase:** P1 · **Roadmap status:** prototyped (v66, v103) · **Size:** M (guess) · **Blocked by:** {{AI-01a}}, {{SPIKE-02}}

## Goal
One function in the core runs one AI task and returns either valid data or a clear error. Every AI feature uses it and nothing else calls Claude.

## Proposed change
- A function `run_task(task)` in the `ai` module. A task has: a name, a prompt, an optional JSON schema, a list of allowed tools, a model, an effort level, a turn limit and a timeout.
- It starts `claude -p` as its own process with `--output-format json` and `--json-schema`, and reads the `structured_output` field.
- It passes `--allowedTools` for this task and `--permission-mode dontAsk`, so a tool outside the list is refused with no question.
- It removes `ANTHROPIC_API_KEY` from the environment of the process, so the subscription is used and the API key is never billed by mistake.
- It never uses `--bare`.
- Failure is any of: exit code not 0, no `structured_output`, output that does not match the schema, timeout. Each gives a typed error with a plain reason. A failed run never returns made-up content.
- A second mode with `--output-format stream-json` for text that appears bit by bit. Ask Mnemo uses it later.
- A hidden developer command or a button in Settings sends a test prompt and shows the result.

## Acceptance criteria
- [ ] A test prompt returns an answer on macOS and on Ubuntu.
- [ ] A task with a schema returns JSON that matches the schema, or a clear error. Never free text.
- [ ] With `ANTHROPIC_API_KEY` set in the shell that starts Mnemo, the child process does not have it. A test checks the environment that is passed.
- [ ] A task that passes its timeout is stopped, the process is gone, and the caller gets a timeout error.
- [ ] A tool that is not in the allowed list is refused. Show one run as proof.
- [ ] No token appears in logs or data files.
- [ ] All unit tests use the fake runner ({{AI-01d}}). None calls the real Claude.

## Out of scope
- The queue and the run table ({{AI-01e}}).
- Mnemo's own config files ({{AI-01c}}).
- Any feature prompt (save a link, Ask Mnemo).
- Usage percent ({{AI-02}}).

## Evidence and links
- Roadmap, AI-01 and DEC-04: {{ROADMAP}}
- Architecture, "DEC-04", table "Hợp đồng cho một lần chạy": {{ARCH}}
- Claude Code docs, headless mode: https://code.claude.com/docs/en/headless
- Claude Code docs, authentication (API key takes priority when set): https://code.claude.com/docs/en/authentication
- Check every flag against `claude --help` on the installed version before you rely on it.

=== ISSUE AI-01c
title: [AI-01] Mnemo's own Claude config in ~/.config/mnemo
type: Feature
labels: priority:high, area:ai
milestone: P1.4 AI runner
---
**Phase:** P1 · **Roadmap status:** prototyped (v66, v103) · **Size:** M (guess) · **Blocked by:** {{AI-01b}}, {{SPIKE-02}}

## Goal
Mnemo shares the owner's Claude Code login but not the owner's personal settings, connectors or CLAUDE.md. A run inside Mnemo must behave the same no matter what the owner changes in their own Claude Code.

## Proposed change
- Mnemo keeps its own files in `~/.config/mnemo/`: a settings file, a connector (MCP) list and the allowed tools per feature. They are created with safe defaults on first start.
- Each run passes `--strict-mcp-config` with `--mcp-config`, `--settings` and `--setting-sources`, so only Mnemo's files are used.
- Each run uses Mnemo's own working folder, not a project folder of the owner.
- The connector list starts empty. Filling it is the job of {{CON-01}}.

## Acceptance criteria
- [ ] First start creates the config files. A second start does not overwrite the owner's changes to them.
- [ ] A strange rule in the owner's personal `CLAUDE.md` does not change the answer of a Mnemo run. This repeats test 3 of {{SPIKE-02}} inside the app.
- [ ] A connector that exists only in the owner's Claude Code is not offered to a Mnemo run.
- [ ] The run's working folder is inside Mnemo's folders.
- [ ] The config files hold no token.

## Out of scope
- The Settings button "Take from Claude Code" that copies the connector list ({{CON-01}}).
- MCP settings per feature (CON-02, P5).
- The other option, a separate `CLAUDE_CONFIG_DIR`. Use it only if {{SPIKE-02}} shows that the personal `CLAUDE.md` cannot be blocked. That is the owner's decision and a new ticket.

## Evidence and links
- Architecture, "Cấu hình riêng của Mnemo" (option B, agreed by the owner on 2026-11-18): {{ARCH}}
- Claude Code docs, CLI reference: https://code.claude.com/docs/en/cli-reference
- Unverified until {{SPIKE-02}}: `--setting-sources` skips the personal CLAUDE.md. The docs only talk about settings files.

=== ISSUE AI-01d
title: [AI-01] Fake AI runner for tests
type: Feature
labels: priority:high, area:ai
milestone: P1.4 AI runner
---
**Phase:** P1 · **Roadmap status:** not started · **Size:** S (guess) · **Blocked by:** nothing (build it together with {{AI-01b}})

## Goal
Tests never call the real Claude. They are fast, free and give the same result every time, also in CI where no Claude login exists.

## Proposed change
- The runner is an interface with two versions: the real one ({{AI-01b}}) and a fake one.
- The fake returns fixed results that a test sets up: a valid result, a schema mismatch, an exit error, a timeout, a "usage limit reached" error.
- The fake records what it was asked (prompt, schema, tools, model), so a test can check the request.
- A switch (an environment variable) starts the whole app with the fake runner, for manual UI testing with no usage cost.

## Acceptance criteria
- [ ] No test in `check` starts a real `claude` process. A test fails if the real runner is used during a test run.
- [ ] Each of the 5 fixed results can be produced by the fake.
- [ ] A sample feature test shows the pattern: set a fake result, call the feature, check what was saved.
- [ ] The app starts with the fake runner on Mac and on Ubuntu, and Settings shows clearly that AI is fake.

## Out of scope
- Scoring real AI quality. That is the eval harness ({{BM-04}}).
- Recording and replaying real Claude answers.

## Evidence and links
- Architecture, "Quy tắc code và test", rule 4 ("AI có bản giả để test"): {{ARCH}}

=== ISSUE AI-01e
title: [AI-01] Run queue (2 at once, owner first) and the run table
type: Feature
labels: priority:high, area:ai
milestone: P1.4 AI runner
---
**Phase:** P1 · **Roadmap status:** prototyped (v66, v103) · **Size:** M (guess) · **Blocked by:** {{AI-01b}}, {{AI-01d}}, {{DATA-01b}}

## Goal
AI work never starts more than two processes at once, the owner's own actions go first, and every run leaves a record. Phase 5 reuses this queue and table and does not rewrite them.

## Proposed change
- A queue in the core. At most 2 runs at the same time. The limit is one constant.
- Two priorities: actions the owner started go before background work.
- Each run is written to the `run` table: task name, start and end time, state (Waiting, Running, Done, Failed, Cancelled), error text. No prompt content with private data and no token.
- A waiting or running run can be cancelled. Cancel stops the process.
- When the app starts, runs left in Running from a crash are marked Failed with the reason "app closed".
- An event to the UI when a run changes state.

## Acceptance criteria
- [ ] With 5 tasks queued, never more than 2 run at once. A test with the fake runner proves it.
- [ ] An owner task added behind 3 waiting background tasks starts before them.
- [ ] Each run has one row with the right end state. A failed run has its error text.
- [ ] Cancel of a running task ends its process within 2 seconds.
- [ ] After a forced kill of the app, the next start leaves no row in Running.

## Out of scope
- The Background runs screen, schedules, retry and the daily limit (AGT-01, P5).
- Pausing at the usage limit ({{AI-02}}).

## Evidence and links
- Architecture, "DEC-04" (queue of 2) and "Job nền" (the P1 table and queue are reused in P5): {{ARCH}}
- Roadmap, AI-01: {{ROADMAP}}

=== ISSUE AI-02
title: [AI-02] AI control: master switch, usage and pause
type: Feature
labels: priority:high, area:ai
milestone: P1.4 AI runner
---
**Phase:** P1 · **Roadmap status:** prototyped (v60, v103) · **Size:** M (guess) · **Blocked by:** {{AI-01e}}, {{SPIKE-02}}, {{APP-03b}}

## Goal
The owner can stop all AI with one switch and can see how much of the usage limit is gone. Mnemo shares one limit with the owner's daily work, so it must not use it up.

## Proposed change
- An AI section in Settings with one master switch. Off means no `claude -p` process starts, for any reason.
- A usage display. If {{SPIKE-02}} shows that the used share can be read: show the real percent. If not: show the count of Mnemo runs today and this week.
- A warning at 60%. At 95%, background work pauses and the owner's own actions still run. Both numbers can be changed in Settings.
- The fallback pause: when a run returns a "limit reached" error, background work pauses until the owner resumes it or until the next window.
- Every AI feature asks one function "may I run?" before it queues a task. The answer carries a reason that the UI can show.

## Acceptance criteria
- [ ] With the switch off, no process starts. A feature that needs AI shows why it is off.
- [ ] With the switch off, a saved link is stored with no summary (check again in {{BM-01}}).
- [ ] At or above the pause line, a background task waits and an owner task runs. Tested with the fake runner.
- [ ] A "limit reached" error from a run pauses background work and shows a plain message.
- [ ] The screen says clearly which number it shows: the real percent, or a count of runs.

## Out of scope
- The spend guard in dollars. That belongs to API key mode (LAST-01).
- A daily limit of runs per job (AGT-01).

## Evidence and links
- Roadmap, AI-02 and DEC-06: {{ROADMAP}}
- Architecture, "DEC-06: subscription và usage": {{ARCH}}
- Prototype, AI control screen (v60, v103): {{PROTO}}
- Unverified: how Claude Code reports the used share in `-p` mode. See {{SPIKE-02}}.

=== ISSUE AI-03
title: [AI-03] Model and effort per feature
type: Feature
labels: priority:medium, area:ai
milestone: P1.4 AI runner
---
**Phase:** P1 · **Roadmap status:** prototyped (v52) · **Size:** S (guess) · **Blocked by:** {{AI-01b}}, {{APP-03b}}

## Goal
Each AI feature can use a cheaper or a stronger model, so the shared usage limit is spent where quality matters.

## Proposed change
- A table in the AI section of Settings: one row per AI feature, with a model and an effort level.
- The defaults live in one file in the code. A "Reset to defaults" button restores them.
- `run_task` reads the row of the feature before each run.
- A new AI feature must register a row. A test fails if a task name has no row.

## Acceptance criteria
- [ ] A change in the table is used by the next run of that feature. Tested with the fake runner, which records the model it was asked for.
- [ ] The defaults match the AI feature map in the prototype (v52).
- [ ] An unknown model name is refused with a plain message, and the old value stays.
- [ ] The choice is kept after restart.

## Out of scope
- Cost numbers per model.
- Other AI providers.

## Evidence and links
- Roadmap, AI-03: {{ROADMAP}}
- Prototype, model table (v52): {{PROTO}}
- Unverified: the list of model names that `claude -p --model` accepts on the Max plan. Check with the installed Claude Code.
