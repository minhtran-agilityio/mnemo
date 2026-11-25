// Acceptance tests for #25 [BM-01] Save a link with summary and tags.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/bm-01-save-link.test.mjs
// Black box, three parts, from the ticket and the owner's "Confirmed decisions (owner, 2026-11-25)":
// 1. Data. Migration 0009 is applied with node:sqlite (Node 24) to a database built by 0001 to 0008 that
//    holds one bookmark. Each test uses its own temporary database.
// 2. Rust. The owner's check is `cargo test --manifest-path src-tauri/Cargo.toml bookmark_save`: it must
//    exit 0 and pass the four fake-runner cases (success, unreadable, schema error, timeout). Other Rust
//    tests are found by the words of the criterion in their names in `cargo test --lib -- --list` (tests
//    that existed before this ticket, listed in helpers/ai-02-base-rust-tests.txt and
//    helpers/ai-03-earlier-rust-tests.json, do not count) and must pass in one `cargo test --lib` run.
//    The fetch limits are looked for in the `fetch` submodule of `ai` (decision 2: `ai::fetch::`).
// 3. UI. The Vite build is served on a private port and headless Chrome is driven through the DevTools
//    protocol, by role, label and visible text (same harness as note-01 and ai-02). The Tauri bridge is an
//    in-page fake that answers the two commands of the public interface, save_link(url) and
//    summarize_bookmark(id, pastedText?), and records every call. Assumed result shape (not fixed by the
//    ticket): both commands resolve with the bookmark in its final state, in the #14 Bookmark shape plus
//    site, summaryStatus (also summary_status), tags (names) and labels ({ id, name }). The fake also
//    sends that bookmark as the payload of every event whose name holds "bookmark", "link" or "save", and
//    answers any list command whose name holds "bookmark" with a page of the saved bookmarks.
//    UI tests skip when no Chrome is found (set MNEMO_CHROME).
// Not tested here (manual): AC1 "in the desktop app" with 5 real public links and real Claude, the AC6 spot
// check of 5 summaries by the owner, and AC7 "Works on Mac and on Ubuntu" (CI on both systems).
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

// ================================================================ Data: migration 0009
const migFile = (prefix) => {
  const f = existsSync(MIG) ? readdirSync(MIG).find((n) => n.startsWith(prefix) && n.endsWith('.sql')) : null;
  assert.ok(f, `migration ${prefix}_*.sql is missing in src-tauri/migrations`);
  return readFileSync(join(MIG, f), 'utf8');
};
const PREVIOUS = ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008'];

// A database built by migrations 0001 to 0008 with one live bookmark, then migrated by 0009.
function withDb(fn) {
  return () => {
    const dir = mkdtempSync(join(tmpdir(), 'mnemo-bm01-'));
    const db = new DatabaseSync(join(dir, 'mnemo.db'));
    try {
      for (const f of PREVIOUS) db.exec(migFile(f));
      db.exec(`INSERT INTO bookmark(id, created_at, updated_at, url, title, summary, reason, reason_is_guess)
               VALUES('bm-old','${U}','${U}','https://example.org/old','Old page','Old summary','Old reason',1);`);
      db.exec(migFile('0009'));
      fn(db);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
const cols = (db, t) => db.prepare(`SELECT name, "notnull" AS nn FROM pragma_table_info(?) ORDER BY cid`).all(t);
const indexFirsts = (db, t) => db.prepare('SELECT name FROM pragma_index_list(?)').all(t)
  .map((i) => db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno LIMIT 1').get(i.name)?.name);
const addBookmark = (db, id, status, site = null, summary = null) =>
  db.prepare(`INSERT INTO bookmark(id, created_at, updated_at, url, title, summary, reason, reason_is_guess, site, summary_status)
              VALUES(?, ?, ?, ?, NULL, ?, NULL, 0, ?, ?)`).run(id, U, U, `https://example.org/${id}`, summary, site, status);

// Decision 8: "New bookmark columns in 0009: `site TEXT NULL` and `summary_status` (`pending`, `reading`,
// `unreadable`, `ai_off`, `done`)." Decision 7: "Tags: in migration `0009`, a `bookmark_label` table shaped
// like `note_label`, with tags as top-level `label` rows."
test('AC2: migration 0009 runs on a database built by 0001 to 0008 and keeps the existing bookmark', withDb((db) => {
  const row = db.prepare("SELECT url, title, summary, reason, reason_is_guess FROM bookmark WHERE id='bm-old' AND deleted_at IS NULL").get();
  assert.deepEqual({ ...row }, { url: 'https://example.org/old', title: 'Old page', summary: 'Old summary', reason: 'Old reason', reason_is_guess: 1 });
}));

// AC2: "A link the app cannot read is saved with a null summary and shows "Paste the text"."
test('AC2: a bookmark can be stored with a null summary, a null site and each summary_status (pending, reading, unreadable, ai_off, done)', withDb((db) => {
  const c = cols(db, 'bookmark');
  const site = c.find((x) => x.name === 'site');
  assert.ok(site, 'bookmark has no site column');
  assert.equal(site.nn, 0, 'bookmark.site must be nullable (site TEXT NULL)');
  assert.ok(c.some((x) => x.name === 'summary_status'), 'bookmark has no summary_status column');
  for (const s of ['pending', 'reading', 'unreadable', 'ai_off', 'done']) addBookmark(db, `bm-${s}`, s);
  const unreadable = db.prepare("SELECT summary, summary_status, site FROM bookmark WHERE id='bm-unreadable'").get();
  assert.deepEqual({ ...unreadable }, { summary: null, summary_status: 'unreadable', site: null });
}));

// AC1: "5 public links give 5 cards with a summary and tags in the desktop app." (decision 7: tags live in
// `bookmark_label`, shaped like `note_label`, with tags as top-level `label` rows)
test('AC1: bookmark_label links a bookmark to a top-level label with the base fields', withDb((db) => {
  const c = cols(db, 'bookmark_label').map((x) => x.name);
  for (const n of ['id', 'bookmark_id', 'label_id', 'created_at', 'updated_at', 'deleted_at']) assert.ok(c.includes(n), `bookmark_label lacks ${n}`);
  assert.equal(cols(db, 'bookmark_label').find((x) => x.name === 'deleted_at').nn, 0, 'deleted_at must be nullable');
  addBookmark(db, 'bm-new', 'done', 'example.org', 'A summary.');
  db.exec(`INSERT INTO label(id, created_at, updated_at, name, parent_id) VALUES('lab-rust','${U}','${U}','rust',NULL);`);
  db.exec(`INSERT INTO bookmark_label(id, bookmark_id, label_id, created_at, updated_at) VALUES('bl-1','bm-new','lab-rust','${U}','${U}');`);
  const n = db.prepare(`SELECT count(*) AS n FROM bookmark_label bl JOIN label l ON l.id = bl.label_id
                        WHERE bl.bookmark_id='bm-new' AND l.parent_id IS NULL AND l.name='rust'`).get().n;
  assert.equal(n, 1);
}));

test('AC1: like note_label, bookmark_label holds one link per bookmark and label and has indexes on both sides', withDb((db) => {
  addBookmark(db, 'bm-new', 'done', 'example.org', 'A summary.');
  db.exec(`INSERT INTO label(id, created_at, updated_at, name, parent_id) VALUES('lab-rust','${U}','${U}','rust',NULL);`);
  db.exec(`INSERT INTO bookmark_label(id, bookmark_id, label_id, created_at, updated_at) VALUES('bl-1','bm-new','lab-rust','${U}','${U}');`);
  assert.throws(() => db.exec(`INSERT INTO bookmark_label(id, bookmark_id, label_id, created_at, updated_at) VALUES('bl-2','bm-new','lab-rust','${U}','${U}');`),
    /UNIQUE/i, 'a second link between the same bookmark and label must be refused (note_label has UNIQUE (note_id, label_id))');
  const firsts = indexFirsts(db, 'bookmark_label');
  assert.ok(firsts.includes('bookmark_id'), `no index on bookmark_label starting with bookmark_id: ${firsts}`);
  assert.ok(firsts.includes('label_id'), `no index on bookmark_label starting with label_id: ${firsts}`);
}));

// ================================================================ Rust tests
const RUST = { timeout: 1200000 };
const EARLIER = new Set([
  ...readFileSync(p('tests', 'acceptance', 'helpers', 'ai-02-base-rust-tests.txt'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean),
  ...JSON.parse(readFileSync(p('tests', 'acceptance', 'helpers', 'ai-03-earlier-rust-tests.json'), 'utf8')),
]);
const cache = new Map();
function cargo(...args) {
  const key = args.join(' ');
  if (!cache.has(key)) {
    const r = spawnSync('cargo', ['test', '--manifest-path', CARGO_TOML, ...args], { encoding: 'utf8', timeout: 580000, maxBuffer: 64 * 1024 * 1024 });
    const passed = [...(r.stdout || '').matchAll(/^test (\S+) \.\.\. ok$/gm)].map((m) => m[1]);
    cache.set(key, { status: r.status, signal: r.signal, out: `${r.stdout}\n${r.stderr}`, passed, stdout: r.stdout || '' });
  }
  const res = cache.get(key);
  assert.notEqual(res.signal, 'SIGTERM', `cargo test ${key} did not finish (hang)`);
  assert.equal(res.status, 0, `cargo test --manifest-path src-tauri/Cargo.toml ${key} exit ${res.status}:\n${res.out.slice(-4000)}`);
  return res;
}
const leaf = (n) => n.split('::').pop().toLowerCase();
const newTests = () => cargo('--lib', '--', '--list').stdout.split('\n').filter((l) => l.endsWith(': test'))
  .map((l) => l.slice(0, -': test'.length)).filter((n) => !EARLIER.has(n));
/** New tests in `pool` whose name matches every regex must exist and pass in one `cargo test --lib`. */
function proved(pool, res, what) {
  const hits = pool.filter((n) => res.every((re) => re.test(n.toLowerCase())));
  assert.ok(hits.length > 0, `no new Rust test checks ${what} (names matching ${res.join(' and ')}). Candidates: ${JSON.stringify(pool)}`);
  const passed = new Set(cargo('--lib').passed);
  assert.ok(hits.some((n) => passed.has(n)), `the tests for ${what} do not pass: ${hits.join(', ')}`);
}

// AC5: "The save runs through the AI runner. Unit tests use the fake runner for: success, unreadable page,
// schema error, timeout." Decision 12: "`cargo test --manifest-path src-tauri/Cargo.toml bookmark_save`
// passes the four fake-runner cases (success, unreadable, schema error, timeout)".
const gate = () => cargo('bookmark_save');
const gateCase = (re, what) => {
  const passed = gate().passed.filter((n) => n.includes('bookmark_save'));
  assert.ok(passed.some((n) => re.test(leaf(n)) || re.test(n.toLowerCase())), `no passing bookmark_save test for ${what} (name matching ${re}). Passed: ${JSON.stringify(passed)}`);
};
test('AC5: cargo test bookmark_save exits 0 and runs at least the four fake-runner cases', RUST, () => {
  const passed = gate().passed.filter((n) => n.includes('bookmark_save'));
  assert.ok(passed.length >= 4, `cargo test bookmark_save passed ${passed.length} tests: ${JSON.stringify(passed)}`);
});
test('AC5: a bookmark_save test passes for success', RUST, () => gateCase(/success|succeed|happy|summary_and_tags/, 'success'));
test('AC5: a bookmark_save test passes for an unreadable page', RUST, () => gateCase(/unreadable|cannot_read|cant_read|not_read|link_only/, 'an unreadable page'));
test('AC5: a bookmark_save test passes for a schema error', RUST, () => gateCase(/schema/, 'a schema error'));
test('AC5: a bookmark_save test passes for a timeout', RUST, () => gateCase(/time_?out/, 'a timeout'));

// AC2: "A link the app cannot read is saved with a null summary and shows "Paste the text"."
// Decision 5: "15 s timeout, at most 5 redirects, http and https only, a 2 MB body cap, at most 20k characters of
// text to Claude, only `text/html` and `text/plain` (anything else is saved as link only), under 200 characters of
// text means unreadable (link only)." Decision 6: "refuse localhost and private IP ranges; save those links as link only."
const fetchTests = () => newTests().filter((n) => n.startsWith('ai::fetch::'));
test('AC2: a passing ai::fetch test refuses localhost and private addresses', RUST, () =>
  proved(fetchTests(), [/localhost|private|loopback|local_addr|internal|127_0_0_1|10_0|192_168/], 'that localhost and private IPs are refused'));
test('AC2: a passing ai::fetch test refuses links that are not http or https', RUST, () =>
  proved(fetchTests(), [/scheme|ftp|file|non_http|not_http|only_http|https?_only|javascript|data_url/], 'that only http and https are fetched'));
test('AC2: a passing ai::fetch test refuses content that is not text/html or text/plain', RUST, () =>
  proved(fetchTests(), [/content_?type|mime|pdf|not_html|image|binary|octet|json/], 'that only text/html and text/plain are read'));
test('AC2: a passing ai::fetch test treats text under 200 characters as unreadable', RUST, () =>
  proved(fetchTests(), [/200|short|too_little|under|empty|unreadable/], 'that under 200 characters is unreadable'));
test('AC2: a passing ai::fetch test caps the body at 2 MB', RUST, () =>
  proved(fetchTests(), [/2_?mb|body|too_big|too_large|size|cap/], 'the 2 MB body cap'));
test('AC2: a passing ai::fetch test stops after 5 redirects', RUST, () =>
  proved(fetchTests(), [/redirect/], 'the redirect limit'));
test('AC2: a passing ai::fetch test gives up at the timeout', RUST, () =>
  proved(fetchTests(), [/time_?out|slow/], 'the fetch timeout'));
test('AC2: a passing ai::fetch test sends at most 20k characters of text to Claude', RUST, () =>
  proved(fetchTests(), [/20_?k|20000|20_000|truncat|cut|char.*(limit|max|most)|(limit|max|most).*char/], 'the 20k character limit'));

// AC3: "Pasted text gives a summary for that card."
test('AC3: a passing Rust test makes a summary from pasted text', RUST, () =>
  proved(newTests(), [/past/, /summar|bookmark/], 'a summary from pasted text (summarize_bookmark with pastedText)'));

// AC4: "With the AI switch off, Save still works and stores the link."
test('AC4: a passing Rust test saves a link with the AI switch off', RUST, () =>
  proved(newTests(), [/ai_off|ai_is_off|ai_disabled|ai_switch_off|ai_switched_off|switch_off/, /save|bookmark|link|store/], 'a save with AI off'));

// ================================================================ UI: the Bookmarks route
const CHROME = [process.env.MNEMO_CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((c) => c && existsSync(c));
const SKIP_UI = CHROME ? false : 'no Chrome found (set MNEMO_CHROME)';
let distDir = null;
let server = null;
let port = 0;
let buildError = null;

before(async () => {
  if (SKIP_UI) return;
  distDir = mkdtempSync(join(tmpdir(), 'mnemo-bm01-dist-'));
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

// The fake answer for link n (1 to 5) when the page was read and summarized.
const SUMMARY = (n) => `Summary of page ${n} about topic ${n}.`;
const REASON = (n) => `It may matter for plan ${n}.`;
const TAGS = (n) => [`tag${n}a`, `tag${n}b`];
const TITLE = (n) => `Page title ${n}`;
const PASTED = 'This is the text of the page that the owner pasted by hand. '.repeat(5);
const PASTED_SUMMARY = 'Summary made from the pasted text.';

// In-page fake of the Tauri bridge. MODE: 'ok' (AI on, each page is read and summarized), 'unreadable' (AI on,
// no page can be read), 'ai_off' (the AI switch is off). A link without http:// or https:// is refused by
// save_link with a validation error.
const bridgeScript = (mode) => `(() => {
  const MODE = ${JSON.stringify(mode)};
  window.__calls = [];
  const T = '2026-11-25T10:00:00Z';
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
      const payload = { ...b, bookmark: b, bookmarkId: b.id, stage: b.summaryStatus, status: b.summaryStatus };
      if (f) try { f({ event: l.event, id: l.id, payload }); } catch (e) { /* the page handles it */ }
    }
  };
  const withStatus = (b, s, extra) => Object.assign(b, { summaryStatus: s, summary_status: s, updatedAt: T }, extra || {});
  const tagged = (b, tags) => Object.assign(b, { tags, labels: tags.map((t) => ({ id: 'lab-' + t, name: t, parentId: null })) });
  const save = async (url) => {
    if (!/^https?:\\/\\/\\S+$/i.test(url || '')) throw { code: 'validation', message: 'This is not a web link.' };
    const n = store.length + 1;
    const b = tagged({ id: 'bm-' + n, createdAt: T, updatedAt: T, deletedAt: null, url, title: null, site: 'example.org',
      summary: null, reason: null, reasonIsGuess: false, summaryStatus: 'pending', summary_status: 'pending' }, []);
    store.unshift(b);
    emit(b);
    if (MODE === 'ai_off') { withStatus(b, 'ai_off'); emit(b); return JSON.parse(JSON.stringify(b)); }
    withStatus(b, 'reading'); emit(b);
    await new Promise((r) => setTimeout(r, 50));
    if (MODE === 'unreadable') { withStatus(b, 'unreadable'); emit(b); return JSON.parse(JSON.stringify(b)); }
    withStatus(b, 'done', { title: 'Page title ' + n, summary: 'Summary of page ' + n + ' about topic ' + n + '.',
      reason: 'It may matter for plan ' + n + '.', reasonIsGuess: true });
    tagged(b, ['tag' + n + 'a', 'tag' + n + 'b']);
    emit(b);
    return JSON.parse(JSON.stringify(b));
  };
  const summarize = async (id, pasted) => {
    const b = store.find((x) => x.id === id);
    if (!b) throw { code: 'not_found', message: 'No such bookmark.' };
    if (typeof pasted === 'string' && pasted.length > 0) {
      withStatus(b, 'done', { summary: ${JSON.stringify(PASTED_SUMMARY)}, reason: 'It may matter later.', reasonIsGuess: true });
      tagged(b, ['pasted']);
    } else {
      withStatus(b, MODE === 'ai_off' ? 'ai_off' : 'pending');
    }
    emit(b);
    return JSON.parse(JSON.stringify(b));
  };
  const invoke = async (cmd, args) => {
    window.__calls.push({ cmd, args: JSON.parse(JSON.stringify(args ?? null)) });
    if (cmd === 'save_link') return save(find(args, 'url'));
    if (cmd === 'summarize_bookmark') return summarize(find(args, 'id'), find(args, 'pastedText') ?? find(args, 'pasted_text'));
    if (cmd === 'plugin:event|listen') {
      const id = listeners.length + 1;
      listeners.push({ id, event: find(args, 'event') || '', handler: find(args, 'handler') });
      return id;
    }
    if (cmd.startsWith('plugin:event')) return 1;
    if (cmd === 'get_bookmark') return JSON.parse(JSON.stringify(store.find((x) => x.id === find(args, 'id')) || null));
    if (/bookmark/i.test(cmd) && /list/i.test(cmd)) return { items: JSON.parse(JSON.stringify(store)), next: null };
    if (cmd === 'get_ai_control' || /ai_control|ai_enabled/.test(cmd)) {
      const on = MODE !== 'ai_off';
      return { enabled: on, warnAt: 60, pauseAt: 95, pause: null, backgroundGate: on ? { kind: 'allow' } : { kind: 'deny', reason: 'off' }, warn: false, usage: { kind: 'runs', today: 0, week: 0 } };
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

async function openApp(mode) {
  assert.equal(buildError, null, buildError ?? '');
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-bm01-chrome-'));
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
      const ctl = () => [...document.querySelectorAll('a, button, [role=link], [role=button], [role=menuitem], [role=tab]')];
      const find = (n) => ctl().filter((el) => { const l = name(el); return (l === n || l.startsWith(n + ' ')) && shown(el); });
      const main = () => document.querySelector('main') || document.body;
      const text = () => norm(main().innerText) + ' ' + [...document.querySelectorAll('[role=dialog], dialog')].filter(shown).map((d) => norm(d.innerText)).join(' ');
      const labelled = (el) => !!(el.labels && el.labels.length) || !!el.getAttribute('aria-label') || !!el.getAttribute('aria-labelledby');
      // The link box: a visible single-line text box in the screen.
      const linkBox = () => [...main().querySelectorAll('input')].filter((e) => !['hidden', 'checkbox', 'radio', 'button', 'submit'].includes(e.type) && shown(e))[0] || null;
      const area = () => [...document.querySelectorAll('textarea')].find(shown) || null;
      const roleText = (r) => [...document.querySelectorAll('[role=' + r + ']')].filter(shown).map((e) => norm(e.textContent)).filter(Boolean);
      // The button that goes with an element: the visible button closest to it in the DOM tree whose name matches re.
      const nearButton = (el, re, not) => {
        let best = null; let bestDepth = 1e9;
        for (const b of [...document.querySelectorAll('button, [role=button]')].filter(shown)) {
          const n = name(b);
          if (!re.test(n) || (not && not.test(n))) continue;
          let a = el; let d = 0;
          while (a && !a.contains(b)) { a = a.parentElement; d++; }
          if (a && d < bestDepth) { best = b; bestDepth = d; }
        }
        return best;
      };
      window.__h = { norm, name, shown, ctl, find, main, text, labelled, linkBox, area, roleText, nearButton };
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
      // Prefer an exact name inside main: a prefix match would also hit the sidebar's "Save or ask" for "Save".
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

async function withApp(mode, fn) {
  const app = await openApp(mode);
  try { await app.goto(); await fn(app); } finally { await app.close(); }
}
const UI = { timeout: 180000, skip: SKIP_UI };

// Decision 9: "a minimal Bookmarks route with the link box and a card list".
async function openBookmarks(app) {
  assert.ok(await app.click('Bookmarks'), "no sidebar item named 'Bookmarks'");
  await app.until('!!__h.linkBox()', 'a link box (a text box) on the Bookmarks screen');
}
// Paste a link in the link box and press Save.
async function saveLink(app, url) {
  assert.ok(await app.h('(() => { const b = __h.linkBox(); b.focus(); b.select(); return true; })()'), 'no link box');
  await app.insert(url);
  assert.ok(await app.click('Save'), "no 'Save' button on the Bookmarks screen");
}
const URL = (n) => `https://example.org/page-${n}`;

// AC1: "5 public links give 5 cards with a summary and tags in the desktop app."
// (The desktop app with 5 real public links is the owner's manual check; here the core is the fake bridge.)
test('AC1: the Bookmarks screen has a labelled link box and a Save button', UI, () =>
  withApp('ok', async (app) => {
    await openBookmarks(app);
    assert.ok(await app.h('__h.labelled(__h.linkBox())'), 'the link box has no label');
    assert.ok(await app.h(`__h.find('Save').some((b) => __h.main().contains(b))`), "no 'Save' button in the screen");
  }));

test('AC1: 5 links saved in the link box give 5 cards, each with its summary and its tags', UI, () =>
  withApp('ok', async (app) => {
    await openBookmarks(app);
    for (let n = 1; n <= 5; n++) {
      await saveLink(app, URL(n));
      await app.until(`__h.text().includes(${JSON.stringify(SUMMARY(n))})`, `the card of link ${n} with its summary`);
    }
    const calls = await app.calls('save_link');
    assert.deepEqual(calls.map((c) => JSON.stringify(c.args)).map((s) => [1, 2, 3, 4, 5].find((n) => s.includes(URL(n)))), [1, 2, 3, 4, 5],
      `save_link was not called once per link with its url: ${JSON.stringify(calls)}`);
    const seen = await app.h(`(() => { const t = __h.text(); return ${JSON.stringify([1, 2, 3, 4, 5].map((n) => [SUMMARY(n), ...TAGS(n)]))}.map((xs) => xs.filter((x) => !t.includes(x))); })()`);
    assert.deepEqual(seen, [[], [], [], [], []], `missing summary or tags per card: ${JSON.stringify(seen)}`);
    const once = await app.h(`(() => { const t = __h.text(); return ${JSON.stringify([1, 2, 3, 4, 5].map(SUMMARY))}.map((s) => t.split(s).length - 1); })()`);
    assert.deepEqual(once, [1, 1, 1, 1, 1], `each link must give exactly one card: ${JSON.stringify(once)}`);
  }));

// Ticket: "The card shows: title, site, summary, tags, the reason marked as a guess, and the saved date."
test('AC1: a card shows the title and the site of the page', UI, () =>
  withApp('ok', async (app) => {
    await openBookmarks(app);
    await saveLink(app, URL(1));
    await app.until(`__h.text().includes(${JSON.stringify(SUMMARY(1))})`, 'the card with its summary');
    const t = await app.h('__h.text()');
    assert.ok(t.includes(TITLE(1)), `the card does not show the title: ${t.slice(0, 600)}`);
    assert.ok(t.includes('example.org'), `the card does not show the site: ${t.slice(0, 600)}`);
  }));

// Decision 11: "UI states (prototype v89): ... invalid URL error."
test('AC1: a link that is not a web link shows an error and gives no card', UI, () =>
  withApp('ok', async (app) => {
    await openBookmarks(app);
    await saveLink(app, 'not a link');
    await app.until(`__h.roleText('alert').length > 0 || __h.linkBox().getAttribute('aria-invalid') === 'true'`, 'an error (an alert, or the link box marked invalid)');
    const t = await app.h('__h.text()');
    assert.ok(!/Summary of page/.test(t), 'a card appeared for an invalid link');
  }));

// AC2: "A link the app cannot read is saved with a null summary and shows "Paste the text"."
test('AC2: a link the app cannot read gives a card with the link, no summary, and a Paste the text button', UI, () =>
  withApp('unreadable', async (app) => {
    await openBookmarks(app);
    await saveLink(app, URL(1));
    await app.until(`__h.find('Paste the text').length > 0`, "a 'Paste the text' button on the link-only card");
    const t = await app.h('__h.text()');
    assert.ok(t.includes('example.org'), `the link-only card does not show the link or site: ${t.slice(0, 600)}`);
    assert.equal((await app.calls('save_link')).length, 1, 'save_link was not called once');
  }));

// AC3: "Pasted text gives a summary for that card."
test('AC3: Paste the text sends the pasted text for that bookmark and the card shows the new summary', UI, () =>
  withApp('unreadable', async (app) => {
    await openBookmarks(app);
    await saveLink(app, URL(1));
    await app.until(`__h.find('Paste the text').length > 0`, "a 'Paste the text' button");
    assert.ok(await app.click('Paste the text'));
    await app.until('!!__h.area()', 'a text area for the page text');
    assert.ok(await app.h('(() => { const a = __h.area(); a.focus(); return __h.labelled(a); })()'), 'the text area for the page text has no label');
    await app.insert(PASTED);
    assert.ok(await app.h(`(() => { const b = __h.nearButton(__h.area(), /summar|save|submit|done|use|send/i, /cancel|later|paste the text/i); if (!b) return false; b.click(); return true; })()`),
      'no button next to the text area to make the summary');
    await app.until(`window.__calls.some((c) => c.cmd === 'summarize_bookmark')`, 'a summarize_bookmark call');
    const call = (await app.calls('summarize_bookmark'))[0];
    const sent = JSON.stringify(call.args);
    assert.ok(sent.includes('"bm-1"'), `summarize_bookmark does not name the bookmark: ${sent}`);
    assert.ok(sent.includes(PASTED.trim().slice(0, 60)), `summarize_bookmark does not send the pasted text: ${sent.slice(0, 400)}`);
    await app.until(`__h.text().includes(${JSON.stringify(PASTED_SUMMARY)})`, 'the summary made from the pasted text on the card');
  }));

// AC4: "With the AI switch off, Save still works and stores the link." Ticket: "With AI off or paused, the
// bookmark is saved as link only and marked "no summary yet", with a button to summarize later."
// Decision 11: "AI off with "Summarize later"".
test('AC4: with the AI switch off, Save still calls save_link and the card says no summary yet with Summarize later', UI, () =>
  withApp('ai_off', async (app) => {
    await openBookmarks(app);
    await saveLink(app, URL(1));
    await app.until(`__h.find('Summarize later').length > 0`, "a 'Summarize later' button on the card");
    assert.equal((await app.calls('save_link')).length, 1, 'Save did not call save_link with AI off');
    const t = await app.h('__h.text()');
    assert.match(t, /no summary yet/i, `the card is not marked "no summary yet": ${t.slice(0, 600)}`);
    assert.ok(t.includes('example.org'), `the card does not show the link or site: ${t.slice(0, 600)}`);
  }));

test('AC4: Summarize later asks the core to summarize that bookmark, without pasted text', UI, () =>
  withApp('ai_off', async (app) => {
    await openBookmarks(app);
    await saveLink(app, URL(1));
    await app.until(`__h.find('Summarize later').length > 0`, "a 'Summarize later' button");
    assert.ok(await app.click('Summarize later'));
    await app.until(`window.__calls.some((c) => c.cmd === 'summarize_bookmark')`, 'a summarize_bookmark call');
    const call = (await app.calls('summarize_bookmark'))[0];
    const sent = JSON.stringify(call.args);
    assert.ok(sent.includes('"bm-1"'), `summarize_bookmark does not name the bookmark: ${sent}`);
    const pasted = call.args && (call.args.pastedText ?? call.args.pasted_text);
    assert.ok(pasted === undefined || pasted === null, `Summarize later sent pasted text: ${sent}`);
  }));

// AC6: "The reason is shown as a guess. The summary contains nothing that is not in the page text (spot check by
// the owner on 5 links)." (The spot check is manual.)
test('AC6: the card shows the reason, marked as a guess', UI, () =>
  withApp('ok', async (app) => {
    await openBookmarks(app);
    await saveLink(app, URL(1));
    await app.until(`__h.text().includes(${JSON.stringify(REASON(1))})`, 'the reason on the card');
    assert.match(await app.h('__h.text()'), /guess/i, 'the reason is not marked as a guess');
  }));
