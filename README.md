# Mnemo

## What is Mnemo

Mnemo is a local-first desktop app built with Tauri 2. The Rust core lives in `src-tauri/` and the web UI (HTML, CSS, TypeScript) lives in `ui/`. The core has four modules, each with one job:

| Module | Owns |
| --- | --- |
| `storage` | Reading and writing local data |
| `ai` | Calls to language models |
| `scheduler` | When background work runs |
| `system` | OS integration |

The UI talks to the core through named Tauri commands. Today there is one, `ping`, which proves the bridge works: the window shows the text the Rust core returns.

## Prerequisites

Install these on a new machine before the first run.

### Both platforms

- Rust, through [rustup](https://rustup.rs). The exact version is pinned in `rust-toolchain.toml`; rustup installs it on first build.
- Node.js 24, pinned in `.nvmrc`. With nvm run `nvm install`, with fnm run `fnm use`.
- npm (comes with Node).

### Ubuntu 22.04

Install the Tauri system packages:

```sh
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### macOS (Apple Silicon)

Install the Xcode Command Line Tools:

```sh
xcode-select --install
```

Then install Rust (rustup) and Node as above. No other system packages are needed for desktop development.

## Run in dev mode

```sh
npm install
npm run tauri dev
```

The first run compiles the Rust core and takes several minutes. An empty window opens and shows the reply from the `ping` command.

## Other commands

- `npm run build` type-checks the UI and builds it into `dist/`.
- `npm run tauri build` makes a release bundle for the current platform.

## Test

Three commands cover everything. Run them from the repository root after `npm install`.

```sh
npm test            # tests only
npm run lint        # linters only
npm run check       # everything, stops at the first failure
```

`npm run check` runs, in this order: format check, lint, type check, tests. The cheapest failures come first.

| Job | Tool |
| --- | --- |
| Rust format | rustfmt (`cargo fmt --check`) |
| Rust lint (warnings are errors) | clippy |
| Rust tests | cargo test |
| UI lint and format | Biome |
| UI type check | tsc |
| UI unit tests | Vitest |

`npm test` also runs the acceptance tests in `tests/acceptance/` with the Node built-in runner. Those that install dependencies and inject faults into a copy of the project are skipped there; run `node --test "tests/acceptance/*.test.mjs"` to include them.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`. It has one job, run twice in a matrix:

| Check name | Runner |
| --- | --- |
| `macos-latest` | macOS on Apple Silicon |
| `ubuntu-22.04` | Ubuntu 22.04 |

Each job installs the pinned Node and Rust toolchains, runs `npm run check`, then a debug build (`npx tauri build --debug --no-bundle`). The npm and Cargo dependencies are cached, so a run with no dependency change is shorter. A feature is done only when both checks are green.

### Make both checks required on `main`

A repository admin does this once. It cannot be done from a pull request.

1. Open the repository on GitHub, then Settings, Branches.
2. Under "Branch protection rules" choose "Add branch protection rule" (or edit the rule for `main`). Set "Branch name pattern" to `main`.
3. Tick "Require a pull request before merging".
4. Tick "Require status checks to pass before merging", then "Require branches to be up to date before merging".
5. In the status check search box add `macos-latest` and `ubuntu-22.04`. A check appears in the list only after it has run once in the last week.
6. Click "Create" (or "Save changes").

Status: **Unverified** that this is set on the repository; see the pull request for the result.

## Environment variables

None yet. New variables are listed here when they are added.
