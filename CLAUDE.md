# Mnemo

Mnemo is a local-first Tauri 2 desktop app: a Rust core in `src-tauri/`, a web UI in `ui/`, one SQLite file, and AI through `claude -p`. The roadmap and the architecture page stay the source of truth:

- Roadmap: https://claude.ai/artifact/Q7awHkWEPD75CfJ3xZksJH
- Architecture: https://claude.ai/artifact/X5UpnELuZDh6vJYU428J7G

## Commands

- `npm test`: run all tests.
- `npm run lint`: lint the TypeScript and Rust code.
- `npm run check`: format, lint, type check and tests. Run it before every commit.

## Run and test

- Test: `npm test` (cargo tests, then vitest, then the node acceptance tests).
- Targeted test: `cargo test --manifest-path src-tauri/Cargo.toml <test_name>` for Rust, `npx vitest run <path>` for the UI, `MNEMO_NESTED=1 node --test --test-isolation=none tests/<file>.test.mjs` for a node test.
- Lint: `npm run lint` (biome, then cargo clippy with warnings denied).
- Full suite: `npm run check` (format check, lint, type check and tests).

## Shared rules (every feature follows these)

1. Honest failure: if the app could not read something, it saves the link only, with no summary. A reason the app wrote is marked as a guess.
2. Nothing moves, deletes or sends without the owner. Any write outside Mnemo waits for approval.
3. The app works when AI is off or at the usage limit.
4. No Claude sign-in inside Mnemo. Mnemo never reads or stores the Claude token.
5. One storage module. Only it reads and writes data files.
6. No embeddings. Search and the graph use plain code rules.
7. Colours come from tokens only.
8. Unchecked facts are marked "Unverified".
9. UI comes from `ui/src/ds` only. Ask the Storehouse keeper session `Mnemo Storehouse` about each part first; a missing part goes through a UI component request (DESIGN.md §8); only the ui-designer agent edits `ui/src/ds/**`.

## Working rules

- One issue is one pull request.
- Every Rust function that touches data has a test.
- Done means it passes on both machines: macOS (Apple Silicon) and Ubuntu 22.04.

## More detail

Layer-specific rules live in `.claude/rules/` (technical, backend, frontend, database, design).
