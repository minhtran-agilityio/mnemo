// Acceptance tests for #30 [BM-04] Eval harness for save quality.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/bm-04-save-eval.test.mjs
// Black box, from the ticket and the owner's "Confirmed decisions" (owner, 2026-11-26: "Accept all").
// The real eval spends the owner's Claude usage, so no test here runs it. These tests read what a real run
// does not need: the stored pages in evals/save/, their expectations, the source and licence table,
// evals/save/judge.md, scripts/save-eval.sh, the ignored Rust module ai::save_eval, the committed baseline,
// and the npm scripts and CI workflows. The one Rust run here starts the ignored eval with a stand-in
// `claude` first on PATH and no MNEMO_* variable, so it can never reach the real Claude.
// The file format of the expectations is not fixed by the ticket. A page's expectations are found in a
// file next to it (same name, other extension, or the other files of a one-page folder), or in a shared
// JSON / TOML / YAML / Markdown file that names the page. JSON is read as data; other formats by keywords.
// Pages are told apart by their visible text (tags, scripts and styles removed): the decisions say the
// unreadable pages are hand-made and under 200 characters; real pages are far longer.
// Left to a real run (not tested here): AC1 "scores ... through the real runner and prints the scores"
// (`bash scripts/save-eval.sh` exits 0 and prints a score per page, a total and "runs used: N"), AC3 "A page
// the app cannot read scores as passed only when it is link only with no summary", AC4 the measured spread
// of two runs (only its mention in the pull request is checked, with MNEMO_PR_CHECK=1), and AC5 "It prints
// how many runs it used".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, basename, extname, relative } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAVE = join(ROOT, 'evals', 'save');
const RESULTS = join(SAVE, 'results');
const JUDGE = join(SAVE, 'judge.md');
const SCRIPT = join(ROOT, 'scripts', 'save-eval.sh');
const MODULE = join(ROOT, 'src-tauri', 'src', 'ai', 'save_eval.rs');
const CARGO_TOML = join(ROOT, 'src-tauri', 'Cargo.toml');
const RUST = { timeout: 600000 };

// ------------------------------------------------------------------ reading evals/save/

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const inResults = (f) => relative(RESULTS, f).split('/')[0] !== '..';
const isPage = (f) => /\.html?$/i.test(f) && !inResults(f);

/** Visible text of a raw HTML page: no scripts, styles, comments or tags; entities and spaces folded. */
function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, 'x')
    .replace(/\s+/g, ' ')
    .trim();
}

let pagesCache = null;
/** Every stored page: { file, id, html, text, unreadable }. The id is the file name without extension,
 * or the folder name when several pages share a file name (one folder per page). */
function pages() {
  if (pagesCache) return pagesCache;
  assert.ok(existsSync(SAVE), 'evals/save/ is missing');
  const files = walk(SAVE).filter(isPage);
  const stems = files.map((f) => basename(f, extname(f)));
  pagesCache = files.map((file, i) => {
    const dup = stems.filter((s) => s === stems[i]).length > 1;
    const html = readFileSync(file, 'utf8');
    const text = visibleText(html);
    return { file, id: dup ? basename(dirname(file)) : stems[i], html, text, unreadable: text.length < 200 };
  });
  return pagesCache;
}
const readable = () => pages().filter((p) => !p.unreadable);
const unreadable = () => pages().filter((p) => p.unreadable);

const otherFiles = () =>
  walk(SAVE).filter((f) => !isPage(f) && !inResults(f) && f !== JUDGE && /\.(json|toml|ya?ml|md|txt)$/i.test(f));

const tryJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The part of the JSON value that holds the expectations of page `id`, or undefined. */
function jsonSection(v, id) {
  if (Array.isArray(v)) {
    for (const x of v) {
      const s = jsonSection(x, id);
      if (s !== undefined) return s;
    }
    return undefined;
  }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) if (k === id || k.startsWith(`${id}.`)) return x;
    const names = Object.values(v).some((x) => typeof x === 'string' && new RegExp(`(^|[/\\\\])${escapeRe(id)}(\\.[a-z]+)?$`, 'i').test(x));
    if (names && Object.keys(v).some((k) => /fact|tag/i.test(k))) return v;
    for (const x of Object.values(v)) {
      const s = jsonSection(x, id);
      if (s !== undefined) return s;
    }
  }
  return undefined;
}

/** Expectations of a page: { json } for JSON data, { text } otherwise, or null when none is found. */
function expectations(page) {
  const dir = dirname(page.file);
  const onePageDir = dir !== SAVE && pages().filter((p) => dirname(p.file) === dir).length === 1;
  const others = otherFiles();
  let side = onePageDir ? others.filter((f) => dirname(f) === dir) : [];
  if (side.length === 0) side = others.filter((f) => basename(f).startsWith(`${page.id}.`));
  if (side.length > 0) {
    const jsons = side.map((f) => tryJson(readFileSync(f, 'utf8'))).filter((j) => j !== undefined);
    if (jsons.length > 0) return { json: Object.assign({}, ...jsons.filter((j) => j && typeof j === 'object' && !Array.isArray(j))) };
    return { text: side.map((f) => readFileSync(f, 'utf8')).join('\n') };
  }
  const ids = pages().map((p) => p.id).filter((id) => id !== page.id);
  for (const f of others) {
    const body = readFileSync(f, 'utf8');
    if (!body.includes(page.id)) continue;
    const j = tryJson(body);
    if (j !== undefined) {
      const s = jsonSection(j, page.id);
      if (s !== undefined) return { json: s };
      continue;
    }
    // Text formats: from the page's name to the next other page's name.
    const start = body.indexOf(page.id);
    const ends = ids.map((id) => body.indexOf(id, start + page.id.length)).filter((n) => n > start);
    const section = body.slice(start, ends.length ? Math.min(...ends) : undefined);
    if (/fact/i.test(section)) return { text: section };
  }
  return null;
}

const KINDS = {
  facts: /fact/i,
  tags: /tag/i,
  mustNot: /must[\s_-]*not|not[\s_-]*appear|forbid|absent|banned|exclude|never/i,
};
/** Values of every key matching `re` anywhere in the JSON section. */
function valuesFor(v, re, out = []) {
  if (Array.isArray(v)) for (const x of v) valuesFor(x, re, out);
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      if (re.test(k)) out.push(x);
      valuesFor(x, re, out);
    }
  return out;
}
const nonEmpty = (x) => (Array.isArray(x) ? x.length > 0 : typeof x === 'string' ? x.trim() !== '' : x && typeof x === 'object' ? Object.keys(x).length > 0 : false);

// ------------------------------------------------------------------ the source and licence table

function tableRows(md) {
  return md
    .split('\n')
    .filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|?\s*$/.test(l))
    .map((l) =>
      l
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim()),
    );
}
/** The Markdown file in evals/save/ (not judge.md) with a table whose header names a source and a licence. */
function licenceTable() {
  for (const f of walk(SAVE).filter((x) => /\.md$/i.test(x) && x !== JUDGE && !inResults(x))) {
    const md = readFileSync(f, 'utf8');
    const rows = tableRows(md);
    const h = rows.findIndex((r) => r.some((c) => /licen[cs]e/i.test(c)) && r.some((c) => /source|url|origin|link/i.test(c)));
    if (h >= 0) {
      const lic = rows[h].findIndex((c) => /licen[cs]e/i.test(c));
      return { file: f, md, header: rows[h], rows: rows.slice(h + 1), lic };
    }
  }
  return null;
}

// ------------------------------------------------------------------ AC1: the fixed pages

// AC1: "One command scores the fixed pages through the real runner and prints the scores." Ticket: "A folder
// `evals/save/` with a fixed set of about 20 pages, stored as text files so the eval does not depend on the
// live web." Decisions: "about 17 readable pages ... plus 3 unreadable pages made by hand"; "Pages are
// stored as raw HTML". The owner may add pages, so only a lower bound is set.
test('AC1: evals/save/ holds about 20 stored pages (at least 18), as raw HTML', () => {
  const all = pages();
  assert.ok(all.length >= 18, `evals/save/ holds ${all.length} stored HTML page(s); the ticket asks for about 20`);
  const ids = all.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, `two pages share a name: ${ids.join(', ')}`);
  for (const p of readable()) assert.match(p.html, /<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i, `${relative(ROOT, p.file)} is not raw HTML`);
});

// Ticket: "Include easy pages, long pages, non-English pages and 3 pages that cannot be read (empty or
// login wall)." Decisions: "The login wall is a hand-made page under 200 characters."
test('AC1: exactly 3 stored pages cannot be read: each is empty or a login wall under 200 characters', () => {
  const bad = unreadable();
  assert.equal(bad.length, 3, `expected 3 unreadable pages (under 200 characters of text), found ${bad.length}: ${bad.map((p) => p.id).join(', ')}`);
  for (const p of bad) assert.ok(p.text === '' || /log\s*-?in|sign\s*-?in|password|subscribe|members? only/i.test(p.text), `${p.id} is neither empty nor a login wall: "${p.text}"`);
  assert.ok(bad.some((p) => /log\s*-?in|sign\s*-?in|password/i.test(p.text)), 'no unreadable page is a login wall');
});

// Ticket: "Include easy pages, long pages, non-English pages". Decisions: "a non-English Wikipedia page, a
// long RFC". Long is taken as at least 20,000 characters of visible text (an RFC is far longer).
test('AC1: the readable pages include a long page and a non-English page', () => {
  const longest = Math.max(0, ...readable().map((p) => p.text.length));
  assert.ok(longest >= 20000, `the longest page has ${longest} characters of text; no long page`);
  const lang = (p) => (p.html.match(/<html\b[^>]*\blang\s*=\s*["']?([A-Za-z-]+)/i) || [])[1] || '';
  const table = licenceTable();
  const nonEn =
    readable().some((p) => lang(p) && !/^en\b/i.test(lang(p))) ||
    (table !== null && table.rows.some((r) => /https?:\/\/(?!en\.|www\.)[a-z]{2,3}(-[a-z]+)?\.wikipedia\.org/i.test(r.join(' '))));
  assert.ok(nonEn, 'no readable page is non-English (no <html lang> other than en and no non-English Wikipedia source)');
});

// Ticket: "For each page: the expected facts (what the summary must contain), the expected tags, and what
// must not appear."
test('AC1: every page has expected facts, expected tags and must-not-appear entries', () => {
  const missing = [];
  for (const p of pages()) {
    const e = expectations(p);
    if (!e) {
      missing.push(`${p.id}: no expectations found`);
      continue;
    }
    for (const [kind, re] of Object.entries(KINDS)) {
      if (e.text !== undefined) {
        if (!re.test(e.text)) missing.push(`${p.id}: no ${kind}`);
        continue;
      }
      const vals = valuesFor(e.json, re);
      if (vals.length === 0) missing.push(`${p.id}: no ${kind}`);
      // An unreadable page is expected to give no summary, so its facts and tags may be empty.
      else if (!p.unreadable && !vals.some(nonEmpty)) missing.push(`${p.id}: ${kind} is empty`);
    }
  }
  assert.deepEqual(missing, [], `expectations are incomplete:\n${missing.join('\n')}`);
});

// Decisions: "Pages: about 17 readable pages from openly licensed sources (Rust and Python docs, Wikipedia
// CC BY-SA, MDN CC BY-SA, a non-English Wikipedia page, a long RFC)"; "A source and licence table, marked
// Unverified."; "The owner may add pages that have a clear licence."
test('AC1: a source and licence table, marked Unverified, lists every readable page with its licence', () => {
  const t = licenceTable();
  assert.ok(t, 'no Markdown table in evals/save/ with a source column and a licence column');
  assert.match(t.md, /Unverified/, `${relative(ROOT, t.file)} does not mark the table Unverified`);
  const unlisted = readable()
    .map((p) => p.id)
    .filter((id) => !t.rows.some((r) => r.join(' ').includes(id)));
  assert.deepEqual(unlisted, [], `readable pages missing from the licence table: ${unlisted.join(', ')}`);
  const unclear = t.rows.filter((r) => !r[t.lic] || /^(-|\?|n\/a|unknown|tbd|none)$/i.test(r[t.lic]));
  assert.deepEqual(unclear, [], `rows with no clear licence: ${unclear.map((r) => r.join(' | ')).join('; ')}`);
});

test('AC1: the sources include Rust docs, Python docs, Wikipedia, MDN and an RFC', () => {
  const t = licenceTable();
  assert.ok(t, 'no source and licence table in evals/save/');
  const all = t.rows.map((r) => r.join(' ')).join('\n');
  for (const [name, re] of [
    ['Rust docs', /rust-lang\.org|docs\.rs|\bRust\b/i],
    ['Python docs', /python\.org|\bPython\b/i],
    ['Wikipedia', /wikipedia\.org|Wikipedia/i],
    ['MDN', /developer\.mozilla\.org|\bMDN\b/i],
    ['an RFC', /\bRFC\s*\d+|rfc-editor\.org|datatracker\.ietf\.org/i],
  ])
    assert.match(all, re, `the licence table lists no source from ${name}`);
});

// ------------------------------------------------------------------ AC1: the command and the judge

// AC1: "One command scores the fixed pages through the real runner". Decisions: "an env-gated `#[ignore]`
// module `src-tauri/src/ai/save_eval.rs`, run by `scripts/save-eval.sh`, like `proof.rs`."
test('AC1: scripts/save-eval.sh exists, is executable, is valid bash and runs the save_eval module', () => {
  assert.ok(existsSync(SCRIPT), 'scripts/save-eval.sh is missing');
  assert.ok((statSync(SCRIPT).mode & 0o111) !== 0, 'scripts/save-eval.sh is not executable');
  const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bash -n scripts/save-eval.sh exit ${r.status}: ${r.stderr}`);
  assert.match(readFileSync(SCRIPT, 'utf8'), /save_eval/, 'scripts/save-eval.sh does not name the save_eval module');
});

// Ticket: "A Claude judge only for "does the summary contain the expected facts", with its prompt kept in
// the repo." Decisions: "Its prompt is in `evals/save/judge.md`."
test('AC1: the judge prompt is kept in evals/save/judge.md', () => {
  assert.ok(existsSync(JUDGE), 'evals/save/judge.md is missing');
  const md = readFileSync(JUDGE, 'utf8');
  assert.ok(md.trim().length >= 100, 'evals/save/judge.md is (nearly) empty');
  assert.match(md, /fact/i, 'the judge prompt does not speak of the expected facts');
});

let ignoredListed = null;
function ignoredSaveEvalTests() {
  if (!ignoredListed) {
    const r = spawnSync('cargo', ['test', '--manifest-path', CARGO_TOML, '--lib', '--', '--list', '--ignored'], { encoding: 'utf8', timeout: 580000, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(r.status, 0, `cargo test --list --ignored exit ${r.status}:\n${(r.stderr || '').slice(-3000)}`);
    ignoredListed = r.stdout
      .split('\n')
      .filter((l) => l.endsWith(': test'))
      .map((l) => l.slice(0, -': test'.length))
      .filter((n) => n.startsWith('ai::save_eval::'));
  }
  return ignoredListed;
}

// Decisions: "an env-gated `#[ignore]` module `src-tauri/src/ai/save_eval.rs`".
test('AC1: src-tauri/src/ai/save_eval.rs holds the eval as ignored Rust tests', RUST, () => {
  assert.ok(existsSync(MODULE), 'src-tauri/src/ai/save_eval.rs is missing');
  assert.ok(ignoredSaveEvalTests().length > 0, 'cargo test --list --ignored shows no ai::save_eval:: test');
});

// AC5: "The eval is not part of `check` or CI, because it uses the real subscription." Decisions:
// "env-gated". With no MNEMO_* variable set, starting the ignored eval must not start a `claude -p` run.
// A stand-in `claude` first on PATH records every call, so this test never uses the real Claude.
test('AC5: the ignored eval, started without its gate variable, starts no claude -p run and writes no result', RUST, () => {
  const names = ignoredSaveEvalTests();
  assert.ok(names.length > 0, 'cargo test --list --ignored shows no ai::save_eval:: test');
  const tmp = mkdtempSync(join(tmpdir(), 'mnemo-bm04-gate-'));
  const before = new Set(walk(RESULTS));
  try {
    const bin = join(tmp, 'bin');
    const home = join(tmp, 'home');
    const tdir = join(tmp, 'tmp');
    for (const d of [bin, home, tdir]) mkdirSync(d, { recursive: true });
    const calls = join(tmp, 'claude-calls.log');
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\necho '{"type":"result","is_error":true,"result":"stand-in"}'\nexit 1\n`);
    chmodSync(join(bin, 'claude'), 0o755);
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
      XDG_STATE_HOME: join(home, '.local', 'state'),
      XDG_CACHE_HOME: join(home, '.cache'),
      TMPDIR: tdir,
      CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), '.cargo'),
      RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'),
      RUST_BACKTRACE: '0',
    };
    for (const k of Object.keys(env)) if (k.startsWith('MNEMO_')) delete env[k];
    const r = spawnSync('cargo', ['test', '--manifest-path', CARGO_TOML, '--lib', '--', '--ignored', '--exact', ...names], { encoding: 'utf8', env, timeout: 580000, maxBuffer: 64 * 1024 * 1024 });
    assert.notEqual(r.signal, 'SIGTERM', 'the ignored eval did not finish without its gate variable');
    const runs = existsSync(calls)
      ? readFileSync(calls, 'utf8')
          .split('\n')
          .filter((c) => /(^|\s)(-p|--print)(\s|$)/.test(c))
      : [];
    assert.deepEqual(runs, [], `without its gate variable the eval started ${runs.length} claude -p run(s)`);
    const added = walk(RESULTS).filter((f) => !before.has(f));
    assert.deepEqual(added.map((f) => relative(ROOT, f)), [], 'without its gate variable the eval wrote a result file');
  } finally {
    for (const f of walk(RESULTS)) if (!before.has(f)) rmSync(f, { force: true });
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ AC2: the baseline

// AC2: "The first baseline is saved in the repo." Decisions: "Results go to `evals/save/results/<date>.json`.
// The first one is committed as `baseline.json`." Verify: "a score per page, a total".
const BASELINE = [join(RESULTS, 'baseline.json'), join(SAVE, 'baseline.json')].find((f) => existsSync(f)) ?? join(RESULTS, 'baseline.json');

function baseline() {
  assert.ok(existsSync(BASELINE), 'evals/save/results/baseline.json is missing');
  const j = tryJson(readFileSync(BASELINE, 'utf8'));
  assert.ok(j !== undefined, `${relative(ROOT, BASELINE)} is not valid JSON`);
  return j;
}
const numbersIn = (v) => (typeof v === 'number' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(numbersIn) : []);

/** True when the baseline gives page `id` a number: as a key, or in an entry that names the page. */
function hasScore(v, id) {
  if (Array.isArray(v)) return v.some((x) => hasScore(x, id));
  if (!v || typeof v !== 'object') return false;
  for (const [k, x] of Object.entries(v)) if ((k === id || k.startsWith(`${id}.`) || k.endsWith(`/${id}`)) && numbersIn(x).length > 0) return true;
  const names = Object.values(v).some((x) => typeof x === 'string' && new RegExp(`(^|[/\\\\])${escapeRe(id)}(\\.[a-z]+)?$`, 'i').test(x));
  if (names && Object.values(v).some((x) => numbersIn(x).length > 0)) return true;
  return Object.values(v).some((x) => hasScore(x, id));
}

test('AC2: the baseline is committed in the repo', () => {
  baseline();
  const r = spawnSync('git', ['-C', ROOT, 'ls-files', '--error-unmatch', relative(ROOT, BASELINE)], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${relative(ROOT, BASELINE)} is not committed (git ls-files)`);
});

test('AC2: the baseline holds a score for every page and a total', () => {
  const j = baseline();
  const totals = valuesFor(j, /total/i).flatMap(numbersIn);
  assert.ok(totals.length > 0, 'the baseline has no numeric total');
  const unscored = pages()
    .map((p) => p.id)
    .filter((id) => !hasScore(j, id));
  assert.deepEqual(unscored, [], `pages with no score in the baseline: ${unscored.join(', ')}`);
});

// ------------------------------------------------------------------ AC5: not in check or CI

// AC5: "The eval is not part of `check` or CI, because it uses the real subscription."
const EVAL_REF = /save[-_]eval|evals\/save|--ignored|--include-ignored/;

test('AC5: the eval command exists, and no npm script (so neither npm test nor npm run check) runs it', () => {
  assert.ok(existsSync(SCRIPT), 'scripts/save-eval.sh is missing, so there is no eval to keep out of check');
  const { scripts = {} } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const hits = Object.entries(scripts).filter(([, cmd]) => EVAL_REF.test(cmd));
  assert.deepEqual(hits, [], `npm scripts that run the eval or ignored tests: ${hits.map(([n]) => n).join(', ')}`);
});

test('AC5: the eval command exists, and no CI workflow runs it', () => {
  assert.ok(existsSync(SCRIPT), 'scripts/save-eval.sh is missing, so there is no eval to keep out of CI');
  const dir = join(ROOT, '.github', 'workflows');
  const hits = walk(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .filter((f) => EVAL_REF.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hits.map((f) => relative(ROOT, f)), [], 'workflows that run the eval or ignored tests');
});

// ------------------------------------------------------------------ AC4: the measured spread, in the PR

// AC4: "Running the eval twice with no change gives total scores that differ by a small amount. Write the
// measured difference in the pull request, so later changes can be judged against it." Decisions: "A
// spread over 5% of the total is flagged in the PR." The two runs themselves are left to a real run. Only
// with MNEMO_PR_CHECK=1: it needs the network and the open pull request.
const PR = { timeout: 120000, skip: process.env.MNEMO_PR_CHECK === '1' ? false : 'set MNEMO_PR_CHECK=1 (needs the network and the open pull request)' };

test('AC4: the pull request writes the measured difference between two runs', PR, () => {
  const r = spawnSync('gh', ['pr', 'list', '--repo', 'minhtran-agilityio/mnemo', '--head', 'feature/30', '--state', 'all', '--json', 'number,body'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `gh pr list exit ${r.status}: ${r.stderr}`);
  const prs = JSON.parse(r.stdout);
  assert.equal(prs.length, 1, `expected one pull request from feature/30, found ${prs.length}`);
  const { body } = prs[0];
  assert.match(body, /spread|difference|differ/i, 'the body does not write the measured difference between two runs');
  assert.match(body, /(spread|difference|differ)[^\n]*\d/i, 'the body names the difference but gives no number');
});
