// Acceptance tests for #28 [LIB-02] Duplicate check when saving a link.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/lib-02-duplicate.test.mjs
// Black box, three parts, from the ticket and the owner's "Confirmed decisions (owner, 2026-11-26)":
// 1. Data. Migration 0010 is applied with node:sqlite (Node 24) to a database built by 0001 to 0009 that
//    holds one bookmark. Each test uses its own temporary database. Decision 5: "a `compare_key` column with
//    a non-unique partial index `WHERE deleted_at IS NULL`. ... Existing duplicates stay as they are."
// 2. Rust. Decision 8: the owner's check is `cargo test --manifest-path src-tauri/Cargo.toml duplicate`. It
//    must exit 0, and each criterion is found by its words in the names of the tests that run passed in that
//    run. Tests that existed before this ticket (helpers/lib-02-earlier-rust-tests.txt) do not count.
// 3. UI. The Vite build is served on a private port and headless Chrome is driven through the DevTools
//    protocol, by role, label and visible text (same harness as bm-01). The Tauri bridge is an in-page fake
//    of the public interface: save_link(url) resolves with a SaveResult; for a link already saved it resolves
//    with the old bookmark and `alreadySaved: true` (decision 6), adds no row and sends no event.
//    list_bookmark_cards answers with the saved bookmarks. UI tests skip when no Chrome is found (MNEMO_CHROME).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { join, dirname, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const p = (...a) => join(ROOT, ...a);
const MIG = p('src-tauri', 'migrations');
const CARGO_TOML = p('src-tauri', 'Cargo.toml');
const U = '2026-01-01T00:00:00Z';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ================================================================ Data: migration 0010
const migFile = (prefix) => {
  const f = existsSync(MIG) ? readdirSync(MIG).find((n) => n.startsWith(prefix) && n.endsWith('.sql')) : null;
  assert.ok(f, `migration ${prefix}_*.sql is missing in src-tauri/migrations`);
  return readFileSync(join(MIG, f), 'utf8');
};
const PREVIOUS = ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009'];

// A database built by migrations 0001 to 0009 with one live bookmark, then migrated by 0010.
function withDb(fn) {
  return () => {
    const dir = mkdtempSync(join(tmpdir(), 'mnemo-lib02-'));
    const db = new DatabaseSync(join(dir, 'mnemo.db'));
    try {
      for (const f of PREVIOUS) db.exec(migFile(f));
      db.exec(`INSERT INTO bookmark(id, created_at, updated_at, url, title, summary, reason, reason_is_guess, site, summary_status)
               VALUES('bm-old','${U}','${U}','https://example.org/old','Old page','Old summary','Old reason',1,'example.org','done');`);
      db.exec(migFile('0010'));
      fn(db);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
const colNames = (db, t) => db.prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid').all(t).map((c) => c.name);
// Indexes on bookmark whose first column is compare_key, with their partial flag, uniqueness and SQL.
const keyIndexes = (db) => db.prepare('SELECT name, "unique" AS uq, partial FROM pragma_index_list(?)').all('bookmark')
  .filter((i) => db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno LIMIT 1').get(i.name)?.name === 'compare_key')
  .map((i) => ({ ...i, sql: db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(i.name)?.sql || '' }));
const addKeyed = (db, id, key, deletedAt = null) =>
  db.prepare(`INSERT INTO bookmark(id, created_at, updated_at, deleted_at, url, title, summary, reason, reason_is_guess, site, summary_status, compare_key)
              VALUES(?, ?, ?, ?, ?, NULL, NULL, NULL, 0, 'example.org', 'done', ?)`).run(id, U, U, deletedAt, `https://example.org/${id}`, key);

// Decision 5: "Storage: a `compare_key` column ... Old rows are filled by a Rust step at open."
test('AC1: migration 0010 runs on a database built by 0001 to 0009, keeps the existing bookmark and adds bookmark.compare_key', withDb((db) => {
  const row = db.prepare("SELECT url, title, summary FROM bookmark WHERE id='bm-old' AND deleted_at IS NULL").get();
  assert.deepEqual({ ...row }, { url: 'https://example.org/old', title: 'Old page', summary: 'Old summary' });
  assert.ok(colNames(db, 'bookmark').includes('compare_key'), 'bookmark has no compare_key column');
}));

// Ticket: "The compare key is stored with each bookmark, so the lookup is one indexed query."
// Decision 5: "a non-unique partial index `WHERE deleted_at IS NULL` ... Existing duplicates stay as they are."
test('AC1: an index on bookmark.compare_key exists, and it is not unique so two live rows may share a key', withDb((db) => {
  const idx = keyIndexes(db);
  assert.ok(idx.length > 0, 'no index on bookmark starting with compare_key');
  assert.ok(idx.some((i) => i.uq === 0), `the compare_key index must not be unique: ${JSON.stringify(idx)}`);
  addKeyed(db, 'bm-a', 'example.org/same');
  assert.doesNotThrow(() => addKeyed(db, 'bm-b', 'example.org/same'), 'two live bookmarks with one compare_key are refused');
}));

// AC5: "A soft-deleted bookmark does not block a new save of the same link."
// Decision 5: "a non-unique partial index `WHERE deleted_at IS NULL`".
test('AC5: the compare_key index is partial and covers only live rows (WHERE deleted_at IS NULL)', withDb((db) => {
  const idx = keyIndexes(db);
  assert.ok(idx.length > 0, 'no index on bookmark starting with compare_key');
  assert.ok(idx.some((i) => i.partial === 1 && /\bWHERE\b[\s\S]*deleted_at["`\]]?\s+IS\s+NULL/i.test(i.sql)),
    `no partial compare_key index WHERE deleted_at IS NULL: ${JSON.stringify(idx)}`);
}));

// ================================================================ Rust: cargo test duplicate
const RUST = { timeout: 1200000 };
const EARLIER = new Set(readFileSync(p('tests', 'acceptance', 'helpers', 'lib-02-earlier-rust-tests.txt'), 'utf8')
  .split('\n').map((l) => l.trim()).filter(Boolean));
let gateRun = null;
// Decision 8: "Verify: `cargo test --manifest-path src-tauri/Cargo.toml duplicate`".
function gate() {
  if (!gateRun) {
    const r = spawnSync('cargo', ['test', '--manifest-path', CARGO_TOML, 'duplicate'], { encoding: 'utf8', timeout: 580000, maxBuffer: 64 * 1024 * 1024 });
    const passed = [...(r.stdout || '').matchAll(/^test (\S+) \.\.\. ok$/gm)].map((m) => m[1]);
    gateRun = { status: r.status, signal: r.signal, out: `${r.stdout}\n${r.stderr}`, passed };
  }
  assert.notEqual(gateRun.signal, 'SIGTERM', 'cargo test duplicate did not finish (hang)');
  assert.equal(gateRun.status, 0, `cargo test --manifest-path src-tauri/Cargo.toml duplicate exit ${gateRun.status}:\n${gateRun.out.slice(-4000)}`);
  return gateRun.passed.filter((n) => !EARLIER.has(n));
}
/** A new test that passed in `cargo test duplicate` has a name that matches every check (regex or function). */
function proved(checks, what) {
  const pool = gate();
  const hit = (n) => checks.every((c) => (typeof c === 'function' ? c(n.toLowerCase()) : c.test(n.toLowerCase())));
  assert.ok(pool.some(hit), `no new passing test in 'cargo test duplicate' checks ${what}. New passing tests: ${JSON.stringify(pool)}`);
}

// AC1: "Saving the same link twice shows "already saved" and adds nothing."
test('AC1: cargo test duplicate exits 0 and a new passing test saves the same link twice and keeps one bookmark', RUST, () =>
  proved([/twice|again|same_link|already|second/], 'a second save of the same link'));

// Decision 5: "Old rows are filled by a Rust step at open."
test('AC1: a new passing duplicate test fills the compare key of bookmarks saved before (the step at open)', RUST, () =>
  proved([/fill|old|existing|earlier|open|migrat/], 'old rows filled with their compare key at open'));

// Decision 7: "An edit that changes a link to one already saved is allowed; it only updates the key."
test('AC1: a new passing duplicate test lets an edit change a link to one already saved', RUST, () =>
  proved([/edit|update|chang/], 'an edit to a link already saved'));

// AC2: "5 planted duplicates are caught: with and without `www.`, with a `utm_` parameter, with a fragment,
// with a trailing slash, with a different letter case in the host."
test('AC2: planted duplicate with and without www. is caught', RUST, () =>
  proved([/www/], 'the www. duplicate'));
test('AC2: planted duplicate with a utm_ parameter is caught', RUST, () =>
  proved([/utm/], 'the utm_ duplicate'));
test('AC2: planted duplicate with a fragment is caught', RUST, () =>
  proved([/fragment|hash|anchor/], 'the fragment duplicate'));
test('AC2: planted duplicate with a trailing slash is caught', RUST, () =>
  proved([/slash/], 'the trailing slash duplicate'));
test('AC2: planted duplicate with a different letter case in the host is caught', RUST, () =>
  proved([/host|domain/, /case|upper|lower|capital/], 'the host letter case duplicate'));
// Decision 1: "The compare key strips only `utm_*`, `fbclid` and `gclid`".
test('AC2: links that differ only by fbclid or by gclid are caught as duplicates', RUST, () => {
  proved([/fbclid/], 'the fbclid duplicate');
  proved([/gclid/], 'the gclid duplicate');
});

// AC3: "Two different pages on the same site are not treated as duplicates."
test('AC3: a new passing duplicate test keeps two different pages on the same site apart', RUST, () =>
  proved([/different|other|two|distinct|not_a_dup|not_dup/, /page|path/], 'two pages on one site'));
// Decision 4: "The path keeps its letter case."
test('AC3: a new passing duplicate test keeps the letter case of the path', RUST, () =>
  proved([/path/, /case|upper|lower|capital/], 'the path letter case'));
// Decision 1: "... and keeps every other query parameter."
test('AC3: a new passing duplicate test keeps the other query parameters in the key', RUST, () =>
  proved([/param|query/, /other|keep|kept/], 'other query parameters kept'));

// AC4: "The duplicate check starts no AI run." Decision 6: "`save_link` returns the old bookmark with
// `alreadySaved: true` and starts no AI run."
test('AC4: a new passing duplicate test shows a duplicate save starts no AI run', RUST, () =>
  proved([/ai|run|summar/, /\bno_|_no_|_not_|without|never|skip|zero/], 'no AI run for a duplicate'));

// AC5: "A soft-deleted bookmark does not block a new save of the same link."
test('AC5: a new passing duplicate test saves a link again after its bookmark was soft-deleted', RUST, () =>
  proved([/delet/], 'a soft-deleted bookmark that does not block a save'));

// Decision 2: "http and https are different links."
test('AC6: a new passing duplicate test keeps http and https links apart', RUST, () =>
  proved([(n) => /scheme/.test(n) || (n.match(/http/g) || []).length >= 2], 'http and https as different links'));

// Decision 3: "A different query-parameter order makes a different link."
test('AC7: a new passing duplicate test keeps links whose query parameters are in another order apart', RUST, () =>
  proved([/order/], 'query-parameter order'));

// ================================================================ UI: the Bookmarks screen
const CHROME = [process.env.MNEMO_CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((c) => c && existsSync(c));
const SKIP_UI = CHROME ? false : 'no Chrome found (set MNEMO_CHROME)';
let distDir = null;
let server = null;
let port = 0;
let buildError = null;

before(async () => {
  if (SKIP_UI) return;
  distDir = mkdtempSync(join(tmpdir(), 'mnemo-lib02-dist-'));
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

const SUMMARY = (n) => `Summary of page ${n} about topic ${n}.`;
const URL = (n) => `https://example.org/page-${n}`;

// In-page fake of the Tauri bridge. A new link is stored, read and summarized (AI on). A link that is already
// saved (same url, live) resolves with the old bookmark and alreadySaved: true, adds no row and sends no event.
const bridgeScript = () => `(() => {
  window.__calls = [];
  const T = '2026-11-26T10:00:00Z';
  const store = [];
  const listeners = [];
  const callbacks = new Map();
  let cb = 1;
  const find = (o, k) => {
    if (!o || typeof o !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(o, k)) return o[k];
    for (const v of Object.values(o)) { const r = find(v, k); if (r !== undefined) return r; }
    return undefined;
  };
  const emit = (b) => {
    for (const l of listeners) {
      if (!/bookmark|link|save/i.test(l.event)) continue;
      const f = callbacks.get(l.handler);
      if (f) try { f({ event: l.event, id: l.id, payload: JSON.parse(JSON.stringify(b)) }); } catch (e) { /* the page handles it */ }
    }
  };
  const copy = (b) => JSON.parse(JSON.stringify(b));
  const save = async (url) => {
    if (!/^https?:\\/\\/\\S+$/i.test(url || '')) throw { code: 'validation', message: 'This is not a web link.' };
    const old = store.find((x) => x.url === url && !x.deletedAt);
    if (old) return { ...copy(old), alreadySaved: true };
    const n = store.length + 1;
    const b = { id: 'bm-' + n, createdAt: T, updatedAt: T, deletedAt: null, url, title: null, site: 'example.org',
      summary: null, reason: null, reasonIsGuess: false, summaryStatus: 'pending', tags: [], labels: [] };
    store.unshift(b);
    emit(b);
    Object.assign(b, { summaryStatus: 'reading' }); emit(b);
    await new Promise((r) => setTimeout(r, 50));
    Object.assign(b, { summaryStatus: 'done', title: 'Page title ' + n, summary: 'Summary of page ' + n + ' about topic ' + n + '.',
      reason: 'It may matter for plan ' + n + '.', reasonIsGuess: true, tags: ['tag' + n], labels: [{ id: 'lab-' + n, name: 'tag' + n }] });
    emit(b);
    return { ...copy(b), alreadySaved: false };
  };
  const invoke = async (cmd, args) => {
    window.__calls.push({ cmd, args: JSON.parse(JSON.stringify(args ?? null)) });
    if (cmd === 'save_link') return save(find(args, 'url'));
    if (cmd === 'summarize_bookmark') {
      const b = store.find((x) => x.id === find(args, 'id'));
      if (!b) throw { code: 'not_found', message: 'No such bookmark.' };
      return copy(b);
    }
    if (cmd === 'plugin:event|listen') {
      const id = listeners.length + 1;
      listeners.push({ id, event: find(args, 'event') || '', handler: find(args, 'handler') });
      return id;
    }
    if (cmd.startsWith('plugin:event')) return 1;
    if (cmd === 'get_bookmark') return copy(store.find((x) => x.id === find(args, 'id')) || null);
    if (cmd === 'list_bookmark_cards' || (/bookmark/i.test(cmd) && /list/i.test(cmd))) return { items: copy(store), next: null };
    if (cmd === 'get_ai_control' || /ai_control|ai_enabled/.test(cmd)) {
      return { enabled: true, warnAt: 60, pauseAt: 95, pause: null, backgroundGate: { kind: 'allow' }, warn: false, usage: { kind: 'runs', today: 0, week: 0 } };
    }
    if (/health/i.test(cmd)) return { state: 'ready', message: 'Claude Code is installed and signed in.' };
    if (/mode/i.test(cmd)) return 'real';
    if (/setting/i.test(cmd)) return null;
    if (/ping/i.test(cmd)) return 'pong';
    if (/version/i.test(cmd)) return '0.1.0';
    if (/^list_/.test(cmd)) return { items: [], next: null };
    return null;
  };
  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback: (f) => { const i = cb++; callbacks.set(i, f); return i; },
    unregisterCallback: (i) => callbacks.delete(i),
    convertFileSrc: (s) => s,
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.isTauri = true;
})();`;

async function openApp() {
  assert.equal(buildError, null, buildError ?? '');
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-lib02-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
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
    await S('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await S('Page.addScriptToEvaluateOnNewDocument', { source: bridgeScript() });
    const evalJs = async (expr) => {
      const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`page error: ${JSON.stringify(r.exceptionDetails).slice(0, 500)}`);
      return r.result.value;
    };
    const helpers = `(() => {
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
      const name = (el) => norm(el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && el.getAttribute('aria-labelledby').split(' ').map((i) => document.getElementById(i)?.textContent).join(' ')) || el.textContent || el.getAttribute('title'));
      const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const ctl = () => [...document.querySelectorAll('a, button, [role=link], [role=button], [role=menuitem], [role=tab]')];
      const find = (n) => ctl().filter((el) => { const l = name(el); return (l === n || l.startsWith(n + ' ')) && shown(el); });
      const main = () => document.querySelector('main') || document.body;
      const text = () => norm(main().innerText);
      const linkBox = () => [...main().querySelectorAll('input')].filter((e) => !['hidden', 'checkbox', 'radio', 'button', 'submit'].includes(e.type) && shown(e))[0] || null;
      // The smallest visible element in the screen whose text holds every string in 'all'.
      const holder = (all) => {
        let best = null;
        for (const el of main().querySelectorAll('*')) {
          if (!shown(el)) continue;
          const t = norm(el.innerText);
          if (all.every((s) => (s instanceof RegExp ? s.test(t) : t.includes(s))) && (!best || best.contains(el))) best = el;
        }
        return best;
      };
      window.__h = { norm, name, shown, ctl, find, main, text, linkBox, holder };
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
      click: (label) => app.h(`(() => { const all = __h.find(${JSON.stringify(label)}); const inMain = all.filter((x) => __h.main().contains(x)); const e = inMain.find((x) => __h.name(x) === ${JSON.stringify(label)}) || inMain[0] || all.find((x) => __h.name(x) === ${JSON.stringify(label)}) || all[0]; if (!e) return false; e.click(); return true; })()`),
      async insert(t) { await S('Input.insertText', { text: t }); await sleep(100); },
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

async function withApp(fn) {
  const app = await openApp();
  try { await app.goto(); await fn(app); } finally { await app.close(); }
}
const UI = { timeout: 180000, skip: SKIP_UI };

async function openBookmarks(app) {
  assert.ok(await app.click('Bookmarks'), "no sidebar item named 'Bookmarks'");
  await app.until('!!__h.linkBox()', 'a link box (a text box) on the Bookmarks screen');
}
async function saveLink(app, url) {
  assert.ok(await app.h('(() => { const b = __h.linkBox(); b.focus(); b.select(); return true; })()'), 'no link box');
  await app.insert(url);
  assert.ok(await app.click('Save'), "no 'Save' button on the Bookmarks screen");
}
async function saveNew(app, n) {
  await saveLink(app, URL(n));
  await app.until(`__h.text().includes(${JSON.stringify(SUMMARY(n))})`, `the card of link ${n} with its summary`);
}
const count = (app, s) => app.h(`__h.text().split(${JSON.stringify(s)}).length - 1`);
const ALREADY = /already saved/i;

// AC1: "Saving the same link twice shows "already saved" and adds nothing."
test('AC1: saving the same link twice shows "Already saved" and adds no card', UI, () =>
  withApp(async (app) => {
    await openBookmarks(app);
    await saveNew(app, 1);
    assert.doesNotMatch(await app.h('__h.text()'), ALREADY, 'the first save already says "Already saved"');
    await saveLink(app, URL(1));
    await app.until(`${ALREADY}.test(__h.text())`, 'an "Already saved" line after the second save');
    assert.equal((await app.calls('save_link')).length, 2, 'the second Save did not call save_link');
    await sleep(500);
    assert.equal(await count(app, SUMMARY(1)), 1, 'a second card was added for a link that is already saved');
  }));

// Decision 6: "The screen shows that card on top with "Already saved" and adds no row."
test('AC1: the old card is shown on top of the list with its "Already saved" line', UI, () =>
  withApp(async (app) => {
    await openBookmarks(app);
    await saveNew(app, 1);
    await saveNew(app, 2);
    await saveLink(app, URL(1));
    await app.until(`${ALREADY}.test(__h.text())`, 'an "Already saved" line after saving link 1 again');
    await sleep(500);
    const t = await app.h('__h.text()');
    assert.equal(await count(app, SUMMARY(1)), 1, 'a second card was added for link 1');
    assert.equal(await count(app, SUMMARY(2)), 1, 'the card of link 2 is gone or doubled');
    assert.ok(t.indexOf(SUMMARY(1)) < t.indexOf(SUMMARY(2)), `the card of link 1 is not on top: ${t.slice(0, 800)}`);
    const card = await app.h(`(() => { const e = __h.holder([${ALREADY}, ${JSON.stringify(SUMMARY(1))}]); return e ? __h.norm(e.innerText) : null; })()`);
    assert.ok(card, 'no element holds both "Already saved" and the card of link 1');
    assert.ok(!card.includes(SUMMARY(2)), `the "Already saved" line is not on the card of link 1 alone: ${card.slice(0, 600)}`);
  }));

// AC4: "The duplicate check starts no AI run." Decision 6: "`save_link` returns the old bookmark with
// `alreadySaved: true` and starts no AI run."
test('AC4: after a duplicate save the screen shows "Already saved" and asks for no summary', UI, () =>
  withApp(async (app) => {
    await openBookmarks(app);
    await saveNew(app, 1);
    await saveLink(app, URL(1));
    await app.until(`${ALREADY}.test(__h.text())`, 'an "Already saved" line after the second save');
    await sleep(500);
    assert.deepEqual(await app.calls('summarize_bookmark'), [], 'the screen asked for a summary of a link that is already saved');
  }));
