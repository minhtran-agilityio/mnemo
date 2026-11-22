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

## Window and tray

Mnemo opens one window and needs no sign-in or network at start. Closing the window keeps Mnemo running in the tray. The tray item has two entries: Open (shows the window again) and Quit (stops the app). A second start focuses the running window. Window size and position are kept across restarts.

- Folders: the data folder is the Tauri `app_data_dir`; Mnemo's own config is in `~/.config/mnemo/`. Only `src-tauri/src/system/paths.rs` builds these paths.
- Log: errors go to `mnemo.log` in the data folder. It holds no tokens and no private content.
- Ubuntu without a tray area (GNOME without the AppIndicator extension): at start Mnemo asks D-Bus for a StatusNotifier watcher. If there is none, closing the window minimises it instead of hiding it, so the window is never lost.
- macOS: **Unverified** until the owner checks the Mac. The tray, close-to-hide, single instance and saved window position are not yet run there.

## Other commands

- `npm run build` type-checks the UI and builds it into `dist/`.
- `npm run build:dev` builds the UI like `npm run build`, in development mode, so dev-only parts (the Storehouse section and its UI Catalog) are kept.

## Builds

There are two installable builds. Both are made for the current platform (`.app` and `.dmg` on macOS, `.deb` and `.AppImage` on Ubuntu) into `src-tauri/target/release/bundle/`.

| Build | Command | App name | Bundle id and data folder | Storehouse |
| --- | --- | --- | --- | --- |
| Release | `npm run bundle` | Mnemo | `io.mnemo.desktop` | Hidden |
| Dev | `npm run bundle:dev` | Mnemo Dev | `io.mnemo.desktop.dev` | Shown |

The dev build reads `src-tauri/tauri.dev.conf.json` on top of `src-tauri/tauri.conf.json`. Its own bundle id gives it its own data folder, so it never touches the release build's notes, and both can be installed and run at the same time. Mnemo's own config folder, `~/.config/mnemo/`, does not depend on the bundle id, so the two builds share it. Add `-- --bundles dmg` to make only the `.dmg` on macOS. Each bundle command empties the bundle folder first, so copy a `.dmg` out before you build the other one. Neither build is signed; a copy moved to another Mac is allowed the same way as a release download (see Install, macOS). The release workflow below publishes only the release build.

`npm run tauri dev` runs the app from source with live reload; it also shows Storehouse but uses the release data folder.

## Data folder

Mnemo keeps all its data in one SQLite file named `mnemo.db` inside the Tauri app data folder (`~/.local/share/io.mnemo.desktop/` on Ubuntu, `~/Library/Application Support/io.mnemo.desktop/` on macOS). The file is created on first start and updated by numbered migrations when the app opens. If the file cannot be opened, the Mnemo window opens on a plain error page instead of the app, and nothing is deleted. The page shows only a short reason; the full error, which can name file paths, is printed to the terminal. If even that window cannot be built, Mnemo prints the error and exits with code 1. The error page was checked in a real window on Ubuntu 22.04; on macOS it is **Unverified**.

Do not put this file in Dropbox, iCloud Drive or any other synced folder. Syncing a live SQLite file can corrupt it. There is no sync in version 1. The sections below say how to back up, restore, export and reset. Settings > Data shows the real data folder path and the same copy commands, and has an Open data folder button.

### Back up

There is no "Back up now" button. A backup is a copy of the whole data folder (the database and the `files/` folder), so close Mnemo first.

1. Close Mnemo first: choose Quit from the tray icon. Closing the window only hides it.
2. Copy the folder. On Ubuntu 22.04:

   ```
   cp -a "$HOME/.local/share/io.mnemo.desktop" ~/mnemo-backup-$(date +%Y-%m-%d-%H%M%S)
   ```

   On macOS (Apple Silicon):

   ```
   cp -Rp "$HOME/Library/Application Support/io.mnemo.desktop" ~/mnemo-backup-$(date +%Y-%m-%d-%H%M%S)
   ```

3. Start Mnemo again.

### Restore

1. Quit Mnemo from the tray icon.
2. Move the current data folder aside (do not delete it yet), for example `mv "<data folder>" "<data folder>.old"`.
3. Copy the backup folder to the data folder path. On Ubuntu 22.04: `cp -a ~/mnemo-backup-YYYY-MM-DD-HHMMSS "$HOME/.local/share/io.mnemo.desktop"`. On macOS: `cp -Rp ~/mnemo-backup-YYYY-MM-DD-HHMMSS "$HOME/Library/Application Support/io.mnemo.desktop"`.
4. Start Mnemo. It opens with all the data of the backup. Delete the `.old` folder when you are sure.

### Export

Settings > Data > Export asks for a folder in a native folder dialog and makes a new `mnemo-export-<date>-<time>/` folder inside it. It never overwrites an existing folder. The export holds `notes/` (one Markdown file per note), one JSON file each for bookmarks, ideas, projects, tasks, events, runs, memories, labels, links and files, and a copy of `files/`. Deleted items are not exported. An export is for reading and for other tools; importing it back into Mnemo is not part of version 1. Use a backup to move Mnemo to another machine.

### Reset

Settings > Data > Reset deletes everything: the whole database (all items, labels, links, settings and the theme) and the `files/` folder. Mnemo then starts empty, as after a fresh install. Reset makes no backup. Type `RESET` in the dialog to confirm; Cancel leaves all data. Export or back up first. The error log is not deleted.

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

## Spikes

`spikes/spike-01-tauri/` is a throwaway Tauri test for DEC-01. It is not part of the app. `npm run check` does not format, lint or build it, but one acceptance test (`tests/acceptance/spike-01.test.mjs`) reads its files, so `npm test` includes it. Build steps and results: `docs/spikes/spike-01-tauri.md`.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`. It has three jobs:

| Check name | Runner | What it does |
| --- | --- | --- |
| `Detect code changes` | Ubuntu 22.04 | Lists the changed files and decides whether the build and tests must run. |
| `macos-latest` | macOS on Apple Silicon | Build and tests. Skipped for a docs-only change. |
| `ubuntu-22.04` | Ubuntu 22.04 | Build and tests. Skipped for a docs-only change. |
| `CI result` | Ubuntu 22.04 | Passes when the build and tests passed or were skipped; fails otherwise. |

A docs-only change touches only `*.md`, `*.markdown` or `*.txt` files, `LICENSE*`, or files under `docs/`, `notes/`, `specs/` or `.claude/`. `CLAUDE.md`, `README.md` and everything under `.github/`, `tests/`, `src-tauri/` and `ui/` always count as code, because the tests read them or the app compiles them. If you add a test that reads another doc, add that path to the code list in `ci.yml`.

Each build job installs the pinned Node and Rust toolchains, runs `npm run check`, then a debug build (`npx tauri build --debug --no-bundle`). The npm and Cargo dependencies are cached, so a run with no dependency change is shorter. A feature is done only when both build checks are green.

### Make the CI result required on `main`

A repository admin does this once. It cannot be done from a pull request.

1. Open the repository on GitHub, then Settings, Branches.
2. Under "Branch protection rules" choose "Add branch protection rule" (or edit the rule for `main`). Set "Branch name pattern" to `main`.
3. Tick "Require a pull request before merging".
4. Tick "Require status checks to pass before merging", then "Require branches to be up to date before merging".
5. In the status check search box add `CI result`. Do not add `macos-latest` or `ubuntu-22.04`: they are skipped for a docs-only change and never report, so such a pull request could not merge. A check appears in the list only after it has run once in the last week.
6. Click "Create" (or "Save changes").

Status: **Unverified** that this is set on the repository; see the pull request for the result.

## How to release

The version number lives in one place: `version` in `package.json`. `src-tauri/tauri.conf.json` reads it from there. `src-tauri/Cargo.toml`, the `mnemo` entry in `src-tauri/Cargo.lock` and the root version in `package-lock.json` cannot read it, so tests (`tests/version-sync.test.mjs` and `tests/acceptance/setup-06.test.mjs`) fail if they differ.

1. Bump the version: set the same number in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (run `cargo check --manifest-path src-tauri/Cargo.toml` to update it) and `package-lock.json` (run `npm install --package-lock-only`), then run `npm run check` and commit.
2. Tag the commit with the same number: `git tag v0.2.0`.
3. Push the tag: `git push origin v0.2.0`. The workflow `.github/workflows/release.yml` also runs by hand from the Actions tab (workflow_dispatch).
4. Wait for both jobs to finish. They attach a macOS Apple Silicon `.dmg`, an Ubuntu `.deb` and an `.AppImage` to one draft release named after the version in `package.json`.
5. Open the draft on GitHub, check the three files, then publish it.

The bundles are not signed or notarized (no Apple developer account is assumed). There is no auto-update; install a new version by hand.

## Install

Download the files from the latest published release on the repository's Releases page.

### macOS (Apple Silicon)

1. Open the `.dmg` and drag Mnemo to Applications.
2. Open Mnemo from Applications. macOS blocks the first launch because the app is unsigned. Allow it once: open System Settings > Privacy & Security, scroll down to the blocked Mnemo message and choose "Open Anyway". On macOS 15 and later, right-click then Open no longer works for unsigned apps. Advanced: remove the quarantine flag in Terminal with `xattr -dr com.apple.quarantine /Applications/Mnemo.app`.

### Ubuntu 22.04

- `.deb`: run `sudo apt install ./Mnemo_<version>_amd64.deb`. Mnemo then appears in the application launcher.
- AppImage: run `chmod +x Mnemo_<version>_amd64.AppImage`, then start it with `./Mnemo_<version>_amd64.AppImage`.

### Open manual checks

Status: **Unverified**. These need the owner's own machines and are not done:

- [ ] The `.dmg` installs on the Mac, and the app opens after the one-time allow step.
- [ ] The `.deb` installs on Ubuntu 22.04 and Mnemo shows in the launcher.
- [ ] The AppImage starts on Ubuntu 22.04.
- [ ] An upgrade over an older install keeps the data (checkable after the storage issue #13).

## Environment variables

| Variable | Effect |
| --- | --- |
| `MNEMO_FAKE_AI` | `1` starts Mnemo with the fake AI runner (fixed test answers, no Claude usage). Settings > AI then shows a Fake AI banner. Any other value leaves the real runner on. |

New variables are listed here when they are added.
