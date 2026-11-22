---
ticket: 22
stage: intent
status: accepted
confidence: medium
decided_by: claude (ship workflow: intent)
date: 2026-11-23
---

# 0012. Expose state and endedAt in the Run item API and make startedAt null while waiting

## Context

Migration 0008 adds state and ended_at. The Run item already has generic Tauri CRUD commands (add_run, update_run, and so on) and TS types in ui/src/shared/api.ts. A waiting run has not started yet, and started_at is NOT NULL in 0003.

## Options

- Add state and endedAt to Run and RunInput, make started_at nullable in the rebuilt table (null while waiting), and update api.ts and the data-01 acceptance fixture
- Keep RunInput unchanged and set started_at to the enqueue time, with state defaulted by SQL for generic inserts
- Drop the generic run commands and expose runs only through the queue

## Decision

Add state and endedAt to Run and RunInput, make started_at nullable (set when the run starts; created_at is the queue time), and update api.ts and the data-01 fixture.

## Why

The ticket asks for a start time. Writing the enqueue time as the start would be invented data. The table is rebuilt anyway, so changing the constraint costs nothing, and the UI types stay true to the row.

## Consequences

The UI Run/RunInput types change (startedAt nullable, new state and endedAt). #23 and P5 build on this shape.

## How to reverse

A later migration can make started_at NOT NULL again by filling it from created_at; the TS types revert with it.
