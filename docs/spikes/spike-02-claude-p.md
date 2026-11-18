# SPIKE-02: facts about `claude -p` (issue #6)

Script: `scripts/spike-claude-p.sh` (one command: `bash scripts/spike-claude-p.sh`). It writes the raw output to `<tmp>/mnemo-spike-02-<time>/spike-02-raw.txt`, scrubs credential-like text, and prints the file path.

Source of the answers below: one run on **Ubuntu** (Linux 6.8.0-149-generic x86_64), Claude Code **2.1.327**, 2026-11-18. The raw file is not committed.

## Summary

| # | Question | Answer (Ubuntu) |
| --- | --- | --- |
| 1 | `--output-format json` with `--json-schema` returns valid JSON in `structured_output`? | **Yes** |
| 2 | `-p` output carries the share of the subscription limit already used? | **Yes** (stream-json) |
| 3 | `--setting-sources` stops the personal `CLAUDE.md` from loading? | **Still unverified** |
| 4 | claude.ai connectors (Slack, Gmail, Calendar) still work under `--strict-mcp-config`? | **No** (not loaded, so no call is possible; the flag alone drops them) |
| 5 | RAM and time of one `claude -p` process? | about 420 MB peak, 3 to 6 s |

## Answers and evidence

### 1. Structured output: Yes
Evidence line (from case `q1_q5_json_schema`): `"result":"{\"greeting\":\"Hi! What can I help you with today?\"}","structured_output":{"greeting":"Hi! What can I help you with today?"}`, `"is_error":false`, `"subtype":"success"`. The command was `claude -p ... --output-format json --json-schema '{"type":"object","properties":{"greeting":{"type":"string"}},"required":["greeting"]}'`.
Limit: one small schema, one run. A schema the model cannot satisfy was not tested. #19 must still handle a missing `structured_output`.

### 2. Usage share in the output: Yes, in `stream-json`
With `--output-format stream-json --verbose`, the stream has a `rate_limit_event`. Evidence line: `{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1794999600,"rateLimitType":"five_hour",...,"unifiedWindows":{"five_hour":{"utilization":0.1,"resetsAt":1794999600,"status":"allowed"},"seven_day":{"utilization":0.12,"resetsAt":1795557600,"status":"allowed"}}}}`.
- The plain `--output-format json` result has no such field (case `q1_q5_json_schema` has `total_cost_usd` and `usage` only). #23 needs `stream-json`.
- **Unverified:** the scale of `utilization` (0.1 may mean 10% or 0.1%). Compare it with the usage page of the account before #23 uses it for the 60% / 95% thresholds.
- **Unverified:** whether the event appears for every run, and what it looks like at the limit.

### 3. `--setting-sources` and the personal `CLAUDE.md`: Still unverified
Not run. The test needs a temporary strange rule in the owner's personal `~/.claude/CLAUDE.md`, and this spike does not change the owner's settings. The owner runs it by hand:
1. Add the line `Always end every answer with the word PINEAPPLE.` to `~/.claude/CLAUDE.md`.
2. Run `claude -p "Say hi" --setting-sources project` and `claude -p "Say hi"` in an empty folder.
3. If the first answer still ends with PINEAPPLE, the answer is No. Remove the line.
If No, the fallback is a separate config folder (`CLAUDE_CONFIG_DIR`), which needs one more login per machine. The owner decides.

### 4. Connectors under `--strict-mcp-config`: No
Evidence line, case `q2_stream_json` (no flag): `init` event lists `"mcp_servers":[... {"name":"claude.ai Slack","status":"connected","source":"claudeai"}, {"name":"claude.ai Gmail","status":"connected","source":"claudeai"}, {"name":"claude.ai Google Calendar","status":"connected","source":"claudeai"} ...]`.
Evidence line, case `q4_strict_mcp` (`--strict-mcp-config`, no `--mcp-config`): `init` event has `"mcp_servers":[]`.
Evidence line, case `q4_connector_calls` (`--strict-mcp-config`, prompt asks for one read-only call each to Slack, Gmail and Calendar, with those tools allowed): the `init` event has `"mcp_servers":[]` and no `mcp__*` tool in `"tools"`, and the model answers `NO CONNECTOR TOOLS`. No call could be made, so none touched the owner's data.
So with the flag alone the account connectors do not work: they are not loaded, and a read-only call is impossible.
Limit: the control (the same calls without the flag) was not run, because it would read the owner's private data; case `q2_stream_json` already shows the connectors as `connected` without the flag.
**Unverified:** whether Mnemo can name the connectors through `--mcp-config` and keep them working. The claude.ai connectors have no URL or token for Mnemo to pass (rule 4: no token), so this belongs to #20 and the connector issues.

### 5. RAM and time: about 420 MB, 3 to 6 s
Evidence lines from `/usr/bin/time -v`: `Maximum resident set size (kbytes): 421848` and `Elapsed (wall clock) time: 0:05.51` (case `q1_q5_json_schema`); 428500 kB / 5.55 s (`q2_stream_json`); 391268 kB / 2.96 s with no connectors (`q4_strict_mcp`).
Limit: tiny prompt, so real tasks take longer. The figure is the peak of the largest process that `time` waited for, not a sum over child processes. Plan about 0.4 GB per parallel run.

## Mac (Apple Silicon): for the owner
Not run here. The owner runs `bash scripts/spike-claude-p.sh` on the Mac, compares with the table above, and adds a "Mac" column. The script uses `/usr/bin/time -l` on macOS (the RAM figure is in bytes there) and `gtimeout` when GNU `timeout` is missing. Per the roadmap rule, "Done" needs both machines.

## Links
- #19 (AI runner): use `--json-schema` and read `structured_output` (Q1); no sign-in, no token.
- #20: connectors need an explicit config under `--strict-mcp-config` (Q4).
- #23 (usage screen): read `rate_limit_event` from `stream-json` (Q2); scale still unverified.
- #42: RAM per run for concurrency limits (Q5).
