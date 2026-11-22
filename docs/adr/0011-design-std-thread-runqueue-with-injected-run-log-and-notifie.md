---
ticket: 22
stage: design
status: accepted
confidence: high
decided_by: claude (ship workflow: design)
date: 2026-11-23
---

# 0011. Design: std-thread RunQueue with injected run log and notifier, cancel token in the process loop, run table rebuilt by 0008

## Context

Ticket #22 needs at most 2 concurrent claude -p runs, owner-first priority, one run row per run with state, cancel that kills the process, crash recovery and a run-state UI event. The core is blocking std code with a 20 ms poll loop in process.rs and one managed SQLite connection (AppStorage).

## Options

- A: std threads + one Mutex over two FIFO deques and a running map; RunLog and notifier injected as trait objects; CancelToken(Arc<AtomicBool>) polled in process.rs
- B: tokio async queue with Semaphore and tokio-util CancellationToken
- C: fixed pool of 2 long-lived worker threads on a Condvar

## Decision

Option A: RunQueue in scheduler/queue.rs (MAX_CONCURRENT_RUNS = 2), a thread per started run with a drop guard that frees the slot, RunLog trait backed by the one AppStorage connection through an AppHandle adapter, notifier mapped to a Tauri run-state event {id, taskType, state}, migration 0008 table rebuild with state and ended_at, recovery in Storage::open.

## Why

No new crate, matches the blocking process layer, the limit and ordering are true by construction under one lock, and tests run without Tauri on a temp database.

## Consequences

AiRunner::run_task and run_bounded_with gain a CancelToken parameter for every implementation and caller; the Run item shape changes; #23 adds its pause gate in dispatch.

## How to reverse

Remove the queue from lib.rs setup and cancel_run, call the runner directly in run_test_prompt, delete queue.rs and storage/runs.rs; schema changes go through a later migration, never by editing 0008.
