---
ticket: 12
stage: attach
status: needs-review
needs_review: true
confidence: high
decided_by: claude (ship workflow: attach)
date: 2026-11-19
---

# 0001. Attach the verify GIF by hand for #12

## Context

The attach stage ran gh pr comment on PR 102 with --attach. The installed gh does not support that flag and printed 'unknown flag: --attach'. Exit code 1. No comment was posted.

## Options

- Paste the command below by hand on a gh version that supports --attach (2.99.0 or newer)

## Decision

gh pr comment 102 --repo minhtran-agilityio/mnemo --attach /tmp/claude-1000/-home-minhtran-myprojects-mnemo-src-mnemo/6d5cd669-d2c4-4b24-8b55-f0f33e408af3/scratchpad/t12/step1-dark.png --body "Verify evidence for #12: pass"

## Why

The --attach flag is not available in the installed gh, and the workflow says not to retry or work around a failed command.

## Consequences

PR 102 has no verify comment or evidence file until the owner runs the command on a newer gh.

## How to reverse

No change was made, so there is nothing to reverse.
