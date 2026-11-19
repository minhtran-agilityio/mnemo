---
ticket: 12
stage: implement
status: needs-review
needs_review: true
confidence: high
decided_by: claude (ship workflow: implement)
date: 2026-11-19
---

# 0002. Flawed acceptance test: app-03-settings bridge never installs (MutationObserver on a missing documentElement)

## Context

In tests/acceptance/app-03-settings.test.mjs the fake Tauri bridge script runs through Page.addScriptToEvaluateOnNewDocument. It starts with new MutationObserver(...).observe(document.documentElement, ...). In Google Chrome 154 headless, document.documentElement is null at that time (I checked: String(document.documentElement) is 'null'), so the script throws before it sets window.__TAURI_INTERNALS__. Every invoke then fails with 'Cannot read properties of undefined (reading invoke)'.

## Options

- Leave the test as it is and report the flaw
- Edit the test (not allowed)
- Work around it in production code (would weaken the product)

## Decision

Left the test untouched. Five tests fail only because of this: AC3 'saved under key theme', AC3 'read with get_setting at start', AC3 'saved Dark applied before first paint and survives Quit and start', and AC5 'readable in light' and 'in dark' (they seed the store through the bridge). A temporary copy that observes `document` with subtree instead of `document.documentElement` passed all 24 tests against my code; the copy was deleted.

## Why

The hard rules forbid editing tests/acceptance. The fix is one line in the test: observe(document, { attributes: true, subtree: true, attributeFilter: ['data-theme'] }).

## Consequences

The acceptance file stays red on Chrome 154 until the owner fixes that line. The app behaviour it checks is proven by the patched copy.

## How to reverse

Apply the one-line fix to the test's bridgeScript.
