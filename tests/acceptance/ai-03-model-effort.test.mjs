// Acceptance tests for #24 [AI-03] Model and effort per feature.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/ai-03-model-effort.test.mjs
// Black box, in the style of ai-01-run-contract and note-01-notes:
// 1. Rust (AC1-AC7). The criteria name cargo tests ("A cargo test proves ..."). The Rust test list is read from
//    `cargo test -- --list`; the tests that existed before this ticket (helpers/ai-03-earlier-rust-tests.json, the
//    list on main when these tests were written) do not count. The new tests are found by the words of each
//    criterion in their names, and are run by exact name: they must all pass.
// 2. Static text (AC7 labels and the Unverified comment, AC8 command registration and signatures). The Tauri
//    commands have no surface node can call, so lib.rs and the command signatures are read as text.
// 3. Typed client (AC9): tests/acceptance/ai-03-api.test.ts (vitest, mocked invoke), run from here.
// 4. Scope (AC10, AC11): the branch diff against origin/main is read with git. Lint (clippy, biome) and the pull
//    request body run only with MNEMO_PR_CHECK=1 (they need the network, an open pull request, and minutes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const p = (...a) => join(ROOT, ...a);
const MANIFEST = p('src-tauri', 'Cargo.toml');
const LONG = { timeout: 600000 };
const BRANCH = 'feat/24-ai-03-model-and-effort-per-feature';
const PR = { timeout: 600000, skip: process.env.MNEMO_PR_CHECK === '1' ? false : 'set MNEMO_PR_CHECK=1 (needs the network, the open pull request and a lint run)' };

const walk = (d, out = []) => {
  if (!existsSync(d)) return out;
  for (const n of readdirSync(d)) {
    if (['node_modules', 'target', '.git', 'dist'].includes(n)) continue;
    const f = join(d, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
};

// ------------------------------------------------------------------ Rust test list

const EARLIER = new Set(JSON.parse(readFileSync(join(HERE, 'helpers', 'ai-03-earlier-rust-tests.json'), 'utf8')));
let listCache = null;
function rustTests() {
  if (listCache) return listCache;
  const r = spawnSync('cargo', ['test', '--manifest-path', MANIFEST, '--', '--list'], { encoding: 'utf8', timeout: 580000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, `cargo test --list exit ${r.status}:\n${r.stderr.slice(-3000)}`);
  listCache = [...new Set(r.stdout.split('\n').filter((l) => l.endsWith(': test')).map((l) => l.slice(0, -': test'.length)))];
  return listCache;
}
const newTests = () => rustTests().filter((n) => !EARLIER.has(n));
const leaf = (n) => n.split('::').pop().toLowerCase();

/** The new Rust tests whose own name passes every regex in `res`; fails with the candidates when there is none. */
function named(res, what) {
  const pool = newTests();
  const hits = pool.filter((n) => res.every((re) => re.test(leaf(n))));
  assert.ok(hits.length > 0, `no new Rust test checks ${what} (name matching ${res.join(' and ')}). New tests: ${JSON.stringify(pool)}`);
  return hits;
}

/** Runs these Rust tests by exact name; they must all run and pass. */
function runExact(names) {
  const r = spawnSync('cargo', ['test', '--manifest-path', MANIFEST, '--', '--exact', ...names], { encoding: 'utf8', timeout: 580000, maxBuffer: 64 * 1024 * 1024 });
  assert.notEqual(r.signal, 'SIGTERM', `the tests did not finish (hang): ${names.join(', ')}`);
  assert.equal(r.status, 0, `${names.join(', ')}\n${r.stdout.slice(-4000)}${r.stderr.slice(-2000)}`);
  const passed = [...r.stdout.matchAll(/test result: ok\. (\d+) passed/g)].reduce((s, m) => s + Number(m[1]), 0);
  assert.ok(passed >= names.length, `expected ${names.length} passing tests, ${passed} passed:\n${r.stdout.slice(-2000)}`);
}

// The name patterns of each criterion (used again by AC11).
const AC1 = [/default/, /(match|balanced|prototype|v52|feature_map|exact)/, /^(?!.*reset)/];
const AC2 = [/task/, /(row|default|table)/, /(^|_)(every|each|all|any|missing|without)(_|$)|(has|have|gets?)_an?_row|no_row/];
const AC3_MODEL = [/(unknown|invalid|unsupported|bad|not_allowed|refus|reject)/, /model/];
const AC3_EFFORT = [/(unknown|invalid|unsupported|bad|not_allowed|refus|reject)/, /effort/];
const AC4 = [/run/, /(model|effort)/, /(next|after|set|changed|new|uses)/];
const AC5 = [/(reopen|restart|persist|surviv|still|kept)/, /(model|effort|row|choice|ai|set)/];
const AC6 = [/reset/, /default/];
const AC7 = [/(allowed|only|accept)/, /(model|effort)/];

// ---------------------------------------------------------------- AC1
// "A cargo test proves the defaults are exactly: save haiku/low, ask sonnet/medium, daily haiku/low, weekly
// sonnet/medium, folders sonnet/medium, notes sonnet/medium, ideas sonnet/medium, paths sonnet/medium (the
// prototype v52 'Balanced' map), and also test_prompt haiku/low and suggest_title haiku/low."
test('AC1: a cargo test proves the defaults are exactly the v52 Balanced map plus test_prompt and suggest_title haiku/low', LONG, () => {
  runExact(named(AC1, 'that the defaults match the v52 Balanced map'));
});

// ---------------------------------------------------------------- AC2
// "A cargo test fails if any AiTask name built in code (test_prompt::task(), sample::task(), and every feature
// task) has no row in the defaults table."
test('AC2: a cargo test fails if any AiTask name built in code has no row in the defaults table', LONG, () => {
  runExact(named(AC2, 'that every AiTask name has a row in the defaults table'));
});

// ---------------------------------------------------------------- AC3
// "A cargo test proves set_row with an unknown model (for example 'gpt-4') or an unknown effort (for example
// 'xhigh') returns a plain-language error (AppError code plus a human message, no stack trace), and the stored row
// is unchanged."
test('AC3: a cargo test proves set_row with an unknown model is refused with a plain error and the row stays', LONG, () => {
  runExact(named(AC3_MODEL, 'that an unknown model is refused'));
});

test('AC3: a cargo test proves set_row with an unknown effort is refused with a plain error and the row stays', LONG, () => {
  runExact(named(AC3_EFFORT, 'that an unknown effort is refused'));
});

test('AC3: the refusal tests say in their name that the stored row is unchanged', LONG, () => {
  const hits = [...named(AC3_MODEL, 'that an unknown model is refused'), ...named(AC3_EFFORT, 'that an unknown effort is refused')];
  assert.ok(hits.some((n) => /(unchanged|stays|keeps|kept|old|same|untouched|intact)/.test(leaf(n))),
    `no refusal test says the stored row is unchanged: ${JSON.stringify(hits)}`);
});

// ---------------------------------------------------------------- AC4
// "A cargo test proves that after set_row(save, sonnet, high) the next run of that feature through the configured
// runner reaches the fake runner with model 'sonnet' and effort 'high' (the fake records them)."
test('AC4: a cargo test proves the next run after set_row reaches the fake runner with the new model and effort', LONG, () => {
  runExact(named(AC4, 'that the next run uses the changed row'));
});

// ---------------------------------------------------------------- AC5
// "A cargo test proves a value set, then the Storage reopened from the same SQLite file, is still read back."
test('AC5: a cargo test proves a value set is still read back after the Storage is reopened from the same file', LONG, () => {
  runExact(named(AC5, 'that a set value survives reopening the store'));
});

// ---------------------------------------------------------------- AC6
// "A cargo test proves reset restores every row to the code defaults (and clears stored overrides)."
test('AC6: a cargo test proves reset restores every row to the code defaults', LONG, () => {
  runExact(named(AC6, 'that reset restores the defaults'));
});

// ---------------------------------------------------------------- AC7
// "Only allowed values are accepted: models haiku, sonnet, opus (labels 'Haiku 5.5', 'Sonnet 5.5', 'Opus 5.5');
// efforts low, medium, high. A code comment states that haiku being accepted by claude -p on the Max plan is
// Unverified."
const rustSources = () => walk(p('src-tauri', 'src')).filter((f) => f.endsWith('.rs'));

test('AC7: a cargo test proves only the allowed models and efforts are accepted', LONG, () => {
  runExact(named(AC7, 'that only the allowed models and efforts are accepted'));
});

test("AC7: the core carries the labels 'Haiku 5.5', 'Sonnet 5.5' and 'Opus 5.5'", () => {
  const all = rustSources().map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const label of ['Haiku 5.5', 'Sonnet 5.5', 'Opus 5.5']) {
    assert.ok(all.includes(`"${label}"`), `no "${label}" string in src-tauri/src`);
  }
});

test('AC7: a code comment states that haiku being accepted by claude -p on the Max plan is Unverified', () => {
  const found = [];
  for (const f of rustSources()) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((_, i) => {
      const block = lines.slice(i, i + 4).filter((l) => /^\s*\/\/|\/\*|^\s*\*/.test(l)).join(' ');
      if (/haiku/i.test(block) && /Unverified/.test(block) && /Max/.test(block)) found.push(`${relative(ROOT, f)}:${i + 1}`);
    });
  }
  assert.ok(found.length > 0, 'no Rust comment says haiku on the Max plan is Unverified');
});

// ---------------------------------------------------------------- AC8
// "Tauri commands list_ai_models, set_ai_model and reset_ai_models are registered in lib.rs, stay thin, and return
// Result<T, AppError>."
const COMMANDS = ['list_ai_models', 'set_ai_model', 'reset_ai_models'];

test('AC8: list_ai_models, set_ai_model and reset_ai_models are registered in lib.rs', () => {
  const lib = readFileSync(p('src-tauri', 'src', 'lib.rs'), 'utf8');
  assert.ok(lib.includes('generate_handler!'), 'no generate_handler! in lib.rs');
  const handler = lib.slice(lib.indexOf('generate_handler!'));
  for (const c of COMMANDS) assert.ok(new RegExp(`\\b${c}\\b`).test(handler), `${c} is not registered in lib.rs`);
});

/** The `#[tauri::command]` function `name`: its signature (up to the opening brace) and its body. */
function commandFn(name) {
  for (const f of rustSources()) {
    const src = readFileSync(f, 'utf8');
    const m = new RegExp(`#\\[tauri::command[^\\]]*\\]\\s*(?:#\\[[^\\]]*\\]\\s*)*pub(?:\\([^)]*\\))?\\s+(?:async\\s+)?fn\\s+${name}\\b`).exec(src);
    if (!m) continue;
    const open = src.indexOf('{', m.index + m[0].length);
    let depth = 0;
    let end = open;
    for (; end < src.length; end++) {
      if (src[end] === '{') depth++;
      else if (src[end] === '}' && --depth === 0) break;
    }
    return { file: relative(ROOT, f), signature: src.slice(m.index, open), body: src.slice(open + 1, end) };
  }
  return null;
}

for (const name of COMMANDS) {
  test(`AC8: ${name} is a Tauri command that returns Result<T, AppError>`, () => {
    const fn = commandFn(name);
    assert.ok(fn, `no #[tauri::command] pub fn ${name} in src-tauri/src`);
    assert.match(fn.signature.replace(/\s+/g, ' '), /->\s*Result<[\s\S]*,\s*AppError\s*>\s*$/, `${name} does not return Result<T, AppError>: ${fn.signature}`);
  });

  test(`AC8: ${name} stays thin (no SQL, file access or process spawn, a short body)`, () => {
    const fn = commandFn(name);
    assert.ok(fn, `no #[tauri::command] pub fn ${name} in src-tauri/src`);
    assert.doesNotMatch(fn.body, /\b(SELECT|INSERT|UPDATE|DELETE)\b|rusqlite|std::fs|Command::new/, `${name} does more than call one module function:\n${fn.body}`);
    const lines = fn.body.split('\n').filter((l) => l.trim() !== '').length;
    assert.ok(lines <= 15, `${name} has ${lines} lines in its body; a thin command validates, calls one module function and maps the result`);
  });
}

// ---------------------------------------------------------------- AC9
// "Vitest tests cover the new typed client functions in ui/src/shared/api.ts (listAiModels, setAiModel,
// resetAiModels): the invoke command name, the argument shape, and error pass-through."
test('AC9: listAiModels, setAiModel and resetAiModels call their command with the right arguments and pass errors through (vitest)', { timeout: 300000 }, () => {
  const r = spawnSync('npx', ['vitest', 'run', '--root', ROOT, '--no-color', 'tests/acceptance/ai-03-api.test.ts'], { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-3000));
});

// ---------------------------------------------------------------- branch diff (AC10, AC11)
const git = (...a) => spawnSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' });
function changedOnBranch() {
  const base = git('merge-base', 'HEAD', 'origin/main');
  if (base.status !== 0) return null;
  const r = git('diff', '--name-only', base.stdout.trim(), 'HEAD');
  assert.equal(r.status, 0, r.stderr);
  return { base: base.stdout.trim(), files: r.stdout.split('\n').filter(Boolean) };
}

// ---------------------------------------------------------------- AC10
// "No change to ui/src/ds/**, no Settings table UI and no screen CSS in this run; the PR body says the Settings UI
// waits for #154 and #155."
test('AC10: no change to ui/src/ds, no Settings UI and no screen CSS, and the PR body says the Settings UI waits for #154 and #155', PR, () => {
  const d = changedOnBranch();
  assert.ok(d, 'no origin/main to compare with (git fetch origin)');
  const ui = d.files.filter((f) => f.startsWith('ui/'));
  assert.deepEqual(ui.filter((f) => f.startsWith('ui/src/ds/')), [], 'the branch changes ui/src/ds');
  assert.deepEqual(ui.filter((f) => f.endsWith('.css')), [], 'the branch changes screen CSS');
  assert.deepEqual(ui.filter((f) => /settings/i.test(f)), [], 'the branch changes the Settings screen');
  const r = spawnSync('gh', ['pr', 'list', '--repo', 'minhtran-agilityio/mnemo', '--head', BRANCH, '--state', 'all', '--json', 'number,body'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `gh pr list exit ${r.status}: ${r.stderr}`);
  const prs = JSON.parse(r.stdout);
  assert.equal(prs.length, 1, `expected one pull request from ${BRANCH}, found ${prs.length}`);
  const { body } = prs[0];
  assert.match(body, /Settings/, 'the PR body does not name the Settings UI');
  assert.match(body, /#154\b/, 'the PR body does not name #154');
  assert.match(body, /#155\b/, 'the PR body does not name #155');
  assert.match(body, /wait/i, 'the PR body does not say the Settings UI waits');
});

// ---------------------------------------------------------------- AC11
// "No new migration; edits to src-tauri/src/ai/runner.rs and claude.rs stay small. Related cargo tests, vitest
// tests, cargo clippy -D warnings and biome pass."
// "Small" is read as at most 80 changed lines (added plus removed) across the two files.
test('AC11: no new migration, small edits to runner.rs and claude.rs, and the related cargo tests pass', LONG, (t) => {
  const related = [...new Set([AC1, AC2, AC3_MODEL, AC3_EFFORT, AC4, AC5, AC6, AC7].flatMap((res) => named(res, `the criterion ${res.join(' and ')}`)))];
  runExact(related);
  const d = changedOnBranch();
  if (!d) {
    t.skip('no origin/main to compare with (git fetch origin)');
    return;
  }
  const added = git('diff', '--name-only', '--diff-filter=A', d.base, 'HEAD', '--', 'src-tauri/migrations');
  assert.equal(added.stdout.trim(), '', `the branch adds a migration: ${added.stdout}`);
  const stat = git('diff', '--numstat', d.base, 'HEAD', '--', 'src-tauri/src/ai/runner.rs', 'src-tauri/src/ai/claude.rs');
  const changed = stat.stdout.split('\n').filter(Boolean).reduce((s, l) => s + l.split('\t').slice(0, 2).reduce((a, n) => a + (Number(n) || 0), 0), 0);
  assert.ok(changed <= 80, `runner.rs and claude.rs change by ${changed} lines (more than 80):\n${stat.stdout}`);
});

test('AC11: cargo clippy -D warnings and biome pass', PR, () => {
  const c = spawnSync('npm', ['run', 'lint'], { cwd: ROOT, encoding: 'utf8', timeout: 580000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(c.status, 0, `npm run lint exit ${c.status}:\n${`${c.stdout}\n${c.stderr}`.slice(-3000)}`);
});
