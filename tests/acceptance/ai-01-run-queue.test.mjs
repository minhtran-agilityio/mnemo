// Acceptance tests for #22 [AI-01] Run queue and run table.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/ai-01-run-queue.test.mjs
// Black box, three parts:
// 1. Data (AC6). The migration files are applied with the sqlite3 CLI to a database built by version 7
//    (0001 to 0007) that holds old run rows, then every migration after 0007 is applied (0008 today; the
//    owner rule lets it be renumbered if another PR lands first). The rebuilt run table is checked from
//    outside. Each test uses its own temporary database.
// 2. Rust (AC1-AC8). The criteria name the cargo filters that prove them (`queue`, `migrat`, a process
//    test). Each filter is run once with `cargo test --manifest-path src-tauri/Cargo.toml <filter>`; it must
//    exit 0, and the tests that prove a criterion are found by the words of the criterion in their names and
//    must be listed as `ok`. Tests that existed before this ticket do not count.
// 3. AC9. `npm run check` runs only outside a nested run (npm test sets MNEMO_NESTED=1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CARGO_TOML = join(ROOT, 'src-tauri', 'Cargo.toml');
const MIG = join(ROOT, 'src-tauri', 'migrations');
const NESTED = process.env.MNEMO_NESTED === '1';
const U = '2026-01-01T00:00:00Z';
const U2 = '2026-01-01T00:00:05Z';

// ------------------------------------------------------------------ sqlite helpers

const sqlite = (db, sql) => spawnSync('sqlite3', ['-bail', db], { input: sql, encoding: 'utf8' });
const ok = (db, sql) => {
  const r = sqlite(db, sql);
  assert.equal(r.status, 0, `sqlite3 failed: ${r.stderr}\n${sql}`);
  return r.stdout.trim();
};
const rejects = (db, sql, why) => {
  const r = sqlite(db, sql);
  assert.notEqual(r.status, 0, `expected sqlite to refuse: ${why}`);
};
const cols = (db, t) => ok(db, `SELECT name FROM pragma_table_info('${t}') ORDER BY cid;`).split('\n').filter(Boolean);
const migrations = () => (existsSync(MIG) ? readdirSync(MIG).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort() : []);
const num = (n) => Number(n.slice(0, 4));
const apply = (db, names) => { for (const f of names) ok(db, readFileSync(join(MIG, f), 'utf8')); };

// The run table columns of version 7 (0003_items.sql). None may be renamed or lost.
const OLD_RUN_COLS = ['id', 'created_at', 'updated_at', 'deleted_at', 'task_type', 'started_at', 'duration_ms', 'outcome', 'error'];
const FAIL_TEXT = 'Claude Code stopped with an error.';

// A database built by version 7 (migrations 0001 to 0007) with one old run row per outcome.
function version7Db() {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-ai22-'));
  const db = join(dir, 'mnemo.db');
  const old = migrations().filter((n) => num(n) <= 7);
  assert.equal(old.length, 7, `expected the seven earlier migrations, found ${old.join(', ')}`);
  apply(db, old);
  const row = (id, outcome, error) =>
    `INSERT INTO run(id,created_at,updated_at,task_type,started_at,duration_ms,outcome,error) VALUES('${id}','${U}','${U2}','summary','${U}',1200,'${outcome}',${error ? `'${error}'` : 'NULL'});`;
  ok(db, row('r-ok', 'ok') + row('r-failed', 'failed', FAIL_TEXT) + row('r-cancelled', 'cancelled'));
  return { dir, db };
}
function upgradedDb() {
  const h = version7Db();
  const added = migrations().filter((n) => num(n) > 7);
  assert.ok(added.length >= 1, 'no migration after 0007 (the run-state migration 0008 is missing)');
  apply(h.db, added);
  return h;
}
const withUpgraded = (fn) => () => {
  const h = upgradedDb();
  try { fn(h.db); } finally { rmSync(h.dir, { recursive: true, force: true }); }
};

// ------------------------------------------------------------------ AC6 (data, from outside)

// AC6: "Migration 0008 rebuilds `run` on a database built by version 7. It adds `state` (CHECK in waiting,
// running, done, failed, cancelled) and `ended_at`, keeps `outcome`, renames no column, and copies old rows
// (ok->done, failed->failed, cancelled->cancelled)."
test('AC6: the migration after 0007 adds state and ended_at to run and keeps every old column', withUpgraded((db) => {
  const c = cols(db, 'run');
  for (const k of OLD_RUN_COLS) assert.ok(c.includes(k), `run lost (or renamed) its column ${k}; columns: ${c.join(', ')}`);
  assert.ok(c.includes('state'), `run has no state column; columns: ${c.join(', ')}`);
  assert.ok(c.includes('ended_at'), `run has no ended_at column; columns: ${c.join(', ')}`);
}));

// AC6: "... copies old rows (ok->done, failed->failed, cancelled->cancelled)." and "keeps `outcome`".
test('AC6: old run rows are copied with ok->done, failed->failed, cancelled->cancelled and keep their data', withUpgraded((db) => {
  assert.equal(ok(db, 'SELECT count(*) FROM run;'), '3', 'the old run rows were not all copied');
  const get = (id) => ok(db, `SELECT state || '|' || outcome || '|' || task_type || '|' || started_at || '|' || duration_ms || '|' || ifnull(error,'-') FROM run WHERE id='${id}';`);
  assert.equal(get('r-ok'), `done|ok|summary|${U}|1200|-`);
  assert.equal(get('r-failed'), `failed|failed|summary|${U}|1200|${FAIL_TEXT}`);
  assert.equal(get('r-cancelled'), `cancelled|cancelled|summary|${U}|1200|-`);
}));

// AC6: "It adds `state` (CHECK in waiting, running, done, failed, cancelled)".
test('AC6: run.state accepts the five states and refuses any other value', withUpgraded((db) => {
  const OUT = { waiting: null, running: null, done: 'ok', failed: 'failed', cancelled: 'cancelled' };
  const ins = (id, state, outcome, ended) =>
    `INSERT INTO run(id,created_at,updated_at,task_type,state,started_at,ended_at,outcome) VALUES('${id}','${U}','${U}','summary','${state}','${U}',${ended ? `'${U2}'` : 'NULL'},${outcome ? `'${outcome}'` : 'NULL'});`;
  for (const [s, o] of Object.entries(OUT)) ok(db, ins(`n-${s}`, s, o, o !== null));
  rejects(db, ins('n-paused', 'paused', null, false), "a state outside waiting, running, done, failed, cancelled ('paused')");
  rejects(db, ins('n-ok', 'ok', 'ok', true), "the old outcome word 'ok' as a state");
}));

// ------------------------------------------------------------------ Rust tests by filter

// Tests that existed before this ticket and match the words below. They do not count.
const EARLIER = new Set([
  'commands::tests::app_storage_recovers_from_a_poisoned_lock',
  'storage::tests::recover_after_panic_rolls_back_an_open_transaction',
  'storage::tests::reopening_keeps_version_and_data',
  'storage::ideas::tests::ideas_are_kept_after_reopen_with_tags_source_why_outline_and_project',
  'storage::settings::tests::setting_write_keeps_each_key_apart_and_survives_reopen',
  'storage::migrate::tests::a_database_from_a_newer_app_is_refused',
  'storage::migrate::tests::a_failing_migration_rolls_back_and_names_the_number',
  'storage::migrate::tests::a_new_migration_runs_once_and_not_again',
  'storage::migrate::tests::all_migrations_on_a_version_2_database_keep_settings_and_add_the_tables',
  'storage::migrate::tests::item_table_checks_refuse_bad_rows',
  'storage::migrate::tests::memory_table_has_only_the_base_fields_and_a_body',
  'storage::migrate::tests::migration_2_adds_settings_to_a_database_built_by_migration_1',
  'storage::migrate::tests::migration_3_adds_item_tables_to_a_database_built_by_migration_2',
  'storage::migrate::tests::migration_4_adds_item_link_to_a_database_built_by_migration_3',
  'storage::migrate::tests::migration_5_adds_file_table_to_a_database_built_by_migration_4',
  'storage::migrate::tests::migration_6_adds_labels_to_a_database_built_by_migration_5',
  'storage::migrate::tests::migration_6_label_names_are_unique_per_parent_ignoring_case',
  'storage::migrate::tests::migration_7_adds_idea_fields_and_idea_tag_and_keeps_ideas_projects_and_links',
  'storage::migrate::tests::migration_numbers_are_1_to_n_with_no_gap',
  'storage::migrate::tests::real_migrations_set_the_version',
]);

const runs = new Map();
/** `cargo test --manifest-path src-tauri/Cargo.toml <args>` once per args; returns { status, out, passed }. */
function cargo(...args) {
  const key = args.join(' ');
  if (!runs.has(key)) {
    const r = spawnSync('cargo', ['test', '--manifest-path', CARGO_TOML, ...args], { encoding: 'utf8', timeout: 580000, maxBuffer: 64 * 1024 * 1024 });
    const out = `${r.stdout}\n${r.stderr}`;
    const passed = [...(r.stdout || '').matchAll(/^test (\S+) \.\.\. ok$/gm)].map((m) => m[1]);
    runs.set(key, { status: r.status, signal: r.signal, out, passed });
  }
  const res = runs.get(key);
  assert.notEqual(res.signal, 'SIGTERM', `cargo test ${key} did not finish (hang)`);
  assert.equal(res.status, 0, `cargo test --manifest-path src-tauri/Cargo.toml ${key} exit ${res.status}:\n${res.out.slice(-5000)}`);
  return res;
}
const leaf = (n) => n.split('::').pop().toLowerCase();
const fresh = (names) => names.filter((n) => !EARLIER.has(n));

/** The passing new tests whose leaf name matches every regex; fails with the candidates when there is none. */
function named(pool, res, what) {
  const hits = pool.filter((n) => res.every((re) => re.test(leaf(n))));
  assert.ok(hits.length > 0, `no passing new Rust test checks ${what} (names matching ${res.join(' and ')}). Candidates: ${JSON.stringify(pool)}`);
  return hits;
}
const queueTests = () => fresh(cargo('queue').passed);
const RUST = { timeout: 600000 };

// AC1: "With 5 tasks queued on the fake runner, at most 2 run at the same time. A test in `cargo test
// --manifest-path src-tauri/Cargo.toml queue` records the highest number running at once and asserts it is 2
// or less, and all 5 finish."
test('AC1: cargo test queue exits 0 and has a passing test that at most 2 of 5 runs run at once', RUST, () => {
  named(queueTests(), [/at_most|two|\b2\b|_2_|concurren|max|limit|five|_5/], 'that at most 2 of 5 queued runs run at once');
});

// AC2: "An Owner task added behind 3 waiting Background tasks (while both slots are busy) starts before all 3
// of them. Inside each class the order is FIFO, and a running Background run is not pre-empted. Proved by a
// queue test."
test('AC2: a passing queue test proves an owner task starts before 3 waiting background tasks', RUST, () => {
  named(queueTests(), [/owner|priorit/], 'that an owner task starts before 3 waiting background tasks');
});
test('AC2: a passing queue test proves FIFO order inside each class', RUST, () => {
  named(queueTests(), [/fifo|order|first_in/], 'FIFO order inside each priority class');
});

// AC3: "Each submitted run has exactly one `run` row. Its end state is done for a good run, failed for a
// runner error with the error text (the AiError's Mnemo-written message, never raw stderr) in `error`, and
// cancelled for a cancelled run. `ended_at` and `duration_ms` are set when the run ends. `outcome` stays
// consistent with `state` (done->ok). Proved by queue tests on a temp database."
test('AC3: a passing queue test proves one run row per run with its end state', RUST, () => {
  named(queueTests(), [/row|record|table/], 'one run row per submitted run with its end state');
});
test('AC3: a passing queue test proves a failed run row holds the error text', RUST, () => {
  const pool = queueTests().filter((n) => !/recover|reopen|app_closed|crash|interrupt|restart/.test(leaf(n)));
  named(pool, [/fail|error/], 'that a failed run is written as failed with its error text');
});

// AC4: "Cancel of a waiting run removes it from the queue and its row becomes cancelled without a process
// starting. Cancel of a running run makes `process.rs` kill the process group from its 20 ms wait loop, and
// run_task returns within 2 seconds. Proved by a process test on a real `sh` child that sleeps (elapsed < 2 s)
// and a queue test with a fake runner that blocks until cancelled."
test('AC4: a passing queue test proves cancel of a waiting run', RUST, () => {
  named(queueTests(), [/cancel/, /wait/], 'cancel of a waiting run (row cancelled, no process started)');
});
test('AC4: a passing queue test proves cancel of a running run with a fake that blocks until cancelled', RUST, () => {
  named(queueTests(), [/cancel/, /running|block|fake/], 'cancel of a running run on a fake runner that blocks until cancelled');
});
test('AC4: a passing process test proves cancel kills a sleeping sh child within 2 s', RUST, () => {
  const pool = fresh(cargo('process').passed).filter((n) => n.includes('process'));
  named(pool, [/cancel/], 'that cancel kills a real sleeping sh child and returns within 2 s');
});

// AC5: "Reopening a database that holds a running row and a waiting row leaves no row in running or waiting.
// Both become failed with error 'app closed' and an end time. Proved by a storage test that is run by the
// `queue` filter (or by a named recovery test listed in the Verify output)."
test('AC5: a passing recovery test proves reopening leaves no run in running or waiting', RUST, () => {
  const words = [/recover|reopen|app_closed|crash|interrupt|restart/];
  const inQueue = queueTests().filter((n) => words.every((re) => re.test(leaf(n))));
  if (inQueue.length > 0) return;
  // A named recovery test outside the queue filter: list all tests and run it by its exact name.
  const all = fresh(cargo('--lib', '--', '--list').out.split('\n').filter((l) => l.endsWith(': test')).map((l) => l.slice(0, -': test'.length)));
  const hits = named(all, words, 'that reopening a database turns running and waiting rows into failed "app closed"');
  const r = cargo('--lib', '--', '--exact', ...hits);
  for (const n of hits) assert.ok(r.passed.includes(n), `${n} did not pass`);
});

// AC6: "... 0008 is registered in storage/migrate.rs, and the schema-version assertions say 8. Proved by
// `cargo test --manifest-path src-tauri/Cargo.toml migrat`."
test('AC6: cargo test migrat exits 0 and has a passing test for the run-state migration', RUST, () => {
  const pool = fresh(cargo('migrat').passed);
  named(pool, [/8|run|state/], 'the migration that rebuilds run on a database built by version 7');
  // The earlier migration tests (with the version assertion) must still pass with 0008 registered.
  const passed = new Set(cargo('migrat').passed);
  for (const n of ['storage::migrate::tests::real_migrations_set_the_version', 'storage::migrate::tests::migration_numbers_are_1_to_n_with_no_gap']) {
    assert.ok(passed.has(n), `${n} no longer passes`);
  }
});

// AC7: "`AiRunner::run_task` takes a cancel token. The real runner, the fake runner and every caller (test
// prompt, commands) pass it through. The fake can block until it is cancelled."
test('AC7: the core builds and tests with the token passed through, and a passing test runs the fake until cancelled', RUST, () => {
  const lib = cargo('--lib');
  const pool = fresh(lib.passed).filter((n) => /fake/.test(n.toLowerCase()));
  named(pool, [/cancel/], 'a fake runner that blocks until it is cancelled');
});

// AC8: "On every run state change the core sends one Tauri event (`run-state`) with only the run id, task
// name and state. It holds no prompt, no path and no raw stderr. The emit goes through a notifier the queue is
// given, so queue tests check the events without Tauri."
test('AC8: a passing queue test checks the run-state events through the notifier', RUST, () => {
  named(queueTests(), [/event|notif|emit/], 'the run-state events (only id, task name and state)');
});

// ------------------------------------------------------------------ AC9

// AC9: "`npm test` exits 0, and `npm run check` (format, lint with clippy warnings denied, type check, tests)
// passes. A real forced kill of the app stays a manual owner check."
test('AC9: npm run check passes', { timeout: 600000, skip: NESTED ? 'nested run (npm test runs this file)' : false }, () => {
  const r = spawnSync('npm', ['run', 'check'], { cwd: ROOT, encoding: 'utf8', timeout: 590000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, `npm run check exit ${r.status}:\n${(r.stdout || '').slice(-3000)}${(r.stderr || '').slice(-3000)}`);
});
