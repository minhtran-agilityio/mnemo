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

## Environment variables

None yet. New variables are listed here when they are added.
