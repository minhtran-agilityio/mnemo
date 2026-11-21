#!/usr/bin/env bash
# Proof for #19: two tiny REAL `claude -p` runs through the Mnemo runner.
#   1. the test prompt gives an answer;
#   2. a tool that is not in the allowed list (Bash, with only Read allowed) is refused.
# One command: bash scripts/ai-runner-proof.sh
# Each run uses a little Claude usage. It writes nothing into the repo and never reads the token.
# The output is scrubbed: lines with an email address, "token", "session_id" or "uuid" are dropped,
# so it can be pasted into a pull request description.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v claude >/dev/null 2>&1 || { echo "claude not found in PATH" >&2; exit 1; }
echo "claude: $(claude --version 2>/dev/null | head -n 1)"
echo "os: $(uname -srm)"

OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT
MNEMO_REAL_AI_PROOF=1 cargo test --manifest-path "$ROOT/src-tauri/Cargo.toml" --lib ai::proof \
  -- --ignored --nocapture --test-threads=1 >"$OUT" 2>&1
STATUS=$?
grep -E '^(answer: |refused tools: |test ai::proof|test result)' "$OUT" | grep -viE '@|token|session_id|uuid'
if [ "$STATUS" -ne 0 ]; then
  echo "proof FAILED (exit $STATUS)"
  grep -E '^(error|thread|  left|  right)' "$OUT" | grep -viE '@|token|session_id|uuid' | head -n 10
fi
exit "$STATUS"
