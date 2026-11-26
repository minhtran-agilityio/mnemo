---
paths:
  - "**/*.{rs,ts,tsx,js,mjs,html,css,sql,toml,yaml,yml,json}"
---

# Technical rules (all code)

Mnemo is a Tauri 2 desktop app: a small Rust core in `src-tauri/`, a web UI (HTML, CSS, TypeScript, built by Vite) in `ui/`, one SQLite file for data, and AI through `claude -p` on the owner's subscription. Source of truth: the architecture page (https://claude.ai/artifact/X5UpnELuZDh6vJYU428J7G) and the roadmap (https://claude.ai/artifact/Q7awHkWEPD75CfJ3xZksJH).

## Shape of the app
- Two layers only. The UI never reads or writes data files and never calls Claude. Every privileged action goes through a named Tauri command into the Rust core.
- The Rust core does four jobs and nothing else: `storage`, `ai` (runs `claude -p`), `scheduler` (timed jobs), `system` (tray, notifications). Display logic belongs in the UI.
- One code base for macOS (Apple Silicon) and Ubuntu 22.04.5+. No per-OS feature differences; OS-specific code is isolated behind `#[cfg(target_os = ...)]` in `system`.
- The app works offline, with AI off, and at the usage limit. Saving and reading never depend on Claude.
- Toolchains are pinned: `rust-toolchain.toml` and `.nvmrc`. Lockfiles (`Cargo.lock`, `package-lock.json`) are committed.

## Secrets and config
- Mnemo never reads, stores or logs the Claude token. There is no sign-in inside Mnemo.
- Secrets come from the environment only. Never hardcode, log, or send them to the UI. Never commit any `.env*` file; list each new variable in `README.md`.
- Mnemo's own Claude config lives in `~/.config/mnemo/` (connectors, settings, allowed tools). Never edit the owner's `~/.claude/` config.
- Tunable values (models per feature, limits, timeouts, concurrency, usage thresholds 60% / 95%) live in one config module, not scattered as magic numbers.

## Errors
- Fail loudly at the boundary that can act on the error. In Rust: no `unwrap()`/`expect()`/`panic!` outside tests and startup; return `Result` and convert to a typed error at the command boundary. In TypeScript: no empty `catch`.
- Validate input where it enters the system (command arguments, `claude -p` output, imported files). Reject invalid data with a clear message; never silently repair it.
- Every external call (process spawn, network) has a timeout. Retries are bounded, with backoff, and only for errors safe to retry.
- Honest failure: when something could not be read or generated, keep the empty result and record the error. Never invent content to fill the gap.

## Logging
- Rust: use the `log`/`tracing` facade, not `println!`. TypeScript: no `console.log` left in committed code.
- Log events with context (ids, durations, task type). Never log tokens, secrets, full prompts or full user content.

## Testing
- Commands: `npm test` (tests only), `npm run lint`, `npm run check` (format, lint, type check, tests; stops at first failure). Run `npm run check` before every commit.
- Every Rust function that touches data has a test. Test behaviour, not implementation; every bug fix starts with a failing test.
- Tests never call the real Claude or the network. The `ai` module has a fake that returns fixed results, including failures. Real AI quality is measured by the eval harness only.
- Test the unhappy path: bad input, timeout, non-zero exit, missing `structured_output`, empty result.
- Keep tests deterministic: fixed fixtures, temp directories, no dependence on wall-clock time or random seeds.

## Change hygiene
- One roadmap issue is one pull request. Do not bundle features.
- Done means the issue's acceptance criteria pass on both macOS and Ubuntu, and CI (GitHub Actions, both OSes) is green.
- Anything not checked against a source or a real run is written as **Unverified**, in docs and in code comments.
- When behaviour changes, update the doc that describes it in the same change.
- **Every pull request attaches screenshots for the reviewer, before review.** No pull request is exempt: Rust, data, scripts and docs pull requests too.
  - A pull request that changes a screen: before and after screenshots of each changed screen (after only, when the screen is new). Light theme at least; dark too when colours change. Take them from the running app, or from a headless browser with mock data.
  - A pull request with no screen (Rust, data, scripts, docs): a screenshot of the evidence the reviewer needs, for example the test run, the command output or the rendered text that shows the change works.
  - No personal data, secrets or private text in a screenshot. Look at each image before you attach it.
  - How to attach: `gh pr comment <n> --attach <file>` (gh 2.99 or newer). With an older gh, put the files on the `pr-evidence` branch under `pr-<n>/` and post a comment with pinned `raw.githubusercontent.com` URLs. Never commit screenshots to the pull request's own branch.
  - A design-system pull request follows the same rule; its catalog screenshots (DESIGN.md §8) are its screenshots.
