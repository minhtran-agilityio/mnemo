// Acceptance tests for #33 [NOTE-01] Notes with nested labels.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/note-01-notes.test.mjs
// Black box:
// - Data (AC1): the migration files are applied with the sqlite3 CLI to a database built by 0001 to 0004.
// - Core rules (AC2 to AC5): the Rust test list is read with `cargo test -- --list`.
// - Commands (AC6): lib.rs registration is read as text; the typed client is checked by
//   tests/acceptance/note-01-api.test.ts (vitest, mocked invoke), which this file runs.
// - Screen (AC7 to AC10): the UI is built with Vite, served on a private port and driven in headless Chrome
//   through the DevTools protocol, by role, label and visible text. The Tauri bridge is an in-page fake
//   (window.__TAURI_INTERNALS__) that answers list_labels, list_labelled_notes and save_labelled_note from
//   memory. UI tests skip when no Chrome is found (set MNEMO_CHROME). Each test gets its own Chrome profile.
// - Pull request (AC11) and full check (AC12): run only outside npm test (MNEMO_NESTED unset), because AC11 reads
//   the pull request text with the gh CLI (network) and AC12 runs npm run check, which itself runs this file.
// Not testable here: the Ubuntu light and dark screenshots of AC12 (the main session publishes them).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { join, dirname, extname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const p = (...a) => join(ROOT, ...a);
const MIG = p('src-tauri', 'migrations');
const U = '2026-01-01T00:00:00Z';
const U2 = '2026-01-02T00:00:00Z';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const walk = (d, out = []) => {
  if (!existsSync(d)) return out;
  for (const n of readdirSync(d)) {
    if (['node_modules', 'target', '.git', 'dist'].includes(n)) continue;
    const f = join(d, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
};

// ================================================================ AC1: migration 0005
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
const cols = (db, t) => ok(db, `SELECT name FROM pragma_table_info('${t}') ORDER BY cid;`).split('\n').filter(Boolean);
const indexFirsts = (db, t) =>
  ok(db, `SELECT name FROM pragma_index_list('${t}');`).split('\n').filter(Boolean)
    .map((i) => ok(db, `SELECT name FROM pragma_index_info('${i}') ORDER BY seqno LIMIT 1;`));

// A database built by migration 0004 (0001 to 0004) with one live note.
function db0004() {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-note01-'));
  const db = join(dir, 'mnemo.db');
  for (const f of ['0001', '0002', '0003', '0004']) ok(db, migFile(f));
  ok(db, `INSERT INTO note(id, created_at, updated_at, body) VALUES('note-old','${U}','${U}','kept body');`);
  return { dir, db };
}
const withDb = (fn) => () => {
  const h = db0004();
  try {
    ok(h.db, migFile('0005'));
    fn(h.db);
  } finally { rmSync(h.dir, { recursive: true, force: true }); }
};
const lab = (id, name, parent = null, deleted = null) =>
  `INSERT INTO label(id, created_at, updated_at, deleted_at, name, parent_id) VALUES('${id}','${U}','${U}',${deleted ? `'${deleted}'` : 'NULL'},'${name}',${parent ? `'${parent}'` : 'NULL'});`;

// AC1: "A new numbered migration (0005) adds a `label` table (UUID id, base fields, name, nullable parent_id,
// unique live name per parent) and a `note_label` link table (note_id, label_id, base fields), with indexes;
// a migration test runs it on a database built by migration 0004 and keeps existing notes."
test('AC1: migration 0005 runs on a database built by 0004 and keeps existing notes', () => {
  const h = db0004();
  try {
    ok(h.db, migFile('0005'));
    assert.equal(ok(h.db, "SELECT body FROM note WHERE id='note-old' AND deleted_at IS NULL;"), 'kept body');
    const tables = ok(h.db, "SELECT name FROM sqlite_master WHERE type='table';").split('\n');
    for (const t of ['label', 'note_label', 'note', 'item_link']) assert.ok(tables.includes(t), `table ${t} missing`);
  } finally { rmSync(h.dir, { recursive: true, force: true }); }
});

test('AC1: label has an id, the base fields, a name and a nullable parent_id', withDb((db) => {
  const c = cols(db, 'label');
  for (const n of ['id', 'created_at', 'updated_at', 'deleted_at', 'name', 'parent_id']) assert.ok(c.includes(n), `label lacks ${n}`);
  assert.equal(ok(db, `SELECT "notnull" FROM pragma_table_info('label') WHERE name='parent_id';`), '0', 'parent_id must be nullable');
}));

test('AC1: a live label name is unique per parent (top level and child level), soft-deleted names do not count', withDb((db) => {
  ok(db, lab('t1', 'Work'));
  rejects(db, lab('t2', 'Work'), 'two live top labels named Work');
  ok(db, lab('c1', 'Plans', 't1'));
  rejects(db, lab('c2', 'Plans', 't1'), 'two live labels named Plans under the same parent');
  ok(db, lab('t3', 'Home'));
  ok(db, lab('c3', 'Plans', 't3')); // same name under another parent is allowed
  ok(db, lab('t4', 'Old', null, U2));
  ok(db, lab('t5', 'Old')); // the earlier Old is soft-deleted, so the name is free
  ok(db, lab('c4', 'Gone', 't1', U2));
  ok(db, lab('c5', 'Gone', 't1'));
}));

test('AC1: note_label links a note to a label with the base fields', withDb((db) => {
  const c = cols(db, 'note_label');
  for (const n of ['id', 'created_at', 'updated_at', 'deleted_at', 'note_id', 'label_id']) assert.ok(c.includes(n), `note_label lacks ${n}`);
  assert.equal(ok(db, `SELECT "notnull" FROM pragma_table_info('note_label') WHERE name='deleted_at';`), '0');
  ok(db, lab('t1', 'Work'));
  ok(db, `INSERT INTO note_label(id, created_at, updated_at, note_id, label_id) VALUES('nl1','${U}','${U}','note-old','t1');`);
  assert.equal(ok(db, "SELECT count(*) FROM note_label WHERE note_id='note-old' AND label_id='t1';"), '1');
}));

test('AC1: migration 0005 adds indexes for label parents and for both sides of note_label', withDb((db) => {
  assert.ok(indexFirsts(db, 'label').includes('parent_id'), 'no index on label starting with parent_id');
  const nl = indexFirsts(db, 'note_label');
  assert.ok(nl.includes('note_id'), 'no index on note_label starting with note_id');
  assert.ok(nl.includes('label_id'), 'no index on note_label starting with label_id');
}));

// ================================================================ AC2 to AC5: Rust tests
const CARGO = ['--manifest-path', p('src-tauri', 'Cargo.toml')];
let testNamesCache = null;
function rustTests() {
  if (testNamesCache) return testNamesCache;
  const r = spawnSync('cargo', ['test', ...CARGO, '--lib', '--', '--list'], { encoding: 'utf8', timeout: 580000 });
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  testNamesCache = r.stdout.split('\n').filter((l) => l.endsWith(': test')).map((l) => l.slice(0, -6));
  return testNamesCache;
}
const labelTests = () => rustTests().filter((n) => n.startsWith('storage::') && /label/i.test(n));
const someTest = (re, what) => assert.ok(labelTests().some((n) => re.test(n)), `no storage label test ${what}; label tests: ${labelTests().join(', ')}`);

// AC1: "... a migration test runs it on a database built by migration 0004 and keeps existing notes."
test('AC1: the Rust test list has a migration test for the label migration', () => {
  const mig = rustTests().filter((n) => n.startsWith('storage::') && /migrat/i.test(n));
  assert.ok(mig.some((n) => /label|0005|five|_5\b/i.test(n)), `no migration test names the label migration: ${mig.join(', ')}`);
}, { timeout: 600000 });

// AC2: "storage has label create, rename, move, delete and list-tree functions; move refuses moving a label under
// itself or a descendant; a name that already exists under the same parent is refused; every function has a Rust test."
test('AC2: every label function (create, rename, move, delete, list) has a Rust storage test', () => {
  for (const f of ['create', 'rename', 'move', 'delete', 'list']) someTest(new RegExp(f, 'i'), `names ${f}`);
}, { timeout: 600000 });

// AC3: "... a Rust test counts live notes before and after a label delete and the counts are equal."
test('AC3: a Rust test on label delete counts the notes', () => {
  someTest(/delete.*(count|lost|lose)|(count|lost|lose).*delete/i, 'about delete that counts notes (name with delete and count/lost)');
}, { timeout: 600000 });

// AC4: "Saving a note (add or update) with zero labels is refused with a plain validation message (Rust test) ..."
test('AC4: a Rust test saves a note with no label', () => {
  someTest(/(save|add|update).*(no|zero|empty|without|missing).*label|(no|zero|empty|without|missing)_?labels?.*(save|refus)/i, 'about saving a note with no label');
}, { timeout: 600000 });

// AC5: "Listing the notes of a label returns the notes of that label and of all its descendant labels ..."
test('AC5: a Rust test lists the notes of a label with its descendant labels', () => {
  someTest(/list.*(descendant|child|nested|grandchild|subtree)|(descendant|child|nested|grandchild|subtree).*list/i, 'about listing notes of child labels');
}, { timeout: 600000 });

// ================================================================ AC6: commands and typed client
// AC6: "Thin Tauri commands for the label functions and label-aware note save/list are registered in lib.rs and
// wrapped in typed functions in ui/src/shared/api.ts with the { code, message } error shape; screens never call invoke directly."
const COMMANDS = ['create_label', 'rename_label', 'move_label', 'delete_label', 'list_labels', 'save_labelled_note', 'list_labelled_notes'];

test('AC6: the label and labelled-note commands are registered in lib.rs', () => {
  const lib = readFileSync(p('src-tauri', 'src', 'lib.rs'), 'utf8');
  assert.ok(lib.includes('generate_handler!'), 'no generate_handler! in lib.rs');
  const handler = lib.slice(lib.indexOf('generate_handler!'));
  for (const c of COMMANDS) assert.ok(new RegExp(`\\b${c}\\b`).test(handler), `${c} is not registered`);
});

test('AC6: ui/src/shared/api.ts wraps each command in a typed function and keeps the { code, message } error (vitest)', () => {
  const r = spawnSync('npx', ['vitest', 'run', '--root', ROOT, '--no-color', 'tests/acceptance/note-01-api.test.ts'], { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-3000));
}, { timeout: 300000 });

test('AC6: screens never call invoke directly', () => {
  const api = readFileSync(p('ui', 'src', 'shared', 'api.ts'), 'utf8');
  assert.match(api, /\bsaveLabelledNote\b/, 'api.ts has no saveLabelledNote wrapper');
  const offenders = walk(p('ui', 'src', 'screens'))
    .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
    .filter((f) => /@tauri-apps\/api\/core|\binvoke\s*\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map((f) => relative(ROOT, f)), [], 'a screen calls invoke itself');
});

// ================================================================ AC10: static rules for the Notes screen code
// AC10: "No label tree, label picker, Markdown renderer or sanitiser, temporary style, own element or stand-in text is
// added; the Read segment shows nothing until #128; screen CSS is layout only and the ds guard tests pass; no 'sqlite'
// or 'sign in' text and issue numbers via ref(n)/planned(n) in ui .ts."
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
test("AC10: the Notes editor code renders no HTML, has no 'sqlite' or 'sign in' text, no raw issue numbers, and the ds guards pass", () => {
  const uiTs = walk(p('ui', 'src')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.includes(`${join('ui', 'src', 'ds')}/`));
  const notesFiles = uiTs.filter((f) => /Unsaved changes/.test(readFileSync(f, 'utf8')) || /Discard changes/.test(readFileSync(f, 'utf8')));
  assert.ok(notesFiles.length > 0, "no ui .ts file outside ui/src/ds builds the Notes editor (no 'Unsaved changes' or 'Discard changes' text)");
  for (const f of notesFiles) {
    const src = readFileSync(f, 'utf8');
    const code = stripComments(src);
    const rel = relative(ROOT, f);
    assert.doesNotMatch(code, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|DOMParser|createContextualFragment/, `${rel} renders HTML`);
    assert.doesNotMatch(code, /\b(marked|markdown-it|micromark|dompurify|sanitize-html)\b/i, `${rel} uses a Markdown renderer or sanitiser`);
    assert.doesNotMatch(src, /sqlite/i, `${rel} says sqlite`);
    assert.doesNotMatch(src, /sign[\s-]?in/i, `${rel} says sign in`);
    assert.doesNotMatch(code, /(["'`])[^"'`\n]*#\d+[^"'`\n]*\1/, `${rel} writes an issue number in a string instead of ref(n)/planned(n)`);
    assert.doesNotMatch(code, /coming soon|\bsoon\b/i, `${rel} has stand-in text`);
  }
  const r = spawnSync(process.execPath, ['--test', '--test-isolation=none', p('tests', 'ds-screen-css.test.mjs'), p('tests', 'ds-screen-elements.test.mjs')], { encoding: 'utf8', env: { ...process.env, MNEMO_NESTED: '1' }, cwd: ROOT });
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-1500));
});

// ================================================================ AC7 to AC10: the Notes screen in a browser
const CHROME = [process.env.MNEMO_CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((c) => c && existsSync(c));
const SKIP_UI = CHROME ? false : 'no Chrome found (set MNEMO_CHROME)';
let distDir = null;
let server = null;
let port = 0;
let buildError = null;

before(async () => {
  if (SKIP_UI) return;
  distDir = mkdtempSync(join(tmpdir(), 'mnemo-note01-dist-'));
  const r = spawnSync('npx', ['vite', 'build', '--outDir', distDir, '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
  if (r.status !== 0) buildError = `vite build exit ${r.status}:\n${r.stdout}\n${r.stderr}`;
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml' };
  server = createServer((req, res) => {
    let u = decodeURIComponent((req.url || '/').split('?')[0]);
    if (u.endsWith('/')) u += 'index.html';
    const f = join(distDir, u);
    if (!f.startsWith(distDir) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' });
    res.end(readFileSync(f));
  });
  await new Promise((r2) => server.listen(0, '127.0.0.1', r2));
  port = server.address().port;
});
after(() => {
  server?.close();
  if (distDir) rmSync(distDir, { recursive: true, force: true });
});

// In-page fake of the Tauri bridge. MODE: 'ok' (two notes), 'empty' (no notes), 'listfail' (the list fails),
// 'slow' (the list waits for window.__releaseList()). At run time: window.__saveFail = true makes a save fail
// with a validation error; window.__holdSave = true makes a save wait for window.__releaseSave().
// Records follow the #14 client shape (camelCase, pages are { items, next }); a labelled note is
// { note, labelIds } (label_ids is sent too, in case the client reads the Rust field name).
const bridgeScript = (mode) => `(() => {
  const MODE = ${JSON.stringify(mode)};
  window.__calls = [];
  const T1 = '2026-11-02T10:00:00Z', T2 = '2026-11-01T09:00:00Z', T3 = '2026-11-03T08:00:00Z';
  const label = (id, name, parentId) => ({ id, createdAt: T2, updatedAt: T2, deletedAt: null, name, parentId, parent_id: parentId });
  const LABELS = [label('lab-work', 'Work', null), label('lab-proj', 'Projects', 'lab-work')];
  const ln = (id, body, labelIds, at) => ({ note: { id, createdAt: at, updatedAt: at, deletedAt: null, body }, labelIds, label_ids: labelIds });
  const notes = MODE === 'empty' ? [] : [
    ln('note-1', '# Groceries\\nBuy oat milk\\n**bold words**', ['lab-work'], T1),
    ln('note-2', 'Meeting plan\\nAgenda for Monday', ['lab-proj'], T2),
  ];
  const page = () => ({ items: notes.slice().sort((a, b) => b.note.updatedAt.localeCompare(a.note.updatedAt)), next: null });
  const find = (o, k) => {
    if (!o || typeof o !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(o, k)) return o[k];
    for (const v of Object.values(o)) { const r = find(v, k); if (r !== undefined) return r; }
    return undefined;
  };
  const invoke = async (cmd, args) => {
    window.__calls.push({ cmd, args: JSON.parse(JSON.stringify(args ?? null)) });
    if (cmd === 'list_labelled_notes') {
      if (MODE === 'listfail') throw { code: 'storage', message: 'The notes could not be read.' };
      if (MODE === 'slow') return new Promise((r) => { window.__releaseList = () => r(page()); });
      return page();
    }
    if (cmd === 'list_labels') return LABELS.slice();
    if (cmd === 'save_labelled_note') {
      if (window.__holdSave) await new Promise((r) => { window.__releaseSave = r; });
      if (window.__saveFail) throw { code: 'validation', message: 'A note needs at least one label.' };
      const id = find(args, 'id') || 'note-new';
      const body = find(args, 'body');
      const ids = find(args, 'labelIds') || find(args, 'label_ids') || [];
      const saved = ln(id, body, ids, T3);
      const i = notes.findIndex((n) => n.note.id === id);
      if (i >= 0) notes[i] = saved; else notes.push(saved);
      return saved;
    }
    if (/setting/i.test(cmd)) return null;
    if (/ping/i.test(cmd)) return 'pong';
    if (/version/i.test(cmd)) return '0.1.0';
    return null;
  };
  let cb = 1;
  window.__TAURI_INTERNALS__ = { invoke, transformCallback: () => cb++, unregisterCallback() {}, convertFileSrc: (s) => s, metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } } };
  window.isTauri = true;
})();`;

async function openApp(mode) {
  assert.equal(buildError, null, buildError ?? '');
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-note01-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
  try {
    let wsUrl;
    let exited = null;
    proc.once('exit', (code, signal) => { exited = signal ?? code; });
    for (let i = 0; i < 300 && !wsUrl && exited === null; i++) {
      await sleep(100);
      const f = join(dir, 'DevToolsActivePort');
      if (existsSync(f)) { const [pt, path] = readFileSync(f, 'utf8').trim().split('\n'); if (path) wsUrl = `ws://127.0.0.1:${pt}${path}`; }
    }
    assert.ok(wsUrl, exited === null ? 'Chrome did not start within 30 s' : `Chrome exited before it started (${exited})`);
    const ws = new WebSocket(wsUrl);
    await new Promise((r1, r2) => { ws.onopen = r1; ws.onerror = r2; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) { const { r1, r2 } = pending.get(d.id); pending.delete(d.id); d.error ? r2(new Error(JSON.stringify(d.error))) : r1(d.result); }
    };
    const send = (method, params = {}, sessionId) => new Promise((r1, r2) => { const i = ++id; pending.set(i, { r1, r2 }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, pr) => send(m, pr, sessionId);
    await S('Page.enable');
    await S('Runtime.enable');
    await S('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await S('Page.addScriptToEvaluateOnNewDocument', { source: bridgeScript(mode) });
    const evalJs = async (expr) => {
      const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`page error: ${JSON.stringify(r.exceptionDetails).slice(0, 500)}`);
      return r.result.value;
    };
    const helpers = `(() => {
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
      const name = (el) => norm(el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && el.getAttribute('aria-labelledby').split(' ').map((i) => document.getElementById(i)?.textContent).join(' ')) || el.textContent || el.getAttribute('title'));
      const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const ctl = () => [...document.querySelectorAll('a, button, [role=link], [role=button], [role=menuitem], [role=tab], [role=radio], [role=option]')];
      const find = (n) => ctl().filter((el) => { const l = name(el); return (l === n || l.startsWith(n + ' ')) && shown(el); });
      const main = () => document.querySelector('main') || document.body;
      const options = () => [...main().querySelectorAll('[role=option]')].filter(shown);
      const option = (t) => options().find((o) => norm(o.textContent).includes(t));
      const area = () => [...main().querySelectorAll('textarea')].find(shown) || null;
      const visibleText = (t) => [...document.querySelectorAll('body *')].some((e) => e.children.length === 0 && shown(e) && norm(e.textContent).includes(t));
      const roleText = (r, root) => [...(root || document).querySelectorAll('[role=' + r + ']')].filter(shown).map((e) => norm(e.textContent)).filter(Boolean);
      window.__h = { norm, name, shown, ctl, find, main, options, option, area, visibleText, roleText };
    })();`;
    const app = {
      async h(expr) { await evalJs(helpers); return evalJs(expr); },
      async until(expr, what, ms = 8000) {
        const end = Date.now() + ms;
        let last = null;
        while (Date.now() < end) { try { if (await app.h(expr)) return; } catch (e) { last = e; } await sleep(100); }
        assert.fail(`timed out waiting for ${what}${last ? ` (${last.message})` : ''}`);
      },
      async goto() {
        await S('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
        await app.until(`document.readyState === 'complete' && !!document.querySelector('nav')`, 'the sidebar to render', 15000);
        await sleep(300);
      },
      // Prefer an exact name inside main: a bare prefix match would also hit the sidebar's "Save or ask" for "Save".
      click: (label) => app.h(`(() => { const all = __h.find(${JSON.stringify(label)}); const inMain = all.filter((x) => __h.main().contains(x)); const e = inMain.find((x) => __h.name(x) === ${JSON.stringify(label)}) || inMain[0] || all.find((x) => __h.name(x) === ${JSON.stringify(label)}) || all[0]; if (!e) return false; e.click(); return true; })()`),
      async typeInEditor(t) {
        assert.ok(await app.h(`(() => { const a = __h.area(); if (!a) return false; a.focus(); a.setSelectionRange(a.value.length, a.value.length); return true; })()`), 'no visible text area in the editor');
        await S('Input.insertText', { text: t });
        await sleep(150);
      },
      calls: (cmd) => evalJs(`window.__calls.filter((c) => c.cmd === ${JSON.stringify(cmd)})`),
      async close() {
        const done = new Promise((r) => { if (proc.exitCode !== null) r(); else proc.once('exit', r); });
        try { await Promise.race([send('Browser.close'), sleep(2000)]); } catch { /* closing */ }
        await Promise.race([done, sleep(5000)]);
        try { ws.close(); } catch { /* closed */ }
        if (proc.exitCode === null) proc.kill('SIGKILL');
        await sleep(200);
        rmSync(dir, { recursive: true, force: true });
      },
    };
    return app;
  } catch (error) {
    proc.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

async function withApp(mode, fn) {
  const app = await openApp(mode);
  try { await app.goto(); await fn(app); } finally { await app.close(); }
}
const UI = { timeout: 180000, skip: SKIP_UI };

async function openNotes(app) {
  assert.ok(await app.click('Notes'), "no sidebar item named 'Notes'");
  await sleep(300);
}
async function openNotesList(app) {
  await openNotes(app);
  await app.until(`!!__h.option('Groceries') && !!__h.option('Meeting plan')`, 'the note list with both notes');
}
async function openNote(app, title, body) {
  assert.ok(await app.h(`(() => { const o = __h.option(${JSON.stringify(title)}); if (!o) return false; o.click(); return true; })()`), `no row for ${title}`);
  await app.until(`!!__h.area() && __h.area().value === ${JSON.stringify(body)}`, `the editor to show the body of ${title}`);
}
const BODY1 = '# Groceries\nBuy oat milk\n**bold words**';
const BODY2 = 'Meeting plan\nAgenda for Monday';

// AC7: "The sidebar Notes item opens a Notes screen (main.ts route) built only from ui/src/ds parts: the note list
// via createListbox (title, sub = labels, meta = last changed, selected = open note), with buildEmptyState,
// buildErrorState and buildSkeleton/buildBusyLine for empty, error and loading states."
test('AC7: the sidebar Notes item opens a note list (a listbox) with each note title and its label names', UI, () =>
  withApp('ok', async (app) => {
    await openNotesList(app);
    const r = await app.h(`(() => ({
      listbox: [...__h.main().querySelectorAll('[role=listbox]')].some(__h.shown),
      one: __h.norm(__h.option('Groceries').textContent),
      two: __h.norm(__h.option('Meeting plan').textContent),
      rows: __h.options().length,
    }))()`);
    assert.ok(r.listbox, 'the note list is not a listbox');
    assert.equal(r.rows, 2, 'the list must show exactly the two notes');
    assert.match(r.one, /Work/, `the Groceries row does not show its label: ${r.one}`);
    assert.match(r.two, /Projects/, `the Meeting plan row does not show its label: ${r.two}`);
    assert.doesNotMatch(r.one, /Buy oat milk/, 'the row shows the whole body instead of a title');
    const lists = await app.calls('list_labelled_notes');
    assert.ok(lists.length >= 1, 'the screen did not call list_labelled_notes');
  }));

test('AC7: the open note is the selected row of the list', UI, () =>
  withApp('ok', async (app) => {
    await openNotesList(app);
    await openNote(app, 'Meeting plan', BODY2);
    const sel = await app.h(`__h.options().map((o) => [__h.norm(o.textContent).slice(0, 12), o.getAttribute('aria-selected')])`);
    assert.deepEqual(sel.filter(([, s]) => s === 'true').map(([t]) => t), [sel.find(([t]) => t.startsWith('Meeting'))[0]], `selected rows: ${JSON.stringify(sel)}`);
  }));

test('AC7: with no notes the screen shows an empty state, not a blank list', UI, () =>
  withApp('empty', async (app) => {
    await openNotes(app);
    await app.until(`__h.visibleText('No notes')`, "an empty state that says there are no notes ('No notes yet.')");
    assert.equal(await app.h('__h.options().length'), 0);
  }));

test('AC7: when the list fails the screen shows the error message, not a blank screen', UI, () =>
  withApp('listfail', async (app) => {
    await openNotes(app);
    await app.until(`__h.visibleText('The notes could not be read.')`, 'the error state with the core message');
    assert.equal(await app.h('__h.options().length'), 0);
  }));

test('AC7: while the list loads the screen shows a busy line, then the notes', UI, () =>
  withApp('slow', async (app) => {
    await openNotes(app);
    await app.until(`__h.roleText('status', __h.main()).length > 0 && __h.options().length === 0`, 'a busy line (status with words) in the screen while the list loads');
    await app.h('window.__releaseList && window.__releaseList()');
    await app.until(`!!__h.option('Groceries')`, 'the notes after loading');
  }));

// AC8: "The editor uses createSegmented (Read/Edit), createTextarea in createField, Save (primary) and Cancel via
// createButton with setButtonBusy; a buildPill 'Unsaved changes' (warn) shows when dirty; a failed save shows
// buildBanner tone bad; a successful save shows a toast; Cancel restores the text from before the edit (vitest)."
test('AC8: the editor has Read and Edit modes, a labelled text area, Save and Cancel', UI, () =>
  withApp('ok', async (app) => {
    await openNotesList(app);
    await openNote(app, 'Groceries', BODY1);
    const r = await app.h(`(() => {
      const radios = [...__h.main().querySelectorAll('[role=radio]')].filter(__h.shown).map((e) => __h.name(e));
      const a = __h.area();
      const labelled = !!(a.labels && a.labels.length) || !!a.getAttribute('aria-label') || !!a.getAttribute('aria-labelledby');
      return { radios, labelled, save: __h.find('Save').length, cancel: __h.find('Cancel').length };
    })()`);
    assert.ok(r.radios.includes('Read') && r.radios.includes('Edit'), `no Read/Edit choice: ${r.radios}`);
    assert.ok(r.labelled, 'the text area has no label');
    assert.ok(r.save >= 1, 'no Save button');
    assert.ok(r.cancel >= 1, 'no Cancel button');
  }));

test("AC8: editing shows 'Unsaved changes' and Cancel restores the text from before the edit", UI, () =>
  withApp('ok', async (app) => {
    await openNotesList(app);
    await openNote(app, 'Groceries', BODY1);
    assert.equal(await app.h(`__h.visibleText('Unsaved changes')`), false, "'Unsaved changes' shows before any edit");
    await app.typeInEditor('\nand bread');
    await app.until(`__h.visibleText('Unsaved changes')`, "the 'Unsaved changes' mark after an edit");
    assert.ok(await app.click('Cancel'), 'no Cancel button');
    await app.until(`__h.area() && __h.area().value === ${JSON.stringify(BODY1)}`, 'Cancel to restore the text from before the edit');
    await app.until(`!__h.visibleText('Unsaved changes')`, "the 'Unsaved changes' mark to go after Cancel");
    assert.equal((await app.calls('save_labelled_note')).length, 0, 'Cancel saved the note');
  }));

test('AC8: Save sends the edited text with the note labels, shows a toast and clears the dirty mark', UI, () =>
  withApp('ok', async (app) => {
    await openNotesList(app);
    await openNote(app, 'Groceries', BODY1);
    await app.typeInEditor('\nand bread');
    await app.h(`window.__statusBefore = __h.roleText('status')`);
    assert.ok(await app.click('Save'), 'no Save button');
    await app.until(`window.__calls.some((c) => c.cmd === 'save_labelled_note')`, 'a save_labelled_note call');
    const call = (await app.calls('save_labelled_note'))[0];
    const sent = JSON.stringify(call.args);
    assert.ok(sent.includes('note-1'), `the save does not name the open note: ${sent}`);
    assert.ok(sent.includes(JSON.stringify(`${BODY1}\nand bread`).slice(1, -1)), `the save does not send the edited text: ${sent}`);
    assert.ok(sent.includes('lab-work'), `the save does not send the note labels: ${sent}`);
    await app.until(`__h.roleText('status').some((t) => !window.__statusBefore.includes(t))`, 'a toast (a new status message) after the save');
    await app.until(`!__h.visibleText('Unsaved changes')`, "the 'Unsaved changes' mark to go after the save");
  }));

test('AC8: a failed save shows an error banner', UI, () =>
  withApp('ok', async (app) => {
    await openNotesList(app);
    await openNote(app, 'Groceries', BODY1);
    await app.h('window.__saveFail = true');
    await app.typeInEditor('\nand bread');
    assert.equal(await app.h(`__h.roleText('alert', __h.main()).length`), 0, 'an error banner shows before the save');
    assert.ok(await app.click('Save'), 'no Save button');
    await app.until(`__h.roleText('alert', __h.main()).length > 0`, 'an error banner (role alert) after the failed save');
  }));

test('AC8: Save is busy while saving, so a second click sends no second save', UI, () =>
  withApp('ok', async (app) => {
    await openNotesList(app);
    await openNote(app, 'Groceries', BODY1);
    await app.h('window.__holdSave = true');
    await app.typeInEditor('\nand bread');
    assert.ok(await app.click('Save'), 'no Save button');
    await app.until(`window.__calls.some((c) => c.cmd === 'save_labelled_note')`, 'the first save call');
    await app.h(`(() => { const b = [...__h.main().querySelectorAll('button')].find((e) => /\\bSave\\b/.test(__h.name(e))); if (b) b.click(); })()`);
    await sleep(300);
    assert.equal((await app.calls('save_labelled_note')).length, 1, 'a second click while saving sent a second save');
    await app.h('window.__holdSave = false; window.__releaseSave && window.__releaseSave()');
    await app.until(`!__h.visibleText('Unsaved changes')`, 'the save to finish');
  }));

// AC9: "Leaving a note with unsaved changes (open another note or leave the screen) asks with createConfirmDialog
// (Keep editing / Discard changes) (vitest)."
test('AC9: opening another note with unsaved changes asks; Keep editing stays, Discard changes opens the other note', UI, () =>
  withApp('ok', async (app) => {
    await openNotesList(app);
    await openNote(app, 'Groceries', BODY1);
    await app.typeInEditor('\nand bread');
    await app.h(`__h.option('Meeting plan').click()`);
    await app.until(`__h.find('Keep editing').length > 0 && __h.find('Discard changes').length > 0`, 'a confirmation with Keep editing and Discard changes');
    assert.ok(await app.click('Keep editing'));
    await app.until(`__h.find('Discard changes').length === 0`, 'the confirmation to close');
    assert.equal(await app.h('__h.area().value'), `${BODY1}\nand bread`, 'Keep editing lost the edit');
    await app.h(`__h.option('Meeting plan').click()`);
    await app.until(`__h.find('Discard changes').length > 0`, 'the confirmation again');
    assert.ok(await app.click('Discard changes'));
    await app.until(`__h.area() && __h.area().value === ${JSON.stringify(BODY2)}`, 'the other note to open after Discard changes');
    assert.equal((await app.calls('save_labelled_note')).length, 0, 'leaving saved the note');
  }));

test('AC9: leaving the screen with unsaved changes asks; Keep editing stays on the note, Discard changes leaves', UI, () =>
  withApp('ok', async (app) => {
    await openNotesList(app);
    await openNote(app, 'Groceries', BODY1);
    await app.typeInEditor('\nand bread');
    assert.ok(await app.click('Ideas'), "no sidebar item named 'Ideas'");
    await app.until(`__h.find('Keep editing').length > 0 && __h.find('Discard changes').length > 0`, 'a confirmation before leaving the screen');
    assert.ok(await app.click('Keep editing'));
    await app.until(`__h.find('Discard changes').length === 0`, 'the confirmation to close');
    await sleep(300);
    assert.equal(await app.h('__h.area() ? __h.area().value : null'), `${BODY1}\nand bread`, 'Keep editing did not keep the note open with its edit');
    assert.ok(await app.click('Ideas'));
    await app.until(`__h.find('Discard changes').length > 0`, 'the confirmation again');
    assert.ok(await app.click('Discard changes'));
    await app.until(`!__h.area() && /Ideas/.test(__h.main().innerText)`, 'the Ideas screen after Discard changes');
  }));

test('AC9: a note with no changes is left without asking', UI, () =>
  withApp('ok', async (app) => {
    await openNotesList(app);
    await openNote(app, 'Groceries', BODY1);
    await app.h(`__h.option('Meeting plan').click()`);
    await app.until(`__h.area() && __h.area().value === ${JSON.stringify(BODY2)}`, 'the other note to open at once');
    assert.equal(await app.h(`__h.find('Discard changes').length`), 0, 'asked although nothing changed');
  }));

// AC10: "No label tree, label picker, Markdown renderer or sanitiser, temporary style, own element or stand-in text is
// added; the Read segment shows nothing until #128; ..."
test('AC10: the Read segment shows nothing, and the screen has no label tree, picker or stand-in text', UI, () =>
  withApp('ok', async (app) => {
    await openNotesList(app);
    await openNote(app, 'Groceries', BODY1);
    assert.ok(await app.click('Read'), 'no Read choice');
    await sleep(300);
    const r = await app.h(`(() => {
      const m = __h.main();
      const leaves = [...m.querySelectorAll('*')].filter((e) => e.children.length === 0 && __h.shown(e) && e.tagName !== 'TEXTAREA').map((e) => __h.norm(e.textContent));
      return {
        body: leaves.filter((t) => t.includes('Buy oat milk') || t.includes('bold words')),
        area: !!__h.area(),
        rendered: [...m.querySelectorAll('strong, b, h1, script')].filter((e) => /bold words|Groceries/.test(e.textContent) || e.tagName === 'SCRIPT').length,
        tree: [...m.querySelectorAll('[role=tree], [role=treeitem]')].length,
        combo: [...m.querySelectorAll('[role=combobox]')].filter(__h.shown).length,
        soon: /coming soon|\\bsoon\\b/i.test(m.innerText),
      };
    })()`);
    assert.deepEqual(r.body, [], 'the Read segment shows the note text');
    assert.equal(r.area, false, 'the text area is still shown in Read mode');
    assert.equal(r.rendered, 0, 'the note Markdown was rendered');
    assert.equal(r.tree, 0, 'a label tree is on the screen');
    assert.equal(r.combo, 0, 'a label picker is on the screen');
    assert.equal(r.soon, false, 'the screen has stand-in text');
    assert.ok(await app.click('Edit'), 'no Edit choice');
    await app.until(`__h.area() && __h.area().value === ${JSON.stringify(BODY1)}`, 'Edit to show the text again');
  }));

// ================================================================ AC11 and AC12: pull request and full check
const NESTED = process.env.MNEMO_NESTED ? 'nested run (inside npm test; run this file without MNEMO_NESTED)' : false;
const BRANCH = 'feat/33-note-01-notes-with-nested-labels';

// AC11: the pull request text. Owner-confirmed for #33: "record in the PR exactly which acceptance criteria wait
// for #126, #127 and #128 (no label tree, no label picker on save, Read mode shows nothing until #128)".
test('AC11: the pull request names the criteria that wait for #126, #127 and #128', { timeout: 120000, skip: NESTED }, () => {
  const r = spawnSync('gh', ['pr', 'list', '--head', BRANCH, '--state', 'all', '--json', 'body', '--limit', '1'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `gh pr list failed: ${r.stderr}`);
  const prs = JSON.parse(r.stdout || '[]');
  assert.equal(prs.length, 1, `no pull request for ${BRANCH}`);
  const body = prs[0].body || '';
  assert.match(body, /acceptance criteri/i, 'the pull request does not talk about acceptance criteria');
  for (const [n, what] of [['126', /label tree/i], ['127', /label picker|picker/i], ['128', /\bRead\b/]]) {
    assert.match(body, new RegExp(`#${n}\\b`), `the pull request does not name #${n}`);
    assert.match(body, what, `the pull request does not say what waits for #${n}`);
  }
});

// AC12: npm run check and the screenshots. Owner-confirmed for #33: "Verify: npm run check passes". The Ubuntu
// light and dark screenshots are not checked here.
test('AC12: npm run check passes', { timeout: 1800000, skip: NESTED }, () => {
  const r = spawnSync('npm', ['run', 'check'], { cwd: ROOT, encoding: 'utf8', timeout: 1790000, maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, (r.stdout || '').slice(-2000) + (r.stderr || '').slice(-2000));
});
