# Claude Code check at start (AI-01, #18)

At start, and when the owner chooses **Check again** in Settings > AI, Mnemo works out whether Claude Code can run. The code is `src-tauri/src/ai/health.rs`. The result is kept in memory only.

## What it runs

1. It looks for `claude` on the PATH, then in `~/.local/bin`, `~/.claude/local`, `~/.npm-global/bin`, `/usr/local/bin`, `/opt/homebrew/bin` and `/usr/bin`. A Dock or launcher start has a short PATH, so the extra folders matter. Which of these folders Claude Code really installs to on macOS is **Unverified**.
2. `claude --version`. A failure, a timeout (10 seconds) or empty output is a Version problem.
3. `claude auth status --json`. It costs no model run and needs no network call from Mnemo. `ANTHROPIC_API_KEY` is removed from the child's environment.

Neither command starts a model run. Mnemo never runs `claude -p` here, never reads Claude's token file and never opens a sign-in.

## What it keeps

Only the boolean `loggedIn`. The status JSON also holds the account email, organisation, config folder and more. Mnemo drops every other field at once: none of it goes to the log, the database, an error text or the UI. The UI gets a state and a fixed message, never output from Claude Code. `tests/ai-health.test.mjs` and the Rust tests prove it with a status JSON that contains an email and an organisation name.

## The four states

| State | When | Settings message |
|---|---|---|
| Ready | `loggedIn` is `true` and the command exited 0 | Claude Code is installed and signed in. |
| Not installed | no `claude` found | Install it from claude.com/claude-code, then choose Check again. |
| Not signed in | `loggedIn` is `false` | Open a terminal, run `claude`, sign in, then choose Check again. |
| Version problem | anything else: failing `--version`, timeout, output that is not a JSON object with a boolean `loggedIn`, `loggedIn: true` with a failing exit | Update Claude Code, then choose Check again. |

Unparseable output is never Ready. This is the check for the risk in the architecture page: a future Claude Code version may change what `-p` or `auth status` does.

## What is verified and what is Unverified

- Verified (Claude Code 2.1.329, Ubuntu): `claude auth status --json` prints JSON with `loggedIn`. With an empty `CLAUDE_CONFIG_DIR` (a signed-out run) it prints `"loggedIn": false` and exits with code 1. The acceptance test runs this case when `claude` is installed.
- Unverified: the signed-out output and exit code on macOS and on other Claude Code versions. The code counts `loggedIn: false` as Not signed in on any exit code, so a different exit code does not change the result.
- Unverified: the `--text` form, and any version before 2.1.329 (it may not have `claude auth status` at all; that gives a Version problem, which is the honest answer).
- Unverified: a Claude Code that is signed in with an API key or a cloud provider. The check reads `loggedIn` only.
- Spike #6 (`docs/spikes/spike-02-claude-p.md`) does not cover sign-in detection.

## Why not a JSON crate

The core has no JSON library as a direct dependency, and adding one is a dependency change outside this ticket. `logged_in` is a small strict scanner for one top-level boolean: it skips every other value without keeping it, and gives `None` on anything it cannot read. If a JSON crate is added later, replace it with a struct that has one field.
