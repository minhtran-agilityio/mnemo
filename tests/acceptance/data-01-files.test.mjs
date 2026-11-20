// Acceptance tests for #16 [DATA-01] Image and attachment files beside the database.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/data-01-files.test.mjs
// Black box. The ticket states its criteria as Rust tests, so this file checks them from outside:
// - the new migration is applied with the sqlite3 CLI to a database built by the previous version (0001 to 0004);
// - the Rust test list (`cargo test -- --list`) must hold new file tests for each criterion, and they must pass;
// - cargo fmt, cargo clippy -D warnings, the type check and the UI wrapper's vitest test must pass.
// Tests that already existed before #16 and only happen to mention "file" are excluded by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const p = (...a) => join(ROOT, ...a);
const MIG = p('src-tauri', 'migrations');
const MANIFEST = p('src-tauri', 'Cargo.toml');
const PREVIOUS = ['0001_init.sql', '0002_settings.sql', '0003_items.sql', '0004_item_links.sql'];
const U = '2026-01-01T00:00:00Z';
const U2 = '2026-01-02T00:00:00Z';
const LONG = 590000;

// ---------- migration helpers ----------
const sqlite = (db, sql) => spawnSync('sqlite3', ['-bail', db], { input: sql, encoding: 'utf8' });
const ok = (db, sql) => {
  const r = sqlite(db, sql);
  assert.equal(r.status, 0, `sqlite3 failed: ${r.stderr}\n${sql}`);
  return r.stdout.trim();
};
const tables = (db) => ok(db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;").split('\n').filter(Boolean);
const newMigrations = () => {
  const names = existsSync(MIG) ? readdirSync(MIG).filter((n) => n.endsWith('.sql')).sort() : [];
  return names.filter((n) => !PREVIOUS.includes(n));
};

// A database built by the previous migration version (0001 to 0004), with data in it.
function previousDb() {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-data01-files-'));
  const db = join(dir, 'mnemo.db');
  for (const f of PREVIOUS) ok(db, readFileSync(join(MIG, f), 'utf8'));
  ok(db, `INSERT INTO settings(key,value,updated_at) VALUES('theme','dark','${U}');`);
  ok(db, `INSERT INTO note(id,created_at,updated_at,body) VALUES('note-1','${U}','${U}','kept text');`);
  ok(db, `INSERT INTO bookmark(id,created_at,updated_at,url) VALUES('bm-1','${U}','${U}','https://example.com');`);
  return { dir, db };
}

// AC6: "Soft-delete sets deleted_at on the file row; normal reads exclude it; the file on disk is not removed (Rust test)."
// From outside: the new file table has a nullable deleted_at column, so a row can be soft deleted and kept.
test('AC6: the file table has a nullable deleted_at column for soft delete', () => {
  const h = previousDb();
  try {
    const before = tables(h.db);
    for (const f of newMigrations()) ok(h.db, readFileSync(join(MIG, f), 'utf8'));
    const added = tables(h.db).filter((t) => !before.includes(t) && !t.startsWith('sqlite_'));
    assert.ok(added.length >= 1, 'no new table for the file rows');
    const withDeleted = added.filter((t) =>
      ok(h.db, `SELECT count(*) FROM pragma_table_info('${t}') WHERE name='deleted_at' AND "notnull"=0;`) === '1');
    assert.ok(withDeleted.length >= 1, `none of the new tables (${added.join(', ')}) has a nullable deleted_at column`);
  } finally { rmSync(h.dir, { recursive: true, force: true }); }
});

// ---------- Rust test list ----------
// Tests on main before #16 whose names mention "file"; they do not count as file tests of this ticket.
const OLD_RUST = new Set([
  'ai::health::tests::system::a_file_without_the_execute_bit_is_not_claude',
  'storage::items::tests::two_writers_on_one_file_save_100_notes_and_lose_none',
  'storage::tests::a_file_from_a_newer_mnemo_is_refused_before_wal_is_turned_on',
  'storage::tests::a_folder_in_place_of_the_file_is_refused',
  'storage::tests::a_garbage_file_is_refused_and_left_untouched',
  'storage::tests::open_creates_file_in_wal_mode_with_busy_timeout',
  'system::logging::tests::log_file_is_created_in_the_data_folder',
]);
let rustCache = null;
function fileTests() {
  if (rustCache) return rustCache;
  const r = spawnSync('cargo', ['test', '--manifest-path', MANIFEST, '--', '--list'], { encoding: 'utf8', timeout: LONG });
  assert.equal(r.status, 0, `cargo test --list failed\n${r.stderr}`);
  const names = r.stdout.split('\n').filter((l) => l.endsWith(': test')).map((l) => l.slice(0, -6));
  rustCache = names.filter((n) => /file|attach|image/i.test(n) && !OLD_RUST.has(n));
  return rustCache;
}
const hasTest = (re, what, extra = () => true) => {
  const all = fileTests();
  const hit = all.filter((n) => re.test(n) && extra(n));
  assert.ok(hit.length >= 1, `no Rust file test for: ${what}\nfile tests found:\n${all.join('\n') || '(none)'}`);
  return hit;
};
const runExact = (names) => {
  const r = spawnSync('cargo', ['test', '--manifest-path', MANIFEST, '--', '--exact', ...names], { encoding: 'utf8', timeout: LONG });
  assert.equal(r.status, 0, `cargo test failed\n${r.stdout}${r.stderr}`);
  const passed = [...r.stdout.matchAll(/test result: ok\. (\d+) passed/g)].reduce((s, m) => s + Number(m[1]), 0);
  assert.ok(passed >= names.length, `expected ${names.length} tests to pass, ${passed} passed\n${r.stdout}`);
};

// AC1: "A saved image can be read back through the storage read function and is byte-for-byte the same as the input (Rust test)."
test('AC1: a Rust test reads a saved image back byte-for-byte, and it passes', () => {
  runExact(hasTest(/byte|round_?trip|read_?back|identical/i, 'saved image reads back byte-for-byte'));
});

// AC2: "Two files saved with the same original name get different UUID file names on disk; both read back with their
// own bytes and both keep the original name in the database (Rust test)."
test('AC2: a Rust test saves two files with the same original name without overwrite, and it passes', () => {
  runExact(hasTest(/same_?(original_?)?name|duplicate|overwrite|two_files|uuid|collid|clash/i, 'two files with the same original name'));
});

// AC3: "A file over the size limit is refused before anything is written, with a plain message that names the limit,
// and no file or row is left behind. The limit defaults to 20 MB and is read from a setting, so a test can lower it (Rust test)."
test('AC3: a Rust test refuses a file over the size limit, and it passes', () => {
  runExact(hasTest(/limit|too_?(large|big)|over_?size|size/i, 'file over the size limit is refused'));
});

// AC4: "The read command cannot return a file outside the files folder: a request with a `../` path (and an absolute
// path or a name with a path separator) is refused with a coded AppError, and a planted file outside the folder is not
// returned (Rust test on the command-level function)."
test('AC4: a command-level Rust test refuses a ../ path, and it passes', () => {
  runExact(hasTest(/travers|dot_?dot|outside|escape|parent|absolute|separator|slash/i, 'read command refuses a ../ path',
    (n) => /command/i.test(n)));
});

// AC5: "The clean-up report lists a planted orphan file (a file in the folder with no database row) and deletes nothing:
// the orphan and all files with rows are still on disk after the report (Rust test)."
test('AC5: a Rust test lists a planted orphan file and deletes nothing, and it passes', () => {
  runExact(hasTest(/orphan|clean_?up/i, 'clean-up report lists an orphan'));
});

// AC6: "Soft-delete sets deleted_at on the file row; normal reads exclude it; the file on disk is not removed (Rust test)."
test('AC6: a Rust test soft-deletes a file row and keeps the file on disk, and it passes', () => {
  runExact(hasTest(/soft_?delete|delete/i, 'soft-delete of a file row'));
});

// AC7: "The new migration runs on a database built by the previous migration version and keeps existing data (migration test)."
test('AC7: a Rust migration test for the new migration exists and passes', () => {
  const r = spawnSync('cargo', ['test', '--manifest-path', MANIFEST, '--', '--list'], { encoding: 'utf8', timeout: LONG });
  assert.equal(r.status, 0, r.stderr);
  const names = r.stdout.split('\n').filter((l) => l.endsWith(': test')).map((l) => l.slice(0, -6));
  const mig = names.filter((n) => /migrat/i.test(n) && (/0005|migration_5|file|attach|image/i.test(n)) && !OLD_RUST.has(n));
  assert.ok(mig.length >= 1, `no Rust migration test for the new migration\nmigration tests:\n${names.filter((n) => /migrat/i.test(n)).join('\n')}`);
  runExact(mig);
});

// ---------- AC8 ----------
// AC8: "cargo fmt, cargo clippy with warnings denied, and the targeted cargo tests pass; the UI client wrapper type
// checks and its vitest test passes."
// cargo fmt and clippy alone already pass on main, so they are checked together with the new targeted file tests.
test('AC8: cargo fmt, cargo clippy with warnings denied and the targeted cargo file tests pass', () => {
  const all = fileTests();
  assert.ok(all.length >= 1, 'no Rust file tests found');
  runExact(all);
  const fmt = spawnSync('cargo', ['fmt', '--manifest-path', MANIFEST, '--check'], { encoding: 'utf8', timeout: LONG });
  assert.equal(fmt.status, 0, `cargo fmt --check failed\n${fmt.stdout}${fmt.stderr}`);
  const clippy = spawnSync('cargo', ['clippy', '--manifest-path', MANIFEST, '--all-targets', '--', '-D', 'warnings'], { encoding: 'utf8', timeout: LONG });
  assert.equal(clippy.status, 0, `cargo clippy failed\n${clippy.stderr}`);
});

// vitest tests on main before #16 whose names mention "file" or "image".
const OLD_VITEST = new Set([
  'self-test: a folder with no test file is reported',
  'the token groups hold every token of the token file exactly once',
  'Files (PDF), Videos and Shared are the Later items, and nothing else is',
  'file names go in as text',
  'the Tokens panel names every token in the token file',
]);

test('AC8: the UI client wrapper type checks and its vitest test passes', () => {
  const tsc = spawnSync('npx', ['tsc', '--noEmit'], { cwd: ROOT, encoding: 'utf8', timeout: LONG });
  assert.equal(tsc.status, 0, `type check failed\n${tsc.stdout}${tsc.stderr}`);
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-data01-files-vl-'));
  try {
    const out = join(dir, 'list.json');
    const l = spawnSync('npx', ['vitest', 'list', `--json=${out}`, 'ui/'], { cwd: ROOT, encoding: 'utf8', timeout: LONG });
    assert.equal(l.status, 0, `vitest list failed\n${l.stdout}${l.stderr}`);
    const list = JSON.parse(readFileSync(out, 'utf8'));
    const hits = list.filter((t) => /file|attach|image/i.test(t.name) && !OLD_VITEST.has(t.name));
    assert.ok(hits.length >= 1, 'no vitest test under ui/ for the file wrapper of the UI client');
    const files = [...new Set(hits.map((t) => t.file))];
    const r = spawnSync('npx', ['vitest', 'run', '--no-color', ...files], { cwd: ROOT, encoding: 'utf8', timeout: LONG });
    assert.equal(r.status, 0, `vitest failed\n${r.stdout}${r.stderr}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
