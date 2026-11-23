---
ticket: 23
stage: intent
status: accepted
confidence: medium
decided_by: claude (ship workflow: intent)
date: 2026-11-23
---

# 0014. How the usage reading and limit resetsAt reach the gate

## Context

Only is_rejected_rate_limit is read today; the gate needs unifiedWindows utilization and resetsAt, and the resetsAt of the window that hit the limit. AiRunner and AiError are shared contracts from #19/#22.

## Options

- Usage sink: the Claude runner hands each parsed reading to an optional sink; RunQueue reports UsageLimit to AiControl, which uses the reading from that run (Recommended)
- Change AiError::UsageLimit and AiOutput to carry a UsageReading
- Re-parse the run's output in the queue

## Decision

Usage sink on the runner side, AiRunner trait and AiError unchanged; resetsAt is used only from a reading of the same run and only when it is in the future, else pause until Resume.

## Why

Keeps the shared AI contracts stable for other tickets and avoids guessing a time from an old reading (owner decision 6).

## Consequences

The fake runner gains a way to emit a reading; ClaudeRunner gets an optional sink at construction.

## How to reverse

Replace the sink with fields on AiOutput/AiError and drop the sink parameter.
