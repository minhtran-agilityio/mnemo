# Storehouse lessons

One running log of what went wrong or failed while the Storehouse keeper got UI parts built
(`.claude/storehouse-keeper.md`, `.claude/agents/ui-designer.md`, DESIGN.md section 8). The keeper adds
one section per design round, in the same pull request, and never rewrites an older one. A later review
pass reads the whole file and decides what to change in the keeper role, the ui-designer agent and the
request template.

Rules for an entry: facts from that round only; a cause nobody checked is marked "Unverified"; no
praise, no summary of what worked unless it changes a rule.

## Round 1 (2026-11-20): label tree (#126), label picker (#127), Markdown view (#128), idea board (#129)

Asks: 16 UI-ASK messages from two sessions. 8 were answered from the catalog (UI-EXISTS), 8 became 4
requests (UI-QUEUED). Pull requests: #132, #131, #133, #134.

### What went wrong

- **Code review found important bugs after the designer reported "done" with a green `npm run check`.**
  Every pull request needed at least one fix round; the tree needed three.
  - Tree (#132): after a rename the tree kept the old name in its own state; the inline field closed on
    any blur and lost the typed name; focus was lost on an empty tree after a create; Delete on another
    node could run while a rename field was open; the default node id was the label text, so two
    labels called "Notes" under different parents gave ambiguous events (wrong label deleted).
  - Picker (#131): two nodes with the same path shared one map entry; the "Current" marker was never
    announced; disabled nodes still showed pressed styles; the error live region was hidden when it
    changed; focus jumped into the tree after a chip was removed.
  - Markdown view (#133): links could be opened by middle-click or the context menu without reaching
    `onLinkClick` (breaks shared rule 2); ordered lists restarted at "1."; "# Learning C#" lost its "#";
    a line with inline triple backticks swallowed the rest of the note.
  - Board (#134): a long unbroken title overflowed the open card; the pressed state of the open card did
    nothing; the card types allowed `current` without `onOpen`.
- **Same defect classes in several parts**, so they are not one-off slips:
  - Accessibility of state changes: focus after a remove, create or cancel; live regions; names that hide
    a marker such as "Current".
  - Keys that collide: ids or paths built from names.
  - A border-width token used as a spacing gap (`--border-2`): found in 3 of the 4 pull requests.
  - Forced catalog states that did not stay held or did not match the real behaviour (tree "renaming",
    held menu, markdown "focus" listed but not shown).
  - State kept in the part while the screen owns the data (tree rename, created names).
  - A test that depended on the clock (`Date.now() - t < 3000`).
- **A new rule was found in the existing parts only by reading them.** `createKanbanBoard` with `drag`
  off still moved cards on Alt+Arrow, and the card was a div. The registry entry did not say so.
  `createSelect` takes only strings, so two items with the same title cannot be told apart. `createTree`
  reports only the label text. None of this is visible in the catalog notes.
- **The designer widened a shared part without being asked** (`popover` got a `held` option so a forced
  catalog state stays open). It was needed and tested, but it changes a part other screens use.
- **Screenshots went stale.** They were taken before the review fixes in #132 and #131 and had to be
  retaken; the first retake of #132 showed the open-menu example blank.
- **Green CI did not mean safe to merge.** #132 and #133 passed all checks while important review
  findings were still open.

- **Review rounds did not converge on the parts that took the most code.** The tree (#132) went through
  seven review rounds, the Markdown view (#133) four, the picker (#131) one. Each round found new
  problems in code added to fix the last round (async refusal with undo, reopen with focus, created-name
  tracking). The loop stopped only when the keeper cut the design down: the tree now only reports a
  rename or create and the screen re-renders (net code went down), and the last Markdown round was
  declared final with the rest listed as "Known limits" in the pull request.
- **Untrusted-text parsing had hangs and quadratic scans that tests did not cover.** A heading regex that
  backtracked on a long run of spaces; a list item that was a thematic break looped forever
  (`- a` then `  - - -`); a long run of blank lines in an item was quadratic; the nesting cap could be
  bypassed with mixed list and quote nesting. Each was found by review, one case at a time. A seeded fuzz
  test (3000 generated sources, no clock) was added only in round 3.
- **The merged tree still had one known important issue.** The owner asked to merge #132 while the last
  fix (the native context menu showing over the node menu on the ContextMenu key) was uncommitted in the
  designer's worktree. It shipped as follow-up PR #139. A merge request that arrives while a designer is
  mid-fix needs the designer's last state checked first.

### What failed in the process

- Three designer agents and the board agent were stopped by a session restart and then by the 5-hour
  usage limit before they had a commit. Their branches and worktrees existed but were empty. Resuming
  them by message worked.
- The Rust test `storage::items::tests::two_writers_on_one_file_save_100_notes_and_lose_none` failed once
  with "database is locked" inside the full `npm run check` in two agents' runs, and passed 4 of 4 when
  run alone. Cause: Unverified (the agents suspect load from parallel sessions).
- #131 failed `ubuntu-22.04` in CI once; the failing step was not identified from the log excerpt. A
  later push had that check pending, not failed. Cause: Unverified.
- A push to `feat/126-ui-tree-actions` was rejected once with no reason shown; a plain retry went through.
- An agent could not stop its own dev server (`pkill` denied); a server stayed running on port 1420 and
  5199.
- `merge-guard` blocked a plain `gh pr merge 134 --repo ...`; it needs `--match-head-commit <sha>`.
- The keeper sent one `SendMessage` to a mistyped socket address (missing `/1000/cc-socks/`) and got
  ENOENT; the real address came from the incoming message's `from`.
- Reviews were run on the first ready state, then again after fixes: three rounds on #132. A review
  of the delta only (the new code) would have been enough from round 2.

### Candidate changes to look at in the review pass

These are suggestions from this round, not decisions.

1. Add a "known traps" checklist to the ui-designer agent: focus after every add, remove, create, cancel;
   live regions that stay in the page; ids that never come from names; spacing tokens for gaps; forced
   catalog states that stay held and match real behaviour; no clock in tests.
2. Run the code review once before marking a design pull request ready, not after, and run later rounds
   on the delta only.
3. Put the behaviour that is not visible in the catalog (Alt+Arrow always moves, string-only select,
   label-only tree select) into the registry notes of those parts.
4. In the request template, ask whether the part may change a shared part; the designer states it in the
   pull request body if it does.
5. Retake screenshots as the last step after the last fix, and say the commit they were taken at.
6. Keeper: before replying UI-EXISTS, read the part's builder, not only the registry entry.
7. Fuzz test (fixed seed, no clock) from the first commit for any part that parses untrusted text.
8. Cap review rounds per pull request (for example three). After the cap, cut scope or list the rest as
   "Known limits" in the pull request body instead of adding more code.
9. Ask the designer to make a part report events only and leave data to the screen, unless the request
   needs the part to own the data.
10. Keeper: batch UI-ASK messages by part into one issue each, as done here; keep that.

## Round 2 (2026-11-22): usage meter (#145), AI-off state (#146), field error (#147), typed-word confirm (#152), copy line (#153), settings row (#154), inline select (#155)

Seven design-system pull requests (#149, #150, #151, #156, #157, #158, #159) from three feature sessions. All
merged by the keeper under the owner's standing order "auto merge when it passes review"; each merge pinned
the reviewed commit and waited for green CI on that commit.

### What went wrong

- **The same bug in each branch, found one round at a time.** A part that has a "disabled" or "error" state
  was fixed for one branch and failed for the next. `setSettingsRowDisabled` took three review rounds:
  re-enabling turned on controls the caller had disabled; then enabling with no earlier disable did the same.
  `setFieldError` and the copy line each hit the "live region is hidden while empty, so nothing is announced"
  trap, and `setFieldError` also re-wrote an unchanged message (announced again on every key) and used
  `isConnected` to mean "is inside the region".
- **Unverified facts stated as fact.** Round 1 of the usage meter let an unverified window drive the pause
  note; later the "figure is unverified" note was attached to any window, not the one driving the tone. The AI-off
  state printed a bare clock time as a reset time.
- **Honest failure at the edges.** NaN percent showed "NaN%" or a healthy tone with an empty note; an empty
  window list showed a meter that looked fine; a bad run count threw and would blank the screen.
- **Global CSS inside a feature part.** The typed-word confirm changed `overflow-wrap` for every `.lose` list.
- **A catalog example broke the layout rule.** #151's note text had one long unbreakable word; at 200% zoom the
  Controls tab was 17 px too wide. Only CI caught it (ds-09-limits, Ubuntu).

### What failed in the process

- **Designers skipped the node acceptance tests.** The first three designers ran biome, tsc and vitest only. The
  horizontal-scroll failure on #151 reached CI. After that the brief required the `ds-*.test.mjs` run before the
  pull request, and the later four passed it.
- **No designer saw a clean `npm run check`.** Every report says "ran the parts separately". Cause: the machine was
  loaded by several designers at once, and `ds-03-catalog-screen` has a 5 s per-test limit that times out under
  load (Unverified whether it also times out on a quiet main). Reports said "flake" each time without proof.
- **The reviewer read the diff only.** `code-review` ran on a checkout of main, so it said several times that it
  could not check a name or a file. A few findings were wrong or unverifiable (for example `ref(146)`); the
  designer had to confirm each one. Findings stated as "important" were real in most cases.
- **Review did not converge.** #149 needed four rounds, #151 four, #159 four. Each round found one more important
  item, mostly in a branch the last fix did not touch. Cap and delta-only review were already candidates in round 1
  (items 2 and 8); they were not applied.
- **Stopped agents.** Restarts and the owner's stop left three designers half done twice; one could not be resumed
  and a new designer had to be started in the old worktree. A message sent to a stopped agent was refused.
- **The keeper reported a wrong fact.** After merge day the keeper told the owner that the lessons pull request
  (#136) was still open. It had been merged on 2026-11-21. The keeper had stopped checking its state.
- **Stale peer address.** One feature session's socket path went stale; sending by name worked.
- **Shared scratchpad.** Two designers wrote screenshot scripts to the same scratchpad path and overwrote each
  other.

### Candidate changes to look at in the review pass

These are suggestions from this round, not decisions.

11. Add to the ui-designer "known traps": every state setter (disabled, error, busy) needs a test for enable-without-
    disable, same-value-twice, detached node, foreign element, and a control the caller had already disabled; a live
    region stays rendered while empty; text inside a catalog note can contain one long unbreakable word.
12. Make the node acceptance run (`MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/ds-*.test.mjs`)
    a hard step in the ui-designer brief before "ready", with the result in the PR body.
13. Run the code review on a checkout of the PR head (a worktree), not main, so the reviewer can open the files.
14. Give the ds-03 vitest suite a longer per-test timeout, or measure whether it is slow on a quiet machine.
15. Limit the number of designers in parallel by machine load (three at once was too many for the full test runs).
16. Give each designer its own scratch folder (`scratchpad/p<issue>/`) in the brief.
17. Rule in the brief: no change to global selectors in a feature PR; scope new CSS to the part's own class.
18. Keeper: check the state of any PR with `gh pr view` before saying it is open or merged.
19. Keeper: when a designer is stopped, start a new one in the existing worktree with the full brief, only after the
    owner agrees.
