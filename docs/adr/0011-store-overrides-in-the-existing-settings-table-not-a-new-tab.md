---
ticket: 24
stage: intent
status: accepted
confidence: high
decided_by: claude (ship workflow: intent)
date: 2026-11-22
---

# 0011. Store overrides in the existing settings table, not a new table

## Context

The owner prefers the settings table (migration 0002) through the storage module; #22 is taking migration 0008.

## Options

- One settings key per feature 'ai_model.<task>' with a JSON value {model, effort}
- Two settings keys per feature (model and effort)
- A new ai_model table through a new migration

## Decision

One settings key per feature, 'ai_model.<task>', with a JSON value {model, effort}; only overrides are stored and defaults come from code.

## Why

No migration, so no conflict with #22. One key means one atomic write per row. Defaults stay in one file in code.

## Consequences

The stored key format becomes a small data contract; a bad or unknown stored value falls back to the default at read time.

## How to reverse

Add a migration that copies the keys into a table, and change only ai::models.
