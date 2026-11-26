## Linked issue

Closes #

## What changed

-

## How it was tested

- [ ] Mac (Apple Silicon): `npm run check` passes
- [ ] Ubuntu 22.04: `npm run check` passes

## Screenshots

Every pull request has screenshots, whatever it changes. Attach them before review. Rules and how to attach: `.claude/rules/technical.md` (Change hygiene).

- How to attach: `gh pr comment <n> --attach <file>` only if `gh pr comment --help` lists `--attach` (gh 2.97.0 does not). Otherwise use the `pr-evidence` branch under `pr-<n>/` and post a comment with pinned `raw.githubusercontent.com` URLs. Design-system pull requests keep `pr-assets`. Never commit screenshots to the pull request's own branch.

- [ ] Changes a screen: before and after of each changed screen (light theme at least; dark too when colours change).
- [ ] No screen (Rust, data, scripts, docs): a screenshot of the evidence, such as the test run or the command output that shows the change works.
- [ ] No personal data, secrets or private text in any screenshot (this repository is public): no home paths, environment values, tokens, or real saved links or notes.

## Shared rules

- [ ] Honest failure: if something could not be read, only the link is saved, with no summary. A reason the app wrote is marked as a guess.
- [ ] Nothing moves, deletes or sends without the owner. Any write outside Mnemo waits for approval.
- [ ] The app works when AI is off or at the usage limit.
- [ ] No Claude sign-in inside Mnemo. Mnemo never reads or stores the Claude token.
- [ ] One storage module. Only it reads and writes data files.
- [ ] No embeddings. Search and the graph use plain code rules.
- [ ] Colours come from tokens only.
- [ ] Unchecked facts are marked "Unverified".
- [ ] UI comes from `ui/src/ds` only. A missing part goes through a UI component request; only the ui-designer agent edits `ui/src/ds/**`.
- [ ] `ui/src/ds` changed → the pull request has the label `design-system` (or `ui/src/ds` did not change).

## Working rules

- [ ] This pull request covers one issue.
- [ ] Every Rust function that touches data has a test.
