// Acceptance tests for #18 [AI-01] Find Claude Code and check it at start.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/ai-health.test.mjs
// The Rust start check runs for real (the ignored probe test in src-tauri/src/ai/health.rs) with a
// controlled PATH and HOME: no `claude` at all, and fake `claude` scripts. The real Claude Code is
// used only for the signed-out case, with an empty CLAUDE_CONFIG_DIR, and only when it is installed.
// Mnemo reads no token: nothing here touches a real login.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_WINDOWS = process.platform === 'win32' ? 'POSIX shell scripts' : false;
let probe = null; // the test binary that holds the probe
let buildError = null;
const dirs = [];
const tmp = (name) => {
  const d = mkdtempSync(join(tmpdir(), `mnemo-ai18-${name}-`));
  dirs.push(d);
  return d;
};

before(() => {
  const r = spawnSync(
    'cargo',
    ['test', '--manifest-path', join(ROOT, 'src-tauri/Cargo.toml'), '--lib', '--no-run', '--message-format=json'],
    { encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    buildError = `cargo test --no-run exit ${r.status}:\n${r.stderr}`;
    return;
  }
  for (const line of r.stdout.split('\n')) {
    try {
      const m = JSON.parse(line);
      if (m.reason === 'compiler-artifact' && m.profile?.test && m.target?.name === 'mnemo_lib' && m.executable) probe = m.executable;
    } catch {
      // Not a JSON line.
    }
  }
});

after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Runs the real start check with this PATH and HOME and returns the state it printed. */
function stateWith(env) {
  assert.equal(buildError, null, buildError ?? '');
  assert.ok(probe, 'the test binary was not found');
  const r = spawnSync(probe, ['--ignored', '--nocapture', 'probe_state_from_env'], {
    encoding: 'utf8',
    timeout: 60000,
    env: { ...env, ANTHROPIC_API_KEY: '' },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const m = /AI_HEALTH_STATE=(\w+)/.exec(r.stdout);
  assert.ok(m, `no state in the output:\n${r.stdout}`);
  // Nothing from Claude Code is printed, only the state word.
  assert.doesNotMatch(r.stdout + r.stderr, /@|sk-ant|org-/);
  return m[1];
}

function fakeClaude(statusJson, statusExit) {
  const dir = tmp('bin');
  const file = join(dir, 'claude');
  writeFileSync(
    file,
    `#!/bin/sh
case "$1" in
  --version) echo "2.1.329 (Claude Code)";;
  auth) printf '%s\\n' '${statusJson}'; exit ${statusExit};;
esac
`,
  );
  chmodSync(file, 0o755);
  return dir;
}

test('with claude removed from PATH the state is Not installed', { skip: SKIP_WINDOWS }, () => {
  const empty = tmp('empty');
  // HOME is empty too, so the usual install folders under it hold no claude either.
  // Unverified: a claude in /usr/local/bin, /opt/homebrew/bin or /usr/bin would still be found.
  assert.equal(stateWith({ PATH: empty, HOME: empty }), 'NotInstalled');
});

test('a fake claude that prints loggedIn false is Not signed in', { skip: SKIP_WINDOWS }, () => {
  const bin = fakeClaude('{"loggedIn": false, "authMethod": "none"}', 1);
  assert.equal(stateWith({ PATH: bin, HOME: tmp('home') }), 'NotSignedIn');
});

test('a fake claude that prints loggedIn true is Ready, and an email in the JSON is not shown', { skip: SKIP_WINDOWS }, () => {
  const bin = fakeClaude('{"loggedIn": true, "email": "owner@example.com", "orgName": "Secret Org"}', 0);
  assert.equal(stateWith({ PATH: bin, HOME: tmp('home') }), 'Ready');
});

test('a fake claude that prints nonsense is a Version problem, never Ready', { skip: SKIP_WINDOWS }, () => {
  const bin = fakeClaude('hello there', 0);
  assert.equal(stateWith({ PATH: bin, HOME: tmp('home') }), 'VersionProblem');
});

test('the real Claude Code with an empty config folder is Not signed in (2.1.329 on Ubuntu; other versions Unverified)', { skip: SKIP_WINDOWS }, (t) => {
  const which = spawnSync('sh', ['-c', 'command -v claude'], { encoding: 'utf8' });
  if (which.status !== 0) return t.skip('claude is not installed here');
  const home = tmp('home');
  const state = stateWith({
    PATH: `${dirname(which.stdout.trim())}:/usr/bin:/bin`,
    HOME: home,
    CLAUDE_CONFIG_DIR: tmp('config'),
  });
  assert.equal(state, 'NotSignedIn');
});
