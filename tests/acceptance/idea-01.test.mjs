// Acceptance tests for #34 [IDEA-01] Ideas with stages (data file and core).
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/idea-01.test.mjs
// Black box, in the style of data-01-item-storage: the migration files are applied with the sqlite3 CLI to a
// database built by the previous version (0001 to 0004), the schema is checked from outside against the
// published storage contract, and the Rust tests the ticket asks for are found by their published names in
// cargo's own list and run. Each test uses its own temporary database.
// The new migration is found by its number (the first after 0004); no number is hard-coded (owner decision).
// The Tauri commands have no surface node can call, so the behaviour of the stage rule, "Turn into project",
// tag removal and reopening is proved by the named Rust tests (the ticket: "A test covers each step").
// The screen is tested in idea-01-ui.test.mjs.
// Not covered: AC4 "word search" moved to #31 by the owner, no test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
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

// The Rust tests, read from cargo's own list (every test target), matched by their published names.
let listCache = null;
function rustTests() {
  if (listCache) return listCache;
  const r = spawnSync('cargo', ['test', '--manifest-path', MANIFEST, '--', '--list'], { encoding: 'utf8', timeout: 580000 });
  assert.equal(r.status, 0, `cargo test --list failed:\n${r.stderr.slice(-2000)}`);
  listCache = r.stdout.split('\n').filter((l) => l.endsWith(': test')).map((l) => l.slice(0, -6));
  return listCache;
}
function namedRustTestPasses(name) {
  const full = rustTests().filter((n) => n === name || n.endsWith(`::${name}`));
  assert.ok(full.length >= 1, `no Rust test named ${name}; idea tests found:\n${rustTests().filter((n) => /idea/i.test(n)).join('\n')}`);
  const r = spawnSync('cargo', ['test', '--manifest-path', MANIFEST, '--', '--exact', ...full], { encoding: 'utf8', timeout: 580000 });
  assert.equal(r.status, 0, `Rust test ${name} failed:\n${r.stdout.slice(-3000)}${r.stderr.slice(-1000)}`);
  const passed = [...r.stdout.matchAll(/test result: ok\. (\d+) passed/g)].reduce((s, m) => s + Number(m[1]), 0);
  assert.ok(passed >= full.length, `expected ${full.length} Rust test(s) named ${name} to run and pass, ${passed} passed:\n${r.stdout.slice(-1500)}`);
}

// ---------------------------------------------------------------- AC1
// "The stage follows the four checks. A test covers each step from 0 to 4 checks."
test('AC1: the stage follows the four checks; the Rust test idea_stage_follows_the_number_of_passed_checks_from_0_to_4 passes', LONG, () => {
  namedRustTestPasses('idea_stage_follows_the_number_of_passed_checks_from_0_to_4');
});

test('AC1: a test covers each step from 0 to 4 checks; the Rust test idea_stage_steps_through_0_1_2_3_4_checks_when_saved passes', LONG, () => {
  namedRustTestPasses('idea_stage_steps_through_0_1_2_3_4_checks_when_saved');
});

// "The stage follows the four checks." The checks read a tag, a source, a why line and an outline, so each is
// stored with the idea: idea gains body, source_kind, source_id, source_url, why, outline (published contract).
test('AC1: the idea table keeps its columns and gains body, source_kind, source_id, source_url, why and outline', withDb((db) => {
  const c = cols(db, 'idea');
  const want = ['id', 'created_at', 'updated_at', 'deleted_at', 'title', 'stage', 'body', 'source_kind', 'source_id', 'source_url', 'why', 'outline'];
  const missing = want.filter((n) => !c.includes(n));
  assert.deepEqual(missing, [], `idea has no column: ${missing.join(', ')} (columns: ${c.join(', ')})`);
}));

// Owner decision: "tags in table idea_tag". Contract: idea_tag(id, idea_id, tag, created_at, updated_at,
// deleted_at, UNIQUE(idea_id, tag)).
test('AC1: tags live in idea_tag with the columns id, idea_id, tag, created_at, updated_at, deleted_at', withDb((db) => {
  const tables = ok(db, "SELECT name FROM sqlite_master WHERE type='table';").split('\n');
  assert.ok(tables.includes('idea_tag'), `no idea_tag table (tables: ${tables.join(', ')})`);
  assert.deepEqual(cols(db, 'idea_tag').sort(), ['created_at', 'deleted_at', 'id', 'idea_id', 'tag', 'updated_at']);
}));

test('AC1: idea_tag holds one row per idea and tag (UNIQUE(idea_id, tag))', withDb((db) => {
  ok(db, `INSERT INTO idea(id,created_at,updated_at,title,stage) VALUES('i-1','${U}','${U}','One','spark'), ('i-2','${U}','${U}','Two','spark');
    INSERT INTO idea_tag(id,idea_id,tag,created_at,updated_at) VALUES('t-1','i-1','garden','${U}','${U}');
    INSERT INTO idea_tag(id,idea_id,tag,created_at,updated_at) VALUES('t-2','i-2','garden','${U}','${U}');`);
  const dup = sqlite(db, `INSERT INTO idea_tag(id,idea_id,tag,created_at,updated_at) VALUES('t-3','i-1','garden','${U}','${U}');`);
  assert.notEqual(dup.status, 0, 'a second row for the same idea and tag was accepted');
  assert.equal(ok(db, "SELECT count(*) FROM idea_tag WHERE tag='garden';"), '2');
}));

// ---------------------------------------------------------------- AC2
// "\"Turn into project\" works at any stage and links idea and project both ways."
test('AC2: "Turn into project" works at any stage and links both ways; the Rust test turn_idea_into_project_works_at_every_stage_and_links_both_ways passes', LONG, () => {
  namedRustTestPasses('turn_idea_into_project_works_at_every_stage_and_links_both_ways');
});

// Contract: the idea <-> project link is one undirected item_link row. Stored once, it is found from either side.
test('AC2: one item_link row joins an idea (with text, why, outline and a tag) and its project, found from either side', withDb((db) => {
  ok(db, `INSERT INTO idea(id,created_at,updated_at,title,stage,body,why,outline) VALUES('i-1','${U}','${U}','Garden robot','project','A robot that weeds','Saves an hour a week','1. motor 2. camera');
    INSERT INTO idea_tag(id,idea_id,tag,created_at,updated_at) VALUES('t-1','i-1','garden','${U}','${U}');
    INSERT INTO project(id,created_at,updated_at,title,status) VALUES('p-1','${U}','${U}','Garden robot','active');
    INSERT INTO item_link(id,a_kind,a_id,b_kind,b_id,created_at,updated_at) VALUES('l-1','idea','i-1','project','p-1','${U}','${U}');`);
  const fromIdea = ok(db, `SELECT CASE WHEN a_kind='idea' THEN b_kind||':'||b_id ELSE a_kind||':'||a_id END FROM item_link
    WHERE deleted_at IS NULL AND ((a_kind='idea' AND a_id='i-1') OR (b_kind='idea' AND b_id='i-1'));`);
  const fromProject = ok(db, `SELECT CASE WHEN a_kind='project' THEN b_kind||':'||b_id ELSE a_kind||':'||a_id END FROM item_link
    WHERE deleted_at IS NULL AND ((a_kind='project' AND a_id='p-1') OR (b_kind='project' AND b_id='p-1'));`);
  assert.equal(fromIdea, 'project:p-1');
  assert.equal(fromProject, 'idea:i-1');
  assert.equal(ok(db, "SELECT body||'|'||why||'|'||outline FROM idea WHERE id='i-1';"), 'A robot that weeds|Saves an hour a week|1. motor 2. camera');
}));

// ---------------------------------------------------------------- AC3
// "Removing a tag from a Ready idea moves it back one stage and deletes nothing."
test('AC3: removing a tag from a Ready idea moves it back one stage and deletes nothing; the Rust test removing_a_tag_from_a_ready_idea_moves_it_back_one_stage_and_deletes_nothing passes', LONG, () => {
  namedRustTestPasses('removing_a_tag_from_a_ready_idea_moves_it_back_one_stage_and_deletes_nothing');
});

// ---------------------------------------------------------------- AC5
// "Ideas are kept after restart, on Mac and on Ubuntu." (Both machines: npm test runs this file in the
// CI matrix of macOS and Ubuntu 22.04.)
test('AC5: ideas are kept after restart; the Rust test ideas_are_kept_after_reopen_with_tags_source_why_outline_and_project passes', LONG, () => {
  namedRustTestPasses('ideas_are_kept_after_reopen_with_tags_source_why_outline_and_project');
});

test('AC5: the ideas migration runs on a database built by the previous version and keeps its ideas, projects and links', () => {
  const h = previousDb();
  try {
    ok(h.db, `INSERT INTO idea(id,created_at,updated_at,title,stage) VALUES('i-1','${U}','${U}','Garden robot','ready');
      INSERT INTO idea(id,created_at,updated_at,title,stage) VALUES('i-2','${U}','${U}','Old thought','project');
      INSERT INTO idea(id,created_at,updated_at,deleted_at,title,stage) VALUES('i-3','${U}','${U}','${U}','Gone thought','spark');
      INSERT INTO project(id,created_at,updated_at,title,status) VALUES('p-1','${U}','${U}','Old thought','active');
      INSERT INTO item_link(id,a_kind,a_id,b_kind,b_id,created_at,updated_at) VALUES('l-1','idea','i-2','project','p-1','${U}','${U}');`);
    assert.ok(NEW().length >= 1, 'no migration after 0004 (the ideas migration of #34 is missing)');
    apply(h.db, NEW());
    assert.equal(ok(h.db, "SELECT title||'|'||stage FROM idea WHERE id='i-1';"), 'Garden robot|ready');
    assert.equal(ok(h.db, "SELECT title||'|'||stage FROM idea WHERE id='i-2';"), 'Old thought|project');
    assert.equal(ok(h.db, "SELECT title||'|'||(deleted_at IS NOT NULL) FROM idea WHERE id='i-3';"), 'Gone thought|1');
    assert.equal(ok(h.db, 'SELECT count(*) FROM idea;'), '3');
    assert.equal(ok(h.db, "SELECT count(*) FROM project WHERE id='p-1';"), '1');
    assert.equal(ok(h.db, "SELECT count(*) FROM item_link WHERE id='l-1' AND deleted_at IS NULL;"), '1');
  } finally { rmSync(h.dir, { recursive: true, force: true }); }
});
