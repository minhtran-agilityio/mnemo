---
ticket: 18
stage: attach
status: needs-review
needs_review: true
confidence: high
decided_by: claude (ship workflow: attach)
date: 2026-11-20
---

# 0007. Attach the verify GIF by hand for #18

## Context

The attach stage ran gh pr comment 123 with --attach on gh 2.97.0. The CLI returned 'unknown flag: --attach', so no comment was posted and the PR body was not edited.

## Options

- Paste the command below by hand to attach the screenshot as a PR comment

## Decision

gh pr comment 123 --repo minhtran-agilityio/mnemo --attach /tmp/claude-1000/-home-minhtran-myprojects-mnemo-src-03-mnemo/e524d578-bdf8-42db-bcf5-e10f6b4a2a25/scratchpad/step-1-not-installed.png --body "Verify evidence for #18: flaky"

## Why

The task says to stop and return this decision when the command fails, without retrying or working around it.

## Consequences

The verify evidence is not on PR 123 until the owner runs the command. The PR body note about the flaky verify run was not appended either.

## How to reverse

Not applicable: nothing was posted or changed.
