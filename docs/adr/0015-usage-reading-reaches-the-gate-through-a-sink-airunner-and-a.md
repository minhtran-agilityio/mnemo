---
ticket: 23
stage: research
status: accepted
confidence: medium
decided_by: claude (ship workflow: research)
date: 2026-11-23
---

# 0015. Usage reading reaches the gate through a sink, AiRunner and AiError unchanged

## Context

Only is_rejected_rate_limit is read today. The gate needs unifiedWindows utilization and resetsAt for the window that hit the limit. AiRunner and AiError are shared contracts used by #19 and #22.

## Options

- Optional UsageSink on ClaudeRunner, AiRunner and AiError unchanged (Recommended)
- Change AiError::UsageLimit and AiOutput to carry a UsageReading

## Decision

Use an optional sink on the Claude runner; keep AiRunner and AiError unchanged.

## Why

Keeps shared contracts stable for other tickets.

## Consequences

ClaudeRunner gets a sink at construction; select_runner and lib.rs wiring change.

## How to reverse

Move the reading into AiOutput and AiError and drop the sink.
