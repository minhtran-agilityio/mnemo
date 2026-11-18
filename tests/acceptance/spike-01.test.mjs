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
const DOC = join(ROOT, 'docs', 'spikes', 'spike-01-tauri.md');
// The fork point from main, found at run time. No commit id is hard-coded, so later changes do not trip it.
const git = (...args) => spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
const mergeBase = () => {
  for (const ref of ['github/main', 'origin/main', 'main']) {
    const r = git('merge-base', 'HEAD', ref);
    const sha = r.stdout.trim();
    if (r.status === 0 && sha) return sha;
  }
  return '';
};
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
  // Only spikes/ is searched, so worktrees or copies of the main app elsewhere in the checkout never match.
  const spikesRoot = join(ROOT, 'spikes');
  if (!existsSync(spikesRoot)) return null;
  const confs = walk(spikesRoot).filter((f) => f.endsWith('tauri.conf.json'));
  if (confs.length === 0) return null;
  // project root = parent of src-tauri/ (or the dir holding the conf)
  let d = dirname(confs[0]);
  if (d.endsWith('src-tauri')) d = dirname(d);
  return d;
}
// The doc tells the owner to delete the spike folder after DEC-01. Spike tests then skip instead of failing.
const SPIKE = spikeDir();
const NO_SPIKE = SPIKE ? false : 'spike folder removed (after DEC-01)';
const spikeFiles = () => walk(SPIKE).filter((f) => !/package-lock\.json|Cargo\.lock|\/gen\/|\/icons\//.test(f));
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

test('AC1: the documented build points at a real spike project', { skip: NO_SPIKE }, () => {
  const dir = SPIKE;
  assert.ok(existsSync(join(dir, 'package.json')), 'spike package.json missing');
  assert.ok(
    existsSync(join(dir, 'src-tauri', 'Cargo.toml')) || existsSync(join(dir, 'Cargo.toml')),
    'spike Cargo.toml missing',
  );
  const rel = relative(ROOT, dir);
  assert.ok(doc().includes(rel), `the doc must name the spike folder ${rel}`);
});

test('AC2: the spike screen has kanban columns and cards from hard-coded sample data', { skip: NO_SPIKE }, () => {
  const src = spikeText(/\.(html|tsx?|jsx?|js)$/).filter(([f]) => !/vite\.config/.test(f));
  assert.ok(src.length > 0, 'no spike UI source found');
  const all = src.map(([, t]) => t).join('\n');
  assert.match(all, /column/i);
  assert.match(all, /card/i);
  assert.match(all, /(To ?do|Backlog|Doing|In progress|Done)/i, 'sample column names missing');
});

test('AC2: a card can be dragged to another column', { skip: NO_SPIKE }, () => {
  const all = spikeText(/\.(html|tsx?|jsx?|js)$/).map(([, t]) => t).join('\n');
  assert.match(all, /dragstart|pointerdown|mousedown/i, 'no drag start handling');
  assert.match(all, /drop|pointerup|mouseup/i, 'no drop handling');
});

test('AC2: the drop target lookup skips the dragged card itself', { skip: NO_SPIKE }, () => {
  const all = spikeText(/\.ts$/).map(([, t]) => t).join('\n');
  assert.doesNotMatch(all, /elementFromPoint\(/, 'elementFromPoint returns the dragged card, not the column below it');
  assert.match(all, /elementsFromPoint\([^)]*\)\s*\.find\(\s*\(el\)\s*=>\s*!\w+\.contains\(el\)/, 'the lookup must skip the dragged card');
});

test('AC2: the move message names the column title, and a card can move by keyboard', { skip: NO_SPIKE }, () => {
  const all = spikeText(/\.ts$/).map(([, t]) => t).join('\n');
  assert.doesNotMatch(all, /to \$\{[^}]*dataset\.columnId\}/, 'the status message must not print the column id');
  assert.match(all, /ArrowLeft/);
  assert.match(all, /ArrowRight/);
  assert.match(all, /tabIndex\s*=\s*0/, 'cards must be focusable');
});

test('AC2: styling comes from CSS tokens only (no colour literals outside token definitions)', { skip: NO_SPIKE }, () => {
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

test('AC3: tray has exactly two items, Open and Quit', { skip: NO_SPIKE }, () => {
  const rs = spikeText(/\.rs$/).map(([, t]) => t).join('\n');
  assert.match(rs, /TrayIcon/);
  assert.match(rs, /["']Open["']/);
  assert.match(rs, /["']Quit["']/);
  const items = rs.match(/(MenuItem(::new|Builder::(new|with_id))|MenuItem::with_id)/g) || [];
  assert.equal(items.length, 2, `expected exactly 2 tray menu items, found ${items.length}`);
});

test('AC3: closing the window hides it, Open shows it, Quit exits', { skip: NO_SPIKE }, () => {
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
    // The Mac cells are the owner's to fill in; they may be empty or filled.
    assert.ok(mac >= 0, 'no Mac column');
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

test('AC5: the file ends with a DEC-01 line, blank until the owner decides', () => {
  const lines = doc().split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  assert.match(last, /^\W*DEC-01\b/);
  const blank = /^\W*DEC-01\W*(:\s*)?[_\s.\-]*$/.test(last);
  const decided = /^\W*DEC-01( closed)?:\s*(Tauri 2|switch to Electron)\b/i.test(last);
  assert.ok(blank || decided, 'the DEC-01 line must be blank or say "DEC-01 closed: Tauri 2" or "DEC-01: switch to Electron"');
});

test('AC6: no real data, storage, AI or network in the spike', { skip: NO_SPIKE }, () => {
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

test('AC6: the spike is outside the main app folders and root lint scope', { skip: NO_SPIKE }, () => {
  const dir = SPIKE;
  const rel = relative(ROOT, dir);
  assert.ok(!rel.startsWith('ui') && !rel.startsWith('src-tauri'), 'spike must not live in ui/ or src-tauri/');
  // Root lint and format are `npm run check`'s job. Here: only that biome.json does not reach the spike.
  const { files } = JSON.parse(readFileSync(join(ROOT, 'biome.json'), 'utf8'));
  const includes = (files?.includes ?? []).join(' ');
  assert.ok(includes && !includes.includes('spikes') && !includes.includes('**/*'), 'biome.json must not include the spike');
});

test('AC7: nothing says it closes issue #5', (t) => {
  const d = doc();
  assert.doesNotMatch(d, /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+(minhtran-agilityio\/mnemo)?#5\b/i);
  const base = mergeBase();
  if (!base) return t.skip('no fork point from main in this checkout (shallow clone?); commit messages not checked');
  const res = git('log', '--format=%B', `${base}..HEAD`);
  assert.equal(res.status, 0, `git log failed: ${res.stderr}`);
  const log = res.stdout;
  assert.doesNotMatch(log, /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+(minhtran-agilityio\/mnemo)?#5\b/i);
});

test('docs: the README does not say npm run check ignores the spike', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /npm run check`?\s+ignores/i, 'the acceptance test reads the spike under npm test');
});
