---
ticket: 12
stage: intent
status: needs-review
needs_review: true
confidence: medium
decided_by: claude (ship workflow: intent)
date: 2026-11-19
---

# 0006. Base is origin/feat/p1-2-app-shell-b, not local main

## Context

The ticket says #11 (settings store, sidebar, Settings nav item) is already on the base branch. Local and origin main (4113570) contain neither migration 0002_settings.sql nor ui/src/frame. They exist on origin/feat/p1-2-app-shell-b (PR #101 merged into that branch).

## Options

- Branch the worktree from origin/feat/p1-2-app-shell-b
- Branch from main and re-implement #11 work
- Stop and ask

## Decision

Branch from origin/feat/p1-2-app-shell-b, which holds the #11 work. The PR must target that branch.

## Why

Owner decision 1 requires reusing the #11 store and sidebar, and they exist only there. Re-implementing would duplicate them.

## Consequences

If the real base is main, the PR would include the #11 diff until #11 reaches main.

## How to reverse

Retarget the PR or rebase onto main after #11 merges.
