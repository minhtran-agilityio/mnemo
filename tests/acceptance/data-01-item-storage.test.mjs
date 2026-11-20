// Acceptance tests for #14 [DATA-01] item tables and add, get, list, update, delete.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/data-01-item-storage.test.mjs
// Black box: the migration files are applied with the sqlite3 CLI to a database built by the previous version
// (0001 + 0002), the schema is checked from outside, and the Rust test list and command registration are read
// as text. Each test uses its own temporary database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const p = (...a) => join(ROOT, ...a);
const MIG = p('src-tauri', 'migrations');
const KINDS = ['bookmark', 'note', 'idea', 'project', 'task', 'event', 'run', 'memory'];
const BASE = ['id', 'created_at', 'updated_at', 'deleted_at'];
const U = '2026-01-01T00:00:00Z';
const U2 = '2026-01-02T00:00:00Z';

const migFile = (prefix) => {
  const f = existsSync(MIG) ? readdirSync(MIG).find((n) => n.startsWith(prefix) && n.endsWith('.sql')) : null;
  assert.ok(f, `migration ${prefix}_*.sql is missing in src-tauri/migrations`);
  return readFileSync(join(MIG, f), 'utf8');
};

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

// A database built by the previous version (migrations 1 and 2), with one settings row.
function previousDb() {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-data01-'));
  const db = join(dir, 'mnemo.db');
  ok(db, readFileSync(join(MIG, '0001_init.sql'), 'utf8'));
  ok(db, readFileSync(join(MIG, '0002_settings.sql'), 'utf8'));
  ok(db, `INSERT INTO settings(key,value,updated_at) VALUES('theme','dark','${U}');`);
  return { dir, db };
}
function migratedDb() {
  const h = previousDb();
  ok(h.db, migFile('0003'));
  ok(h.db, migFile('0004'));
  return h;
}
const cols = (db, t) => ok(db, `SELECT name FROM pragma_table_info('${t}') ORDER BY cid;`).split('\n').filter(Boolean);
const withDb = (fn) => () => {
  const h = migratedDb();
  try { fn(h.db); } finally { rmSync(h.dir, { recursive: true, force: true }); }
};

const MINIMAL = {
  bookmark: ['url', "'https://example.com'"],
  note: ['body', "'text'"],
  idea: ['title', "'t'"],
  project: ['title, status', "'t','active'"],
  task: ['title', "'t'"],
  event: ['title, starts_at, ends_at', `'t','${U}','${U2}'`],
  run: ['task_type, started_at', `'summary','${U}'`],
  memory: ['body', "'text'"],
};
const ins = (kind, id, extraCols = '', extraVals = '') => {
  const [c, v] = MINIMAL[kind];
  return `INSERT INTO ${kind}(id, created_at, updated_at, ${c}${extraCols}) VALUES('${id}','${U}','${U}',${v}${extraVals});`;
};

test('AC6: 0003 and 0004 run on a database built by the previous version and keep its data', () => {
  const h = previousDb();
  try {
    ok(h.db, migFile('0003'));
    ok(h.db, migFile('0004'));
    assert.equal(ok(h.db, "SELECT value FROM settings WHERE key='theme';"), 'dark');
    const tables = ok(h.db, "SELECT name FROM sqlite_master WHERE type='table';").split('\n');
    for (const k of [...KINDS, 'item_link', 'settings']) assert.ok(tables.includes(k), `table ${k} missing`);
  } finally { rmSync(h.dir, { recursive: true, force: true }); }
});

test('AC6: the migration list has 0001 to 0004 in order and the old files are unchanged in name', () => {
  const names = readdirSync(MIG).filter((n) => n.endsWith('.sql')).sort();
  assert.deepEqual(names.slice(0, 2), ['0001_init.sql', '0002_settings.sql']);
  assert.ok(/^0003_/.test(names[2] ?? ''), 'no 0003 migration');
  assert.ok(/^0004_/.test(names[3] ?? ''), 'no 0004 migration');
});

test('AC1: every item type has a table with the base columns', withDb((db) => {
  for (const k of KINDS) {
    const c = cols(db, k);
    for (const b of BASE) assert.ok(c.includes(b), `${k} lacks ${b}`);
  }
}));

test('AC2: deleted_at is nullable and a row can be soft deleted and kept', withDb((db) => {
  for (const k of KINDS) {
    ok(db, ins(k, `${k}-1`));
    ok(db, `UPDATE ${k} SET deleted_at='${U2}', updated_at='${U2}' WHERE id='${k}-1';`);
    assert.equal(ok(db, `SELECT count(*) FROM ${k};`), '1');
    assert.equal(ok(db, `SELECT count(*) FROM ${k} WHERE deleted_at IS NULL;`), '0');
    const nn = ok(db, `SELECT "notnull" FROM pragma_table_info('${k}') WHERE name='deleted_at';`);
    assert.equal(nn, '0');
  }
}));

test('AC2: each table has an index for the list query on deleted_at and created_at', withDb((db) => {
  for (const k of KINDS) {
    const idx = ok(db, `SELECT name FROM pragma_index_list('${k}');`).split('\n').filter(Boolean);
    const covers = idx.some((i) => {
      const c = ok(db, `SELECT name FROM pragma_index_info('${i}') ORDER BY seqno;`).split('\n');
      return c.includes('deleted_at') && c.includes('created_at');
    });
    assert.ok(covers, `${k} has no index over deleted_at and created_at`);
  }
}));

test('AC3: id is a text primary key and refuses a repeated id', withDb((db) => {
  for (const k of KINDS) {
    const t = ok(db, `SELECT type||'|'||pk FROM pragma_table_info('${k}') WHERE name='id';`);
    assert.equal(t.toUpperCase(), 'TEXT|1', `${k}.id`);
    ok(db, ins(k, 'same'));
    rejects(db, ins(k, 'same'), `${k} accepted a repeated id`);
  }
}));

test('AC7: memory has only the base fields plus a text body', withDb((db) => {
  assert.deepEqual(cols(db, 'memory').sort(), [...BASE, 'body'].sort());
  assert.equal(ok(db, "SELECT type FROM pragma_table_info('memory') WHERE name='body';").toUpperCase(), 'TEXT');
  rejects(db, `INSERT INTO memory(id,created_at,updated_at) VALUES('m','${U}','${U}');`, 'memory without body');
}));

test('AC1: required fields and CHECKs of each type are enforced by the database', withDb((db) => {
  rejects(db, `INSERT INTO bookmark(id,created_at,updated_at) VALUES('x','${U}','${U}');`, 'bookmark without url');
  ok(db, ins('bookmark', 'b-ok'));
  assert.equal(ok(db, "SELECT reason_is_guess FROM bookmark WHERE id='b-ok';"), '0');
  rejects(db, ins('bookmark', 'b-bad', ', reason_is_guess', ',2'), 'reason_is_guess 2');
  assert.equal(ok(db, "SELECT summary IS NULL AND title IS NULL AND reason IS NULL FROM bookmark WHERE id='b-ok';"), '1');
  ok(db, ins('idea', 'i-ok'));
  assert.equal(ok(db, "SELECT stage FROM idea WHERE id='i-ok';"), 'spark');
  rejects(db, ins('idea', 'i-bad', ', stage', ",'nonsense'"), 'bad idea stage');
  for (const s of ['spark', 'shape', 'ready', 'project']) ok(db, ins('idea', `i-${s}`, ', stage', `,'${s}'`));
  ok(db, ins('task', 't-ok'));
  assert.equal(ok(db, "SELECT done_at IS NULL FROM task WHERE id='t-ok';"), '1');
  ok(db, ins('run', 'r-ok'));
  assert.equal(ok(db, "SELECT duration_ms IS NULL AND outcome IS NULL AND error IS NULL FROM run WHERE id='r-ok';"), '1');
  rejects(db, ins('run', 'r-neg', ', duration_ms', ',-1'), 'negative duration');
  rejects(db, ins('run', 'r-out', ', outcome', ",'weird'"), 'bad outcome');
  for (const o of ['ok', 'failed', 'cancelled']) ok(db, ins('run', `r-${o}`, ', outcome', `,'${o}'`));
  rejects(db, `INSERT INTO event(id,created_at,updated_at,title) VALUES('e','${U}','${U}','t');`, 'event without times');
  rejects(db, `INSERT INTO project(id,created_at,updated_at,title) VALUES('p','${U}','${U}','t');`, 'project without status');
}));

test('AC4: item_link stores a link between any two types and refuses duplicates and self links', withDb((db) => {
  const link = (id, ak, ai, bk, bi) =>
    `INSERT INTO item_link(id,a_kind,a_id,b_kind,b_id,created_at,updated_at) VALUES('${id}','${ak}','${ai}','${bk}','${bi}','${U}','${U}');`;
  const c = cols(db, 'item_link');
  for (const n of [...BASE, 'a_kind', 'a_id', 'b_kind', 'b_id']) assert.ok(c.includes(n), `item_link lacks ${n}`);
  let n = 0;
  for (const a of KINDS) for (const b of KINDS) ok(db, link(`l${n++}`, a, `${a}-1`, b, `${b}-2`));
  assert.equal(ok(db, 'SELECT count(*) FROM item_link;'), String(KINDS.length ** 2));
  rejects(db, link('dup', 'note', 'note-1', 'task', 'task-2'), 'duplicate pair');
  rejects(db, link('self', 'note', 'n1', 'note', 'n1'), 'self link');
  rejects(db, link('bad', 'folder', 'f1', 'note', 'n1'), 'unknown kind');
  rejects(db, link('bad2', 'note', 'n1', 'folder', 'f1'), 'unknown kind on side b');
  // soft delete keeps the row
  ok(db, `UPDATE item_link SET deleted_at='${U2}' WHERE id='l0';`);
  assert.equal(ok(db, "SELECT count(*) FROM item_link WHERE id='l0';"), '1');
}));

test('AC4: item_link has indexes on both sides', withDb((db) => {
  const idx = ok(db, "SELECT name FROM pragma_index_list('item_link');").split('\n').filter(Boolean);
  const firsts = idx.map((i) => ok(db, `SELECT name FROM pragma_index_info('${i}') ORDER BY seqno LIMIT 1;`));
  assert.ok(firsts.includes('a_kind') || firsts.includes('a_id'), 'no index starting on side a');
  assert.ok(firsts.includes('b_kind') || firsts.includes('b_id'), 'no index starting on side b');
}));

const walk = (d, out = []) => {
  for (const n of readdirSync(d)) {
    const f = join(d, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
};

test('AC6: only the storage module names SQLite', () => {
  const src = p('src-tauri', 'src');
  for (const f of walk(src).filter((x) => x.endsWith('.rs'))) {
    if (f.includes(`${join(src, 'storage')}/`)) continue;
    assert.ok(!/rusqlite/.test(readFileSync(f, 'utf8')), `${f} names rusqlite`);
  }
  const r = spawnSync('cargo', ['test', '--manifest-path', p('src-tauri', 'Cargo.toml'), '--test', 'storage_boundary'], { encoding: 'utf8', timeout: 580000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

const COMMAND_NAMES = () => {
  const out = [];
  const plural = (k) => (k === 'memory' ? 'memories' : `${k}s`);
  for (const k of KINDS) out.push(`add_${k}`, `get_${k}`, `list_${plural(k)}`, `update_${k}`, `delete_${k}`);
  out.push('add_link', 'list_links', 'remove_link');
  return out;
};

test('AC5: all 43 commands are registered in lib.rs', () => {
  const lib = readFileSync(p('src-tauri', 'src', 'lib.rs'), 'utf8');
  const handler = lib.slice(lib.indexOf('generate_handler!'));
  assert.ok(lib.includes('generate_handler!'), 'no generate_handler! in lib.rs');
  for (const c of COMMAND_NAMES()) assert.ok(new RegExp(`\\b${c}\\b`).test(handler), `${c} is not registered`);
});

test('AC1: the Rust test list has a storage test for each of the 8 types', () => {
  const r = spawnSync('cargo', ['test', '--manifest-path', p('src-tauri', 'Cargo.toml'), '--lib', '--', '--list'], { encoding: 'utf8', timeout: 580000 });
  assert.equal(r.status, 0, r.stderr);
  const names = r.stdout.split('\n').filter((l) => l.endsWith(': test')).map((l) => l.slice(0, -6));
  const storage = names.filter((n) => n.startsWith('storage::'));
  for (const k of KINDS) assert.ok(storage.some((n) => n.includes(k)), `no storage test names ${k}`);
  for (const a of ['add', 'get', 'list', 'update', 'delete']) assert.ok(storage.some((n) => n.includes(a)), `no storage test names ${a}`);
  assert.ok(storage.some((n) => n.startsWith('storage::items')), 'no tests in storage::items');
  assert.ok(storage.some((n) => n.startsWith('storage::links')), 'no tests in storage::links');
});

test('AC1: the Rust tests of storage::items and storage::links pass (AC1 to AC4)', () => {
  for (const filter of ['storage::items', 'storage::links', 'migrate']) {
    const r = spawnSync('cargo', ['test', '--manifest-path', p('src-tauri', 'Cargo.toml'), '--lib', filter], { encoding: 'utf8', timeout: 580000 });
    assert.equal(r.status, 0, `${filter}\n${r.stdout}${r.stderr}`);
    if (filter !== 'migrate') assert.ok(/test result: ok\. [1-9]\d* passed/.test(r.stdout), `${filter} ran no tests`);
  }
});
