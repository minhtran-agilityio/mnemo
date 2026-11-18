// Acceptance tests for #4 [SETUP-04] Issue template, PR template and CLAUDE.md.
// Run: node --test tests/acceptance/setup-04.test.mjs   (Node built-in runner, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...a) => readFileSync(join(ROOT, ...a), 'utf8');

const RULES = [
  /Honest failure/,
  /Nothing moves, deletes or sends without the owner/,
  /works when AI is off or at the usage limit/,
  /No Claude sign-in inside Mnemo/,
  /One storage module/,
  /No embeddings/,
  /Colours come from tokens only/,
  /Unchecked facts are marked "Unverified"/,
];

test('AC1: issue template has the five headings', () => {
  const t = read('.github', 'ISSUE_TEMPLATE', 'feature.md');
  for (const h of ['Goal', 'Proposed change', 'Acceptance criteria', 'Out of scope', 'Evidence and links']) {
    assert.match(t, new RegExp(`^## ${h}$`, 'm'), `missing heading: ${h}`);
  }
});

test('AC2: PR template has issue link, testing lines and the 8-rule checklist', () => {
  assert.ok(existsSync(join(ROOT, '.github', 'pull_request_template.md')));
  const t = read('.github', 'pull_request_template.md');
  assert.match(t, /Closes #/);
  assert.match(t, /What changed/);
  assert.match(t, /^- \[ \] Mac/m);
  assert.match(t, /^- \[ \] Ubuntu/m);
  for (const r of RULES) {
    assert.match(t, new RegExp(`^- \\[ \\] .*${r.source}`, 'm'), `PR template lacks rule ${r}`);
  }
});

test('AC3: CLAUDE.md lists the 8 rules, working rules and commands', () => {
  const t = read('CLAUDE.md');
  for (const r of RULES) assert.match(t, r);
  assert.match(t, /One issue is one pull request/);
  assert.match(t, /Every Rust function that touches data has a test/);
  assert.match(t, /passes on both machines/);
  for (const c of ['npm test', 'npm run lint', 'npm run check']) assert.ok(t.includes(`\`${c}\``), c);
});

test('AC4: CLAUDE.md is under 100 lines', () => {
  assert.ok(read('CLAUDE.md').split('\n').length < 100);
});
