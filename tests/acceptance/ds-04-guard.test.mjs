// Acceptance tests for #106 [DS-04] Guard: pick-only rule, tests, ui-designer agent and request flow.
// Run: node --test tests/acceptance/ds-04-guard.test.mjs
// Black box: repo files, the write-guard CLI (stdin + env + exit code) and the guard tests' exported functions.
// Not testable before the PR exists: AC9 (PR body dry run). Checked by the reviewer.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const p = (...a) => join(ROOT, ...a);
const read = (...a) => readFileSync(p(...a), 'utf8');
const walk = (d) =>
  !existsSync(d) ? [] : readdirSync(d).flatMap((n) => {
    const f = join(d, n);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });
const NESTED = !!process.env.MNEMO_NESTED;

// Load an exported function from a guard test file in a child process (importing it also runs its own tests; we read a marked line).
function callExport(file, fn, args) {
  const code = `const m = await import(${JSON.stringify(p(file))});
    const r = await m[${JSON.stringify(fn)}](...${JSON.stringify(args)});
    console.log('@@RESULT@@' + JSON.stringify(r ?? null));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, MNEMO_NESTED: '1' } });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@RESULT@@'));
  assert.ok(line, `could not call ${fn} from ${file}: ${r.stderr.slice(0, 400)}`);
  return JSON.parse(line.slice('@@RESULT@@'.length));
}

function guardCli(files, labels, rawLabels) {
  assert.ok(existsSync(p('scripts', 'ds-write-guard.mjs')), 'scripts/ds-write-guard.mjs is missing');
  return spawnSync(process.execPath, [p('scripts', 'ds-write-guard.mjs')], {
    input: files.join('\n') + '\n',
    encoding: 'utf8',
    env: { ...process.env, DS_GUARD_LABELS: rawLabels ?? JSON.stringify(labels) },
  });
}

// ---------- AC1 ----------
test('AC1: CLAUDE.md has shared rule 9 (ui/src/ds only, UI component request)', () => {
  const t = read('CLAUDE.md');
  assert.match(t, /^9\. .*ui\/src\/ds/m, 'no rule 9 naming ui/src/ds');
  assert.match(t, /^9\. .*(component request|request)/im, 'rule 9 does not mention the UI component request');
  assert.ok(t.split('\n').length < 100, 'CLAUDE.md must stay under 100 lines');
});

test('AC1: design.md and frontend.md state the pick-only rule and the request flow', () => {
  for (const f of ['design.md', 'frontend.md']) {
    const t = read('.claude', 'rules', f);
    assert.match(t, /ui\/src\/ds/, `${f} does not mention ui/src/ds`);
    assert.match(t, /ui-designer/, `${f} does not name the ui-designer agent`);
    assert.match(t, /request/i, `${f} does not mention the UI component request`);
  }
});

// ---------- AC5 ----------
test('AC5: tests/lib/ds-guard.mjs exports the known-exception list and #111 emptied it', async () => {
  const file = p('tests', 'lib', 'ds-guard.mjs');
  assert.ok(existsSync(file), 'tests/lib/ds-guard.mjs is missing');
  const m = await import(file);
  assert.ok(Array.isArray(m.KNOWN_EXCEPTIONS), 'KNOWN_EXCEPTIONS is not exported as an array');
  assert.deepEqual(m.KNOWN_EXCEPTIONS, [], '#111 removes every known exception');
});

test('AC5: the catalog screen decision is recorded with its reason and is not tied to #111', async () => {
  const m = await import(p('tests', 'lib', 'ds-guard.mjs'));
  assert.ok(Array.isArray(m.DEV_TOOL_EXCEPTIONS), 'DEV_TOOL_EXCEPTIONS is not exported');
  const e = m.DEV_TOOL_EXCEPTIONS.find((x) => /screens\/catalog/.test(x.path));
  assert.ok(e, 'ui/src/screens/catalog/ is not decided');
  assert.ok(e.reason && e.reason.length > 10, 'the catalog decision has no reason');
  assert.notEqual(e.removedBy, 111, 'the dev tool exception must not be tied to #111');
  assert.equal(typeof m.isExcepted, 'function');
  assert.equal(m.isExcepted('ui/src/screens/settings/settings.css', 'css'), false);
  assert.equal(m.isExcepted('ui/src/shared/card.ts', 'elements'), false);
});

test('AC5: no other test file lists the exceptions by path (one place only)', () => {
  const others = readdirSync(p('tests')).filter((f) => /^ds-.*\.test\.mjs$/.test(f));
  assert.ok(others.length >= 3, 'the guard test files are missing');
  for (const f of others) {
    const t = read('tests', f);
    assert.doesNotMatch(t, /screens\/kanban/, `${f} lists an exception path itself; use tests/lib/ds-guard.mjs`);
  }
});

// ---------- AC2 ----------
test('AC2: guard (a) test file exists and exports checkCss', () => {
  const f = read('tests', 'ds-screen-css.test.mjs');
  assert.match(f, /export\s+(function|const)\s+checkCss/);
});

test('AC2: checkCss rejects colour, font, border, radius, shadow and non-token values', () => {
  const bad = [
    '.a { color: red; }',
    '.a { background: var(--bg); }',
    '.a { font-size: var(--text-sm); }',
    '.a { border: 1px solid; }',
    '.a { border-radius: var(--radius-md); }',
    '.a { box-shadow: 0 0 4px #000; }',
    '.a { gap: 12px; }',
    '.a { padding: 1rem; }',
    '.a { --x: 1; }',
    '.a { transition: opacity var(--motion); }',
  ];
  for (const css of bad) {
    const v = callExport('tests/ds-screen-css.test.mjs', 'checkCss', [css]);
    assert.ok(Array.isArray(v) && v.length > 0, `checkCss accepted: ${css}`);
  }
});

test('AC2: checkCss accepts layout properties with token values and a media query', () => {
  const good = [
    '.a { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }',
    '.a { padding: var(--space-2) 0; margin: 0 auto; width: 100%; overflow: hidden; }',
    '.a { display: flex; flex-direction: column; align-items: center; }',
    '/* color: red; */ .a { position: relative; z-index: 1; }',
    '@media (max-width: 720px) { .a { display: block; } }',
    '[data-motion="off"] .a { transition: none; animation: none; }',
  ];
  for (const css of good) {
    const v = callExport('tests/ds-screen-css.test.mjs', 'checkCss', [css]);
    assert.deepEqual(v, [], `checkCss rejected: ${css} -> ${JSON.stringify(v)}`);
  }
});

// ---------- AC3 ----------
test('AC3: guard (b) test file exists and exports checkSource', () => {
  assert.match(read('tests', 'ds-screen-elements.test.mjs'), /export\s+(function|const)\s+checkSource/);
});

test('AC3: checkSource rejects createElement and markup strings of form elements', () => {
  const bad = [
    'const b = doc.createElement("button");',
    "const i = document.createElement('input');",
    'const s = doc.createElement("select");',
    'const t = doc.createElement("textarea");',
    'const d = doc.createElement("dialog");',
    'const h = `<input type="text">`;',
    'const h = "<button>Go</button>";',
  ];
  for (const src of bad) {
    const v = callExport('tests/ds-screen-elements.test.mjs', 'checkSource', ['sample.ts', src, []]);
    assert.ok(Array.isArray(v) && v.length > 0, `checkSource accepted: ${src}`);
  }
});

test('AC3: checkSource accepts calls that do not create elements', () => {
  const good = [
    'const x = root.querySelector("button");',
    'node.addEventListener("input", fn);',
    'node.setAttribute("aria-haspopup", "dialog");',
    'const d = doc.createElement("div");',
  ];
  for (const src of good) {
    const v = callExport('tests/ds-screen-elements.test.mjs', 'checkSource', ['sample.ts', src, []]);
    assert.deepEqual(v, [], `checkSource rejected: ${src} -> ${JSON.stringify(v)}`);
  }
});

// ---------- AC4 ----------
test('AC4: guard (c) vitest file exists outside ui/src/ds, with findGaps and a sample that fails', () => {
  const f = p('ui', 'src', 'ds-guard.test.ts');
  assert.ok(existsSync(f), 'ui/src/ds-guard.test.ts is missing');
  const t = readFileSync(f, 'utf8');
  assert.match(t, /export\s+(function|const)\s+findGaps/);
  assert.match(t, /CATALOG/, 'it must read the real CATALOG registry');
  assert.match(t, /components/, 'it must walk ui/src/ds/components');
  assert.match(t, /\.test\.ts/, 'it must require a <name>.test.ts');
  assert.match(t, /ALIASES/, 'it must hold the ALIASES map for folders named differently from the registry');
});

// ---------- AC2/3/4: guards pass on current code ----------
test('AC2+AC3: guard (a), (b) and the write guard pass on the current code', { skip: NESTED && 'covered by the outer node --test run' }, () => {
  const r = spawnSync(process.execPath, ['--test', '--test-isolation=none',
    p('tests', 'ds-screen-css.test.mjs'), p('tests', 'ds-screen-elements.test.mjs'), p('tests', 'ds-write-guard.test.mjs')],
    { encoding: 'utf8', cwd: ROOT, env: { ...process.env, MNEMO_NESTED: '1' } });
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-2000));
});

// ---------- AC6 ----------
test('AC6: the ds-write-guard job runs in its own workflow, label events included, and ci.yml keeps its setup-03 shape', () => {
  // The job moved out of ci.yml: label events there restarted the whole build (review of #118).
  const y = read('.github', 'workflows', 'ds-write-guard.yml');
  assert.match(y, /^on:\s*\n\s+pull_request:/m);
  assert.doesNotMatch(y, /contents:\s*write/);
  assert.match(y, /types:\s*\[[^\]]*labeled[^\]]*unlabeled[^\]]*\]|types:[\s\S]{0,120}-\s*labeled/, 'label events do not trigger the guard');
  assert.match(y, /^\s{2}ds-write-guard:/m, 'no ds-write-guard job');
  assert.match(y, /name:\s*Design system write guard/);
  assert.match(y, /scripts\/ds-write-guard\.mjs/);
  assert.match(y, /DS_GUARD_LABELS/);
  const ci = read('.github', 'workflows', 'ci.yml');
  assert.match(ci, /^on:\s*\n\s+pull_request:/m, 'setup-03 shape broken');
  assert.match(ci, /name:\s*CI result/, 'the "CI result" job was renamed or removed');
  assert.match(ci.slice(ci.search(/^\s{2}result:/m)), /!cancelled\(\)/);
});

test('AC6: write guard rejects a ds change without the label and says how to fix it', () => {
  const r = guardCli(['ui/src/ds/components/toast/toast.ts', 'README.md'], []);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /ui\/src\/ds\/components\/toast\/toast\.ts/);
  assert.match(r.stdout + r.stderr, /design-system/);
});

test('AC6: write guard accepts a ds change with the label', () => {
  const r = guardCli(['ui/src/ds/tokens.css'], ['bug', 'design-system']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('AC6: write guard accepts a change with no ds file, with or without labels', () => {
  assert.equal(guardCli(['ui/src/screens/foo/foo.ts', 'tests/x.test.mjs'], []).status, 0);
  assert.equal(guardCli(['ui/src/dsx/file.ts', 'docs/ui/src/ds/a.md'], []).status, 0, 'only paths starting with ui/src/ds/ count');
});

test('AC6: write guard rejects a move out of ds (both old and new path listed)', () => {
  const r = guardCli(['ui/src/ds/components/a/a.ts', 'ui/src/screens/a.ts'], []);
  assert.equal(r.status, 1);
});

test('AC6: write guard fails closed on invalid label JSON', () => {
  assert.equal(guardCli(['README.md'], null, 'not json').status, 1);
  assert.equal(guardCli(['ui/src/ds/a.ts'], null, '{').status, 1);
});

test('AC6: write guard exports decide() with ok, dsFiles, message', async () => {
  const m = await import(p('scripts', 'ds-write-guard.mjs'));
  const no = m.decide({ files: ['ui/src/ds/a.css', 'x.md'], labels: ['other'] });
  assert.equal(no.ok, false);
  assert.deepEqual(no.dsFiles, ['ui/src/ds/a.css']);
  assert.equal(typeof no.message, 'string');
  assert.equal(m.decide({ files: ['ui/src/ds/a.css'], labels: ['design-system'] }).ok, true);
  assert.equal(m.decide({ files: ['x.md'], labels: [] }).ok, true);
});

test('AC6: the write guard has a unit test and its decision is written down', () => {
  assert.ok(existsSync(p('tests', 'ds-write-guard.test.mjs')), 'tests/ds-write-guard.test.mjs is missing');
  const head = read('scripts', 'ds-write-guard.mjs').split('\n').slice(0, 40).join('\n');
  assert.match(head, /design-system/, 'the script header does not say how it decides');
  assert.match(read('DESIGN.md'), /design-system/, 'DESIGN.md does not describe the label rule');
});

test('AC6: the design-system label exists on the repo', (t) => {
  const r = spawnSync('gh', ['label', 'list', '--repo', 'minhtran-agilityio/mnemo', '--limit', '200', '--json', 'name', '-q', '.[].name'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return t.skip('gh not available');
  assert.match(r.stdout, /^design-system$/m, 'label design-system not created');
});

// ---------- AC7 ----------
test('AC7: ui-designer agent has frontmatter and the required duties', () => {
  const f = p('.claude', 'agents', 'ui-designer.md');
  assert.ok(existsSync(f), '.claude/agents/ui-designer.md is missing');
  const t = readFileSync(f, 'utf8');
  assert.match(t, /^---\n[\s\S]*?\bname:\s*ui-designer\b[\s\S]*?\bdescription:[\s\S]*?\btools:[\s\S]*?\n---/, 'frontmatter needs name, description, tools');
  for (const [re, what] of [
    [/DESIGN\.md/, 'reads DESIGN.md'],
    [/state/i, 'every state'],
    [/catalog\.ts|registry/i, 'registry entry'],
    [/\.test\.ts|tests?\b/i, 'tests'],
    [/UI Catalog/, 'shows it on the UI Catalog'],
    [/light/i, 'light screenshot'],
    [/dark/i, 'dark screenshot'],
    [/pr-assets/, 'pr-assets branch'],
    [/design-system/, 'design-system label'],
    [/Closes #|closes/i, 'closes the request issue'],
    [/only agent|only the ui-designer|only agent that edits/i, 'the only agent editing ds'],
  ]) assert.match(t, re, `ui-designer.md does not cover: ${what}`);
});

test('AC7: UI component request template has the required fields', () => {
  const f = p('.github', 'ISSUE_TEMPLATE', 'ui-component-request.md');
  assert.ok(existsSync(f), 'ui-component-request.md is missing');
  const t = readFileSync(f, 'utf8');
  assert.match(t, /^---\n[\s\S]*?\ntitle:\s*["']?\[UI-REQ\]/, 'title must start with [UI-REQ]');
  assert.match(t, /labels?:[\s\S]*?ui-component-request/, 'label ui-component-request');
  for (const re of [/Needed for/i, /What the part must do/i, /^#+ States/im, /Sample content/i, /Checked in the UI Catalog/i, /Linked pull request/i]) {
    assert.match(t, re, `template lacks ${re}`);
  }
});

test('AC7: DESIGN.md links to the agent and the template', () => {
  const d = read('DESIGN.md');
  assert.match(d, /\.claude\/agents\/ui-designer\.md/);
  assert.match(d, /ISSUE_TEMPLATE\/ui-component-request\.md/);
});

// ---------- AC8 ----------
test('AC8: DESIGN.md sections 5, 6, 7 and 8 lose the Planned marks that #106 covers', () => {
  const d = read('DESIGN.md');
  assert.doesNotMatch(d, /\*\*Planned\*\*[^\n]*#106/, 'a Planned mark still points at #106');
  assert.doesNotMatch(d, /requested in #106/);
  assert.doesNotMatch(d, /Detail and templates are in #106/);
  assert.doesNotMatch(d, /Planned\*\*: a test that fails on those properties/);
});

test('AC8: DESIGN.md states the request flow', () => {
  const d = read('DESIGN.md');
  const i = d.search(/^#+ .*8[.)]?\s/m);
  const s = i >= 0 ? d.slice(i) : d;
  assert.match(s, /stops? (its|their) UI work/i, 'feature agent stops its UI work');
  assert.match(s, /files? (the|a) request/i);
  assert.match(s, /after the design (pull request|PR) (is )?merge/i);
  assert.match(s, /one request is one issue and one (pull request|PR)/i);
});

// ---------- AC10 ----------
test('AC10: the ui .ts files do not use the words sqlite or sign in', () => {
  const bad = walk(p('ui')).filter((f) => /\.ts$/.test(f)).filter((f) => /sqlite|sign in/i.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad.map((f) => f.slice(ROOT.length)), []);
});

test('AC10: the new ui guard test writes issue numbers through ref(n)/planned(n)', () => {
  const f = p('ui', 'src', 'ds-guard.test.ts');
  assert.ok(existsSync(f), 'ui/src/ds-guard.test.ts is missing');
  const lines = readFileSync(f, 'utf8').split('\n').filter((l) => /#\d+/.test(l) && !/\bref\(|\bplanned\(/.test(l));
  assert.deepEqual(lines, []);
});
