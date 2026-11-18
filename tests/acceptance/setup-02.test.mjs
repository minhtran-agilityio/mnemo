// Acceptance tests for #2 [SETUP-02] format, lint and test scripts with one "check" command.
// Run: node --test "tests/acceptance/*.test.mjs"   (Node built-in runner, no extra dependencies)
//
// Behavioural tests copy the project to a temp dir, inject one fault, and run the real npm
// commands. They need network for `npm ci` and a Rust toolchain. They skip themselves when
// MNEMO_NESTED is set, so `npm test` (which runs this file) cannot recurse into itself.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, readFileSync, cpSync, mkdtempSync, rmSync, appendFileSync, writeFileSync, symlinkSync, mkdirSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const p = (...a) => join(ROOT, ...a);
const read = (...a) => readFileSync(p(...a), 'utf8');
const pkg = () => JSON.parse(read('package.json'));
const NESTED = !!process.env.MNEMO_NESTED;
const LONG = { timeout: 590000, skip: NESTED ? 'nested run (inside npm test)' : false };

const SKIP = new Set(['node_modules', 'target', '.git', 'dist']);
// Judge only the path inside the project, so a parent folder named like a skipped one does not matter.
const filter = (src) => !relative(ROOT, src).split(sep).some((s) => SKIP.has(s));

const CHILD_TIMEOUT = 540000; // below the 590 s test timeout, which a blocking spawnSync cannot trigger
const temps = []; // every temp dir, removed when the file is done
const tempDir = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
};
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

let base; // a copy of the project with dependencies installed; set only after npm ci succeeds
let targetDir; // shared cargo target dir so builds are reused between cases
function prepareBase() {
  if (base) return base;
  const tmp = tempDir('mnemo-qa2-');
  const dir = join(tmp, 'base');
  targetDir = join(tmp, 'target');
  cpSync(ROOT, dir, { recursive: true, filter });
  // The #1 tests call git ls-files, so the copy needs its own repo.
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['add', '-A'], { cwd: dir });
  const r = spawnSync('npm', ['ci'], { cwd: dir, encoding: 'utf8', timeout: CHILD_TIMEOUT });
  assert.equal(r.status, 0, `npm ci failed (exit ${r.status}, signal ${r.signal}):\n${r.stderr}`);
  base = dir;
  return base;
}
function freshCopy() {
  const b = prepareBase();
  const dir = join(tempDir('mnemo-qa2-case-'), 'proj');
  cpSync(b, dir, { recursive: true, filter: (src) => !relative(b, src).split(sep).some((s) => s === 'node_modules') });
  symlinkSync(join(b, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}
function npm(cwd, args) {
  const t0 = Date.now();
  // Drop NODE_TEST_CONTEXT so the inner node --test really runs instead of skipping as a recursive call.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const r = spawnSync('npm', args, {
    cwd, encoding: 'utf8', maxBuffer: 1 << 28, timeout: CHILD_TIMEOUT,
    env: { ...env, MNEMO_NESTED: '1', CARGO_TARGET_DIR: targetDir, CI: '1', FORCE_COLOR: '0' },
  });
  assert.ok(r.signal === null, `npm ${args.join(' ')} was killed (${r.signal}), likely a hang`);
  return { status: r.status, out: `${r.stdout}\n${r.stderr}`, secs: (Date.now() - t0) / 1000 };
}
const rustRoot = (dir) =>
  join(dir, 'src-tauri', 'src', existsSync(join(dir, 'src-tauri', 'src', 'lib.rs')) ? 'lib.rs' : 'main.rs');
function addUiFile(dir, name, body) {
  mkdirSync(join(dir, 'ui', 'src'), { recursive: true });
  const f = join(dir, 'ui', 'src', name);
  writeFileSync(f, body);
  return f;
}
const biomeFormat = (dir, f) => spawnSync('npx', ['biome', 'format', '--write', f], { cwd: dir, encoding: 'utf8' });

// ---- AC1 ----
test('AC1: npm ci && npm run check exits 0 on a clean copy', LONG, () => {
  const dir = freshCopy();
  const r = npm(dir, ['run', 'check']);
  assert.equal(r.status, 0, `npm run check exit ${r.status}:\n${r.out.slice(-3000)}`);
});

// ---- AC2 ----
test('AC2: test script runs cargo test, Vitest and tests/acceptance', () => {
  const t = pkg().scripts?.test;
  assert.ok(t, 'no "test" script');
  assert.match(t, /cargo test/);
  assert.match(t, /vitest/);
  assert.match(t, /tests\/acceptance/);
});

test('AC2: npm test exits 0 and runs Rust, Vitest and acceptance tests', LONG, () => {
  const dir = freshCopy();
  const r = npm(dir, ['test']);
  assert.equal(r.status, 0, `npm test exit ${r.status}:\n${r.out.slice(-3000)}`);
  assert.match(r.out, /test result: ok\. [1-9]\d* passed/, 'no passing Rust test reported');
  assert.match(r.out, /Tests\s+[1-9]\d* passed/, 'no passing Vitest test reported');
  assert.match(r.out, /AC1: npm run tauri dev is a defined, documented command/, 'acceptance tests not run');
});

test('AC2: a failing Rust test makes npm test fail', LONG, () => {
  const dir = freshCopy();
  appendFileSync(rustRoot(dir), '\n#[test]\nfn zz_qa_failing() {\n    assert_eq!(1, 2);\n}\n');
  const r = npm(dir, ['test']);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /zz_qa_failing/);
});

// ---- AC3 ----
test('AC3: lint script runs clippy with warnings as errors and Biome', () => {
  const l = pkg().scripts?.lint;
  assert.ok(l, 'no "lint" script');
  assert.match(l, /cargo clippy/);
  assert.match(l, /-D\s*warnings|--deny\s+warnings/);
  assert.match(l, /biome/);
});

test('AC3: a UI lint error makes npm run lint fail', LONG, () => {
  const dir = freshCopy();
  addUiFile(dir, 'zz-lint.ts', 'debugger;\nexport const zz = 1;\n');
  const r = npm(dir, ['run', 'lint']);
  assert.notEqual(r.status, 0, r.out.slice(-2000));
  assert.match(r.out, /zz-lint\.ts|debugger/i);
});

test('AC3: a clippy warning makes npm run lint fail', LONG, () => {
  const dir = freshCopy();
  appendFileSync(rustRoot(dir), '\npub fn zz_qa_lint() -> i32 {\n    return 1;\n}\n');
  const r = npm(dir, ['run', 'lint']);
  assert.notEqual(r.status, 0, r.out.slice(-2000));
  assert.match(r.out, /needless_return|zz_qa_lint|clippy/i);
});

// ---- AC4 / AC5 ----
test('AC4: a Rust formatting error fails check with a message; AC5: later steps do not run', LONG, () => {
  const dir = freshCopy();
  appendFileSync(rustRoot(dir), '\npub fn   zz_qa_fmt( )   {   }\n');
  const r = npm(dir, ['run', 'check']);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /Diff in|fmt|format/i, 'no clear formatting message');
  assert.doesNotMatch(r.out, /test result:|Test Files|Running unittests|Checking |Compiling /, 'a later step ran');
});

test('AC4: a UI formatting error fails check with a message', LONG, () => {
  const dir = freshCopy();
  addUiFile(dir, 'zz-fmt.ts', 'export   const   zz  =  {a:1,\n  b:2}\n');
  const r = npm(dir, ['run', 'check']);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /zz-fmt\.ts|format/i, 'no clear formatting message');
});

test('AC4: a lint error fails check with a message', LONG, () => {
  const dir = freshCopy();
  const f = addUiFile(dir, 'zz-lint.ts', 'debugger;\nexport const zz = 1;\n');
  biomeFormat(dir, f);
  const r = npm(dir, ['run', 'check']);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /zz-lint\.ts|debugger|lint/i);
});

test('AC4: a type error fails check with a message', LONG, () => {
  const dir = freshCopy();
  const f = addUiFile(dir, 'zz-type.ts', 'export const zz: number = "not a number";\n');
  biomeFormat(dir, f);
  const r = npm(dir, ['run', 'check']);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /error TS\d+/, 'no TypeScript error reported');
});

test('AC4: a failing test fails check with a message', LONG, () => {
  const dir = freshCopy();
  const f = addUiFile(dir, 'zz-fail.test.ts',
    'import { expect, test } from "vitest";\ntest("zz qa failing", () => {\n  expect(1).toBe(2);\n});\n');
  biomeFormat(dir, f);
  const r = npm(dir, ['run', 'check']);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /zz qa failing|FAIL|failed/i);
});

test('AC5: check chains its steps with && and nothing else', () => {
  const c = pkg().scripts?.check;
  assert.ok(c, 'no "check" script');
  const steps = c.split('&&').map((s) => s.trim()).filter(Boolean);
  assert.ok(steps.length >= 3, `check should chain several steps with &&, got: ${c}`);
  assert.doesNotMatch(c.replace(/&&/g, ''), /[;|&]/, 'check must not use ; || | or & between steps');
});

test('AC4: check covers format, lint, types and tests', () => {
  const s = pkg().scripts;
  const c = s.check ?? '';
  const expanded = c.replace(/npm run ([\w:-]+)/g, (_, n) => ` ${s[n] ?? ''} `);
  assert.match(expanded, /cargo fmt|rustfmt/);
  assert.match(expanded, /biome (check|format|ci)/);
  assert.match(expanded, /clippy/);
  assert.match(expanded, /tsc/);
  assert.match(expanded, /cargo test/);
  assert.match(expanded, /vitest/);
});

// ---- AC6 ----
test('AC6: README has a Test section with exact commands and tools per job', () => {
  const r = read('README.md');
  const m = r.match(/^#{1,4}\s+Tests?\s*$([\s\S]*?)(?=^#{1,3}\s|(?![\s\S]))/im);
  assert.ok(m, 'README has no "Test" heading');
  const sec = m[1];
  for (const c of ['npm test', 'npm run lint', 'npm run check'])
    assert.ok(sec.includes(c), `Test section lacks "${c}"`);
  for (const t of ['rustfmt', 'clippy', 'cargo test', 'Biome', 'tsc', 'Vitest'])
    assert.ok(sec.includes(t), `Test section does not name ${t}`);
});

// ---- AC7 ----
test('AC7: a warm npm run check finishes in under 3 minutes', LONG, () => {
  const dir = freshCopy();
  const cold = npm(dir, ['run', 'check']);
  assert.equal(cold.status, 0, cold.out.slice(-2000));
  const warm = npm(dir, ['run', 'check']);
  assert.equal(warm.status, 0, warm.out.slice(-2000));
  console.log(`warm npm run check: ${warm.secs.toFixed(1)}s`);
  assert.ok(warm.secs < 180, `warm check took ${warm.secs}s`);
});

// ---- AC8 ----
test('AC8: README keeps what the #1 tests require', () => {
  const r = read('README.md');
  assert.match(r, /npm run tauri dev/);
  assert.match(r, /npm install/);
  assert.match(r, /Ubuntu 22\.04/);
  assert.ok(existsSync(p('tests', 'acceptance', 'setup-01.test.mjs')), '#1 acceptance tests removed');
});
