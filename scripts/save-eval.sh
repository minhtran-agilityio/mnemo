#!/usr/bin/env bash
# The save eval (#30): scores the save summaries on the fixed pages in evals/save/ through the REAL
# `claude -p` runner. One command: bash scripts/save-eval.sh
#   bash scripts/save-eval.sh compare <a.json> <b.json>   the spread between two results (no runs)
#   bash scripts/save-eval.sh rescore <in.json> <out.json> <note>   score a stored result again with the
#     current expectations, from its stored summaries and judge answers (no runs)
#   bash scripts/save-eval.sh usage                         one tiny run: print the usage percent now
# It is not part of `npm test`, `npm run check` or CI. One eval starts about 34 `claude -p` runs and uses
# the owner's Claude usage. It prints a score per page, the total, "runs used: N" (the 2 usage
# probe runs included) and the usage % before and after (Unverified scale). The result goes to evals/save/results/<date>.json (-2, -3 ... when the
# file exists). It never reads the Claude token.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${1:-}" = "compare" ]; then
  [ $# -eq 3 ] || { echo "usage: bash scripts/save-eval.sh compare <a.json> <b.json>" >&2; exit 2; }
  node -e '
    const fs = require("fs");
    const [a, b] = process.argv.slice(1).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
    const mean = (a.total + b.total) / 2;
    const spread = mean === 0 ? 0 : (Math.abs(a.total - b.total) / mean) * 100;
    console.log(`total a: ${a.total.toFixed(3)} of ${a.max_total}`);
    console.log(`total b: ${b.total.toFixed(3)} of ${b.max_total}`);
    console.log(`spread: ${Math.abs(a.total - b.total).toFixed(3)} points, ${spread.toFixed(1)}% of the mean total${spread > 5 ? " (OVER 5%: flag it in the pull request)" : ""}`);
    for (const id of Object.keys(a.pages)) {
      const d = Math.abs(a.pages[id].score - (b.pages[id] ? b.pages[id].score : 0));
      if (d > 0) console.log(`  differs: ${id}: ${a.pages[id].score.toFixed(2)} vs ${b.pages[id] ? b.pages[id].score.toFixed(2) : "missing"}`);
    }
  ' "$2" "$3"
  exit $?
fi

if [ "${1:-}" = "rescore" ]; then
  [ $# -eq 4 ] || { echo "usage: bash scripts/save-eval.sh rescore <in.json> <out.json> <note>" >&2; exit 2; }
  MNEMO_SAVE_RESCORE_FROM="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")" \
    MNEMO_SAVE_EVAL_RESULT="$(cd "$(dirname "$3")" && pwd)/$(basename "$3")" MNEMO_SAVE_RESCORE_NOTE="$4" \
    cargo test --manifest-path "$ROOT/src-tauri/Cargo.toml" --lib ai::save_eval::rescore_a_stored_result \
    -- --ignored --nocapture --test-threads=1 2>&1 | grep -oE 'eval: .*|^error.*|panicked.*' | sed 's/^eval: //'
  exit "${PIPESTATUS[0]}"
fi

if [ "${1:-}" = "usage" ]; then
  MNEMO_SAVE_EVAL=1 cargo test --manifest-path "$ROOT/src-tauri/Cargo.toml" --lib ai::save_eval::usage_probe_once \
    -- --ignored --nocapture --test-threads=1 2>&1 | grep -oE 'eval: .*|^error.*|panicked.*' | sed 's/^eval: //'
  exit "${PIPESTATUS[0]}"
fi

command -v claude >/dev/null 2>&1 || { echo "claude not found in PATH" >&2; exit 1; }
DATE="$(date +%F)"
OUT="$ROOT/evals/save/results/$DATE.json"
N=2
while [ -e "$OUT" ]; do OUT="$ROOT/evals/save/results/$DATE-$N.json"; N=$((N + 1)); done
echo "claude: $(claude --version 2>/dev/null | head -n 1)"
echo "os: $(uname -srm)"

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT
MNEMO_SAVE_EVAL=1 MNEMO_SAVE_EVAL_DATE="$DATE" MNEMO_SAVE_EVAL_RESULT="$OUT" \
  cargo test --manifest-path "$ROOT/src-tauri/Cargo.toml" --lib ai::save_eval::save_eval \
  -- --ignored --nocapture --test-threads=1 >"$LOG" 2>&1
STATUS=$?
grep -oE 'eval: .*' "$LOG" | sed 's/^eval: //'
if [ "$STATUS" -ne 0 ]; then
  echo "eval FAILED (exit $STATUS)"
  grep -E '^(error|thread|  left|  right)' "$LOG" | head -n 10
fi
exit "$STATUS"
