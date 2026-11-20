---
ticket: 18
stage: implement
status: needs-review
needs_review: true
confidence: high
decided_by: claude (ship workflow: implement)
date: 2026-11-20
---

# 0009. Boundary: acceptance test needs a probe test marked #[ignore] in health.rs

## Context

The node acceptance test must run the real Rust check with a controlled PATH and HOME. There is no CLI entry point and no other named file for one.

## Options

- Ignored Rust test that prints the state, run through the built test binary
- Add a binary or CLI flag to the app
- Only unit tests with a fake runner

## Decision

An ignored test `probe_state_from_env` in health.rs prints the state word; tests/ai-health.test.mjs builds the test binary and runs it with a controlled PATH, HOME and fake claude scripts.

## Why

Exercises the real locate, spawn and parse path without adding product code or a new file outside the boundary.

## Consequences

The node test depends on `cargo test --no-run` output; it takes about a second after the build.

## How to reverse

Delete the probe test and the node test.
