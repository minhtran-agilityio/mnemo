// Acceptance tests for #1 [SETUP-01] Scaffold the Tauri 2 project structure.
// Run: node --test "tests/acceptance/*.test.mjs"   (Node built-in runner, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const p = (...a) => join(ROOT, ...a);
const read = (...a) => readFileSync(p(...a), 'utf8');

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'target' || e === 'node_modules' || e === '.git') continue;
    const f = join(dir, e);
    statSync(f).isDirectory() ? walk(f, out) : out.push(f);
  }
  return out;
}

test('AC1: npm run tauri dev is a defined, documented command', () => {
  assert.ok(existsSync(p('package.json')), 'package.json missing');
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts?.tauri, 'package.json has no "tauri" script');
  assert.ok(pkg.devDependencies?.['@tauri-apps/cli'] || pkg.dependencies?.['@tauri-apps/cli'],
    '@tauri-apps/cli not declared');
  assert.match(read('README.md'), /npm run tauri dev/);
});

test('AC1: README covers both macOS Apple Silicon and Ubuntu 22.04', () => {
  const r = read('README.md');
  assert.match(r, /Ubuntu 22\.04/);
  assert.match(r, /macOS/);
  assert.match(r, /Apple Silicon/i);
});

test('AC2: Tauri 2 config declares an app window', () => {
  assert.ok(existsSync(p('src-tauri', 'tauri.conf.json')), 'src-tauri/tauri.conf.json missing');
  const conf = JSON.parse(read('src-tauri', 'tauri.conf.json'));
  const wins = conf.app?.windows;
  assert.ok(Array.isArray(wins) && wins.length >= 1, 'no window configured under app.windows');
  const cargo = read('src-tauri', 'Cargo.toml');
  assert.match(cargo, /tauri\s*=\s*(\{[^}]*version\s*=\s*)?"2/);
});

test('AC2: a ping command exists in the Rust core and is called by the UI', () => {
  const rustFiles = walk(p('src-tauri', 'src')).filter((f) => f.endsWith('.rs'));
  const rust = rustFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
  assert.match(rust, /#\[tauri::command\][\s\S]*?fn\s+ping\b/);
  assert.match(rust, /generate_handler!\s*\[[^\]]*\bping\b/);
  const uiFiles = walk(p('ui')).filter((f) => /\.(js|jsx|ts|tsx|vue|svelte|html)$/.test(f));
  assert.ok(uiFiles.length > 0, 'no UI sources under ui/');
  const ui = uiFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
  assert.match(ui, /invoke\s*(<[^>]*>)?\s*\(\s*['"]ping['"]/);
});

for (const m of ['storage', 'ai', 'scheduler', 'system']) {
  test(`AC3: module ${m} exists with a one-line ownership comment`, () => {
    const candidates = [p('src-tauri', 'src', `${m}.rs`), p('src-tauri', 'src', m, 'mod.rs')];
    const file = candidates.find(existsSync);
    assert.ok(file, `src-tauri/src/${m}.rs or ${m}/mod.rs missing`);
    const text = readFileSync(file, 'utf8');
    assert.match(text, /^\s*\/\/[/!]?\s*\S.*$/m, 'no comment line');
    const first = text.split('\n').find((l) => l.trim() !== '');
    assert.match(first, /^\s*\/\/[/!]?\s*\S/, 'first line must be the ownership comment');
    assert.doesNotMatch(text, /\bfn\s+\w+/, 'public interface should be empty (no functions)');
  });
}

test('AC3: modules are declared in the crate root', () => {
  const root = ['lib.rs', 'main.rs'].filter((f) => existsSync(p('src-tauri', 'src', f)))
    .map((f) => read('src-tauri', 'src', f)).join('\n');
  for (const m of ['storage', 'ai', 'scheduler', 'system'])
    assert.match(root, new RegExp(`mod\\s+${m}\\s*;`), `mod ${m}; not declared`);
});

test('AC3: cargo check passes in src-tauri', { timeout: 570000 }, () => {
  const r = spawnSync('cargo', ['check', '--manifest-path', p('src-tauri', 'Cargo.toml')],
    { encoding: 'utf8' });
  assert.equal(r.status, 0, `cargo check failed (exit ${r.status}):\n${r.stderr}`);
});

test('AC4: old GitLab template README is fully replaced', () => {
  const r = read('README.md');
  assert.doesNotMatch(r, /gitlab/i);
  assert.doesNotMatch(r, /Editing this README|Add your files|Already a pro/);
  assert.match(r, /mnemo/i);
});

test('AC4: no file from the old code base remains in the tree', () => {
  const tracked = execFileSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  for (const f of ['package.json', 'src-tauri/Cargo.toml', 'README.md'])
    assert.ok(tracked.includes(f), `${f} must be tracked (new scaffold replaces old tree)`);
  const old = tracked.filter((f) => /(^|\/)(\.gitlab-ci\.yml|requirements\.txt|setup\.py|pyproject\.toml|manage\.py|Pipfile|Dockerfile|docker-compose\.ya?ml)$/.test(f)
    || /\.py$/.test(f));
  assert.deepEqual(old, []);
});

test('AC5: README explains what Mnemo is and how to run it', () => {
  const r = read('README.md');
  assert.ok(r.length > 500, 'README too short');
  assert.match(r, /^#{1,3}\s.*(what|about|overview|mnemo)/im);
  assert.match(r, /npm install/);
  assert.match(r, /npm run tauri dev/);
});

test('AC5: README lists every tool a new machine needs', () => {
  const r = read('README.md');
  assert.match(r, /Rust|rustup/);
  assert.match(r, /Node/);
  assert.match(r, /Xcode Command Line Tools|xcode-select/i);
  for (const pkg of ['libwebkit2gtk-4.1-dev', 'build-essential', 'libssl-dev', 'librsvg2-dev'])
    assert.ok(r.includes(pkg), `Ubuntu package ${pkg} not listed`);
});

test('AC6: .gitignore ignores build output and dependencies', () => {
  assert.ok(existsSync(p('.gitignore')), '.gitignore missing');
  const g = read('.gitignore');
  assert.match(g, /^\/?node_modules\/?$/m);
  assert.match(g, /^\/?(src-tauri\/)?target\/?$/m);
});

test('AC6: rust-toolchain.toml pins a toolchain channel', () => {
  assert.ok(existsSync(p('rust-toolchain.toml')), 'rust-toolchain.toml missing');
  assert.match(read('rust-toolchain.toml'), /channel\s*=\s*"\d+\.\d+(\.\d+)?"/);
});

test('AC6: .nvmrc pins a Node version', () => {
  assert.ok(existsSync(p('.nvmrc')), '.nvmrc missing');
  assert.match(read('.nvmrc').trim(), /^v?\d+(\.\d+){0,2}$/);
});
