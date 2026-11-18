---
paths:
  - "src-tauri/**"
  - "**/*.rs"
---

# Backend rules (Rust core, Tauri 2)

The owner does not read Rust. Small modules, typed errors and tests are how the core stays trustworthy.

## Code style
- Format with `cargo fmt`. Lint with `cargo clippy` with warnings as errors. Test with `cargo test`. All three run inside `npm run check`.
- One crate (`src-tauri/`) with plain modules: `storage/`, `ai/`, `scheduler/`, `system/`, plus `commands.rs` for the Tauri bridge. Each module's `mod.rs` starts with a one-line comment saying what it owns. Do not add a fifth job to the core without an architecture decision.
- Modules talk through small public functions and types. No module reaches into another module's internals or opens another module's resources.
- Structured data uses `struct`/`enum` with `serde` derives, not `serde_json::Value` passed around.
- No `unsafe`. No global mutable state; shared state lives in Tauri managed state (`State<T>`) behind a `Mutex`/`RwLock` or a channel.
- Do not add a crate for something a few lines of std can do.

## Tauri commands (the only bridge to the UI)
- Commands stay thin: validate arguments, call one module function, map the result. No SQL, file access or process spawning in a command.
- Every command returns `Result<T, AppError>`, where `AppError` serialises to one shape: a stable machine `code` plus a human `message`. Never send stack traces, file paths, tokens or raw stderr to the UI.
- Commands that do slow work are `async` and never block the main thread. Long work reports progress through Tauri events.
- Register every command in one place in `lib.rs`. Keep the capability file (`capabilities/*.json`) minimal: do not enable fs, shell or http plugins for the UI.

## Running claude -p (the `ai` module)
- Each AI task is one `claude -p` child process: spawn, read output, wait for exit. Only the `ai` module spawns it.
- Structured results use `--output-format json` with `--json-schema`; read `structured_output`. Streaming (Ask Mnemo) uses `--output-format stream-json`; the last line is the `result` record.
- Failure is a non-zero exit code **or** a missing/invalid `structured_output`. Both are failures; never produce a summary from a failed run.
- Pass `--allowedTools` per feature with `--permission-mode dontAsk`, plus `--max-turns`, and enforce a Mnemo-side timeout that kills the process.
- Use Mnemo's own config: `--strict-mcp-config --mcp-config`, `--settings`, `--setting-sources` pointing at `~/.config/mnemo/`. Run in Mnemo's own working directory, never a project directory of the owner.
- Remove `ANTHROPIC_API_KEY` from the child's environment so the subscription is used. Do not use `--bare`.
- Model and effort per feature come from the config table (AI-03), not literals at call sites.
- Treat model output as untrusted: parse, validate against the schema, never execute it.
- At app start, run a health check (Claude Code installed, signed in, version works). On failure, the UI shows how to fix it and saving/reading keep working.
- The `ai` module sits behind a trait so tests use a fake and a later API-key mode (P8) can swap in without touching features.

## Queue and usage
- At most 2 `claude -p` runs at the same time. Owner-triggered actions go before background jobs.
- Every run is written to the `run` table (task type, start, duration, outcome, error). Never record tokens.
- Warn at 60% usage; pause background jobs at 95%; owner-triggered actions still run. Thresholds come from Settings. Reading the usage percent from `-p` output is **Unverified**; the fallback is counting Mnemo's own runs and pausing on a limit error.

## Scheduler and system
- Timers live in the core. No launchd/systemd service in version 1.
- Jobs run only while the app is open or in the tray. Each job stores its last run time in SQLite; on start, a missed job catches up at most once.
- Closing the window hides to the tray; only Quit from the tray stops the app. Background jobs keep running in the tray.
- Anything that moves, deletes or sends outside Mnemo waits for the owner's approval.
