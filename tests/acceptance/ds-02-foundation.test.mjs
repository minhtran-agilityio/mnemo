// Acceptance tests for #104 [DS-02] Foundation: ui/src/ds, missing tokens, icons, contrast test.
// Run: node --test tests/acceptance/ds-02-foundation.test.mjs
// Outside-in: reads files and runs the project's own commands. Nothing here reads application source logic.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const p = (...a) => join(ROOT, ...a);
const DS = p('ui', 'src', 'ds');
const TOKENS = join(DS, 'tokens.css');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const walk = (d) =>
  !existsSync(d) ? [] : readdirSync(d).flatMap((n) => {
    if (n === 'node_modules' || n === 'dist') return [];
    const f = join(d, n);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });
const rel = (f) => relative(ROOT, f);
const tokensText = () => {
  assert.ok(existsSync(TOKENS), 'ui/src/ds/tokens.css is missing');
  return strip(readFileSync(TOKENS, 'utf8'));
};

// Split the token file into [selector-header, body] for the three palette blocks.
function block(css, header) {
  const i = css.indexOf(header);
  assert.ok(i >= 0, `${header} is missing in ui/src/ds/tokens.css`);
  const start = css.indexOf('{', i);
  let depth = 0;
  for (let k = start; k < css.length; k++) {
    if (css[k] === '{') depth++;
    else if (css[k] === '}' && --depth === 0) return css.slice(start + 1, k);
  }
  assert.fail(`unclosed block ${header}`);
}
const decls = (body) =>
  Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().replace(/\s+/g, ' ')]));
const darkAttr = () => decls(block(tokensText(), ':root[data-theme="dark"]'));
const darkMedia = () => {
  const t = tokensText();
  const i = t.search(/@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{/);
  assert.ok(i >= 0, 'no prefers-color-scheme: dark media block');
  return decls(block(t.slice(i), ':root:not([data-theme="light"])'));
};
// Light base = every declaration in plain `:root { }` blocks (not the attribute or media ones).
const lightBase = () => {
  const t = tokensText();
  const out = {};
  for (const m of t.matchAll(/(^|\n)\s*:root\s*\{/g)) Object.assign(out, decls(block(t.slice(m.index), ':root')));
  return out;
};
const norm = (v) => v.toLowerCase().replace(/\s+/g, '');

// ---------------------------------------------------------------- AC1
// npm test already runs vitest; a nested run skips the vitest and vite build steps (as setup-05 does).
const NESTED = process.env.MNEMO_NESTED ? 'nested run (inside npm test, which already runs vitest)' : false;

test('AC1: ui/src/ds has tokens.css, components/ and index.ts', () => {
  assert.ok(existsSync(DS) && statSync(DS).isDirectory(), 'ui/src/ds/ is missing');
  assert.ok(existsSync(TOKENS), 'ui/src/ds/tokens.css is missing');
  assert.ok(existsSync(join(DS, 'index.ts')), 'ui/src/ds/index.ts is missing');
  assert.ok(existsSync(join(DS, 'components')) && statSync(join(DS, 'components')).isDirectory(), 'ui/src/ds/components/ is missing');
});

test('AC1: every component folder holds <name>.ts, <name>.css and <name>.test.ts', () => {
  const dir = join(DS, 'components');
  assert.ok(existsSync(dir), 'ui/src/ds/components/ is missing');
  for (const n of readdirSync(dir).filter((x) => statSync(join(dir, x)).isDirectory())) {
    for (const ext of ['ts', 'css', 'test.ts'])
      assert.ok(existsSync(join(dir, n, `${n}.${ext}`)), `components/${n}/${n}.${ext} is missing`);
  }
});

test('AC1: ui/src/ds/index.ts is the only top-level entry point', () => {
  const idx = join(DS, 'index.ts');
  assert.ok(existsSync(idx), 'index.ts missing');
  // Later tickets add component folders (#107 to #110), so this file does not forbid them.
  // Only index.ts and tokens.css (plus the moved base styles) sit at the top of ds; no other .ts entry point.
  const topTs = readdirSync(DS).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'));
  // index.ts is the entry point; later files such as the dev-only registry (catalog.ts, #105) may sit beside it.
  assert.ok(topTs.includes('index.ts'), `index.ts is missing at the top of ui/src/ds, found: ${topTs.join(', ')}`);
});

test('AC1: ui/src/tokens.css and ui/src/base.css are gone; base styles live under ui/src/ds', () => {
  assert.ok(!existsSync(p('ui', 'src', 'tokens.css')), 'ui/src/tokens.css still exists');
  assert.ok(!existsSync(p('ui', 'src', 'base.css')), 'ui/src/base.css still exists');
  const css = walk(DS).filter((f) => f.endsWith('.css') && f !== TOKENS).map((f) => strip(readFileSync(f, 'utf8'))).join('\n');
  for (const [name, re] of [
    ['page', /\bbody\b|\.page\b/], ['card', /\.card\b/], ['button', /\.btn\b/],
    ['input', /\binput\b|\.input\b/], ['pill', /\.pill\b/], ['list row', /\.row\b/],
  ]) assert.match(css, re, `base style for ${name} not found under ui/src/ds`);
});

// ---------------------------------------------------------------- AC2
const NEW_LIGHT = {
  '--control-height-primary': '44px',
  '--control-edge': '#80858f',
  '--on-bad': '#ffffff',
  '--sidebar-width': '260px',
  '--sidebar-width-collapsed': '72px',
  '--dur-fast': '120ms',
  '--dur-base': '200ms',
  '--dur-slow': '1200ms',
  '--z-sticky': '20',
  '--z-popover': '50',
  '--z-toast': '200',
  '--icon-sm': '16px',
  '--icon-md': '20px',
  '--border-1': '1px',
  '--border-2': '2px',
};

test('AC2: the new tokens exist in ui/src/ds/tokens.css with the approved values', () => {
  tokensText();
  const base = lightBase();
  for (const [k, v] of Object.entries(NEW_LIGHT)) {
    assert.ok(k in base, `${k} is missing from the light/base :root`);
    assert.equal(norm(base[k]), norm(v), `${k} should be ${v}, is ${base[k]}`);
  }
  assert.ok('--scrim' in base, '--scrim is missing');
  assert.match(norm(base['--scrim']), /color-mix\(insrgb,var\(--player\)55%,transparent\)/, '--scrim must be color-mix(in srgb, var(--player) 55%, transparent)');
});

test('AC2: dark values of --control-edge and --on-bad are in both dark blocks', () => {
  for (const [name, d] of [['data-theme=dark', darkAttr()], ['prefers-color-scheme', darkMedia()]]) {
    assert.equal(norm(d['--control-edge'] ?? ''), '#6b7184', `--control-edge dark in ${name}`);
    assert.equal(norm(d['--on-bad'] ?? ''), '#0b1033', `--on-bad dark in ${name}`);
  }
});

test('AC2: --sidebar-width and --sidebar-width-collapsed are removed from frame/sidebar.css', () => {
  const css = strip(readFileSync(p('ui', 'src', 'frame', 'sidebar.css'), 'utf8'));
  assert.doesNotMatch(css, /--sidebar-width(-collapsed)?\s*:/, 'sidebar.css still declares a sidebar width token');
  assert.match(css, /var\(\s*--sidebar-width\s*\)/, 'sidebar.css should still use var(--sidebar-width)');
  assert.match(css, /var\(\s*--sidebar-width-collapsed\s*\)/, 'sidebar.css should still use var(--sidebar-width-collapsed)');
});

test('AC2: every token named in DESIGN.md exists in ui/src/ds/tokens.css', () => {
  const defined = new Set(Object.keys(lightBase()));
  for (const k of Object.keys(darkAttr())) defined.add(k);
  const design = readFileSync(p('DESIGN.md'), 'utf8');
  const section = design.slice(design.indexOf('## 3. Token groups'), design.indexOf('### Sizes, icons and fixed choices'));
  const names = new Set();
  for (const m of section.matchAll(/`(--[a-z0-9-]+)`/g)) names.add(m[1]);
  // ranges written as "--space-1 to --space-6"
  for (let i = 1; i <= 6; i++) names.add(`--space-${i}`);
  for (const n of [...names].sort()) assert.ok(defined.has(n), `${n} is named in DESIGN.md but missing in ui/src/ds/tokens.css`);
  for (const n of ['--dur-fast', '--dur-base', '--dur-slow', '--z-sticky', '--z-popover', '--z-toast', '--icon-sm', '--icon-md', '--border-1', '--border-2'])
    assert.ok(defined.has(n), `${n} missing`);
});

test('AC2: no colour, font-size, spacing, radius, shadow or sidebar-width token is declared outside ui/src/ds/tokens.css', () => {
  const bad = [];
  for (const f of walk(p('ui', 'src')).filter((x) => x.endsWith('.css') && x !== TOKENS)) {
    const s = strip(readFileSync(f, 'utf8'));
    for (const m of s.matchAll(/(^|[;{\s])(--(?:paper|card|ink2?|muted|line|accent[\w-]*|bad[\w-]*|good[\w-]*|tint-[\w-]+|text-[\w-]+|space-\d|radius-[\w-]+|sh\d|shadow|dur-[\w-]+|z-[\w-]+|sidebar-width[\w-]*|scrim|control-[\w-]+|on-[\w-]+))\s*:/g))
      bad.push(`${rel(f)} declares ${m[2]}`);
  }
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- AC3
test('AC3: theme selectors stay as shipped and the dark palette is written twice and equal', () => {
  const t = tokensText();
  assert.ok(t.includes(':root[data-theme="dark"]'), 'missing :root[data-theme="dark"]');
  assert.ok(t.includes(':root:not([data-theme="light"])'), 'missing :root:not([data-theme="light"])');
  assert.ok(t.includes(':root[data-theme="light"]'), 'missing :root[data-theme="light"]');
  const a = darkAttr();
  const b = darkMedia();
  assert.ok(Object.keys(a).length > 30, 'dark palette looks empty');
  assert.deepEqual(a, b, 'the two dark blocks differ');
});

// theme.ts is byte-identical to main. theme.test.ts may differ only in the token path it reads.
// The one-time hash pin of theme.ts and theme.test.ts was removed after review: it would fail on
// any later legitimate edit. The theme behaviour stays covered by theme.test.ts itself.

test('AC3: theme.test.ts passes against the moved token file', { skip: NESTED }, () => {
  tokensText();
  assert.ok(!existsSync(p('ui', 'src', 'tokens.css')), 'old ui/src/tokens.css still exists');
  const r = spawnSync('npx', ['vitest', 'run', '--no-color', 'ui/src/frame/theme.test.ts'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  assert.equal(r.status, 0, `vitest exit ${r.status}\n${r.stdout}\n${r.stderr}`);
});

// ---------------------------------------------------------------- AC4
test('AC4: Lucide is bundled locally, with no CDN', () => {
  const pkg = JSON.parse(readFileSync(p('package.json'), 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const inPkg = Object.keys(deps).some((n) => /lucide/i.test(n));
  const vendored = walk(p('ui')).some((f) => /lucide/i.test(rel(f)) || (/\.svg$/.test(f) && /icons?/i.test(rel(f))));
  assert.ok(inPkg || vendored, 'no Lucide dependency or bundled icon files found');
  const files = walk(p('ui')).filter((f) => /\.(html|css|ts|svg)$/.test(f));
  for (const f of files)
    assert.doesNotMatch(readFileSync(f, 'utf8'), /https?:\/\/[^\s"')]*(unpkg|jsdelivr|cdnjs|lucide\.dev|googleapis|gstatic)[^\s"')]*/i, `${rel(f)} loads from a CDN`);
});

test('AC4: the Lucide licence text is in licenses/', () => {
  const files = existsSync(p('licenses')) ? readdirSync(p('licenses')) : [];
  const f = files.find((n) => /lucide/i.test(n));
  assert.ok(f, `no Lucide licence file in licenses/ (found: ${files.join(', ')})`);
  const text = readFileSync(p('licenses', f), 'utf8');
  assert.match(text, /ISC License|Permission to use, copy, modify, and\/or distribute this software/i, 'licence text is not the ISC text');
  assert.match(text, /Lucide/i, 'licence text does not name Lucide');
  assert.ok(files.includes('OFL.txt'), 'existing OFL.txt must stay');
});

test('AC4: the icon choice is recorded in docs/decisions/', () => {
  const dir = p('docs', 'decisions');
  const f = readdirSync(dir).find((n) => n.endsWith('.md') && /lucide/i.test(readFileSync(join(dir, n), 'utf8')));
  assert.ok(f, 'no file in docs/decisions/ mentions Lucide');
});

// ---------------------------------------------------------------- AC5
const lin = (hex) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
};
const L = (hex) => { const [r, g, b] = lin(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

const TEXT_PAIRS = [
  ['--ink', '--paper'], ['--ink', '--card'], ['--ink', '--head'],
  ['--ink2', '--paper'], ['--ink2', '--card'], ['--ink2', '--head'],
  ['--muted', '--paper'], ['--muted', '--card'], ['--muted', '--head'],
  ['--on-accent', '--accent'], ['--on-bad', '--bad'],
  ['--chip-ink', '--tint-info'], ['--warn-ink', '--tint-warn'], ['--guess-ink', '--tint-bad'],
  ['--ink', '--tint-note'], ['--ink', '--tint-good'], ['--ink', '--tint-neutral'],
];
const EDGE_PAIRS = [['--control-edge', '--card'], ['--control-edge', '--paper'], ['--control-edge', '--head']];

test('AC5: text/surface pairs and --control-edge borders meet WCAG AA in light and dark (independent check)', () => {
  const light = lightBase();
  const dark = darkAttr();
  const fails = [];
  for (const [mode, pal] of [['light', { ...light }], ['dark', { ...light, ...dark }]]) {
    for (const [fg, bg, min] of [...TEXT_PAIRS.map((x) => [...x, 4.5]), ...EDGE_PAIRS.map((x) => [...x, 3])]) {
      const a = pal[fg], b = pal[bg];
      assert.match(a ?? '', /^#[0-9a-f]{6}$/i, `${fg} (${mode}) is not a 6-digit hex`);
      assert.match(b ?? '', /^#[0-9a-f]{6}$/i, `${bg} (${mode}) is not a 6-digit hex`);
      const r = ratio(a, b);
      if (r < min) fails.push(`${mode}: ${fg} on ${bg} = ${r.toFixed(2)}:1 (needs ${min}:1)`);
    }
  }
  assert.deepEqual(fails, [], `pairs below AA (report to the owner, do not edit the palette silently):\n${fails.join('\n')}`);
});

test('AC5: a contrast test exists, is picked up by npm test (so npm run check), and passes', () => {
  const pkg = JSON.parse(readFileSync(p('package.json'), 'utf8'));
  assert.match(pkg.scripts.check, /npm run test/, 'npm run check must run npm run test');
  const cands = [...walk(p('tests')), ...walk(p('ui', 'src'))].filter(
    (f) => /contrast/i.test(rel(f)) && !rel(f).startsWith(join('tests', 'acceptance')) && /\.(test\.mjs|test\.ts)$/.test(f));
  assert.ok(cands.length > 0, 'no *contrast*.test.mjs or *contrast*.test.ts outside tests/acceptance');
  for (const f of cands) {
    const src = readFileSync(f, 'utf8');
    assert.match(src, /ds[\\/]tokens\.css|ds['",\s]+['"]tokens\.css/, `${rel(f)} does not read ui/src/ds/tokens.css`);
    assert.match(src, /control-edge/, `${rel(f)} does not check --control-edge`);
    const inScope = f.endsWith('.mjs') ? /^tests[\\/][^\\/]+\.test\.mjs$/.test(rel(f)) : true;
    assert.ok(inScope, `${rel(f)} is not matched by the npm test globs`);
    const r = f.endsWith('.mjs')
      ? spawnSync('node', ['--test', f], { cwd: ROOT, encoding: 'utf8', timeout: 120000 })
      : spawnSync('npx', ['vitest', 'run', '--no-color', rel(f)], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    assert.equal(r.status, 0, `${rel(f)} failed:\n${r.stdout}\n${r.stderr}`);
  }
});

// ---------------------------------------------------------------- AC6
test('AC6: raw-colour test and every file under ui/ point to the new ds paths', () => {
  const raw = readFileSync(p('tests', 'raw-colour.test.mjs'), 'utf8');
  assert.match(raw, /["']ds["']\s*,\s*["']tokens\.css["']|ds\/tokens\.css/, 'tests/raw-colour.test.mjs does not point to ui/src/ds/tokens.css');
  assert.doesNotMatch(raw, /["']src["']\s*,\s*["']tokens\.css["']|ui\/src\/tokens\.css/, 'tests/raw-colour.test.mjs still names the old path');
  const stale = [];
  for (const f of [...walk(p('ui')), ...walk(p('tests')).filter((x) => !x.endsWith('ds-02-foundation.test.mjs'))]
    .filter((x) => /\.(ts|css|html|mjs|js)$/.test(x))) {
    const s = readFileSync(f, 'utf8');
    const t = s.replace(/ds\/tokens\.css/g, '').replace(/ds\/base\.css/g, '');
    if (/ui\/src\/tokens\.css|(^|[^\w-])\.{1,2}\/(\.\.\/)*tokens\.css|['"]\.\/tokens\.css|['"]src['"],\s*['"]tokens\.css/.test(t)) stale.push(rel(f));
    // #105: the UI Catalog registry and its tests name the source tag "base.css" as plain text. Only the bare tag is allowed there; a path-like reference is still stale.
    const tagFile = /ui\/src\/ds\/catalog[.\w]*$|ui\/src\/screens\/catalog\/|tests\/acceptance\/ds-03-/.test(rel(f));
    const baseRe = tagFile ? /(^|[^\w-])(\.\/|src\/|ui\/src\/)base\.css\b/ : /(^|[^\w-])(\.\/|src\/|ui\/src\/)?base\.css\b/;
    if (baseRe.test(t)) stale.push(`${rel(f)} (base.css)`);
  }
  assert.deepEqual(stale, [], `stale references to the old paths:\n${stale.join('\n')}`);
});

test('AC6: the build succeeds and ships both palettes and the new tokens', { skip: NESTED }, () => {
  const r = spawnSync('npx', ['vite', 'build', '--outDir', join(p('node_modules'), '.cache', 'ds02-dist'), '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
  assert.equal(r.status, 0, `vite build exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  const out = join(p('node_modules'), '.cache', 'ds02-dist');
  const css = walk(out).filter((f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8')).join('\n');
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /--control-edge/);
  assert.match(css, /--sidebar-width:\s*260px/);
});

test('AC6: the app look is kept: existing colour values are unchanged', () => {
  const base = lightBase();
  const keep = { '--paper': '#f3f4f8', '--card': '#ffffff', '--ink': '#14161b', '--accent': '#2b4bff', '--bad': '#b3261e', '--line': '#e4e6ee', '--control-height': '40px', '--focus-ring': '3px', '--radius-md': '8px', '--space-4': '16px' };
  for (const [k, v] of Object.entries(keep)) assert.equal(norm(base[k] ?? ''), norm(v), `${k} changed`);
  const d = darkAttr();
  for (const [k, v] of Object.entries({ '--paper': '#0d0f15', '--card': '#161922', '--ink': '#f2f1ec', '--accent': '#8fa2ff', '--bad': '#ff9c8c' }))
    assert.equal(norm(d[k] ?? ''), norm(v), `dark ${k} changed`);
});

// ---------------------------------------------------------------- AC7
test('AC7: --scrim has a safe fallback before color-mix and WebKitGTK support is marked Unverified', () => {
  const raw = readFileSync(TOKENS, 'utf8');
  const lines = raw.split('\n');
  const idx = lines.findIndex((l) => /--scrim\s*:\s*color-mix\(/.test(l) && !/^\s*\/[/*]/.test(l));
  assert.ok(idx >= 0, 'no --scrim: color-mix(...) declaration');
  const before = lines.slice(0, idx).filter((l) => /^\s*--scrim\s*:/.test(l));
  assert.ok(before.length >= 1, 'no fallback --scrim declaration before the color-mix one');
  assert.doesNotMatch(before.at(-1), /color-mix/, 'the fallback must not itself use color-mix');
  assert.match(before.at(-1), /--scrim\s*:\s*\S/, 'fallback must have a value');
  assert.match(raw, /Unverified/i, 'tokens.css does not mark the support as Unverified');
  const near = lines.slice(Math.max(0, idx - 8), idx + 4).join('\n');
  assert.match(near, /WebKitGTK/i, 'the comment near --scrim does not name WebKitGTK');
  assert.match(near, /Unverified/i, 'the comment near --scrim does not say Unverified');
  assert.match(near, /22\.04/, 'the comment near --scrim does not name Ubuntu 22.04');
});
