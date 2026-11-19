---
ticket: 12
stage: implement
status: needs-review
needs_review: true
confidence: medium
decided_by: claude (ship workflow: implement)
date: 2026-11-19
---

# 0003. Flawed acceptance test: app-02 AC1 'every sidebar item opens a screen that shows its name and phase' now conflicts with #12

## Context

tests/acceptance/app-02.test.mjs (ticket #11) requires the main area of every sidebar item, including Settings, to show a phase number such as 'Phase 1'. Owner decision 3 of #12 says the Settings item opens the real Settings screen (title, note, section list, content), which has no phase line.

## Options

- Add a 'Phase 1' text to the Settings screen only to satisfy the old test
- Leave the screen as the owner specified and report the older test as outdated

## Decision

Did not add a phase line. The Settings screen follows the prototype layout from the owner's decision.

## Why

A phase label on a built screen is noise and not in the prototype. The old test describes the placeholder screens that #12 replaces for Settings.

## Consequences

app-02 AC1 and, through it, the nested 'npm run check' test (app-02 AC10) fail until the test excludes Settings.

## How to reverse

Exclude 'Settings' from that loop in app-02, or add a phase line to the screen.
