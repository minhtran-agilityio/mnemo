=== ISSUE SETUP-01
title: [SETUP-01] Scaffold the Tauri 2 project structure
type: Task
labels: priority:critical, area:infra
milestone: P1.1 Project setup and first test
---
**Phase:** P1 · **Size:** M (guess) · **Blocked by:** nothing

## Goal
Give the new code base one clear structure, so every later ticket knows where its code goes. This is a fresh start: no old code or old docs are reused.

## Proposed change
- Create a Tauri 2 project: a Rust core in `src-tauri/` and a web UI (HTML, CSS, TypeScript) in `ui/`.
- Split the Rust core into four modules with empty public interfaces: `storage`, `ai`, `scheduler`, `system` (tray, notifications). The architecture allows the core to do only these four jobs.
- The UI talks to the core only through named Tauri commands. Add one sample command (`ping`) to prove the bridge works.
- Replace the old `README.md` with a short new one: what Mnemo is, how to install the tools, how to run the app in dev mode.
- Add `.gitignore`, `rust-toolchain.toml` and a pinned Node version, so both machines build with the same tool versions.

## Acceptance criteria
- [ ] One documented command starts the app in dev mode on macOS (Apple Silicon) and on Ubuntu 22.04.
- [ ] An empty window opens, and the `ping` command returns a value from the Rust core to the UI.
- [ ] The four core modules exist and compile. Each has a one-line comment that says what it owns.
- [ ] No file from the old code base is left in the repo, except in Git history.
- [ ] The README lists every tool a new machine needs (Rust, Node, the Tauri system packages for Ubuntu).

## Out of scope
- Any real screen, storage or AI code.
- Lint, format and test scripts ({{SETUP-02}}) and CI ({{SETUP-03}}).
- The choice of UI library ({{SETUP-05}}).

## Evidence and links
- Architecture, sections "Shell và ngôn ngữ" and "Quy tắc code và test" (rule 1: small Rust core): {{ARCH}}
- Roadmap, decisions DEC-01 and DEC-02: {{ROADMAP}}
- Unverified: the exact Ubuntu system packages that Tauri 2 needs. Check the Tauri docs when you do this ticket.

=== ISSUE SETUP-02
title: [SETUP-02] Add format, lint and test scripts with one "check" command
type: Task
labels: priority:critical, area:infra
milestone: P1.1 Project setup and first test
---
**Phase:** P1 · **Size:** S (guess) · **Blocked by:** {{SETUP-01}}

## Goal
The owner cannot read Rust, so tests and checks are how quality is controlled. One command must tell anyone, on any machine, whether the code is healthy.

## Proposed change
- Rust: `cargo fmt --check`, `cargo clippy` with warnings as errors, `cargo test`.
- UI: TypeScript type check, a linter and formatter, and a unit test runner. Pick one tool per job and write the choice in the README.
- One top-level command (for example `npm run check`) runs all of the above and stops at the first failure.
- A second command runs only the tests, for fast re-runs.
- Add one real example test on each side (one Rust test, one UI test), so the runners are proven to work.

## Acceptance criteria
- [ ] `check` passes on a clean clone on macOS and on Ubuntu 22.04.
- [ ] A formatting error, a lint error, a type error and a failing test each make `check` fail with a clear message. Show one screenshot or log line per case in the pull request.
- [ ] The README has a "Test" section with the exact commands.
- [ ] The whole `check` run takes under 3 minutes on a warm build. If it does not, say the measured time in the pull request.

## Out of scope
- CI ({{SETUP-03}}).
- End-to-end tests that drive the real window. Decide later, when there are screens to test.
- Tests that call the real Claude. Those are never part of `check` (see {{AI-01d}}).

## Evidence and links
- Architecture, "Quy tắc code và test", rules 2 and 4: {{ARCH}}

=== ISSUE SETUP-03
title: [SETUP-03] CI on macOS and Ubuntu for every pull request
type: Task
labels: priority:critical, area:infra
milestone: P1.1 Project setup and first test
---
**Phase:** P1 · **Size:** S (guess) · **Blocked by:** {{SETUP-02}}

## Goal
Every pull request is checked and built on both systems before the owner reviews it. A feature is done only when it passes on both.

## Proposed change
- One GitHub Actions workflow that runs on every pull request and on pushes to `main`.
- A matrix with two jobs: `macos-latest` (Apple Silicon) and `ubuntu-22.04`.
- Each job runs the `check` command from {{SETUP-02}} and then a debug build of the app.
- Cache the Rust and Node dependencies so a normal run is short.
- Make both jobs required checks on `main` (branch protection). If the repo settings cannot be changed by the author, write the steps for the owner in the pull request.

## Acceptance criteria
- [ ] A pull request shows two checks, one per system, and both are green.
- [ ] A pull request with a failing test shows a red check on both systems.
- [ ] A second run with no dependency change uses the cache. Write the run time of both runs in the pull request.
- [ ] `main` cannot be merged into with a red check, or the manual steps for the owner are written down.

## Out of scope
- Release builds and installers ({{SETUP-06}}).
- Windows.
- Tests that need a real Claude login.

## Evidence and links
- Architecture, "Quy tắc code và test", rules 3 and 5: {{ARCH}}
- Unverified: GitHub Actions minutes for macOS runners cost more than Linux on a private repo. Check the plan of the `minhtran-agilityio` org before you make the workflow run on every push.

=== ISSUE SETUP-04
title: [SETUP-04] Issue template, PR template and CLAUDE.md with the shared rules
type: Task
labels: priority:high, area:infra
milestone: P1.1 Project setup and first test
---
**Phase:** P1 · **Size:** S (guess) · **Blocked by:** {{SETUP-01}}

## Goal
Write the rules that every feature follows once, in the repo, so each ticket and each Claude Code session does not have to repeat them.

## Proposed change
- `.github/ISSUE_TEMPLATE/feature.md` with the headings used in this tracker: Goal, Proposed change, Acceptance criteria, Out of scope, Evidence and links.
- `.github/pull_request_template.md` with: linked issue, what changed, how it was tested on Mac and on Ubuntu, and a checklist of the shared rules.
- `CLAUDE.md` at the repo root with the shared rules and the test commands. Keep it short.
- The shared rules, copied from the roadmap:
  1. Honest failure: if the app could not read something, it saves the link only, with no summary. A reason the app wrote is marked as a guess.
  2. Nothing moves, deletes or sends without the owner. Any write outside Mnemo waits for approval.
  3. The app works when AI is off or at the usage limit.
  4. No Claude sign-in inside Mnemo. Mnemo never reads or stores the Claude token.
  5. One storage module. Only it reads and writes data files.
  6. No embeddings. Search and the graph use plain code rules.
  7. Colours come from tokens only.
  8. Unchecked facts are marked "Unverified".
- The working rules from the architecture: one issue is one pull request, every Rust function that touches data has a test, done means it passes on both machines.

## Acceptance criteria
- [ ] A new issue opened from the template shows the five headings.
- [ ] A new pull request shows the template with the rule checklist.
- [ ] `CLAUDE.md` lists the 8 rules, the working rules and the commands from {{SETUP-02}}.
- [ ] `CLAUDE.md` is under 100 lines.

## Out of scope
- Long design docs. The roadmap and the architecture page stay the source of truth.
- Contribution rules for other people. This is a one-person project.

## Evidence and links
- Roadmap, "Rules every feature follows" and "How this maps to GitHub": {{ROADMAP}}
- Architecture, "Quy tắc code và test": {{ARCH}}

=== ISSUE SPIKE-01
title: [SPIKE-01] First test: empty Tauri app with the kanban screen on Mac and Ubuntu (closes DEC-01)
type: Task
labels: priority:critical, area:app, spike
milestone: P1.1 Project setup and first test
---
**Phase:** P1 · **Size:** M (guess) · **Blocked by:** {{SETUP-01}}

## Goal
Decide with measured numbers whether Tauri 2 stays, before any feature is built on it. Moving to Electron is cheap now and expensive later, because the Rust core would be rewritten in TypeScript.

## Proposed change
- Claude Code builds a throwaway version of the app that shows the heaviest prototype screen (the project kanban) with sample data, plus a tray icon with Open and Quit.
- The owner opens it on the Mac and on Ubuntu 22.04 and fills in the table below.
- The result is written to `docs/spikes/spike-01-tauri.md`. The roadmap and architecture pages are then updated by the owner's Claude project, not in this repo.

| Check | How to measure | Mac | Ubuntu |
| --- | --- | --- | --- |
| RAM when the app is open and idle | Activity Monitor, System Monitor | | |
| Time from click to first screen | Stopwatch, 3 runs | | |
| Kanban looks like the prototype | By eye, drag one card | | |
| Tray: close window, open again, Quit | Try it | | |

## Acceptance criteria
- [ ] The test app builds and opens on both machines from a documented command.
- [ ] All four rows are filled in for both machines, with numbers where the row asks for a number.
- [ ] The result file ends with one clear line: "DEC-01 closed: Tauri 2" or "DEC-01: switch to Electron", with the owner's reason.
- [ ] If the answer is Electron, a new ticket is opened to redo {{SETUP-01}}, and the tickets that name Rust are flagged.

## Out of scope
- Real data, storage or AI.
- Making the kanban work fully. It only needs to render and drag one card.
- A fixed pass number for RAM or start-up. The owner judges, because no target number was set.

## Evidence and links
- Architecture, "Bài test đầu tiên của P1" (pass and fallback conditions): {{ARCH}}
- Prototype, Projects kanban screen (v98 to v100): {{PROTO}}
- Unverified: all RAM numbers for Tauri and Electron. Nothing was measured on the owner's machines yet.

=== ISSUE SPIKE-02
title: [SPIKE-02] Test the Unverified facts about claude -p on Mac and Ubuntu
type: Task
labels: priority:critical, area:ai, spike
milestone: P1.1 Project setup and first test
---
**Phase:** P1 · **Size:** S (guess) · **Blocked by:** nothing (can run from a plain script, before the app exists)

## Goal
Three facts decide the design of the AI runner, the usage screen and the connectors. They are marked Unverified. Test them before code depends on them.

## Proposed change
Write one small script (`scripts/spike-claude-p.sh` or Python) that the owner runs on both machines. It runs `claude -p` with the planned flags and saves the raw output. Record the Claude Code version.

| Question | How to test |
| --- | --- |
| 1. Does `--output-format json` with `--json-schema` return valid JSON in `structured_output`? | Run a test prompt with a small schema. |
| 2. Does the `-p` output (json or stream-json) carry the share of the subscription limit already used? | Read the raw output for rate limit fields. |
| 3. Does `--setting-sources` (with `--settings`) stop the personal `CLAUDE.md` from loading? | Put a strange rule in the personal `CLAUDE.md` and see if the answer follows it. |
| 4. Does the Slack connector of the claude.ai account still work under `--strict-mcp-config`? And Gmail, Calendar? | Run one read-only call per connector. |
| 5. How much RAM and time does one `claude -p` process use? | Measure one run. |

## Acceptance criteria
- [ ] The script runs on both machines with one command and writes its raw output to a file. No token appears in that file.
- [ ] `docs/spikes/spike-02-claude-p.md` answers each of the 5 questions with Yes, No or "Still unverified", and shows the evidence line.
- [ ] If question 3 is No, the file says so in bold. The fallback is a separate Claude config folder (`CLAUDE_CONFIG_DIR`), which needs one more login per machine. The owner decides.
- [ ] If question 2 is No, the file says that {{AI-02}} uses the fallback: count runs and pause on a limit error.
- [ ] The result is linked from {{AI-01b}}, {{AI-01c}}, {{AI-02}} and {{CON-01}}.

## Out of scope
- Building the runner itself ({{AI-01b}}).
- Any change to the owner's personal Claude Code settings, apart from the temporary test rule, which is removed at the end.

## Evidence and links
- Architecture, "DEC-04", "DEC-06" and "Unverified, sẽ test ở P1": {{ARCH}}
- Claude Code docs, headless mode: https://code.claude.com/docs/en/headless
- Claude Code docs, CLI reference: https://code.claude.com/docs/en/cli-reference
- Claude Code docs, status line (`rate_limits` field): https://code.claude.com/docs/en/statusline

=== ISSUE SETUP-05
title: [SETUP-05] Choose the UI approach: plain TypeScript or one small library
type: Task
labels: priority:high, area:app, spike
milestone: P1.1 Project setup and first test
---
**Phase:** P1 · **Size:** S (guess) · **Blocked by:** {{SETUP-01}}

## Goal
Close the open question from the architecture page before the first real screen is written. The goal of the app is low RAM and a fast start, so the default is the lightest option.

## Proposed change
- Compare two or three options on one prototype screen (the same kanban as {{SPIKE-01}}): plain TypeScript, and one or two small libraries.
- For each option write: bundle size, how screens share state, how the prototype HTML and CSS are reused, and how easy it is to unit test.
- Write the choice and the reason in `docs/decisions/ui-approach.md`. Add the folder layout for screens and shared parts.

## Acceptance criteria
- [ ] The decision file names one choice, the options that lost and why, in under one page.
- [ ] The choice keeps the prototype HTML and CSS usable without a rewrite. Show one screen as proof.
- [ ] The owner has approved the choice in the pull request.
- [ ] {{SETUP-02}} has a working unit test for one UI part written with the chosen approach.

## Out of scope
- Building real screens.
- A design system or a component library.

## Evidence and links
- Architecture, "Open question" (UI framework) and "DEC-01 và DEC-02": {{ARCH}}
- Prototype (the design reference, a mock with sample data): {{PROTO}}

=== ISSUE SETUP-06
title: [SETUP-06] Release build: installable app for macOS and Ubuntu from one workflow
type: Task
labels: priority:high, area:infra
milestone: P1.1 Project setup and first test
---
**Phase:** P1 · **Size:** M (guess) · **Blocked by:** {{SETUP-03}}, {{SPIKE-01}}

## Goal
The owner installs Mnemo like a normal app on both machines and uses it every day. A build must not need a developer setup.

## Proposed change
- A GitHub Actions workflow that runs on a version tag (and by hand) and builds release bundles: a `.dmg` for macOS Apple Silicon, and a `.deb` plus an AppImage for Ubuntu.
- The bundles are attached to a draft GitHub release.
- One place holds the version number. A short "How to release" section goes in the README.
- Write install steps for both systems in the README, including the macOS step for an app that is not signed.

## Acceptance criteria
- [ ] A tag produces the three bundles in a draft release, with no manual step.
- [ ] The `.dmg` installs and opens on the owner's Mac.
- [ ] The `.deb` installs and opens on Ubuntu 22.04. The app shows in the app launcher.
- [ ] Installing a newer version over an older one keeps the data (re-check this when {{DATA-01a}} is done).
- [ ] The app version is visible somewhere in the app or in the tray menu.

## Out of scope
- Apple code signing and notarization. They need a paid Apple developer account. Unverified whether the owner has one. Without it, macOS asks the owner to allow the app once.
- Auto-update inside the app.
- Windows, Intel Mac, app stores.

## Evidence and links
- Roadmap, APP-01 ("One installable app per system"): {{ROADMAP}}
- Architecture, "Ràng buộc" (Mac Apple Silicon and Ubuntu 22.04.5 or newer): {{ARCH}}

=== ISSUE APP-01
title: [APP-01] Desktop app: window, tray, Quit, no sign-in, works offline
type: Feature
labels: priority:critical, area:app
milestone: P1.2 App shell
---
**Phase:** P1 · **Roadmap status:** not started · **Size:** L (guess) · **Blocked by:** {{SPIKE-01}}

## Goal
One app that opens the Mnemo window on macOS and Linux, with no sign-in screen, and keeps running in the tray so later jobs can run while the window is closed.

## Proposed change
- One main window. Its size and position are remembered between starts.
- Closing the window hides it and keeps Mnemo in the tray. The tray menu has Open and Quit. Only Quit stops the app.
- A second start of the app brings the running window to the front. It must not start a second copy, because two copies would open the same database.
- No sign-in screen and no network call at start. The app opens with the network off.
- Fixed folders: data in the system data folder for Mnemo, config in `~/.config/mnemo/`. One function in the core returns these paths. Nothing else builds paths by hand.
- A plain log file for errors, with no private content and no tokens.

## Acceptance criteria
- [ ] The app opens on the Mac and on Ubuntu 22.04 from the installed bundle ({{SETUP-06}}).
- [ ] With the network off, the app opens and shows its window.
- [ ] Closing the window leaves the tray icon. Open brings the window back in the same state. Quit ends the process (check in the system monitor).
- [ ] Starting the app twice gives one process and one window.
- [ ] The window size and position are kept after a restart.
- [ ] On Ubuntu, if the desktop has no tray area, closing the window minimises the app and does not hide it for good. Unverified: tray support on the owner's Ubuntu desktop. Test it.

## Out of scope
- Start at login. Not asked for.
- Jobs that run after Quit (LATER-07, {{LATER-07}}).
- "Data is still there after close and open". That is checked once storage exists ({{QA-P1}}).
- Notifications (first needed in P4).

## Evidence and links
- Roadmap, APP-01: {{ROADMAP}}
- Architecture, "Sơ đồ kiến trúc" and "DEC-01 và DEC-02" (tray, no sign-in): {{ARCH}}

=== ISSUE APP-03a
title: [APP-03] Design tokens and base styles from the prototype
type: Feature
labels: priority:high, area:app
milestone: P1.2 App shell
---
**Phase:** P1 · **Roadmap status:** prototyped (v31, v50, v54, v55, v78) · **Size:** S (guess) · **Blocked by:** {{SETUP-05}}

## Goal
Every screen takes its colours, type and spacing from one set of tokens, so every theme works on every screen from the first day.

## Proposed change
- Copy the colour, type, spacing and radius tokens from the hub prototype into one CSS file of custom properties.
- Add the base styles the prototype uses everywhere: page, card, button, input, pill, list row.
- Add a lint rule or a test that fails when a UI file uses a raw colour value (hex, `rgb`, a named colour) outside the token file.
- Bundle the fonts inside the app. The prototype loads them from Google Fonts, and the app must open with no network.

## Acceptance criteria
- [ ] A sample page that shows every base style looks like the prototype, on Mac and on Ubuntu.
- [ ] The check from {{SETUP-02}} fails when a raw colour is added to a screen file.
- [ ] With the network off, the fonts still show.
- [ ] Changing one token changes every place that uses it.

## Out of scope
- The theme picker and the Settings screen ({{APP-03b}}).
- The final list of themes to keep. This is an open question on the roadmap. Port the default light and dark themes first.

## Evidence and links
- Roadmap, APP-03 and the rule "Colours come from tokens only": {{ROADMAP}}
- Prototype: {{PROTO}}
- Unverified: the font licences allow bundling. Check them before you copy the files.

=== ISSUE APP-02
title: [APP-02] App frame and navigation
type: Feature
labels: priority:high, area:app
milestone: P1.2 App shell
---
**Phase:** P1 · **Roadmap status:** prototyped (v16, v81, v92, v93, v99) · **Size:** M (guess) · **Blocked by:** {{APP-01}}, {{APP-03a}}

## Goal
The frame every screen lives in: a sidebar to reach each area and a search box, the same as the prototype.

## Proposed change
- A left sidebar with the groups Daily, Library, Life, Knowledge and Agents, and the items the prototype shows under each.
- The sidebar collapses to icons and opens again. The state is kept after restart.
- "Apps and settings" is pinned at the bottom.
- A search box at the top of the sidebar.
- A simple router: each sidebar item opens its own screen. A screen that is not built yet shows an empty state with its name and the phase it comes in.
- Features marked Later on the roadmap show a "Later" mark and open the same empty state.

## Acceptance criteria
- [ ] Every sidebar item opens its screen or its empty state. No item does nothing.
- [ ] The sidebar collapses to icons and opens again, by mouse and by keyboard.
- [ ] The collapsed state is kept after restart.
- [ ] Typing a word in the search box and pressing Enter opens the Everything screen with that word. Until {{LIB-01}} is built, the empty state shows the word.
- [ ] The frame looks like the prototype on Mac and on Ubuntu. Add two screenshots to the pull request.

## Out of scope
- The content of any screen.
- Real search ({{LIB-01}}).
- Keyboard shortcuts beyond normal focus and Enter.
- The phone layout (LAST-03).

## Evidence and links
- Roadmap, APP-02: {{ROADMAP}}
- Prototype, sidebar: {{PROTO}}

=== ISSUE APP-03b
title: [APP-03] Settings screen and theme choice
type: Feature
labels: priority:medium, area:app
milestone: P1.2 App shell
---
**Phase:** P1 · **Roadmap status:** prototyped (v31, v50, v54, v55, v78) · **Size:** S (guess) · **Blocked by:** {{APP-02}}, {{APP-03a}}, {{DATA-01a}}

## Goal
One Settings screen that later tickets add their sections to, and a theme choice that applies at once and is kept.

## Proposed change
- A Settings screen with a section list on the left and the section content on the right.
- A first section "Appearance" with the theme choice (light, dark, follow the system).
- A small settings store in the core: read and write a setting by key, saved through the storage module. Later sections (AI, connectors, data) reuse it.
- Empty sections for AI and Data, so {{AI-02}}, {{AI-03}} and {{DATA-02}} have a place to go.

## Acceptance criteria
- [ ] A theme change applies at once, with no restart.
- [ ] The chosen theme is kept after Quit and start.
- [ ] "Follow the system" changes when the system theme changes.
- [ ] Every screen built so far works in each theme. No text is unreadable.
- [ ] The settings store has tests for read, write and a missing key.

## Out of scope
- More themes than light and dark. Open question on the roadmap: which prototype themes to keep.
- The content of the AI, connector and data sections.

## Evidence and links
- Roadmap, APP-03: {{ROADMAP}}
- Prototype, Settings: {{PROTO}}
