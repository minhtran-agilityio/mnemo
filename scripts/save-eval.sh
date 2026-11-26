#!/usr/bin/env bash
# The save eval (#30): scores the save summaries on the fixed pages in evals/save/ through the REAL
# `claude -p` runner. One command: bash scripts/save-eval.sh   (or: bash scripts/save-eval.sh run)
#   bash scripts/save-eval.sh compare <a.json> <b.json>   the spread between two results (no runs)
#   bash scripts/save-eval.sh rescore <in.json> <out.json> <note>   score a stored result again with the
#     current expectations, from its stored summaries and judge answers (no runs)
#   bash scripts/save-eval.sh usage                         2 tiny runs: print the usage percent twice
#   bash scripts/save-eval.sh --help                        this list (an unknown argument runs nothing)
# It is not part of `npm test`, `npm run check` or CI. One eval starts about 34 `claude -p` runs and uses
# the owner's Claude usage. It prints a score per page, the total, "runs used: N" (36 for a
# full eval: 17 pages x 2 runs plus 2 usage probe runs) and the usage % before and after (Unverified scale). The result goes to evals/save/results/<date>.json (-2, -3 ... when the
# file exists). It never reads the Claude token.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USAGE='usage: bash scripts/save-eval.sh [run] | compare <a.json> <b.json> | rescore <in.json> <out.json> <note> | usage | --help
  run (or no argument)  start the real eval: 36 `claude -p` runs, uses the Claude subscription
  compare, rescore      read stored results only, no run
  usage                 2 tiny runs: print the usage percent twice'

case "${1:-run}" in
  -h | --help | help) echo "$USAGE"; exit 0 ;;
  run) [ $# -le 1 ] || { echo "$USAGE" >&2; exit 2; } ;;
  compare) [ $# -eq 3 ] || { echo "$USAGE" >&2; exit 2; } ;;
  rescore) [ $# -eq 4 ] || { echo "$USAGE" >&2; exit 2; } ;;
  usage) [ $# -eq 1 ] || { echo "$USAGE" >&2; exit 2; } ;;
  *) echo "unknown argument: $1" >&2; echo "$USAGE" >&2; exit 2 ;;
esac

if [ "${1:-}" = "compare" ]; then
  [ $# -eq 3 ] || { echo "usage: bash scripts/save-eval.sh compare <a.json> <b.json>" >&2; exit 2; }
  node -e '
    const fs = require("fs");
    const [a, b] = process.argv.slice(1).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
    if (a.max_total !== b.max_total || Object.keys(a.pages).sort().join() !== Object.keys(b.pages).sort().join())
      console.log("WARNING: the two results do not hold the same pages, so the spread is not comparable");
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
  IN_DIR="$(cd -- "$(dirname -- "$2")" && pwd)" || { echo "folder of $2 not found" >&2; exit 2; }
  OUT_DIR="$(cd -- "$(dirname -- "$3")" && pwd)" || { echo "folder of $3 not found" >&2; exit 2; }
  MNEMO_SAVE_RESCORE_FROM="$IN_DIR/$(basename -- "$2")" \
    MNEMO_SAVE_EVAL_RESULT="$OUT_DIR/$(basename -- "$3")" MNEMO_SAVE_RESCORE_NOTE="$4" \
    cargo test --manifest-path "$ROOT/src-tauri/Cargo.toml" --lib ai::save_eval::rescore_a_stored_result \
    -- --ignored --nocapture --test-threads=1 2>&1 | grep -oE 'eval: .*|^error.*|panicked.*' | sed 's/^eval: //'
  exit "${PIPESTATUS[0]}"
fi

if [ "${1:-}" = "usage" ]; then
  MNEMO_SAVE_EVAL=1 cargo test --manifest-path "$ROOT/src-tauri/Cargo.toml" --lib ai::save_eval::usage_probe_pair \
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
