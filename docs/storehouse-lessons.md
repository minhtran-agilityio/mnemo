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
