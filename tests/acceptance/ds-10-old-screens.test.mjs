// Acceptance tests for #111 [DS-10] Move the old screens to the catalog and remove the exceptions.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/ds-10-old-screens.test.mjs
// Black box: repo files and the exported guard configuration. Behaviour and look of the screens are held
// by the earlier acceptance tests (AC4: app-02, app-03*, setup-*), which this ticket must keep green.
// Not testable here: AC9 (screenshots, evidence stage) and the PR label (AC10, reviewer).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
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
const guard = () => import(p('tests', 'lib', 'ds-guard.mjs'));

// ---------- AC1 ----------
test('AC1: KNOWN_EXCEPTIONS is empty', async () => {
  const m = await guard();
  assert.deepEqual(m.KNOWN_EXCEPTIONS, []);
});

test('AC1: DEV_TOOL_EXCEPTIONS for the UI Catalog files stay', async () => {
  const m = await guard();
  const paths = m.DEV_TOOL_EXCEPTIONS.map((e) => e.path);
  for (const f of ['catalog.ts', 'find.ts', 'parts.ts', 'specimen.ts', 'inspect.ts', 'tabs/foundations.ts', 'tabs/tokens.ts', 'tabs/limits.ts', 'tabs/surfaces.ts'])
    assert.ok(paths.includes(`ui/src/screens/catalog/${f}`), `dev tool exception gone: ${f}`);
  const pairs = m.DEV_TOOL_EXCEPTIONS.flatMap((e) => e.guards.map((g) => `${e.path}|${g}`));
  assert.equal(pairs.length, 11, 'the dev tool exceptions changed');
  for (const e of m.DEV_TOOL_EXCEPTIONS) assert.notEqual(e.removedBy, 111);
});

test('AC1: the old code is held by the guards (isExcepted is false for each former exception)', async () => {
  const m = await guard();
  for (const f of ['ui/src/frame/sidebar.css', 'ui/src/frame/sidebar.ts', 'ui/src/screens/settings/settings.css', 'ui/src/screens/settings/settings.ts', 'ui/src/screens/kanban/kanban.css', 'ui/src/style.css', 'ui/error.html', 'ui/src/error-page.ts'])
    for (const g of ['css', 'elements']) assert.equal(m.isExcepted(f, g), false, `${f} still excepted from ${g}`);
});

// ---------- AC2 ----------
test('AC2: the pinned test has no known-exception pins left', () => {
  const t = read('tests', 'guard-exceptions-pinned.test.mjs');
  for (const old of ['ui/src/frame/|', 'ui/src/screens/settings/|', 'ui/src/screens/kanban/|', 'ui/src/style.css|'])
    assert.ok(!t.includes(old), `stale pin: ${old}`);
  assert.doesNotMatch(t, /PINNED_PATHS\s*=\s*new Set\(\[\s*["'][^\]]/, 'PINNED_PATHS still lists a path');
  assert.ok(!t.includes('ui/error.html') && !t.includes('ui/src/error-page.ts'), 'error page still pinned');
  assert.match(t, /screens\/catalog\//, 'catalog pins must stay');
});

test('AC2: the three guards and the pinned test pass with the empty list', async () => {
  assert.deepEqual((await guard()).KNOWN_EXCEPTIONS, [], 'the list is not empty yet');
  const r = spawnSync(process.execPath, ['--test', '--test-isolation=none', p('tests', 'ds-screen-css.test.mjs'), p('tests', 'ds-screen-elements.test.mjs'), p('tests', 'guard-exceptions-pinned.test.mjs')], { encoding: 'utf8', env: { ...process.env, MNEMO_NESTED: '1' }, cwd: ROOT });
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-1500));
});

test('AC2: the old files really pass both rules (no layout-only violation in them)', async () => {
  const checkCss = (src) => {
    const code = `const m = await import(${JSON.stringify(p('tests', 'ds-screen-css.test.mjs'))});
      console.log('@@R@@' + JSON.stringify(await m.checkCss(${JSON.stringify(src)})));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, MNEMO_NESTED: '1' } });
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@R@@'));
    assert.ok(line, `checkCss failed: ${r.stderr.slice(0, 300)}`);
    return JSON.parse(line.slice(5));
  };
  for (const f of ['ui/src/style.css', 'ui/src/screens/settings/settings.css', 'ui/src/screens/kanban/kanban.css']) {
    assert.ok(existsSync(p(f)), `${f} is missing (the proof/CSS stays as a layout file)`);
    assert.deepEqual(checkCss(read(...f.split('/'))), [], `${f} sets more than layout`);
  }
  assert.ok(!existsSync(p('ui', 'src', 'frame', 'sidebar.css')), 'frame/sidebar.css must move into the ds sidebar part');
});

// ---------- AC4 (moved paths only) ----------
test('AC4: ds-02 and app-02 point at the moved files, with checks kept', () => {
  assert.match(read('tests', 'acceptance', 'ds-02-foundation.test.mjs'), /components.*sidebar.*sidebar\.css/);
  assert.match(read('tests', 'acceptance', 'app-02.test.mjs'), /kanban-card/);
  for (const f of ['app-02.test.mjs', 'app-03.test.mjs', 'app-03-settings.test.mjs', 'setup-05.test.mjs'])
    assert.ok(existsSync(p('tests', 'acceptance', f)), `${f} was removed`);
});

// ---------- AC5 ----------
const NEW_PARTS = [['sidebar', 'surfaces'], ['later-mark', 'feedback'], ['text', 'feedback'], ['section-list', 'lists'], ['choice-list', 'controls']];
for (const [name, tab] of NEW_PARTS) {
  test(`AC5: part ${name} is a full ds component (ts, css, test, one barrel line, catalog entry)`, () => {
    for (const ext of ['ts', 'css', 'test.ts'])
      assert.ok(existsSync(p('ui', 'src', 'ds', 'components', name, `${name}.${ext}`)), `${name}.${ext} is missing`);
    const barrel = read('ui', 'src', 'ds', 'components', `${tab}.ts`);
    const lines = barrel.split('\n').filter((l) => l.includes(`components/${name}/`) || l.includes(`./${name}/`));
    assert.equal(lines.length, 1, `${tab}.ts must have exactly one line for ${name}`);
    const reg = walk(p('ui', 'src', 'ds', 'catalog')).map((f) => readFileSync(f, 'utf8')).join('\n');
    assert.ok(new RegExp(`['"]${name}['"]`).test(reg), `no catalog registry entry for ${name}`);
    const css = read('ui', 'src', 'ds', 'components', name, `${name}.css`);
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, `${name}.css has a raw colour`);
    assert.doesNotMatch(name, /screen|view|page|badge|count|pill/);
  });
}

test('AC5: every new part is shown on the UI Catalog (a renderer under screens/catalog/tabs)', () => {
  const src = walk(p('ui', 'src', 'screens', 'catalog', 'tabs')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const fn of ['createSidebar', 'buildLaterMark', 'buildText', 'createSectionList', 'createChoiceList'])
    assert.ok(src.includes(fn), `the catalog tabs never call ${fn}`);
});

test('AC5: the sidebar icon size and stroke are tokens (18 px, 1.8) in tokens.css and DESIGN.md', () => {
  const tk = read('ui', 'src', 'ds', 'tokens.css');
  assert.match(tk, /--icon-nav:\s*18px/);
  assert.match(tk, /--icon-stroke-nav:\s*1\.8/);
  const d = read('DESIGN.md');
  assert.ok(d.includes('--icon-nav') && d.includes('--icon-stroke-nav'), 'DESIGN.md section 3 misses the new tokens');
});

test('AC5: the old screens import the parts from ui/src/ds', () => {
  assert.match(read('ui', 'src', 'frame', 'sidebar.ts'), /ds/);
  assert.match(read('ui', 'src', 'screens', 'settings', 'settings.ts'), /createSectionList/);
  assert.match(read('ui', 'src', 'screens', 'settings', 'settings.ts'), /createChoiceList/);
});

// ---------- AC6 ----------
test('AC6: the kanban proof is migrated to the ds kanban parts, or removed with its tests', () => {
  const dir = p('ui', 'src', 'screens', 'kanban');
  const files = walk(dir);
  if (files.length === 0) return; // removed: the decision is checked in the PR note by the reviewer
  const ts = read('ui', 'src', 'screens', 'kanban', 'kanban.ts');
  assert.match(ts, /createKanbanBoard|createKanbanCard/, 'kanban.ts neither uses the ds parts nor is removed');
  assert.doesNotMatch(ts, /shared\/card/, 'kanban.ts still uses shared/card');
});

// ---------- AC7 ----------
test('AC7: ui/src/shared/card.ts and card.test.ts are removed; nothing imports them', () => {
  assert.ok(!existsSync(p('ui', 'src', 'shared', 'card.ts')));
  assert.ok(!existsSync(p('ui', 'src', 'shared', 'card.test.ts')));
  for (const f of walk(p('ui', 'src')).filter((x) => /\.(ts|css|html)$/.test(x)))
    assert.doesNotMatch(readFileSync(f, 'utf8'), /shared\/card['"]/, `${relative(ROOT, f)} imports shared/card`);
});

test('AC7: docs/decisions describe the new layout (no stale exception or sidebar.css text)', () => {
  for (const f of ['design-tokens.md', 'ui-approach.md']) {
    const t = read('docs', 'decisions', f);
    assert.doesNotMatch(t, /frame\/sidebar\.css/, `${f} still names frame/sidebar.css`);
    assert.doesNotMatch(t, /shared\/card\.ts/, `${f} still names shared/card.ts`);
    assert.doesNotMatch(t, /known exceptions?[^.\n]*(#111|until|still)/i, `${f} still describes pending exceptions`);
  }
  assert.match(read('docs', 'decisions', 'ui-approach.md'), /ui\/src\/ds/);
});

// ---------- AC8 ----------
test('AC8: DESIGN.md sections 6 to 8 and the design.md rule say there are no known exceptions', () => {
  const d = read('DESIGN.md');
  const s = d.slice(d.indexOf('## 6.'), d.indexOf('## 9.'));
  assert.match(s, /no known exceptions/i);
  assert.doesNotMatch(s, /#111 moves them/, 'section 6 still lists the old exceptions');
  assert.doesNotMatch(s, /Shipped before this contract/);
  for (const part of ['sidebar', 'later-mark', 'section-list', 'choice-list']) assert.ok(s.includes(part), `section 7 does not list ${part}`);
  const r = read('.claude', 'rules', 'design.md');
  assert.match(r, /no known exceptions/i);
  assert.doesNotMatch(r, /Known exceptions are listed once/);
});

// ---------- AC10 ----------
test('AC10: no "sqlite" or "sign in" words in ui files; issue numbers in ui .ts go through ref(n)/planned(n)', () => {
  const files = walk(p('ui')).filter((f) => !f.includes('node_modules') && !f.includes(`${join('ui', 'dist')}`) && /\.(ts|css|html|json)$/.test(f));
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /sqlite|sign[ -]in/i, `${relative(ROOT, f)} has a banned word`);
  }
  const bad = files.filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).filter((f) => /(^|[^\w/])#\d{2,4}\b/.test(readFileSync(f, 'utf8').replace(/\b(ref|planned)\(\d+\)/g, '').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')));
  assert.deepEqual(bad.map((f) => relative(ROOT, f)), [], 'raw #n issue numbers in ui .ts');
});
