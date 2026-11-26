# Save eval (#30, BM-04)

One command scores the save summaries on a fixed set of stored pages, so a change of prompt or model can be
compared with numbers.

```
bash scripts/save-eval.sh                          # one eval: 36 real `claude -p` runs (also: `run`)
bash scripts/save-eval.sh compare <a.json> <b.json>  # spread between two results, no runs
bash scripts/save-eval.sh rescore <in> <out> <note>  # score a stored result again, no runs
bash scripts/save-eval.sh usage                      # 2 tiny runs: the usage percent twice
```

Any other argument prints the usage and starts nothing. It is not part of `npm test`, `npm run check` or CI: it uses the owner's Claude subscription. It prints a score
per page, the total, `runs used: N`, and the usage percent before and after.

- **Pages:** `evals/save/pages/`, raw HTML (17 readable, 3 hand-made unreadable). `evals/save/SOURCES.md` has the
  source and licence of each (**Unverified**). `evals/save/expected.json` has, per page, the expected facts, the
  expected tags and what must not appear.
- **How a page is scored:** the stored HTML goes through the real HTML-to-text step. An unreadable page scores 1
  only when that step gives it up (the save stays link only, no summary, no run). A readable page goes through
  the real save task (`bookmark_save::task`) and scores the mean of four parts: a valid answer inside the length
  limits, no forbidden text, a tag overlap, and the share of expected facts that a Claude judge (Sonnet, low
  effort, `evals/save/judge.md`) finds in the summary. The total is the sum of the page scores.
- **A failed run is not a bad score.** When a run fails for a reason outside the answer (usage limit, timeout,
  Claude missing, a failed exit), the page is `NOT SCORED`, the eval stops, exits non-zero and writes no result.
  Only a bad answer (it does not match the schema) scores 0 for that part.
- **Runs happen in** `~/.cache/mnemo-eval/` (an owner-only folder under the home folder, like the app).
- **Code:** `src-tauri/src/ai/save_eval.rs`, an `#[ignore]` test gated by `MNEMO_SAVE_EVAL=1`, built like
  `ai/proof.rs`. The runner guard in `ai/runner.rs` is unchanged.
- **Results:** `evals/save/results/<date>.json`. `baseline.json` is the first one.
- **Usage percent:** one tiny stream-mode probe run before the pages and one after (2 runs, counted in
  `runs used`; `bash scripts/save-eval.sh usage` runs the pair alone, its output is in
  `evals/save/results/usage-probe-2026-11-26.txt`). The json output that the save uses gave no
  five-hour reading on Ubuntu with Claude Code 2.1.332, the stream does. The first baseline and the second eval of 2026-11-26
  ran before the probes existed, so their usage numbers are `null`. **Unverified:** the scale of the number (see `docs/spikes/spike-02-claude-p.md`).
