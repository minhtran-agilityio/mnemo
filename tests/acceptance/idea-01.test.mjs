// Acceptance tests for #34 [IDEA-01] Ideas with stages.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/idea-01.test.mjs
// Black box, in the style of data-01-item-storage: the migration files are applied with the sqlite3 CLI to a
// database built by the previous version (0001 to 0004), the schema is checked from outside, and the Rust
// test list is read through cargo and the matching tests are run. Each test uses its own temporary database.
// The new migration is found by its number (the first after 0004); no number is hard-coded.
// Not covered here: "An idea is found by word search (#31)" moved to #31 (owner decision).
// The commands and record fields of this ticket are not public yet, so the stage rule, "Turn into project"
// and tag removal are checked through the Rust tests the ticket asks for ("A test covers each step").
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
const U = '2026-01-01T00:00:00Z';
const LONG = { timeout: 590000 };

const sqlite = (db, sql) => spawnSync('sqlite3', ['-bail', db], { input: sql, encoding: 'utf8' });
const ok = (db, sql) => {
  const r = sqlite(db, sql);
  assert.equal(r.status, 0, `sqlite3 failed: ${r.stderr}\n${sql.slice(0, 400)}`);
  return r.stdout.trim();
};
const migrations = () => readdirSync(MIG).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort();
const num = (n) => Number(n.slice(0, 4));
const OLD = () => migrations().filter((n) => num(n) <= 4);
const NEW = () => migrations().filter((n) => num(n) > 4);
const apply = (db, names) => { for (const n of names) ok(db, readFileSync(join(MIG, n), 'utf8')); };
const cols = (db, t) => ok(db, `SELECT name FROM pragma_table_info('${t}') ORDER BY cid;`).split('\n').filter(Boolean);

// A database built by the previous version (migrations 0001 to 0004).
function previousDb() {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-idea01-'));
  const db = join(dir, 'mnemo.db');
  assert.equal(OLD().length, 4, `expected the four earlier migrations, found ${OLD().join(', ')}`);
  apply(db, OLD());
  return { dir, db };
}
function migratedDb() {
  const h = previousDb();
  assert.ok(NEW().length >= 1, 'no migration after 0004 (the ideas migration of #34 is missing)');
  apply(h.db, NEW());
  return h;
}
const withDb = (fn) => () => {
  const h = migratedDb();
  try { fn(h.db); } finally { rmSync(h.dir, { recursive: true, force: true }); }
};

// The Rust tests, read from cargo's own list. Names are matched loosely, by what they are about.
let listCache = null;
function rustTests() {
  if (listCache) return listCache;
  const r = spawnSync('cargo', ['test', '--manifest-path', MANIFEST, '--lib', '--', '--list'], { encoding: 'utf8', timeout: 580000 });
  assert.equal(r.status, 0, `cargo test --list failed:\n${r.stderr.slice(-2000)}`);
  listCache = r.stdout.split('\n').filter((l) => l.endsWith(': test')).map((l) => l.slice(0, -6));
  return listCache;
}
function runRust(names) {
  const r = spawnSync('cargo', ['test', '--manifest-path', MANIFEST, '--lib', '--', '--exact', ...names], { encoding: 'utf8', timeout: 580000 });
  assert.equal(r.status, 0, `Rust tests failed:\n${r.stdout.slice(-3000)}${r.stderr.slice(-1000)}`);
  const m = r.stdout.match(/test result: ok\. (\d+) passed/);
  assert.ok(m && Number(m[1]) >= names.length, `expected ${names.length} Rust tests to run and pass:\n${r.stdout.slice(-1500)}`);
}
const about = (...res) => rustTests().filter((n) => /idea/i.test(n) && res.every((re) => re.test(n)));

// ---------------------------------------------------------------- AC1
// "The stage follows the four checks. A test covers each step from 0 to 4 checks."
test('AC1: the stage follows the four checks; a Rust test covers the steps from 0 to 4 checks and passes', LONG, () => {
  const names = about(/stage/i, /check/i);
  assert.ok(names.length >= 1, `no Rust test about the idea stage and its checks in:\n${rustTests().filter((n) => /idea/i.test(n)).join('\n')}`);
  runRust(names);
});

// "The stage follows the four checks." The checks read a tag, a source, a why line and an outline,
// so each of them is stored with the idea (tags in their own table idea_tag, owner decision).
test('AC1: the data file has a place for the text, source, why line and outline of an idea', withDb((db) => {
  const c = cols(db, 'idea');
  for (const c0 of ['id', 'title', 'stage']) assert.ok(c.includes(c0), `idea lost the column ${c0}`);
  const missing = [
    ['text', /text|body/i],
    ['source', /source|url/i],
    ['why', /why/i],
    ['outline', /outline/i],
  ].filter(([, re]) => !c.some((n) => re.test(n))).map(([w]) => w);
  assert.deepEqual(missing, [], `idea has no column for: ${missing.join(', ')} (columns: ${c.join(', ')})`);
}));

test('AC1: tags of an idea live in their own table idea_tag (idea id, tag text)', withDb((db) => {
  const tables = ok(db, "SELECT name FROM sqlite_master WHERE type='table';").split('\n');
  assert.ok(tables.includes('idea_tag'), `no idea_tag table (tables: ${tables.join(', ')})`);
  const c = cols(db, 'idea_tag');
  const ideaCol = c.find((n) => /idea/i.test(n));
  const tagCol = c.find((n) => /tag/i.test(n) && n !== ideaCol);
  assert.ok(ideaCol, `idea_tag has no idea id column (columns: ${c.join(', ')})`);
  assert.ok(tagCol, `idea_tag has no tag text column (columns: ${c.join(', ')})`);
  const t = ok(db, `SELECT upper(type) FROM pragma_table_info('idea_tag') WHERE name='${tagCol}';`);
  assert.equal(t, 'TEXT', `idea_tag.${tagCol} is not text`);
}));

// ---------------------------------------------------------------- AC2
// "\"Turn into project\" works at any stage and links idea and project both ways."
test('AC2: a Rust test covers "Turn into project" at any stage with links both ways, and it passes', LONG, () => {
  const names = about(/turn|into_project|to_project/i, /project/i);
  assert.ok(names.length >= 1, `no Rust test about turning an idea into a project in:\n${rustTests().filter((n) => /idea/i.test(n)).join('\n')}`);
  runRust(names);
});

// ---------------------------------------------------------------- AC3
// "Removing a tag from a Ready idea moves it back one stage and deletes nothing."
test('AC3: a Rust test covers removing a tag from a Ready idea, and it passes', LONG, () => {
  const names = about(/tag/i, /remov|delet|drop|untag/i);
  assert.ok(names.length >= 1, `no Rust test about removing a tag from an idea in:\n${rustTests().filter((n) => /idea/i.test(n)).join('\n')}`);
  runRust(names);
});

// ---------------------------------------------------------------- AC5
// "Ideas are kept after restart, on Mac and on Ubuntu." (Both machines: npm test runs this file in the
// CI matrix of macOS and Ubuntu 22.04.)
test('AC5: the ideas migration runs on a database built by the previous version and keeps its ideas, projects and links', () => {
  const h = previousDb();
  try {
    ok(h.db, `INSERT INTO idea(id,created_at,updated_at,title,stage) VALUES('i-1','${U}','${U}','Garden robot','ready');
      INSERT INTO idea(id,created_at,updated_at,title,stage) VALUES('i-2','${U}','${U}','Old thought','project');
      INSERT INTO project(id,created_at,updated_at,title,status) VALUES('p-1','${U}','${U}','Old thought','active');
      INSERT INTO item_link(id,a_kind,a_id,b_kind,b_id,created_at,updated_at) VALUES('l-1','idea','i-2','project','p-1','${U}','${U}');`);
    assert.ok(NEW().length >= 1, 'no migration after 0004 (the ideas migration of #34 is missing)');
    apply(h.db, NEW());
    assert.equal(ok(h.db, "SELECT title||'|'||stage FROM idea WHERE id='i-1';"), 'Garden robot|ready');
    assert.equal(ok(h.db, "SELECT title||'|'||stage FROM idea WHERE id='i-2';"), 'Old thought|project');
    assert.equal(ok(h.db, "SELECT count(*) FROM project WHERE id='p-1';"), '1');
    assert.equal(ok(h.db, "SELECT count(*) FROM item_link WHERE id='l-1' AND deleted_at IS NULL;"), '1');
  } finally { rmSync(h.dir, { recursive: true, force: true }); }
});

test('AC5: a Rust test opens the data file again and finds the ideas, and it passes', LONG, () => {
  const names = about(/reopen|restart|persist|kept|survive/i);
  assert.ok(names.length >= 1, `no Rust test about ideas after reopening the data file in:\n${rustTests().filter((n) => /idea/i.test(n)).join('\n')}`);
  runRust(names);
});
