---
ticket: 23
stage: design
status: accepted
confidence: medium
decided_by: claude (ship workflow: design)
date: 2026-11-23
---

# 0013. AI control gate design: scheduler AiControl with may_run, usage sink, settings-backed pause state

## Context

Ticket #23 needs one 'may I run?' function for features and the #22 RunQueue, a usage reading from rate_limit_event, limit/owner/threshold pause and a master switch, with AiRunner and AiError shared by other tickets.

## Options

- A: AiControl in scheduler/ai_control.rs with ControlStore trait, injected clock, usage sink on the runner side, AI contracts unchanged (Recommended)
- B: Carry UsageReading in AiError::UsageLimit and AiOutput
- C: Gate inside queue.rs with a separate pause table

## Decision

Option A: AiControl::may_run(priority, now) -> Allow | Deny{Off|Limit|Threshold|OwnerPause}, checked by features before queueing and by RunQueue::dispatch before each start; readings reach it through a UsageSink on ClaudeRunner/FakeRunner; state in the six owner-confirmed settings keys; a timer thread and change listeners re-run dispatch when a pause lifts.

## Why

Keeps the shared AI contract stable for other tickets, follows the existing RunLog adapter pattern, and applies owner decisions 2-10 as written.

## Consequences

select_runner and RunQueue::new gain one parameter; limit resetsAt is taken from a reading that arrived after the run started.

## How to reverse

Remove the commands, the dispatch gate, the run_test_prompt check, and the new modules; drop the sink parameter (see design 'How to reverse').
