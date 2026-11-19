// Acceptance tests for #105 [DS-03] UI Catalog screen (dev only) and the component registry.
// Run: node --test tests/acceptance/ds-03-catalog.test.mjs
// Screen and registry behaviour: tests/acceptance/ds-03-catalog-screen.test.ts (vitest, happy-dom).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const p = (...a) => join(ROOT, ...a);
const NESTED = process.env.MNEMO_NESTED ? 'nested run (inside npm test, which already runs vite build elsewhere)' : false;
const walk = (d) =>
  !existsSync(d) ? [] : readdirSync(d).flatMap((n) => {
    const f = join(d, n);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });

test('AC1: ui/src/ds/catalog.ts exists and ds/index.ts does not pull it in', () => {
  assert.ok(existsSync(p('ui', 'src', 'ds', 'catalog.ts')), 'ui/src/ds/catalog.ts is missing');
  const idx = readFileSync(p('ui', 'src', 'ds', 'index.ts'), 'utf8');
  assert.doesNotMatch(idx, /catalog/i, 'ds/index.ts must not import or re-export the catalog (it would reach the release bundle)');
});

test('AC3: the screen lives in ui/src/screens/catalog/ and main.ts loads it only behind import.meta.env.DEV', () => {
  assert.ok(existsSync(p('ui', 'src', 'screens', 'catalog', 'catalog.ts')), 'ui/src/screens/catalog/catalog.ts is missing');
  assert.ok(existsSync(p('ui', 'src', 'screens', 'catalog', 'catalog.css')), 'ui/src/screens/catalog/catalog.css is missing');
  const main = readFileSync(p('ui', 'src', 'main.ts'), 'utf8');
  assert.match(main, /import\.meta\.env\.DEV/, 'main.ts has no import.meta.env.DEV gate');
  assert.doesNotMatch(main, /^\s*import\s[^;]*screens\/catalog/m, 'main.ts imports the catalog statically');
  const gate = main.indexOf('import.meta.env.DEV');
  const load = main.search(/import\(\s*["'][^"']*screens\/catalog/);
  assert.ok(load > gate, 'main.ts must load the catalog with a dynamic import() after the DEV check');
});

test('AC6: the Motion rule stops transitions and animations under data-motion="off"', () => {
  const css = readFileSync(p('ui', 'src', 'screens', 'catalog', 'catalog.css'), 'utf8');
  assert.match(css, /data-motion=["']?off["']?/, 'no data-motion="off" rule');
  assert.match(css, /transition\s*:\s*none/, 'no transition: none');
  assert.match(css, /animation\s*:\s*none/, 'no animation: none');
});

test('AC6: theme.ts and the theme selectors still exist (the switch reuses them)', () => {
  const theme = readFileSync(p('ui', 'src', 'frame', 'theme.ts'), 'utf8');
  assert.match(theme, /export function applyTheme/);
  const tokens = readFileSync(p('ui', 'src', 'ds', 'tokens.css'), 'utf8');
  assert.match(tokens, /:root\[data-theme="dark"\]/);
});

test('AC5: a release build holds no catalog code and no "UI Catalog" text', { skip: NESTED }, () => {
  assert.ok(existsSync(p('ui', 'src', 'screens', 'catalog', 'catalog.ts')), 'the catalog screen does not exist yet, so this check proves nothing');
  const out = join(p('node_modules'), '.cache', 'ds03-dist');
  const r = spawnSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
  assert.equal(r.status, 0, `vite build exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  const files = walk(out);
  assert.ok(files.length > 0, 'the build produced no files');
  for (const f of files) {
    const name = relative(out, f);
    assert.doesNotMatch(name, /catalog/i, `built file name mentions the catalog: ${name}`);
    if (!/\.(js|mjs|css|html|map|json|txt|svg)$/.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    for (const marker of ['UI Catalog', 'ui-catalog', 'planned #', 'Dev only. Not in the release build', 'data-motion'])
      assert.ok(!text.includes(marker), `${name} contains "${marker}"`);
  }
});

test('AC8: ui/src/screens/sample/ is removed', () => {
  assert.ok(!existsSync(p('ui', 'src', 'screens', 'sample')), 'ui/src/screens/sample/ still exists');
});

test('AC9: the banned old name of the showcase screen appears nowhere in the tracked files', () => {
  assert.ok(existsSync(p('ui', 'src', 'screens', 'catalog', 'catalog.ts')), 'the catalog screen does not exist yet, so this check proves nothing');
  const ls = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(ls.status, 0, ls.stderr);
  const phrase = new RegExp(['kitchen', '[\\s_-]*', 'sink'].join(''), 'i');
  const hits = ls.stdout.split('\0').filter(Boolean).filter((f) => {
    if (!existsSync(p(f)) || /\.(png|jpe?g|gif|ico|icns|woff2?|ttf|lock)$/i.test(f)) return false;
    return phrase.test(f) || phrase.test(readFileSync(p(f), 'utf8'));
  });
  assert.deepEqual(hits, [], `the banned name appears in: ${hits.join(', ')}`);
});

test('AC7: the catalog files use tokens only (no raw colour)', () => {
  const files = [p('ui', 'src', 'ds', 'catalog.css'), p('ui', 'src', 'ds', 'catalog.ts'), ...walk(p('ui', 'src', 'screens', 'catalog')).filter((f) => !/\.test\./.test(f))];
  assert.ok(existsSync(files[0]) && existsSync(p('ui', 'src', 'screens', 'catalog', 'catalog.ts')), 'catalog files are missing');
  const RAW = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/;
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''), RAW, `raw colour in ${relative(ROOT, f)}`);
});

// The registry and screen tests need Vite's module handling and happy-dom. The project's vitest root is ui/,
// so this runs them from the repo root. It is not skipped in a nested run: nothing else runs this file.
test('AC1-AC9: registry and screen behaviour (tests/acceptance/ds-03-catalog-screen.test.ts)', () => {
  const r = spawnSync('npx', ['vitest', 'run', '--no-color', '--root', '.', 'tests/acceptance/ds-03-catalog-screen.test.ts'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  assert.equal(r.status, 0, `vitest exit ${r.status}\n${r.stdout.slice(-6000)}\n${r.stderr.slice(-2000)}`);
});
