// Acceptance tests for #3 [SETUP-03] CI on macOS and Ubuntu for every pull request.
// They read .github/workflows/ci.yml as text; no network and no extra dependencies.
// Run: node --test "tests/acceptance/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = join(ROOT, '.github', 'workflows', 'ci.yml');
const ci = () => readFileSync(FILE, 'utf8');
const at = (re) => ci().search(re);

test('the workflow file exists', () => {
  assert.ok(existsSync(FILE));
});

test('runs on every pull request and on pushes to main', () => {
  assert.match(ci(), /^on:\s*\n\s+pull_request:/m);
  assert.match(ci(), /^\s+push:\s*\n\s+branches:\s*\[\s*main\s*\]/m);
});

test('matrix has macos-latest and ubuntu-22.04, and neither stops the other', () => {
  assert.match(ci(), /os:\s*\[\s*macos-latest\s*,\s*ubuntu-22\.04\s*\]/);
  assert.match(ci(), /runs-on:\s*\$\{\{\s*matrix\.os\s*\}\}/);
  assert.match(ci(), /fail-fast:\s*false/);
});

test('runs npm run check, then the debug build', () => {
  const check = at(/run:\s*npm run check\b/);
  const build = at(/run:\s*npx tauri build --debug --no-bundle\b/);
  assert.ok(check >= 0, 'npm run check is missing');
  assert.ok(build >= 0, 'debug build is missing');
  assert.ok(check < build, 'check must run before the build');
});

test('caches Node and Rust dependencies', () => {
  assert.match(ci(), /cache:\s*npm/);
  assert.match(ci(), /Swatinem\/rust-cache@/);
});

test('installs apt packages on Linux only', () => {
  const lines = ci().split('\n');
  const apt = lines.findIndex((l) => l.includes('apt-get install'));
  assert.ok(apt >= 0, 'apt install is missing');
  const stepStart = lines.slice(0, apt).map((l, i) => [l, i]).reverse().find(([l]) => /^\s+- (name|uses):/.test(l))[1];
  const step = lines.slice(stepStart, apt).join('\n');
  assert.match(step, /if:\s*runner\.os == 'Linux'/);
  assert.equal(ci().split('apt-get install').length - 1, 1, 'apt install appears more than once');
});

test('does not use Windows or a real Claude login', () => {
  assert.doesNotMatch(ci(), /windows/i);
  assert.doesNotMatch(ci(), /ANTHROPIC|CLAUDE_CODE_OAUTH/i);
});
