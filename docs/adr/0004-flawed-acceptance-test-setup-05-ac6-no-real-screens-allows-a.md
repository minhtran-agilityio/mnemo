---
ticket: 12
stage: implement
status: needs-review
needs_review: true
confidence: high
decided_by: claude (ship workflow: implement)
date: 2026-11-19
---

# 0004. Flawed acceptance test: setup-05 AC6 'no real screens' allows at most 3 screen files

## Context

tests/acceptance/setup-05.test.mjs counts ui/src files whose path contains screen, view or page (kanban excluded). It allowed error-page.ts and the two sample files. The ticket's own file list names ui/src/screens/settings/settings.ts and settings.css, which makes 5.

## Options

- Put the Settings files at a path without 'screen' (outside the ticket's named paths)
- Keep the named paths and report the older test as outdated

## Decision

Kept the paths the ticket names.

## Why

The ticket names those paths, and moving them would be a Boundary change.

## Consequences

setup-05 AC6 fails until its limit is raised.

## How to reverse

Raise the limit in setup-05 to 5, or move the files.
