// Acceptance tests for #5 [SPIKE-01] Throwaway Tauri app: kanban screen + tray (closes DEC-01).
// They check the result file, the spike files and the git history from outside. No network.
// Run: node --test "tests/acceptance/spike-01.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = '7068ce7'; // main at the time the spike branch was cut
const DOC = join(ROOT, 'docs', 'spikes', 'spike-01-tauri.md');
const SKIP = new Set(['node_modules', 'target', '.git', 'dist']);

const doc = () => {
  assert.ok(existsSync(DOC), 'docs/spikes/spike-01-tauri.md is missing');
  return readFileSync(DOC, 'utf8');
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// The spike app is the Tauri project (has a tauri.conf.json) that is not the main app's src-tauri/.
function spikeDir() {
  const confs = walk(ROOT).filter(
    (f) => f.endsWith('tauri.conf.json') && relative(ROOT, f) !== join('src-tauri', 'tauri.conf.json'),
  );
  assert.ok(confs.length > 0, 'no spike Tauri project found (a second tauri.conf.json outside src-tauri/)');
  // project root = parent of src-tauri/ (or the dir holding the conf)
  let d = dirname(confs[0]);
  if (d.endsWith('src-tauri')) d = dirname(d);
  return d;
}
const spikeFiles = () => walk(spikeDir()).filter((f) => !/package-lock\.json|Cargo\.lock|\/gen\/|\/icons\//.test(f));
const spikeText = (re) =>
  spikeFiles()
    .filter((f) => re.test(f))
    .map((f) => [relative(ROOT, f), readFileSync(f, 'utf8')]);

function tableRows(md) {
  return md
    .split('\n')
    .filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|?\s*$/.test(l))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
}

test('AC1: one documented build command sequence, recorded as run with exit code 0', () => {
  const d = doc();
  const blocks = [...d.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const build = blocks.find((b) => /tauri\s+build|cargo\s+build/.test(b));
  assert.ok(build, 'no fenced code block with a build command (tauri build / cargo build)');
  assert.match(build, /npm\s+(ci|install)/, 'the sequence should include the dependency install step');
  assert.match(d, /Ubuntu 22\.04/);
  assert.match(d, /exit(\s+code)?\s*[:=]?\s*0\b/i, 'the doc must record the build exit code 0');
});

test('AC1: the documented build points at a real spike project', () => {
  const dir = spikeDir();
  assert.ok(existsSync(join(dir, 'package.json')), 'spike package.json missing');
  assert.ok(
    existsSync(join(dir, 'src-tauri', 'Cargo.toml')) || existsSync(join(dir, 'Cargo.toml')),
    'spike Cargo.toml missing',
  );
  const rel = relative(ROOT, dir);
  assert.ok(doc().includes(rel), `the doc must name the spike folder ${rel}`);
});

test('AC2: the spike screen has kanban columns and cards from hard-coded sample data', () => {
  const src = spikeText(/\.(html|tsx?|jsx?|js)$/).filter(([f]) => !/vite\.config/.test(f));
  assert.ok(src.length > 0, 'no spike UI source found');
  const all = src.map(([, t]) => t).join('\n');
  assert.match(all, /column/i);
  assert.match(all, /card/i);
  assert.match(all, /(To ?do|Backlog|Doing|In progress|Done)/i, 'sample column names missing');
});

test('AC2: a card can be dragged to another column', () => {
  const all = spikeText(/\.(html|tsx?|jsx?|js)$/).map(([, t]) => t).join('\n');
  assert.match(all, /dragstart|pointerdown|mousedown/i, 'no drag start handling');
  assert.match(all, /drop|pointerup|mouseup/i, 'no drop handling');
});

test('AC2: styling comes from CSS tokens only (no colour literals outside token definitions)', () => {
  const css = spikeText(/\.css$/);
  assert.ok(css.length > 0, 'no spike CSS found');
  const all = css.map(([, t]) => t).join('\n');
  assert.match(all, /--[a-z0-9-]+\s*:/, 'no CSS custom properties (tokens) defined');
  assert.match(all, /var\(--/, 'styles do not use tokens');
  for (const [file, text] of css) {
    const bad = text
      .split('\n')
      .filter((l) => !/^\s*--[\w-]+\s*:/.test(l))
      .filter((l) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(l));
    assert.deepEqual(bad, [], `${file} has colour literals outside token definitions`);
  }
  const markup = spikeText(/\.(html|tsx?|jsx?)$/).map(([, t]) => t).join('\n');
  assert.doesNotMatch(markup, /style=["'][^"']*#[0-9a-fA-F]{3,8}/, 'inline hex colours');
});

test('AC3: tray has exactly two items, Open and Quit', () => {
  const rs = spikeText(/\.rs$/).map(([, t]) => t).join('\n');
  assert.match(rs, /TrayIcon/);
  assert.match(rs, /["']Open["']/);
  assert.match(rs, /["']Quit["']/);
  const items = rs.match(/(MenuItem(::new|Builder::(new|with_id))|MenuItem::with_id)/g) || [];
  assert.equal(items.length, 2, `expected exactly 2 tray menu items, found ${items.length}`);
});

test('AC3: closing the window hides it, Open shows it, Quit exits', () => {
  const rs = spikeText(/\.rs$/).map(([, t]) => t).join('\n');
  assert.match(rs, /CloseRequested/);
  assert.match(rs, /prevent_close/);
  assert.match(rs, /\.hide\(\)/);
  assert.match(rs, /\.show\(\)/);
  assert.match(rs, /\.exit\(\s*0\s*\)/);
});

test('AC4: result file has the four rows with Mac and Ubuntu columns', () => {
  const rows = tableRows(doc());
  const header = rows.find((r) => r.some((c) => /^mac$/i.test(c)) && r.some((c) => /^ubuntu$/i.test(c)));
  assert.ok(header, 'no table header with Mac and Ubuntu columns');
  const mac = header.findIndex((c) => /^mac$/i.test(c));
  const ubu = header.findIndex((c) => /^ubuntu$/i.test(c));
  const find = (re) => rows.find((r) => re.test(r[0] || ''));
  const four = [
    find(/RAM/i),
    find(/click to first screen|first screen/i),
    find(/kanban/i),
    find(/tray/i),
  ];
  four.forEach((r, i) => assert.ok(r, `row ${i + 1} missing`));
  for (const r of four) {
    assert.equal((r[mac] ?? '').trim(), '', `Mac cell must be empty in row "${r[0]}"`);
    assert.ok((r[ubu] ?? '').trim().length > 0, `Ubuntu cell must be filled in row "${r[0]}"`);
  }
});

test('AC4: Ubuntu numbers say how they were measured, and 3 runs are reported', () => {
  const d = doc();
  const rows = tableRows(d);
  const header = rows.find((r) => r.some((c) => /^ubuntu$/i.test(c)));
  const ubu = header.findIndex((c) => /^ubuntu$/i.test(c));
  const ram = rows.find((r) => /RAM/i.test(r[0] || ''));
  const first = rows.find((r) => /first screen/i.test(r[0] || ''));
  if (/\d/.test(ram[ubu])) assert.match(ram[ubu], /measured|ps|\/proc|RSS|System Monitor|smem|top/i);
  if (/\d/.test(first[ubu])) {
    assert.match(first[ubu], /measured|stopwatch|timer|script|date|ms|seconds|s\b/i);
    assert.ok((first[ubu].match(/\d+(\.\d+)?\s*(ms|s)\b/g) || []).length >= 3, 'expected 3 run values');
  } else {
    assert.match(first[ubu], /not measurable here\s*:/i);
  }
  assert.match(d, /Unverified/, 'unmeasured claims must be marked Unverified');
});

test('AC5: the file ends with a blank DEC-01 line', () => {
  const lines = doc().split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  assert.match(last, /^\W*DEC-01\b/);
  assert.doesNotMatch(last, /Tauri 2|Electron/i, 'the DEC-01 line must not be pre-filled');
  assert.match(last, /^\W*DEC-01\W*(:\s*)?[_\s.\-]*$/, 'the DEC-01 line must have nothing after it');
});

test('AC6: no real data, storage, AI or network in the spike', () => {
  const files = spikeText(/\.(rs|toml|html|tsx?|jsx?|js|json)$/).filter(([f]) => !/package\.json$/.test(f));
  assert.ok(files.length > 0);
  const all = files.map(([, t]) => t).join('\n');
  assert.doesNotMatch(all, /reqwest|ureq|hyper|fetch\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(all, /rusqlite|sqlx|localStorage|indexedDB/);
  assert.doesNotMatch(all, /claude\s+-p|Command::new/);
  const urls = (all.match(/https?:\/\/[^\s"')]+/g) || []).filter(
    (u) => !/localhost|127\.0\.0\.1|schema\.tauri\.app|w3\.org|json-schema\.org/.test(u),
  );
  assert.deepEqual(urls, []);
});

test('AC6: the main app code is untouched and the spike is outside root lint scope', () => {
  const dir = spikeDir();
  const rel = relative(ROOT, dir);
  assert.ok(!rel.startsWith('ui') && !rel.startsWith('src-tauri'), 'spike must not live in ui/ or src-tauri/');
  const diff = spawnSync('git', ['-C', ROOT, 'diff', '--name-only', BASE], { encoding: 'utf8' });
  const changed = diff.stdout.split('\n').filter(Boolean);
  const touched = changed.filter((f) => /^(ui|src-tauri)\//.test(f));
  assert.deepEqual(touched, [], 'main app files changed');
  const fmt = spawnSync('npx', ['biome', 'format'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(fmt.status, 0, fmt.stdout + fmt.stderr);
  const lint = spawnSync('npx', ['biome', 'ci', '--formatter-enabled=false'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(lint.status, 0, lint.stdout + lint.stderr);
});

test('AC7: nothing says it closes issue #5', () => {
  const d = doc();
  assert.doesNotMatch(d, /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+(minhtran-agilityio\/mnemo)?#5\b/i);
  const log = spawnSync('git', ['-C', ROOT, 'log', '--format=%B', `${BASE}..HEAD`], { encoding: 'utf8' }).stdout;
  assert.doesNotMatch(log, /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+(minhtran-agilityio\/mnemo)?#5\b/i);
});
