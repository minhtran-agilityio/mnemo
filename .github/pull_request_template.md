## Linked issue

Closes #

## What changed

-

## How it was tested

- [ ] Mac (Apple Silicon): `npm run check` passes
- [ ] Ubuntu 22.04: `npm run check` passes

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
