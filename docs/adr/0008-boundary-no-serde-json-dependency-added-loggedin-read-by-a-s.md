---
ticket: 18
stage: implement
status: needs-review
needs_review: true
confidence: medium
decided_by: claude (ship workflow: implement)
date: 2026-11-20
---

# 0008. Boundary: no serde_json dependency added; loggedIn read by a small strict scanner

## Context

The plan said to parse loggedIn with a serde struct, but serde_json is not a direct dependency and Cargo.toml is not a file ticket #18 names. Adding a dependency is outside this ticket.

## Options

- Add serde_json to Cargo.toml
- Hand-written strict scanner for one top-level boolean in ai/health.rs
- Substring search for loggedIn

## Decision

Hand-written scanner `logged_in` that keeps only the top-level boolean loggedIn, skips every other value without keeping it, and returns None on anything unreadable (which maps to Version problem).

## Why

Stays inside the named files and the no-new-dependency rule; a substring search would be fooled by a nested or quoted loggedIn. Unit tests cover nesting, escapes, bad JSON and trailing text.

## Consequences

About 100 lines of parsing code that a JSON crate would replace with a one-field struct.

## How to reverse

Add serde_json to src-tauri/Cargo.toml and replace logged_in with a struct with one bool field; the tests stay valid.
