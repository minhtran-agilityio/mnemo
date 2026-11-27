// Acceptance tests for #29 [LIB-03] File import of old links.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/lib-03-import.test.mjs
// Black box, two parts, from the ticket and the owner's "Confirmed decisions" (owner, 2026-11-27). The
// bookmark-places source (links.jsonl, gh) moved to #204 and is not tested here.
// 1. Data. Triage: "import state that survives a restart needs migration 0012 (#26 takes 0011)". Migration
//    0012 is applied with node:sqlite (Node 24) to a database built by every earlier migration in
//    src-tauri/migrations (0001 to 0010 on this branch, plus 0011 once #26 lands) that holds one bookmark.
//    Each test uses its own temporary database.
// 2. Rust. Decision 10: the owner's check runs `cargo test --manifest-path src-tauri/Cargo.toml import`. It
//    must exit 0, and each criterion is found by its words in the names of the tests that passed in that run.
//    Before this ticket no Rust test matched `import`, so every passing test in the run is new.
// Fixtures (made-up links only) for the implementer's tests and for a hand check of the screen:
//   fixtures/lib-03-bookmarks-export.html: a browser bookmarks export with 55 entries: 50 distinct links,
//     3 repeats by the #28 compare key, 2 entries that are not web links.
//   fixtures/lib-03-links.txt: plain text, one URL per line: 4 distinct links, 1 repeat, 2 lines that are
//     not links.
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

// ================================================================ Data: migration 0012
const migrations = () => (existsSync(MIG) ? readdirSync(MIG) : []).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort();
const target = () => {
  const f = migrations().find((n) => n.startsWith('0012_'));
  assert.ok(f, 'migration 0012_*.sql is missing in src-tauri/migrations');
  return f;
};

// A database built by every migration before 0012 with one live bookmark, then migrated by 0012.
function withDb(fn) {
  return () => {
    const last = target();
    const dir = mkdtempSync(join(tmpdir(), 'mnemo-lib03-'));
    const db = new DatabaseSync(join(dir, 'mnemo.db'));
    try {
      for (const f of migrations().filter((n) => n < last)) db.exec(readFileSync(join(MIG, f), 'utf8'));
      db.exec(`INSERT INTO bookmark(id, created_at, updated_at, url, title, summary, reason, reason_is_guess, site, summary_status, compare_key)
               VALUES('bm-old','${U}','${U}','https://example.org/old','Old page','Old summary','Old reason',1,'example.org','done','example.org/old');`);
      const earlier = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name));
      db.exec(readFileSync(join(MIG, last), 'utf8'));
      fn(db, earlier);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
const colNames = (db, t) => db.prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid').all(t).map((c) => c.name);
const newImportTables = (db, earlier) => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
  .map((t) => t.name).filter((n) => !earlier.has(n) && /import/i.test(n));

// AC4: "After Quit in the middle of an import, the next start shows the import as paused with the right counts."
// Triage: "import state that survives a restart needs migration 0012".
test('AC4: migration 0012 runs on a database built by the earlier migrations and keeps the saved bookmark', withDb((db) => {
  const row = db.prepare("SELECT url, title, summary, reason FROM bookmark WHERE id='bm-old' AND deleted_at IS NULL").get();
  assert.deepEqual({ ...row }, { url: 'https://example.org/old', title: 'Old page', summary: 'Old summary', reason: 'Old reason' });
}));

// AC4: "After Quit in the middle of an import, the next start shows the import as paused with the right counts."
test('AC4: migration 0012 adds a table for the import that holds its state (paused or running) across a restart', withDb((db, earlier) => {
  const tables = newImportTables(db, earlier);
  assert.ok(tables.length > 0, 'migration 0012 adds no table whose name holds "import"');
  const withState = tables.filter((t) => colNames(db, t).some((c) => /state|status|paus/i.test(c)));
  assert.ok(withState.length > 0, `no new import table has a state column: ${JSON.stringify(tables.map((t) => [t, colNames(db, t)]))}`);
}));

// ================================================================ Rust: cargo test import
const RUST = { timeout: 1200000 };
let gateRun = null;
// Decision 10: "Verify: `cargo test --manifest-path src-tauri/Cargo.toml import && ...`".
function gate() {
  if (!gateRun) {
    const r = spawnSync('cargo', ['test', '--manifest-path', CARGO_TOML, 'import'], { encoding: 'utf8', timeout: 580000, maxBuffer: 64 * 1024 * 1024 });
    const passed = [...(r.stdout || '').matchAll(/^test (\S+) \.\.\. ok$/gm)].map((m) => m[1]);
    gateRun = { status: r.status, signal: r.signal, out: `${r.stdout}\n${r.stderr}`, passed };
  }
  assert.notEqual(gateRun.signal, 'SIGTERM', 'cargo test import did not finish (hang)');
  assert.equal(gateRun.status, 0, `cargo test --manifest-path src-tauri/Cargo.toml import exit ${gateRun.status}:\n${gateRun.out.slice(-4000)}`);
  return gateRun.passed;
}
/** A test that passed in `cargo test import` has a name that matches every check (regex or function). */
function proved(checks, what) {
  const pool = gate();
  const hit = (n) => checks.every((c) => (typeof c === 'function' ? c(n.toLowerCase()) : c.test(n.toLowerCase())));
  assert.ok(pool.some(hit), `no passing test in 'cargo test import' checks ${what}. Passing tests: ${JSON.stringify(pool)}`);
}

// AC1: "A file of 50 links imports in batches and shows progress."
test('AC1: a passing import test imports a file of 50 links', RUST, () =>
  proved([/50|fifty/, /link/], 'a file of 50 links'));
// AC1: "... shows progress." Decision 5: "Progress shows done, waiting and failed."
test('AC1: a passing import test reports progress as done, waiting and failed', RUST, () =>
  proved([/progress|done|count/, /wait/, /fail/], 'progress with done, waiting and failed'));
// AC1: "... imports in batches". Decision 5: "summaries run as background work, at most 2 at a time (the queue
// limit), with no fixed batch size."
test('AC1: a passing import test runs the summaries as background work, at most 2 at a time', RUST, () =>
  proved([/background|queue|batch/, /at_most_two|at_most_2|two_at_a_time|2_at_a_time|concurren|queue_limit/], 'background summaries at most 2 at a time'));

// AC2: "Exact repeats, inside the file and against saved bookmarks, are skipped and counted."
test('AC2: a passing import test skips and counts repeats inside the file', RUST, () =>
  proved([/repeat|dup|twice|same/, /file|inside|within/, /skip|count/], 'repeats inside the file skipped and counted'));
// AC2: "... against saved bookmarks ..." Decision 9: "A link already saved: skipped and counted; the saved
// bookmark is not changed."
test('AC2: a passing import test skips and counts a link that is already saved', RUST, () =>
  proved([/saved|existing|already/, /skip|count/], 'a link already saved skipped and counted'));
test('AC2: a passing import test leaves the saved bookmark of a skipped link unchanged', RUST, () =>
  proved([/saved|existing|already/, /unchanged|not_changed|untouched|keeps|kept|same|not_modif|not_overwrit/], 'the saved bookmark not changed'));
// Decision 3: "Repeats: the #28 compare key decides."
test('AC2: a passing import test finds repeats by the #28 compare key', RUST, () =>
  proved([/compare_key|key/, /repeat|dup|saved|skip/], 'repeats found by the compare key'));
// Decision 3: "A deleted bookmark does not block."
test('AC2: a passing import test imports a link whose saved bookmark was deleted', RUST, () =>
  proved([/delet/], 'a deleted bookmark that does not block the import'));

// AC3: "Import pauses at the usage limit and continues when the owner presses Continue. Tested with the fake runner."
test('AC3: a passing import test pauses the import at the usage limit', RUST, () =>
  proved([/paus|wait|stop/, /usage|limit/], 'a pause at the usage limit'));
test('AC3: a passing import test continues the import when the owner presses Continue', RUST, () =>
  proved([/continue|resume/], 'Continue resuming the import'));
// Decision 4: "Continue then shows the reason and keeps waiting until AI may run again. It never goes past the limit."
test('AC3: a passing import test keeps waiting after Continue while AI may not run, and never goes past the limit', RUST, () =>
  proved([/continue|resume/, /wait|limit|never|still|reason/], 'Continue at the limit keeps waiting'));
// Decision 4: "Pause and Continue: they pause and resume this import only."
test('AC3: a passing import test pauses the import when the owner presses Pause', RUST, () =>
  proved([/pause/, /owner|press|button|manual|by_hand|command/], 'the owner pausing the import'));

// AC4: "After Quit in the middle of an import, the next start shows the import as paused with the right counts."
test('AC4: a passing import test shows the import as paused with its counts after a restart', RUST, () =>
  proved([/restart|quit|reopen|next_start|start_again|survive|persist|after_open|at_open|on_open/, /paus/], 'the import paused after a restart'));
test('AC4: a passing import test keeps the right counts after a restart', RUST, () =>
  proved([/restart|quit|reopen|next_start|start_again|survive|persist|after_open|at_open|on_open/, /count/], 'the counts kept after a restart'));

// AC5: "A line that is not a link is skipped and counted, and does not stop the import."
test('AC5: a passing import test skips and counts a line that is not a link', RUST, () =>
  proved([/not_a_link|not_link|non_link|junk|invalid|bad_line|garbage|no_link|not_a_url|not_url/, /skip|count/], 'a line that is not a link skipped and counted'));
test('AC5: a passing import test goes on with the other links after a line that is not a link', RUST, () =>
  proved([/not_a_link|not_link|non_link|junk|invalid|bad_line|garbage|no_link|not_a_url|not_url/, /not_stop|does_not_stop|continu|rest|other|keeps_going|still|goes_on/], 'the import going on after a line that is not a link'));

// Ticket: "Pick a file of links: a browser bookmarks export (HTML) or a plain text file with one URL per line."
test('Decision: a passing import test reads a browser bookmarks export (HTML)', RUST, () =>
  proved([/html|netscape|browser|bookmarks_export|export/], 'a browser bookmarks export'));
test('Decision: a passing import test reads a plain text file with one URL per line', RUST, () =>
  proved([/plain|txt|text_file|one_per_line|one_url|per_line/], 'a plain text file with one URL per line'));
// Ticket: "All links are stored at once as link only." Decision 6: "Import without summaries: ... Links are
// stored as link only".
test('Decision: a passing import test stores the links as link only when the import runs without summaries', RUST, () =>
  proved([/without_summar|no_summar|link_only|links_only/], 'import without summaries storing link only'));
