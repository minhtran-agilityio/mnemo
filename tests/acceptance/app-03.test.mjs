// Acceptance tests for #10 [APP-03] Design tokens and base styles from the prototype.
// Run: node --test tests/acceptance/app-03.test.mjs   (runs under npm test too)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, cpSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const p = (...a) => join(ROOT, ...a);
const NESTED = process.env.MNEMO_NESTED ? 'nested run (inside npm test, which already runs these)' : false;
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'specs', 'gen']);
const walk = (d, skip = new Set()) =>
  !existsSync(d)
    ? []
    : readdirSync(d).flatMap((n) => {
        if (skip.has(n)) return [];
        const f = join(d, n);
        return statSync(f).isDirectory() ? walk(f, skip) : [f];
      });
const uiAll = () => walk(p('ui'));
const TOKENS = p('ui', 'src', 'ds', 'tokens.css');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = () => {
  assert.ok(existsSync(TOKENS), 'ui/src/ds/tokens.css is missing');
  return strip(readFileSync(TOKENS, 'utf8'));
};
const otherCss = () => uiAll().filter((f) => f.endsWith('.css') && f !== TOKENS);
const RAW_COLOUR = /#[0-9a-f]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch|hwb|lab|lch)\(/i;
const HEX = /#[0-9a-f]{3,8}\b/gi;
const sh = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: 600000, ...opts });

// Blocks of the token file: [header, body] pairs for non-nested rules, plus media blocks.
const darkMedia = (t) => {
  const i = t.search(/@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{/i);
  if (i < 0) return null;
  let depth = 0, start = -1;
  for (let k = t.indexOf('{', i); k < t.length; k++) {
    if (t[k] === '{') { if (depth++ === 0) start = k + 1; }
    else if (t[k] === '}' && --depth === 0) return { inner: t.slice(start, k), before: t.slice(0, i) + t.slice(k + 1) };
  }
  return null;
};
const colourVars = (css) =>
  [...css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+);/g)].filter(([, , v]) => RAW_COLOUR.test(v));

let built;
const build = () => {
  if (built) return built;
  const out = mkdtempSync(join(tmpdir(), 'mnemo-app03-dist-'));
  const r = sh('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir']);
  built = { out, r };
  return built;
};

test('AC1: tokens.css exists and holds colour tokens for light and dark', () => {
  const t = tokens();
  const dm = darkMedia(t);
  assert.ok(dm, 'no @media (prefers-color-scheme: dark) block in tokens.css');
  const light = colourVars(dm.before);
  const dark = colourVars(dm.inner);
  assert.ok(light.length >= 10, `expected a real light palette, found ${light.length} colour tokens`);
  assert.ok(dark.length >= 10, `expected a real dark palette, found ${dark.length} colour tokens`);
  const lm = new Map(light.map(([, n, v]) => [n, v.trim().toLowerCase()]));
  const differing = dark.filter(([, n, v]) => lm.has(n) && lm.get(n) !== v.trim().toLowerCase());
  assert.ok(differing.length >= 5, 'dark values do not differ from light values');
});

test('AC1: light and dark follow the system by default (light is the base, dark is under prefers-color-scheme)', () => {
  const t = tokens();
  const dm = darkMedia(t);
  assert.ok(dm, 'no prefers-color-scheme: dark block');
  assert.match(dm.before, /:root|html|\*|body/, 'light tokens are not on a root selector');
  assert.doesNotMatch(readFileSync(TOKENS, 'utf8'), /prefers-color-scheme\s*:\s*light/i, 'light should be the default, not a media query');
});

test('AC1: tokens.css also has type, spacing and radius tokens', () => {
  const t = tokens();
  assert.match(t, /--[\w-]*(font|type|text)[\w-]*\s*:/i, 'no type tokens');
  assert.match(t, /--[\w-]*(space|spacing|gap)[\w-]*\s*:/i, 'no spacing tokens');
  assert.match(t, /--[\w-]*radius[\w-]*\s*:/i, 'no radius tokens');
});

test('AC1: tokens.css is the only file defining colour tokens', () => {
  assert.ok(existsSync(TOKENS), 'tokens.css missing');
  for (const f of uiAll().filter((x) => /\.(css|html|ts)$/.test(x) && x !== TOKENS)) {
    const s = strip(readFileSync(f, 'utf8'));
    assert.equal(colourVars(s).length, 0, `${relative(ROOT, f)} defines a colour custom property`);
  }
});

test('AC2: base styles for page, card, button, input, pill and list row exist and use only var(--token)', () => {
  const css = otherCss().map((f) => strip(readFileSync(f, 'utf8'))).join('\n');
  assert.ok(css.length > 0, 'no CSS besides tokens.css');
  for (const [name, re] of [
    ['page', /(^|[\s,}.#])(page|app|body)\b/im],
    ['card', /\.[\w-]*card/i],
    ['button', /\.[\w-]*(button|btn)|\bbutton\b/i],
    ['input', /\.[\w-]*input|\binput\b/i],
    ['pill', /\.[\w-]*(pill|chip|badge|tag)/i],
    ['list row', /\.[\w-]*(row|list-item|list__item|item)/i],
  ]) assert.match(css, re, `no base style for ${name}`);
  assert.match(css, /var\(\s*--/, 'no var(--token) in base styles');
  assert.doesNotMatch(css, RAW_COLOUR, 'raw colour in a base style');
  // every var() resolves to a token defined in tokens.css
  const defined = new Set([...tokens().matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  for (const m of css.matchAll(/var\(\s*(--[\w-]+)/g))
    assert.ok(defined.has(m[1]) || new RegExp(`${m[1]}\\s*:`).test(css), `${m[1]} is used but not defined`);
});

test('AC2: a sample page shows every base style', () => {
  const files = uiAll().filter((f) => /\.(html|ts)$/.test(f) && !/\.test\./.test(f));
  const sample = files.filter((f) => /sample|styleguide|style-guide|showcase|gallery|kit/i.test(relative(p('ui'), f)));
  assert.ok(sample.length > 0, 'no sample page under ui/ (name with sample/styleguide/showcase/gallery)');
  const text = sample.map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const [name, re] of [
    ['card', /card/i], ['button', /button|btn/i], ['input', /input/i],
    ['pill', /pill|chip|badge|tag/i], ['list row', /row|list/i],
  ]) assert.match(text, re, `sample page does not show ${name}`);
});

test('AC2: the build succeeds and ships both light and dark colours', () => {
  tokens();
  const { out, r } = build();
  assert.equal(r.status, 0, `vite build exit ${r.status}:\n${r.stdout}\n${r.stderr}`);
  const css = walk(out).filter((f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8')).join('\n');
  assert.match(css, /prefers-color-scheme:\s*dark|prefers-color-scheme:dark/i, 'dark scheme missing from built CSS');
});

test('AC3: fonts come from @fontsource packages only', () => {
  const pkg = JSON.parse(readFileSync(p('package.json'), 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const fonts = deps.filter((d) => d.startsWith('@fontsource'));
  assert.ok(fonts.length >= 1, 'no @fontsource package declared');
  assert.ok(fonts.length <= 4, `too many font packages for one pair: ${fonts.join(', ')}`);
  const src = uiAll().filter((f) => /\.(css|ts|html)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
  assert.match(src, /@fontsource/, 'ui does not import any @fontsource package');
});

test('AC3: no Google Fonts reference in ui/ or in the built dist', () => {
  for (const f of uiAll())
    assert.doesNotMatch(readFileSync(f, 'utf8'), /fonts\.googleapis\.com|fonts\.gstatic\.com/, `${relative(ROOT, f)} references Google Fonts`);
  const { out, r } = build();
  assert.equal(r.status, 0, `vite build exit ${r.status}:\n${r.stderr}`);
  const files = walk(out);
  assert.ok(files.some((f) => /\.woff2?$/.test(f)), 'no font file bundled in the build');
  for (const f of files.filter((x) => /\.(html|css|js)$/.test(x)))
    assert.doesNotMatch(readFileSync(f, 'utf8'), /fonts\.googleapis\.com|fonts\.gstatic\.com/, `${f} references Google Fonts`);
});

test('AC3: the OFL licence text is copied into the repo', () => {
  const hits = walk(ROOT, SKIP_DIRS).filter((f) => /(OFL|licen[cs]e|fonts?)/i.test(f.split('/').pop()) && !/\.(mjs|ts|rs|json|lock)$/.test(f))
    .filter((f) => /SIL OPEN FONT LICENSE/i.test(readFileSync(f, 'utf8')));
  assert.ok(hits.length >= 1, 'no file with the SIL Open Font License text found');
});

const RAW_TEST = () => {
  const dir = join(ROOT, 'tests');
  const c = readdirSync(dir).filter((n) => n.endsWith('.test.mjs') && n !== 'version-sync.test.mjs');
  // The raw-colour test by name first; other tests (the contrast test) also name tokens.css.
  const f = c.find((n) => n === 'raw-colour.test.mjs') ?? c.find((n) => /tokens\.css/.test(readFileSync(join(dir, n), 'utf8')));
  assert.ok(f, 'no node test in tests/ that checks raw colours outside ui/src/ds/tokens.css');
  return f;
};
const sandbox = () => {
  const d = mkdtempSync(join(tmpdir(), 'mnemo-app03-'));
  mkdirSync(join(d, 'tests'));
  cpSync(p('tests'), join(d, 'tests'), { recursive: true });
  cpSync(p('ui'), join(d, 'ui'), { recursive: true });
  cpSync(p('package.json'), join(d, 'package.json'));
  return d;
};
const runIn = (d, name) => sh('node', ['--test', join(d, 'tests', name)], { cwd: d });

test('AC4: a raw-colour test exists in tests/ and passes on the clean tree', () => {
  const name = RAW_TEST();
  const d = sandbox();
  const r = runIn(d, name);
  assert.equal(r.status, 0, `exit ${r.status}:\n${r.stdout}\n${r.stderr}`);
});

for (const [label, file, body] of [
  ['hex #fff in a ts file', 'src/zz-screen.ts', "export const c = '#fff';\n"],
  ['hex in a css file', 'src/zz.css', '.zz { color: #ff0000; }\n'],
  ['rgba in a css file', 'src/zz.css', '.zz { background: rgba(0, 0, 0, 0.5); }\n'],
  ['hsl in a css file', 'src/zz.css', '.zz { color: hsl(10 20% 30%); }\n'],
  ['oklch in a css file', 'src/zz.css', '.zz { color: oklch(0.5 0.1 200); }\n'],
  ['named colour in a css file', 'src/zz.css', '.zz { color: red; }\n'],
  ['hex in an html file', 'zz.html', '<p style="color:#fff">x</p>\n'],
]) {
  test(`AC4: the raw-colour test fails on ${label}`, () => {
    const name = RAW_TEST();
    const d = sandbox();
    writeFileSync(join(d, 'ui', file), body);
    const r = runIn(d, name);
    assert.notEqual(r.status, 0, `the test still passed with a raw colour in ui/${file}`);
  });
}

test('AC4: the raw-colour test allows colours inside ui/src/ds/tokens.css', () => {
  const name = RAW_TEST();
  const d = sandbox();
  writeFileSync(join(d, 'ui', 'src', 'ds', 'tokens.css'), readFileSync(TOKENS, 'utf8') + '\n:root { --zz-test: #123456; }\n');
  const r = runIn(d, name);
  assert.equal(r.status, 0, `tokens.css was flagged:\n${r.stdout}`);
});

test('AC5: kanban.css and style.css hold no raw colour or token block', () => {
  const css = otherCss();
  const names = css.map((f) => f.split('/').pop());
  assert.ok(names.includes('style.css'), 'ui/src/style.css missing');
  assert.ok(names.some((n) => /kanban/.test(n)), 'kanban css missing');
  for (const f of css) {
    const s = strip(readFileSync(f, 'utf8'));
    assert.doesNotMatch(s, RAW_COLOUR, `raw colour in ${relative(ROOT, f)}`);
    assert.equal(colourVars(s).length, 0, `${relative(ROOT, f)} duplicates a token block`);
    assert.doesNotMatch(s, /\b(color|background(-color)?|border(-\w+)?-color|border|outline|fill|stroke)\s*:[^;]*\b(red|blue|green|white|black|gray|grey|orange|purple|yellow|pink|teal|navy)\b/i, `named colour in ${relative(ROOT, f)}`);
  }
});

test('AC5: screens use tokens, so one token change reaches every use', () => {
  const kanban = otherCss().filter((f) => /kanban|style\.css/.test(f));
  const used = kanban.map((f) => readFileSync(f, 'utf8')).join('\n');
  assert.match(used, /var\(\s*--/, 'kanban/style css use no tokens');
  const defined = new Set([...tokens().matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  for (const m of used.matchAll(/var\(\s*(--[\w-]+)/g)) assert.ok(defined.has(m[1]), `${m[1]} is not defined in tokens.css`);
  for (const f of uiAll().filter((x) => /\.(ts|html)$/.test(x)))
    assert.doesNotMatch(strip(readFileSync(f, 'utf8')), /#[0-9a-f]{3,8}\b(?![\w-])/i, `raw hex in ${relative(ROOT, f)}`);
});

test('AC6: format, lint, typecheck and unit tests pass (npm run check parts, exit 0)', { skip: NESTED }, () => {
  for (const args of [['run', 'format:check'], ['run', 'lint'], ['run', 'typecheck'], ['exec', '--', 'vitest', 'run', '--no-color']]) {
    const r = sh('npm', args);
    assert.equal(r.status, 0, `npm ${args.join(' ')} exit ${r.status}:\n${r.stdout}\n${r.stderr}`);
  }
});

// Review fix (#11): the setting commands must not run on the main thread.
test('get_setting and set_setting are async commands', () => {
  const src = readFileSync(join(ROOT, 'src-tauri', 'src', 'commands.rs'), 'utf8');
  assert.match(src, /pub async fn get_setting\(/);
  assert.match(src, /pub async fn set_setting\(/);
});

// Review fix (#11): code that is now used carries no allow(dead_code).
test('used settings code has no stale allow(dead_code)', () => {
  for (const f of ['commands.rs', join('storage', 'settings.rs')]) {
    const src = readFileSync(join(ROOT, 'src-tauri', 'src', f), 'utf8');
    assert.doesNotMatch(src, /allow\(dead_code\)/, f);
  }
});

test('a theme save result has its own line, apart from the sidebar save line', () => {
  const html = readFileSync(p('ui', 'index.html'), 'utf8');
  const main = readFileSync(p('ui', 'src', 'main.ts'), 'utf8');
  assert.match(html, /id="theme-save-note"/);
  assert.match(html, /id="setting-save-note"/);
  assert.match(main, /onDetachedSave:\s*\(failure\)\s*=>\s*showNote\(themeSaveNote,/);
  assert.doesNotMatch(main, /onDetachedSave:\s*\(failure\)\s*=>\s*showNote\(saveNote,/);
});
