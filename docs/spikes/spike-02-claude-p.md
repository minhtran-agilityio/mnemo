# SPIKE-02: facts about `claude -p` (issue #6)

Script: `scripts/spike-claude-p.sh` (one command: `bash scripts/spike-claude-p.sh`). It writes the raw output to `<tmp>/mnemo-spike-02-<time>/spike-02-raw.txt`, scrubs credential-like text, and prints the file path.

Source of the answers below: one run on **Ubuntu** (Linux 6.8.0-149-generic x86_64) and one run on **macOS** (Darwin 25.6.0, Apple M2, arm64). Both used Claude Code **2.1.327** on 2026-11-18. The raw files are not committed.

## Summary

| # | Question | Ubuntu | Mac (Apple Silicon) |
| --- | --- | --- | --- |
| 1 | `--output-format json` with `--json-schema` returns valid JSON in `structured_output`? | **Yes** | **Yes** |
| 2 | `-p` output carries the share of the subscription limit already used? | **Yes** (stream-json) | **Yes** (stream-json; also in the json array) |
| 3 | `--setting-sources` stops the personal `CLAUDE.md` from loading? | **Still unverified** | **Yes** |
| 4 | claude.ai connectors (Slack, Gmail, Calendar) still work under `--strict-mcp-config`? | **No** (not loaded, so no call is possible; the flag alone drops them) | **No** (same) |
| 5 | RAM and time of one `claude -p` process? | about 420 MB peak, 3 to 6 s | about 390 MB peak, 2.4 to 4.8 s |

## Answers and evidence

### 1. Structured output: Yes
Evidence line (from case `q1_q5_json_schema`): `"result":"{\"greeting\":\"Hi! What can I help you with today?\"}","structured_output":{"greeting":"Hi! What can I help you with today?"}`, `"is_error":false`, `"subtype":"success"`. The command was `claude -p ... --output-format json --json-schema '{"type":"object","properties":{"greeting":{"type":"string"}},"required":["greeting"]}'`.
Mac: same result. Evidence line (case `q1_q5_json_schema`): `"result":"{\"greeting\":\"...\"}"`, `"structured_output":{"greeting":"..."}`, `"is_error":false`, `"subtype":"success"`. Note that with `--output-format json` the output on Mac is a JSON array of events, and the last element (`"type":"result"`) holds `structured_output`. #19 must read that element.
Limit: one small schema, one run per machine. A schema the model cannot satisfy was not tested. #19 must still handle a missing `structured_output`.

### 2. Usage share in the output: Yes, in `stream-json`
With `--output-format stream-json --verbose`, the stream has a `rate_limit_event`. Evidence line: `{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1794999600,"rateLimitType":"five_hour",...,"unifiedWindows":{"five_hour":{"utilization":0.1,"resetsAt":1794999600,"status":"allowed"},"seven_day":{"utilization":0.12,"resetsAt":1795557600,"status":"allowed"}}}}`.
- The plain `--output-format json` result has no such field (case `q1_q5_json_schema` has `total_cost_usd` and `usage` only). #23 needs `stream-json`.
- **Unverified:** the scale of `utilization` (0.1 may mean 10% or 0.1%). Compare it with the usage page of the account before #23 uses it for the 60% / 95% thresholds.
- **Unverified:** what the event looks like at the limit.
- Mac: the `rate_limit_event` appeared in all 3 `stream-json` runs, with the same shape (`unifiedWindows.five_hour.utilization` 0.57, `seven_day.utilization` 0.18). In the `--output-format json` run it is also an element of the output array, but the `result` object itself has no rate-limit field. Ubuntu looked only at the `result` object, so the Ubuntu json output was not re-checked for the array form.

### 3. `--setting-sources` and the personal `CLAUDE.md`: Yes (Mac); still unverified on Ubuntu
Run on the Mac by hand, in an empty folder. `~/.claude/CLAUDE.md` did not exist before; the test created it with the line `Always end every answer with the word PINEAPPLE.`, ran the commands, and deleted the file again (checked: the file is gone).
- `claude -p "Say hi"` (no flag): the answer ends with `PINEAPPLE`. The personal file is loaded.
- `claude -p "Say hi" --setting-sources project`: `Hi! What can I help you with today?`. No PINEAPPLE.
- `claude -p "Say hi" --setting-sources project --settings '{}'`: `Hi! What would you like to work on today?`. No PINEAPPLE.
So `--setting-sources project` stops the personal `CLAUDE.md` from loading, and the fallback (`CLAUDE_CONFIG_DIR`) is not needed.
Limit: one run per case, and the model could in theory skip the rule by chance; the control run did follow it. Ubuntu was not run (this spike does not change settings there); repeat the three commands on Ubuntu to close it for both machines.

### 4. Connectors under `--strict-mcp-config`: No
Evidence line, case `q2_stream_json` (no flag): `init` event lists `"mcp_servers":[... {"name":"claude.ai Slack","status":"connected","source":"claudeai"}, {"name":"claude.ai Gmail","status":"connected","source":"claudeai"}, {"name":"claude.ai Google Calendar","status":"connected","source":"claudeai"} ...]`.
Evidence line, case `q4_strict_mcp` (`--strict-mcp-config`, no `--mcp-config`): `init` event has `"mcp_servers":[]`.
Evidence line, case `q4_connector_calls` (`--strict-mcp-config`, prompt asks for one read-only call each to Slack, Gmail and Calendar, with those tools allowed): the `init` event has `"mcp_servers":[]` and no `mcp__*` tool in `"tools"`, and the model answers `NO CONNECTOR TOOLS`. No call could be made, so none touched the owner's data.
So with the flag alone the account connectors do not work: they are not loaded, and a read-only call is impossible.
Mac: same result. Case `q2_stream_json` (no flag) lists 15 `mcp_servers` and 265 `mcp__*` tools, including `claude.ai Slack`, `claude.ai Gmail` and `claude.ai Google Calendar` as `connected`. Cases `q4_strict_mcp` and `q4_connector_calls` (`--strict-mcp-config`) list 0 servers and 0 `mcp__*` tools, and the model answers `NO CONNECTOR TOOLS.`. No connector was called.
Limit: the control (the same calls without the flag) was not run, because it would read the owner's private data; case `q2_stream_json` already shows the connectors as `connected` without the flag.
**Unverified:** whether Mnemo can name the connectors through `--mcp-config` and keep them working. The claude.ai connectors have no URL or token for Mnemo to pass (rule 4: no token), so this belongs to #20 and the connector issues.

### 5. RAM and time: about 420 MB, 3 to 6 s
Evidence lines from `/usr/bin/time -v`: `Maximum resident set size (kbytes): 421848` and `Elapsed (wall clock) time: 0:05.51` (case `q1_q5_json_schema`); 428500 kB / 5.55 s (`q2_stream_json`); 391268 kB / 2.96 s with no connectors (`q4_strict_mcp`).
Limit: tiny prompt, so real tasks take longer. The figure is the peak of the largest process that `time` waited for, not a sum over child processes. Mac (`/usr/bin/time -l`, bytes): 392593408 B / 4.80 s (`q1_q5_json_schema`), 412155904 B / 4.44 s (`q2_stream_json`), 373555200 B / 2.39 s (`q4_strict_mcp`), 378732544 B / 2.61 s (`q4_connector_calls`). Same limits as above. Plan about 0.4 GB per parallel run on both machines.

### Usage windows (Unverified), as read by #23
Mnemo reads every `rate_limit_event` (stream-json lines, and elements of the json output array) in `src-tauri/src/ai/usage.rs`:
- Shape read: `rate_limit_info.unifiedWindows.five_hour` and `.seven_day`, each with `utilization`, `resetsAt` and `status`; plus `rate_limit_info.status`, `resetsAt` and `rateLimitType`. The shape is the one seen above. A field of an unexpected type is dropped on its own; the event is still read, so a `rejected` status is never lost.
- **Unverified: the scale.** `utilization` is read as a fraction 0..1 and shown as `round(utilization * 100)` percent (0.57 shows as 57%). It may instead be a percent already (0.57 meaning 0.57%). Until it is checked, Settings > AI marks every percent "Unverified", and the warn (60%) and pause (95%) lines act on the assumed scale.
- `resetsAt` is read as Unix seconds (seen above). A time in the past or more than 8 days ahead is dropped; Mnemo never guesses a time.
- At the limit: the window with `status: "rejected"` (else the one at or above 100%) gives the time the limit pause lifts; the event's own `resetsAt` is used only when the event itself says `rejected`. **Unverified:** what the event looks like at the limit (see above).
- The last reading is stored in the `settings` table as `ai_usage_last` (JSON with its read time).
- Ubuntu prints the json output as one object, so only stream-json runs give a reading there; with no reading, Settings shows Mnemo's own run count instead.

**Owner step (open):** run one prompt, compare `unifiedWindows.five_hour.utilization` with the usage page of the account on claude.ai at the same moment, then pin the scale in a unit test in `src-tauri/src/ai/usage.rs` and in this section.

## Mac (Apple Silicon)
Run on 2026-11-18 with `bash scripts/spike-claude-p.sh` (exit 0, all 4 cases `exit=0`, the output file holds no `sk-ant`, `bearer` or `oauth` text). Question 3 was run by hand as described above. The results are in the table and in each answer.

## Status
Both machines ran the script. Open: question 3 on Ubuntu, and the `utilization` scale (Q2; see "Usage windows (Unverified)" for the owner step). Neither blocks the design: Q1, Q2 and Q3 are Yes, so the fallbacks (`CLAUDE_CONFIG_DIR`; counting runs in #23) are not needed.

## Links
- #19 (AI runner): use `--json-schema` and read `structured_output` (Q1); no sign-in, no token.
- #20: connectors need an explicit config under `--strict-mcp-config` (Q4). `--setting-sources project` keeps the personal `CLAUDE.md` out (Q3).
- #23 (usage screen): read `rate_limit_event` from `stream-json` (Q2); scale still unverified.
- #42: RAM per run for concurrency limits (Q5): about 0.4 GB on both machines.
