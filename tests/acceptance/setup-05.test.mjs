// Acceptance tests for #7 [SETUP-05] Choose the UI approach: plain TypeScript or one small library.
// Run: node --test tests/acceptance/setup-05.test.mjs   (runs under npm test too)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const p = (...a) => join(ROOT, ...a);
const DOC = p('docs', 'decisions', 'ui-approach.md');
const doc = () => {
  assert.ok(existsSync(DOC), 'docs/decisions/ui-approach.md is missing');
  return readFileSync(DOC, 'utf8');
};
const walk = (d) =>
  !existsSync(d)
    ? []
    : readdirSync(d).flatMap((n) => {
        const f = join(d, n);
        return statSync(f).isDirectory() ? walk(f) : [f];
      });
const uiFiles = () => walk(p('ui', 'src'));
const norm = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
const SPIKE_CSS = p('spikes', 'spike-01-tauri', 'src', 'style.css');
// The spike is deleted after DEC-01; the checks that compare against it then skip.
const NO_SPIKE = existsSync(SPIKE_CSS) ? false : 'spike folder removed (after DEC-01)';
const NESTED = process.env.MNEMO_NESTED ? 'nested run (inside npm test, which already runs vitest)' : false;
const OLD_TESTS = ['ping-text.test.ts', 'version-text.test.ts'];
const newUnitTests = () =>
  uiFiles().filter((f) => /\.test\.(ts|tsx|js)$/.test(f) && !OLD_TESTS.includes(f.split('/').pop()));
const section = (text, re) => {
  const m = text.match(re);
  return m ? m.index : -1;
};

test('AC1: the doc is under one page (at most 60 lines, 600 words)', () => {
  const t = doc();
  assert.ok(t.split('\n').length <= 60, `too many lines: ${t.split('\n').length}`);
  assert.ok(t.split(/\s+/).filter(Boolean).length <= 600, 'too many words');
});

test('AC1: the doc names exactly one choice', () => {
  const t = doc();
  const lines = t.split('\n').filter((l) => /^\s*[#*>-]*\s*\**(choice|decision|chosen)\b/i.test(l));
  assert.equal(lines.length, 1, `expected exactly one Choice/Decision line, found ${lines.length}`);
});

test('AC1: each losing option is listed with why it lost', () => {
  const t = doc();
  assert.match(t, /plain typescript/i, 'plain TypeScript is not discussed');
  const lost = t.split('\n').filter((l) => /\b(lost|loses|rejected|why not|because)\b/i.test(l));
  assert.ok(lost.length >= 1, 'no line says why an option lost');
  assert.match(t, /^#{1,4}\s*.*(lost|losers|rejected|not chosen|alternatives)/im, 'no section for the losing options');
});

test('AC2: each option covers bundle size, shared state, prototype reuse and unit testing', () => {
  const t = doc();
  for (const [name, re] of [
    ['bundle size', /bundle|kb\b|kib\b/i],
    ['state sharing', /state/i],
    ['prototype HTML/CSS reuse', /prototype/i],
    ['unit testing', /unit[- ]test|testab/i],
  ]) assert.match(t, re, `doc does not cover ${name}`);
  assert.ok(/\|.*\|/.test(t) || /^#{2,4}\s/m.test(t), 'doc has no table or per-option sections');
  const rows = t.split('\n').filter((l) => /\b(bundle|kb|kib)\b/i.test(l));
  assert.ok(rows.length >= 2, 'bundle size is not given per option');
});

test('AC2: bundle size gives the command used, or is marked Unverified', () => {
  const t = doc();
  const measured = /(npm run build|vite build|gzip|brotli|wc -c|du -)/i.test(t) && /\d+(\.\d+)?\s*(kb|kib|bytes?)/i.test(t);
  assert.ok(measured || /unverified/i.test(t), 'neither a measuring command nor "Unverified" found');
});

test('AC3: the doc gives a folder layout under ui/src/ for screens and shared parts', () => {
  const t = doc();
  assert.match(t, /ui\/src\//);
  assert.match(t, /screens?\//i, 'no screens folder in the layout');
  assert.match(t, /(shared|components|parts|common)\//i, 'no shared-parts folder in the layout');
});

test('AC3: the doc states the proposal awaits owner approval, or that the owner approved it', () => {
  const t = doc();
  if (/\bapproved\b/i.test(t)) return;
  assert.match(t, /proposal/i);
  assert.match(t, /(awaiting|awaits|pending|needs|until)[^\n]*(owner|approval)|owner[^\n]*approv/i);
});

test('AC4: a kanban screen exists under ui/src/ and the page loads it', () => {
  const files = uiFiles();
  assert.ok(files.some((f) => /kanban/i.test(relative(p('ui', 'src'), f))), 'no kanban file under ui/src/');
  const html = readFileSync(p('ui', 'index.html'), 'utf8');
  assert.match(html, /<script[^>]+src=/);
});

test('AC4: the spike CSS is reused unchanged', { skip: NO_SPIKE }, () => {
  const spike = norm(readFileSync(SPIKE_CSS, 'utf8'));
  const all = uiFiles().concat(p('ui', 'index.html')).filter((f) => /\.(css|html)$/.test(f));
  const ui = all.map((f) => norm(readFileSync(f, 'utf8'))).join(' ');
  assert.ok(ui.includes(spike), 'the spike CSS text is not found unchanged in ui/');
});

test('AC4: colours come from tokens only (no raw colour outside custom-property definitions)', () => {
  const css = uiFiles().filter((f) => f.endsWith('.css'));
  assert.ok(css.length > 0, 'no CSS under ui/src/');
  if (!NO_SPIKE) {
    const spike = norm(readFileSync(SPIKE_CSS, 'utf8'));
    assert.ok(css.map((f) => norm(readFileSync(f, 'utf8'))).join(' ').includes(spike), 'the kanban CSS is not in ui/src/ yet');
  }
  for (const f of css) {
    const lines = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n');
    for (const l of lines) {
      if (/^\s*--[\w-]+\s*:/.test(l)) continue;
      assert.doesNotMatch(l, /#[0-9a-f]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch|hwb)\(/i, `raw colour in ${f}: ${l.trim()}`);
    }
  }
});

test('AC5: one new unit test for a UI part exists under ui/src/', () => {
  const tests = newUnitTests();
  assert.ok(tests.length >= 1, 'no new *.test.ts under ui/src/');
  const src = readFileSync(tests[0], 'utf8');
  assert.match(src, /\b(it|test)\s*\(/);
  assert.match(
    tests.map((f) => readFileSync(f, 'utf8')).join('\n'),
    /empty|invalid|missing|unknown|throw|reject|escape|<script|<img|malformed|blank|long|null|undefined|""|''/i,
    'no edge or unhappy path visible in the test',
  );
});

test('AC5: the UI code inserts content as text, never innerHTML', () => {
  assert.ok(uiFiles().some((f) => /kanban/i.test(f)), 'no kanban part in ui/src/ to check');
  for (const f of uiFiles().filter((x) => /\.(ts|tsx|js)$/.test(x))) {
    const s = readFileSync(f, 'utf8');
    if (/\.test\./.test(f)) continue;
    assert.doesNotMatch(s, /innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|v-html|\{@html/, `${f} uses an HTML sink`);
  }
});

test('AC5: the new unit test passes under vitest (exit 0)', { skip: NESTED }, () => {
  const tests = newUnitTests();
  assert.ok(tests.length >= 1, 'no new unit test to run');
  const r = spawnSync('npx', ['vitest', 'run', '--no-color', ...tests.map((f) => relative(ROOT, f))], {
    cwd: ROOT, encoding: 'utf8', timeout: 120000,
  });
  assert.equal(r.status, 0, `vitest exit ${r.status}:\n${r.stdout}\n${r.stderr}`);
});

test('AC6: no real screens, design system or component library are added', () => {
  const screens = uiFiles().filter((f) => /screen|view|page/i.test(relative(p('ui', 'src'), f)) && !/kanban/i.test(f) && !/\.test\./.test(f));
  assert.ok(screens.length <= 3, `too many screen files: ${screens.map((f) => relative(ROOT, f)).join(', ')}`);
  const pkg = JSON.parse(readFileSync(p('package.json'), 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  assert.ok(!deps.some((d) => /^(@mui|antd|@chakra-ui|@radix-ui|bootstrap|tailwindcss|@shadcn|primevue|vuetify|@mantine)/.test(d)), 'a component library is declared');
});
