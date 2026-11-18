// Acceptance tests for #8 [SETUP-06] Release build: installable app for macOS and Ubuntu.
// Run: node --test "tests/acceptance/setup-06.test.mjs"   (Node built-in runner, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const p = (...a) => join(ROOT, ...a);
const read = (...a) => readFileSync(p(...a), 'utf8');
const release = () => {
  assert.ok(existsSync(p('.github', 'workflows', 'release.yml')), '.github/workflows/release.yml missing');
  return read('.github', 'workflows', 'release.yml');
};
const version = () => JSON.parse(read('package.json')).version;
const NESTED = !!process.env.MNEMO_NESTED;

test('AC1: release.yml triggers on v* tags and workflow_dispatch', () => {
  const y = release();
  assert.match(y, /tags:/);
  assert.match(y, /workflow_dispatch/);
  assert.match(y, /['"]?v\*['"]?/);
  const n = y.split('\n').filter((l) => /tags:|workflow_dispatch/.test(l)).length;
  assert.ok(n >= 2, 'expected at least 2 lines with tags: or workflow_dispatch');
});

test('AC2: builds dmg on macOS aarch64 and deb + AppImage on ubuntu-22.04', () => {
  const y = release();
  assert.match(y, /aarch64-apple-darwin/);
  assert.match(y, /macos-/);
  assert.match(y, /ubuntu-22\.04/);
  assert.match(y, /dmg/);
  assert.match(y, /\bdeb\b/);
  assert.match(y, /appimage/i);
});

test('AC2: uses tauri-apps/tauri-action and publishes a draft release', () => {
  const y = release();
  assert.match(y, /tauri-apps\/tauri-action@/);
  assert.match(y, /releaseDraft:\s*true/);
});

test('AC2: contents: write permission is set in release.yml, and not in ci.yml', () => {
  assert.match(release(), /contents:\s*write/);
  assert.doesNotMatch(read('.github', 'workflows', 'ci.yml'), /contents:\s*write/);
});

test('AC3: version lives in package.json; tauri.conf.json reads it', () => {
  assert.match(version(), /^\d+\.\d+\.\d+/);
  const conf = JSON.parse(read('src-tauri', 'tauri.conf.json'));
  assert.equal(conf.version, '../package.json', 'tauri.conf.json must point at ../package.json (or omit version only if Tauri falls back to Cargo, which is not allowed)');
});

test('AC3: src-tauri/Cargo.toml and Cargo.lock match the package.json version', () => {
  const v = version();
  const toml = read('src-tauri', 'Cargo.toml');
  const pkgSection = toml.split(/^\[/m).find((s) => s.startsWith('package]'));
  assert.ok(pkgSection.includes(`version = "${v}"`), `Cargo.toml version differs from ${v}`);
  const lock = read('src-tauri', 'Cargo.lock');
  assert.match(lock, new RegExp(`name = "mnemo"\\r?\\nversion = "${v.replace(/\./g, '\\.')}"`), `Cargo.lock mnemo version differs from ${v}`);
});

test('AC3: a committed test guards against version drift', () => {
  const found = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (['node_modules', 'target', '.git', 'dist', 'acceptance'].includes(e)) continue;
      const f = join(d, e);
      if (statSync(f).isDirectory()) walk(f);
      else if (/\.test\.(ts|mjs|js)$/.test(e)) {
        const t = readFileSync(f, 'utf8');
        if (/Cargo\.lock/.test(t) && /Cargo\.toml/.test(t) && /package\.json/.test(t)) found.push(f);
      }
    }
  };
  walk(ROOT);
  assert.ok(found.length > 0, 'no non-acceptance test compares package.json with Cargo.toml and Cargo.lock');
});

test('AC4: UI reads the version through the Tauri app API', () => {
  const dir = p('ui', 'src');
  const srcs = readdirSync(dir).filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f));
  const all = srcs.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  assert.match(all, /@tauri-apps\/api\/app/);
  assert.match(all, /getVersion/);
});

test('AC4: a unit test covers the version text helper', () => {
  const dir = p('ui', 'src');
  const tests = readdirSync(dir).filter((f) => /version.*\.test\.ts$/.test(f));
  assert.ok(tests.length > 0, 'no ui/src/*version*.test.ts found');
  assert.match(readFileSync(join(dir, tests[0]), 'utf8'), /\bit\(|\btest\(/);
});

test('AC5: README has a How to release section with the four steps', () => {
  const r = read('README.md');
  assert.match(r, /^#{2,3}\s+How to release/im);
  const s = r.split(/^#{2,3}\s+How to release/im)[1].split(/^#{1,2}\s/m)[0];
  assert.match(s, /version/i);
  assert.match(s, /git tag/);
  assert.match(s, /push/i);
  assert.match(s, /draft/i);
  assert.match(s, /publish/i);
});

test('AC5: README has macOS install steps for the unsigned dmg', () => {
  const r = read('README.md');
  assert.match(r, /\.dmg/);
  assert.match(r, /Applications/);
  assert.match(r, /right-click/i);
  assert.match(r, /Privacy & Security/);
});

test('AC5: README has Ubuntu 22.04 install steps for deb and AppImage', () => {
  const r = read('README.md');
  assert.match(r, /apt install \.\//);
  assert.match(r, /\.deb/);
  assert.match(r, /AppImage/);
  assert.match(r, /chmod \+x/);
  assert.match(r, /launcher/i);
});

const haveWebkit = spawnSync('pkg-config', ['--exists', 'webkit2gtk-4.1']).status === 0;
test('AC6: tauri build --bundles deb exits 0 and writes one .deb', {
  timeout: 590000,
  skip: NESTED ? 'nested run' : process.platform !== 'linux' ? 'not Linux' : !haveWebkit ? 'webkit2gtk-4.1 dev packages missing: not run' : false,
}, () => {
  const r = spawnSync('npm', ['run', 'tauri', 'build', '--', '--bundles', 'deb'], { cwd: ROOT, encoding: 'utf8', timeout: 540000 });
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
  const dir = p('src-tauri', 'target', 'release', 'bundle', 'deb');
  const debs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.deb')) : [];
  assert.equal(debs.length, 1, `expected exactly one .deb, found ${debs.length}`);
});

test('AC7: ci.yml never gets write access to repository contents', () => {
  assert.doesNotMatch(read('.github', 'workflows', 'ci.yml'), /contents:\s*write/);
});

test('AC8: README lists the manual checks and does not claim them done', () => {
  const r = read('README.md');
  assert.match(r, /manual check/i);
  const s = r.split(/^#{2,3}\s+Open manual checks/im)[1].split(/^#{1,2}\s/m)[0];
  assert.match(s, /- \[[ xX]\]/, 'checkbox list expected (ticked or not)');
  assert.match(r, /upgrade/i);
  assert.match(r, /launcher/i);
});

test('F3: release.yml checks the tag against the package.json version', () => {
  const y = release();
  assert.match(y, /GITHUB_REF_NAME/);
  assert.match(y, /package\.json/);
  assert.ok(y.indexOf('GITHUB_REF_NAME') < y.indexOf('tauri-apps/tauri-action@'), 'check must run before the build');
});

test('F4: release jobs run one at a time and the workflow has a concurrency group', () => {
  const y = release();
  assert.match(y, /max-parallel:\s*1/);
  assert.match(y, /^concurrency:/m);
});

test('F5: release.yml runs npm run check before the build', () => {
  const y = release();
  const i = y.indexOf('npm run check');
  assert.ok(i > -1, 'npm run check missing');
  assert.ok(i < y.indexOf('tauri-apps/tauri-action@'), 'check must run before the build');
});
