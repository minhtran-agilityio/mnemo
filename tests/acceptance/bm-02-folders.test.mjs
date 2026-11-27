// Acceptance tests for #26 [BM-02] Folders: a new link lands in a folder by itself; only the owner creates,
// moves or deletes.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/bm-02-folders.test.mjs
// Black box, two parts, from the ticket and the owner's "Confirmed decisions" (2026-11-26, "Accept all"):
// 1. Data. Migration 0011 is applied with node:sqlite (Node 24) to a database built by 0001 to 0010 that
//    holds bookmarks. Each test uses its own temporary database. Decisions: "A `folder` table with UUID ids
//    and a fixed Unsorted row." "New `bookmark` columns `folder_id`, `folder_reason` and `folder_is_guess`."
//    "Old rows go to Unsorted." "It ... takes the next free migration number (0011)."
// 2. Rust. Decision: "Verify: `cargo test --manifest-path src-tauri/Cargo.toml folder`". It must exit 0, and
//    each criterion is found by its words in the names of the tests that passed in that run. Tests that
//    existed before this ticket (helpers/bm-02-earlier-rust-tests.txt) do not count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const p = (...a) => join(ROOT, ...a);
const MIG = p('src-tauri', 'migrations');
const CARGO_TOML = p('src-tauri', 'Cargo.toml');
const U = '2026-01-01T00:00:00Z';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ================================================================ Data: migration 0011
const migFile = (prefix) => {
  const f = existsSync(MIG) ? readdirSync(MIG).find((n) => n.startsWith(prefix) && n.endsWith('.sql')) : null;
  assert.ok(f, `migration ${prefix}_*.sql is missing in src-tauri/migrations`);
  return readFileSync(join(MIG, f), 'utf8');
};
const PREVIOUS = ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010'];

// A database built by migrations 0001 to 0010 with one live and one soft-deleted bookmark, then migrated by 0011.
function withDb(fn) {
  return () => {
    const dir = mkdtempSync(join(tmpdir(), 'mnemo-bm02-'));
    const db = new DatabaseSync(join(dir, 'mnemo.db'));
    try {
      for (const f of PREVIOUS) db.exec(migFile(f));
      db.exec(`INSERT INTO bookmark(id, created_at, updated_at, url, title, summary, reason, reason_is_guess, site, summary_status)
               VALUES('bm-old','${U}','${U}','https://example.org/old','Old page','Old summary','Old reason',1,'example.org','done');`);
      db.exec(`INSERT INTO bookmark(id, created_at, updated_at, deleted_at, url, title, summary, reason, reason_is_guess, site, summary_status)
               VALUES('bm-gone','${U}','${U}','${U}','https://example.org/gone','Gone page',NULL,NULL,0,'example.org','done');`);
      db.exec(migFile('0011'));
      fn(db);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
const colNames = (db, t) => db.prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid').all(t).map((c) => c.name);
// The folder rows that hold the text "Unsorted" in any column.
const unsortedRows = (db) => db.prepare('SELECT * FROM folder').all()
  .filter((r) => Object.values(r).some((v) => typeof v === 'string' && v.trim() === 'Unsorted'));

// Decision: "A `folder` table with UUID ids and a fixed Unsorted row."
test('AC1: migration 0011 adds a folder table with one fixed Unsorted row whose id is a UUID', withDb((db) => {
  assert.ok(colNames(db, 'folder').length > 0, 'migration 0011 adds no folder table');
  const rows = unsortedRows(db);
  assert.equal(rows.length, 1, `expected one Unsorted folder row, found ${JSON.stringify(rows)}`);
  assert.match(String(rows[0].id), UUID, `the Unsorted folder id is not a UUID: ${rows[0].id}`);
}));

// Decision: "New `bookmark` columns `folder_id`, `folder_reason` and `folder_is_guess`."
test('AC1: migration 0011 adds bookmark.folder_id, bookmark.folder_reason and bookmark.folder_is_guess', withDb((db) => {
  const cols = colNames(db, 'bookmark');
  for (const c of ['folder_id', 'folder_reason', 'folder_is_guess']) assert.ok(cols.includes(c), `bookmark has no ${c} column: ${cols}`);
}));

// AC4: "Deleting a folder loses no bookmark." Decision: "Old rows go to Unsorted."
test('AC4: migration 0011 keeps every existing bookmark and puts each old row in Unsorted', withDb((db) => {
  const [unsorted] = unsortedRows(db);
  assert.ok(unsorted, 'no Unsorted folder row');
  const rows = db.prepare('SELECT id, url, title, deleted_at, folder_id FROM bookmark ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(rows.map((r) => [r.id, r.url, r.title]), [
    ['bm-gone', 'https://example.org/gone', 'Gone page'],
    ['bm-old', 'https://example.org/old', 'Old page'],
  ], 'a bookmark was lost or changed by migration 0011');
  assert.equal(rows.find((r) => r.id === 'bm-gone').deleted_at, U, 'the soft-deleted bookmark came back');
  for (const r of rows) assert.equal(r.folder_id, unsorted.id, `old bookmark ${r.id} is not in Unsorted`);
}));

// ================================================================ Rust: cargo test folder
const RUST = { timeout: 1200000 };
const EARLIER = new Set(readFileSync(p('tests', 'acceptance', 'helpers', 'bm-02-earlier-rust-tests.txt'), 'utf8')
  .split('\n').map((l) => l.trim()).filter(Boolean));
let gateRun = null;
// Decision: "Verify: `cargo test --manifest-path src-tauri/Cargo.toml folder`".
function gate() {
  if (!gateRun) {
    const r = spawnSync('cargo', ['test', '--manifest-path', CARGO_TOML, 'folder'], { encoding: 'utf8', timeout: 580000, maxBuffer: 64 * 1024 * 1024 });
    const passed = [...(r.stdout || '').matchAll(/^test (\S+) \.\.\. ok$/gm)].map((m) => m[1]);
    gateRun = { status: r.status, signal: r.signal, out: `${r.stdout}\n${r.stderr}`, passed };
  }
  assert.notEqual(gateRun.signal, 'SIGTERM', 'cargo test folder did not finish (hang)');
  assert.equal(gateRun.status, 0, `cargo test --manifest-path src-tauri/Cargo.toml folder exit ${gateRun.status}:\n${gateRun.out.slice(-4000)}`);
  return gateRun.passed.filter((n) => !EARLIER.has(n));
}
/** A new test that passed in `cargo test folder` has a name that matches every check (regex or function). */
function proved(checks, what) {
  const pool = gate();
  const hit = (n) => checks.every((c) => (typeof c === 'function' ? c(n.toLowerCase()) : c.test(n.toLowerCase())));
  assert.ok(pool.some(hit), `no new passing test in 'cargo test folder' checks ${what}. New passing tests: ${JSON.stringify(pool)}`);
}
const NEG = /\bno_|_no_|_not_|never|without|refus|reject|cannot|can_t|denied|not_allowed|error|fail/;

// AC1: "A save never creates a folder by itself. A test gives the fake runner an unknown folder name and the
// bookmark goes to Unsorted." Decision: "An unknown name goes to Unsorted."
test('AC1: a new passing folder test gives the fake runner an unknown folder name and the bookmark goes to Unsorted', RUST, () =>
  proved([/unknown|not_exist|missing|invented|new_folder_name|no_such/, /unsorted/], 'an unknown folder name from the runner going to Unsorted'));

// AC1: "A save never creates a folder by itself."
test('AC1: a new passing folder test shows a save never creates a folder by itself', RUST, () =>
  proved([/save|run|ai/, /creat|add|make|new/, NEG], 'a save that creates no folder'));

// AC2: "Move then Undo puts the bookmark back in its old folder."
test('AC2: a new passing folder test moves a bookmark, undoes it, and finds it back in its old folder', RUST, () =>
  proved([/move/, /undo/], 'move then Undo'));

// AC3: "Delete then Undo brings the bookmark back." Decision: "Undo of a delete clears `deleted_at`."
test('AC3: a new passing folder test deletes a bookmark, undoes it, and brings the bookmark back', RUST, () =>
  proved([/delet/, /undo/], 'delete then Undo'));

// AC4: "Deleting a folder loses no bookmark." Decision: "Deleting a folder moves its bookmarks to Unsorted."
test('AC4: a new passing folder test deletes a folder and its bookmarks move to Unsorted', RUST, () =>
  proved([/delet/, /unsorted|lose|lost|keep|kept/], 'a folder delete that loses no bookmark'));

// Decision: "Folder rename and delete ... both are refused on Unsorted." (keeps AC4: the default folder that
// receives the bookmarks of a deleted folder cannot itself be deleted.)
test('AC4: new passing folder tests refuse to delete and to rename Unsorted', RUST, () => {
  proved([/unsorted/, /delet/, NEG], 'a delete of Unsorted refused');
  proved([/unsorted/, /renam/, NEG], 'a rename of Unsorted refused');
});

// AC5: "With AI off, a new link goes to Unsorted." Decision: "With AI off, the bookmark goes to Unsorted."
test('AC5: a new passing folder test saves a new link with AI off and it goes to Unsorted', RUST, () =>
  proved([/ai_off|ai_is_off|ai_disabled|ai_turned_off|without_ai|no_ai|ai_paused/, /unsorted/], 'a link saved with AI off going to Unsorted'));
