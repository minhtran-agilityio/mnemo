#!/usr/bin/env bash
# SPIKE-02 (#6): test the Unverified facts about `claude -p`.
# One command: bash scripts/spike-claude-p.sh [output-dir]
# Writes raw output to a file and prints its path. Works on macOS and Ubuntu.
# Read-only on the owner's setup: it never edits ~/.claude and never reads the token.
# Questions 3 (--setting-sources) is NOT run here: it needs a temporary rule in the
# personal CLAUDE.md, which the owner does by hand (see docs/spikes/spike-02-claude-p.md).
set -u

TIMEOUT_S="${SPIKE_TIMEOUT_S:-180}"
OUT_DIR="${1:-${TMPDIR:-/tmp}/mnemo-spike-02-$(date +%Y%m%d-%H%M%S)}"
OUT="$OUT_DIR/spike-02-raw.txt"
WORK="$(mktemp -d)"
mkdir -p "$OUT_DIR"
trap 'rm -rf "$WORK"' EXIT

command -v claude >/dev/null 2>&1 || { echo "claude not found in PATH" >&2; exit 1; }

# Run with a timeout when the OS has one (GNU timeout, or gtimeout from Homebrew coreutils).
if command -v timeout >/dev/null 2>&1; then TMO="timeout $TIMEOUT_S"
elif command -v gtimeout >/dev/null 2>&1; then TMO="gtimeout $TIMEOUT_S"
else TMO=""; fi

# Resource meter: GNU time (-v) on Linux, BSD time (-l) on macOS.
TIMEBIN=/usr/bin/time
METER=""
if [ -x "$TIMEBIN" ]; then
  if "$TIMEBIN" -v true >/dev/null 2>&1; then METER="-v"
  elif "$TIMEBIN" -l true >/dev/null 2>&1; then METER="-l"; fi
fi

# run_case <name> <args...>: run `claude -p` in a scratch dir; append stdout, stderr and metrics.
run_case() {
  name="$1"; shift
  {
    echo "=== CASE $name ==="
    echo "--- stdout ---"
  } >> "$OUT"
  start=$(date +%s)
  if [ -n "$METER" ]; then
    ( cd "$WORK" && $TMO "$TIMEBIN" "$METER" -o "$WORK/meter.txt" claude "$@" ) >> "$OUT" 2> "$WORK/stderr.txt"
  else
    ( cd "$WORK" && $TMO claude "$@" ) >> "$OUT" 2> "$WORK/stderr.txt"
  fi
  code=$?
  end=$(date +%s)
  {
    echo
    echo "--- stderr ---"; cat "$WORK/stderr.txt"
    echo "--- exit=$code wall_s=$((end - start)) ---"
    if [ -f "$WORK/meter.txt" ]; then echo "--- meter ($METER) ---"; cat "$WORK/meter.txt"; rm -f "$WORK/meter.txt"; fi
  } >> "$OUT"
}

SCHEMA='{"type":"object","properties":{"greeting":{"type":"string"}},"required":["greeting"]}'

{
  echo "# Mnemo SPIKE-02 raw output"
  echo "date_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "os=$(uname -s) $(uname -r) $(uname -m)"
  echo "claude_version=$(claude --version 2>&1)"
  echo "meter_flag=${METER:-none}"
} > "$OUT"

# Q1 and Q5: structured output, and RAM/time of one process.
run_case "q1_q5_json_schema" -p "Reply with a short greeting." \
  --output-format json --json-schema "$SCHEMA" --no-session-persistence

# Q2: stream-json carries rate limit events?
run_case "q2_stream_json" -p "Reply with the word ok." \
  --output-format stream-json --verbose --no-session-persistence

# Q4: do claude.ai connectors (Slack, Gmail, Calendar) load under --strict-mcp-config?
# Compare the tools listed in the init event with and without the flag. No connector is called.
run_case "q4_strict_mcp" -p "Reply with the word ok." \
  --output-format stream-json --verbose --no-session-persistence --strict-mcp-config

# Q4 (call): under the flag, ask for one read-only call per connector (list channels, list
# labels, list calendars). The flag removes the connector tools, so the model has nothing to call:
# the answer shows they do not work under the flag. The prompt names metadata calls only and
# the control run without the flag is NOT done here, because it would read the owner's data.
run_case "q4_connector_calls" -p "If you have a tool for Slack, Gmail or Google Calendar, call one read-only tool for each (list channels, list labels, list calendars) and say which worked. If you have none, reply exactly: NO CONNECTOR TOOLS." \
  --output-format stream-json --verbose --no-session-persistence --strict-mcp-config \
  --allowedTools "mcp__claude_ai_Slack__*,mcp__claude_ai_Gmail__*,mcp__claude_ai_Google_Calendar__*"

# Scrub anything that looks like a credential, then fail if any marker is left.
SCRUBBED="$OUT.tmp"
sed -E \
  -e 's/sk-ant[A-Za-z0-9_-]*/[REDACTED]/g' \
  -e 's/[Bb]earer( +[A-Za-z0-9._~+\/=-]+)?/[REDACTED]/g' \
  -e 's/[Oo][Aa]uth[A-Za-z0-9_-]*/[REDACTED]/g' \
  "$OUT" > "$SCRUBBED" && mv "$SCRUBBED" "$OUT"

if grep -Eqi 'sk-ant|bearer|oauth' "$OUT"; then
  echo "token marker left in $OUT; delete the file" >&2
  exit 2
fi

echo "$OUT"
