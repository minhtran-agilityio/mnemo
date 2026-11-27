// Acceptance tests for #27 [BM-03] Bookmarks page: folders, 3 views, search.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/bm-03-bookmarks-page.test.mjs
// Black box, three parts, from the ticket and the owner's "Confirmed decisions" (2026-11-27, "accept all works"):
// 1. Rust. Decision 8: "`cargo test --manifest-path src-tauri/Cargo.toml bookmark` pass[es]". It must exit 0,
//    and decision 5 (`open_link(id)`) is found by its words in the names of the tests that passed in that run.
//    Tests that existed before this ticket (helpers/bm-03-earlier-rust-tests.txt) do not count.
// 2. Vitest. Decision 8: "`npx vitest run ui/src/screens/bookmarks` ... pass", and decision 9: "a vitest
//    render-time budget". Tests that existed before (helpers/bm-03-earlier-vitest-tests.txt) do not count.
// 3. UI. The Vite build is served on a private port and headless Chrome is driven through the DevTools
//    protocol, by role, label and visible text (same harness as bm-01 and lib-02). The Tauri bridge is an
//    in-page fake of the public interface in ui/src/shared/api.ts, seeded with 500 bookmarks (decision 8):
//    list_bookmark_cards answers pages of at most `limit` items, newest first, with a `next` cursor;
//    list_folders answers the folders with their full counts, Unsorted last; get_setting / set_setting keep
//    values in the page; open_link(id) is recorded. UI tests skip when no Chrome is found (MNEMO_CHROME).
//    Assumptions (names the ticket does not fix): the three view controls are named "List", "Cards" and
//    "Compact" and show which one is chosen by aria-pressed, aria-checked, aria-selected or aria-current;
//    the search box is a text box whose label, placeholder or role names "Search"; a sidebar row reads as
//    "<folder name> <count>" (also "Needs a look <count>"); each bookmark shows its title in every view; the
//    open_link arguments carry the bookmark id under the key `id`.
// Not tested here (manual): AC5 "scrolls without a visible delay on both machines" (decision 9: "a manual
// scroll on both machines recorded as evidence"), and AC6 "The page looks like the prototype in light and
// dark themes" (a visual comparison with the prototype; it cannot be checked blind).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { join, dirname, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const p = (...a) => join(ROOT, ...a);
const CARGO_TOML = p('src-tauri', 'Cargo.toml');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = (f) => new Set(readFileSync(p('tests', 'acceptance', 'helpers', f), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean));

// ================================================================ Rust: cargo test bookmark
const RUST = { timeout: 1200000 };
const EARLIER_RUST = lines('bm-03-earlier-rust-tests.txt');
let cargoRun = null;
function cargoGate() {
  if (!cargoRun) {
    const r = spawnSync('cargo', ['test', '--manifest-path', CARGO_TOML, 'bookmark'], { encoding: 'utf8', timeout: 580000, maxBuffer: 64 * 1024 * 1024 });
    const passed = [...(r.stdout || '').matchAll(/^test (\S+) \.\.\. ok$/gm)].map((m) => m[1]);
    cargoRun = { status: r.status, signal: r.signal, out: `${r.stdout}\n${r.stderr}`, passed };
  }
  assert.notEqual(cargoRun.signal, 'SIGTERM', 'cargo test bookmark did not finish (hang)');
  assert.equal(cargoRun.status, 0, `cargo test --manifest-path src-tauri/Cargo.toml bookmark exit ${cargoRun.status}:\n${cargoRun.out.slice(-4000)}`);
  return cargoRun.passed.filter((n) => !EARLIER_RUST.has(n));
}
function provedRust(checks, what) {
  const pool = cargoGate();
  const hit = (n) => checks.every((c) => c.test(n.toLowerCase()));
  assert.ok(pool.some(hit), `no new passing test in 'cargo test bookmark' checks ${what}. New passing tests: ${JSON.stringify(pool)}`);
}

// Decision 5: "a new core command `open_link(id)`, which opens only that bookmark's stored http(s) URL through
// the Rust opener." Decision 8: "`cargo test --manifest-path src-tauri/Cargo.toml bookmark` pass[es]".
test('Decision 5: cargo test bookmark exits 0 and a new passing test opens the stored http(s) link of a bookmark (open_link)', RUST, () =>
  provedRust([/open/, /link|url/, /http|stored|its_|own|bookmark/], 'open_link opening the stored http(s) URL'));

// Decision 5: "opens only that bookmark's stored http(s) URL".
test('Decision 5: a new passing bookmark test shows open_link refuses a link that is not http(s)', RUST, () =>
  provedRust([/open/, /link|url/, /\bno_|_no_|_not_|never|refus|reject|non_http|not_http|javascript|file|ftp|scheme|error|unknown|missing/],
    'open_link refusing what is not a stored http(s) link'));

// ================================================================ Vitest: ui/src/screens/bookmarks
const EARLIER_UI = lines('bm-03-earlier-vitest-tests.txt');
let vitestRun = null;
function vitestGate() {
  if (!vitestRun) {
    const dir = mkdtempSync(join(tmpdir(), 'mnemo-bm03-vitest-'));
    const out = join(dir, 'report.json');
    const r = spawnSync('npx', ['vitest', 'run', '--no-color', '--reporter=default', '--reporter=json', `--outputFile.json=${out}`, 'ui/src/screens/bookmarks'], { cwd: ROOT, encoding: 'utf8', timeout: 400000, maxBuffer: 64 * 1024 * 1024 });
    let passed = [];
    if (existsSync(out)) {
      const rep = JSON.parse(readFileSync(out, 'utf8'));
      passed = rep.testResults.flatMap((f) => f.assertionResults).filter((a) => a.status === 'passed').map((a) => a.title);
    }
    rmSync(dir, { recursive: true, force: true });
    vitestRun = { status: r.status, out: `${r.stdout}\n${r.stderr}`, passed };
  }
  assert.equal(vitestRun.status, 0, `npx vitest run ui/src/screens/bookmarks exit ${vitestRun.status}:\n${vitestRun.out.slice(-4000)}`);
  return vitestRun.passed.filter((t) => !EARLIER_UI.has(t));
}

// AC5: "With 500 bookmarks the page scrolls without a visible delay on both machines."
// Decision 9: "render every row, no virtual scrolling; a vitest render-time budget".
test('AC5: npx vitest run ui/src/screens/bookmarks exits 0 with a new passing render-time budget test for 500 bookmarks', { timeout: 420000 }, () => {
  const fresh = vitestGate();
  assert.ok(fresh.some((t) => /500/.test(t) && /render|draw|budget|time|\bms\b|millisecond|second|fast/i.test(t)),
    `no new passing bookmarks test names a render-time budget with 500 bookmarks. New tests: ${JSON.stringify(fresh)}`);
});

// ================================================================ UI: the Bookmarks page
const CHROME = [process.env.MNEMO_CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((c) => c && existsSync(c));
const SKIP_UI = CHROME ? false : 'no Chrome found (set MNEMO_CHROME)';
let distDir = null;
let server = null;
let port = 0;
let buildError = null;

before(async () => {
  if (SKIP_UI) return;
  distDir = mkdtempSync(join(tmpdir(), 'mnemo-bm03-dist-'));
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

// ---------------------------------------------------------------- the 500 seeded bookmarks
const N = 500;
const pad = (n) => String(n).padStart(4, '0');
const TITLE = (n) => `Item ${pad(n)} title`;
const FOLDERS = [
  { id: 'f-research', name: 'Research', isDefault: false },
  { id: 'f-work', name: 'Work', isDefault: false },
  { id: 'f-recipes', name: 'Recipes', isDefault: false },
  { id: 'f-unsorted', name: 'Unsorted', isDefault: true },
];
// n % 10: 0-3 Research (200), 4-6 Work (150), 7-8 Recipes (100), 9 Unsorted (50).
const folderOf = (n, oneFolder) => (oneFolder ? FOLDERS[0] : FOLDERS[[0, 0, 0, 0, 1, 1, 1, 2, 2, 3][n % 10]]);
const NULL_STATUSES = ['pending', 'reading', 'unreadable', 'ai_off', 'not_reached'];
const isNull = (n) => n % 25 === 0; // 20 bookmarks with a null summary, in every not-done status.
const SUMMARY_WORD = 'zephyrine'; // only in the summary of 137 (Recipes)
const TAG_WORD = 'quokka'; // only in the tags of 242 (Research)
const TITLE_WORD = 'marmalade'; // only in the title of 311 (Research)
const VI_NFD = 'quán phở ngon'.normalize('NFD'); // summary of 401 (Research), stored decomposed
const VI_PLAIN = 'quan pho ngon'; // summary of 402 (Research), no diacritics
function seed(oneFolder = false) {
  const T0 = Date.parse('2026-11-27T12:00:00Z');
  const out = [];
  for (let n = 1; n <= N; n++) {
    const f = folderOf(n, oneFolder);
    const nul = isNull(n);
    let summary = `Summary text number ${pad(n)}.`;
    if (n === 137) summary = `Summary text number ${pad(n)} with ${SUMMARY_WORD} inside.`;
    if (n === 401) summary = `Summary text number ${pad(n)}: ${VI_NFD}.`;
    if (n === 402) summary = `Summary text number ${pad(n)}: ${VI_PLAIN}.`;
    const tags = n === 242 ? [TAG_WORD] : [`tag${n % 7}`];
    const t = new Date(T0 - n * 60000).toISOString();
    out.push({
      id: `bm-${pad(n)}`, createdAt: t, updatedAt: t, deletedAt: null, url: `https://example.org/item-${pad(n)}`,
      title: n === 311 ? `${TITLE(n)} ${TITLE_WORD}` : TITLE(n), site: 'example.org',
      summary: nul ? null : summary, reason: nul ? null : `It may matter for plan ${n}.`, reasonIsGuess: !nul,
      summaryStatus: nul ? NULL_STATUSES[(n / 25) % NULL_STATUSES.length] : 'done',
      tags: nul ? [] : tags, labels: nul ? [] : tags.map((x) => ({ id: `lab-${x}`, name: x })),
      folderId: f.id, folder: f.name, folderReason: null, folderIsGuess: false,
    });
  }
  return out;
}
const ALL = seed();
const num = (id) => Number(id.slice(3));
const inFolder = (name, rows = ALL) => rows.filter((b) => b.folder === name).map((b) => num(b.id)); // newest first
const NULL_IDS = ALL.filter((b) => b.summary === null).map((b) => num(b.id));

// In-page fake of the Tauri bridge (command names from ui/src/shared/api.ts).
const bridgeScript = ({ rows, settings }) => `(() => {
  window.__calls = [];
  const rows = ${JSON.stringify(rows)};
  const folders = ${JSON.stringify(FOLDERS)};
  const settings = ${JSON.stringify(settings || {})};
  const callbacks = new Map();
  let cb = 1;
  const find = (o, k) => {
    if (!o || typeof o !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(o, k)) return o[k];
    for (const v of Object.values(o)) { const r = find(v, k); if (r !== undefined) return r; }
    return undefined;
  };
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const sorted = () => rows.slice().sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : (a.createdAt < b.createdAt ? 1 : -1)));
  const page = (args) => {
    const pg = find(args, 'page') || args || {};
    const limit = Math.max(1, Math.min(100, Number(pg.limit) || 100));
    const after = pg.after || null;
    const all = sorted();
    let start = 0;
    if (after) start = all.findIndex((b) => b.createdAt === after.createdAt && b.id === after.id) + 1;
    const items = all.slice(start, start + limit);
    const last = items[items.length - 1];
    const next = start + limit < all.length && last ? { createdAt: last.createdAt, id: last.id } : null;
    return { items: copy(items), next };
  };
  const invoke = async (cmd, args) => {
    window.__calls.push({ cmd, args: JSON.parse(JSON.stringify(args ?? null)) });
    if (cmd === 'list_bookmark_cards') return page(args);
    if (cmd === 'list_folders') return folders.map((f) => ({ ...f, count: rows.filter((b) => b.folderId === f.id).length }));
    if (cmd === 'get_setting') { const k = find(args, 'key'); return Object.prototype.hasOwnProperty.call(settings, k) ? settings[k] : null; }
    if (cmd === 'set_setting') { settings[find(args, 'key')] = find(args, 'value'); return null; }
    if (cmd === 'open_link') { if (!rows.some((b) => b.id === find(args, 'id'))) throw { code: 'not_found', message: 'No such bookmark.' }; return null; }
    if (cmd === 'get_bookmark') return copy(rows.find((b) => b.id === find(args, 'id')) || null);
    if (cmd === 'plugin:event|listen') return cb++;
    if (cmd.startsWith('plugin:event')) return 1;
    if (cmd.startsWith('plugin:')) return null;
    if (cmd === 'get_ai_control' || /ai_control|ai_enabled/.test(cmd)) {
      return { enabled: true, warnAt: 60, pauseAt: 95, pause: null, backgroundGate: { kind: 'allow' }, warn: false, usage: { kind: 'runs', today: 0, week: 0 } };
    }
    if (/health/i.test(cmd)) return { state: 'ready', message: 'Claude Code is installed and signed in.' };
    if (/mode/i.test(cmd)) return 'real';
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

async function openApp(cfg) {
  assert.equal(buildError, null, buildError ?? '');
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-bm03-chrome-'));
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
    await S('Page.addScriptToEvaluateOnNewDocument', { source: bridgeScript(cfg) });
    const evalJs = async (expr) => {
      const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`page error: ${JSON.stringify(r.exceptionDetails).slice(0, 500)}`);
      return r.result.value;
    };
    const helpers = `(() => {
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
      const name = (el) => norm(el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && el.getAttribute('aria-labelledby').split(' ').map((i) => document.getElementById(i)?.textContent).join(' ')) || el.textContent || el.getAttribute('title'));
      const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const CTL = 'a, button, [role=link], [role=button], [role=menuitem], [role=menuitemradio], [role=tab], [role=radio], [role=option], [role=treeitem], [role=switch]';
      const ctl = () => [...document.querySelectorAll(CTL)];
      const find = (n) => ctl().filter((el) => { const l = name(el); return (l === n || l.startsWith(n + ' ')) && shown(el); });
      const main = () => document.querySelector('main') || document.body;
      const text = () => norm(main().innerText);
      // The ids (numbers) of the bookmarks whose title is visible in the screen, first place of each, in order.
      const ids = () => { const seen = []; for (const m of main().innerText.matchAll(/Item (\\d{4}) title/g)) { const n = Number(m[1]); if (!seen.includes(n)) seen.push(n); } return seen; };
      const chosen = (el) => ['aria-pressed', 'aria-checked', 'aria-selected'].some((a) => el.getAttribute(a) === 'true') || (el.getAttribute('aria-current') && el.getAttribute('aria-current') !== 'false');
      // The sidebar row of a folder (or "Needs a look"): a control whose name starts with the label and holds one number.
      const row = (label) => {
        const re = new RegExp('^' + label + '\\\\b\\\\D*(\\\\d+)\\\\D*$', 'i');
        const all = ctl().filter((el) => main().contains(el) && shown(el) && (re.test(name(el)) || re.test(norm(el.innerText))));
        all.sort((a, b) => (b.getAttribute('role') === 'treeitem') - (a.getAttribute('role') === 'treeitem'));
        return all[0] || null;
      };
      const rowCount = (label) => { const e = row(label); if (!e) return null; const re = new RegExp('^' + label + '\\\\b\\\\D*(\\\\d+)', 'i'); const m = name(e).match(re) || norm(e.innerText).match(re); return m ? Number(m[1]) : null; };
      const search = () => [...main().querySelectorAll('input, [role=searchbox]')].filter((e) => shown(e) && (e.type === 'search' || e.getAttribute('role') === 'searchbox' ||
        /search/i.test([e.getAttribute('aria-label'), e.getAttribute('placeholder'), e.labels && [...e.labels].map((l) => l.textContent).join(' '),
          e.getAttribute('aria-labelledby') && e.getAttribute('aria-labelledby').split(' ').map((i) => document.getElementById(i)?.textContent).join(' ')].join(' '))))[0] || null;
      // The smallest visible element in the screen whose text holds 's'.
      const holder = (s) => { let best = null; for (const el of main().querySelectorAll('*')) { if (shown(el) && norm(el.innerText).includes(s) && (!best || best.contains(el))) best = el; } return best; };
      const dialog = () => [...document.querySelectorAll('dialog[open], [role=dialog], [role=alertdialog]')].find(shown) || null;
      window.__h = { norm, name, shown, ctl, find, main, text, ids, chosen, row, rowCount, search, holder, dialog };
    })();`;
    const app = {
      async h(expr) { await evalJs(helpers); return evalJs(expr); },
      async until(expr, what, ms = 10000) {
        const end = Date.now() + ms;
        let last = null;
        while (Date.now() < end) { try { if (await app.h(expr)) return; } catch (e) { last = e; } await sleep(150); }
        assert.fail(`timed out waiting for ${what}${last ? ` (${last.message})` : ''}`);
      },
      async goto() {
        await S('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
        await app.until(`document.readyState === 'complete' && !!document.querySelector('nav')`, 'the sidebar to render', 15000);
        await sleep(300);
      },
      click: (label) => app.h(`(() => { const all = __h.find(${JSON.stringify(label)}); const inMain = all.filter((x) => __h.main().contains(x)); const e = inMain.find((x) => __h.name(x) === ${JSON.stringify(label)}) || inMain[0] || all.find((x) => __h.name(x) === ${JSON.stringify(label)}) || all[0]; if (!e) return false; e.click(); return true; })()`),
      async key(k) {
        const code = { Enter: 13, Escape: 27 }[k];
        await S('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, text: k === 'Enter' ? '\r' : undefined });
        await S('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
        await sleep(100);
      },
      async insert(t) { await S('Input.insertText', { text: t }); await sleep(100); },
      calls: (cmd) => evalJs(`window.__calls.filter((c) => c.cmd === ${JSON.stringify(cmd)})`),
      allCalls: () => evalJs('window.__calls'),
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

async function withApp(cfg, fn) {
  const app = await openApp({ rows: ALL, settings: {}, ...cfg });
  try { await app.goto(); await fn(app); } finally { await app.close(); }
}
const UI = { timeout: 240000, skip: SKIP_UI };

// Opens the Bookmarks page and waits until its titles stop changing.
async function openBookmarks(app) {
  assert.ok(await app.click('Bookmarks'), "no sidebar item named 'Bookmarks'");
  await app.until('__h.ids().length > 0', 'a bookmark title on the Bookmarks page', 20000);
  await settle(app);
}
async function settle(app) {
  let last = '';
  for (let i = 0; i < 40; i++) {
    const now = JSON.stringify(await app.h('__h.ids()'));
    if (now === last) return;
    last = now;
    await sleep(250);
  }
}
async function pickView(app, view) {
  assert.ok(await app.click(view), `no control named '${view}' on the Bookmarks page`);
  await app.until(`__h.find(${JSON.stringify(view)}).some((e) => __h.main().contains(e) && __h.chosen(e))`, `the '${view}' view to be shown as chosen`);
  await settle(app);
}
async function pickRow(app, label) {
  assert.ok(await app.h(`(() => { const e = __h.row(${JSON.stringify(label)}); if (!e) return false; e.click(); return true; })()`),
    `no sidebar row '${label} <count>' on the Bookmarks page`);
  await sleep(300);
  await settle(app);
}
async function searchFor(app, words) {
  assert.ok(await app.h('(() => { const b = __h.search(); if (!b) return false; b.focus(); b.select(); return true; })()'), 'no search box on the Bookmarks page');
  await app.insert(words);
  await sleep(400);
  await settle(app);
}
const VIEWS = ['List', 'Cards', 'Compact'];

// AC1: "Each view shows the same bookmarks in the same order." Decision 3: "Picking a folder shows all its
// bookmarks. Newest first inside a section, the same order in all three views."
test('AC1: in a folder of 200 bookmarks, List, Cards and Compact show the same bookmarks in the same order, newest first', UI, () =>
  withApp({}, async (app) => {
    await openBookmarks(app);
    await pickRow(app, 'Research');
    const want = inFolder('Research');
    for (const v of VIEWS) {
      await pickView(app, v);
      assert.deepEqual(await app.h('__h.ids()'), want, `the ${v} view does not show the 200 Research bookmarks newest first`);
    }
  }));

// AC1: "Each view shows the same bookmarks in the same order." Decision 3: "one section per folder (Unsorted
// last) with its count, its first 4 items and a "Show all N" button."
test('AC1: on All bookmarks, the three views show the same bookmarks in the same order: 4 newest per folder, Unsorted last', UI, () =>
  withApp({}, async (app) => {
    await openBookmarks(app);
    const seen = {};
    for (const v of VIEWS) {
      await pickView(app, v);
      seen[v] = await app.h('__h.ids()');
    }
    assert.deepEqual(seen.List, seen.Cards, 'List and Cards differ');
    assert.deepEqual(seen.Compact, seen.Cards, 'Compact and Cards differ');
    const ids = seen.Cards;
    for (const f of FOLDERS) {
      const got = ids.filter((n) => folderOf(n).name === f.name);
      assert.deepEqual(got, inFolder(f.name).slice(0, 4), `the ${f.name} section does not show its 4 newest bookmarks in order`);
    }
    const firstUnsorted = ids.findIndex((n) => folderOf(n).name === 'Unsorted');
    assert.ok(ids.slice(firstUnsorted).every((n) => folderOf(n).name === 'Unsorted'), `Unsorted is not the last section: ${ids}`);
  }));

// AC2: "The needs-a-look bar lists every link with a null summary, and no other link." Decision 2: "a ds banner
// "N links have no summary" with one action, "Show them". It selects a "Needs a look" filter".
test('AC2: the bar says "20 links have no summary" and Show them lists exactly the 20 null-summary links in each view', UI, () =>
  withApp({}, async (app) => {
    await openBookmarks(app);
    await app.until(`/\\b${NULL_IDS.length} links have no summary/i.test(__h.text())`, `the bar "${NULL_IDS.length} links have no summary"`);
    assert.ok(await app.click('Show them'), "no 'Show them' action on the needs-a-look bar");
    await sleep(300);
    await settle(app);
    for (const v of VIEWS) {
      await pickView(app, v);
      const got = await app.h('__h.ids()');
      assert.deepEqual([...got].sort((a, b) => a - b), [...NULL_IDS].sort((a, b) => a - b), `the ${v} view of Show them is not exactly the null-summary links`);
    }
  }));

// AC2. Decision 2: "also a sidebar row with a count. Each card in that filter keeps its #25 actions ("Paste the
// text", "Summarize later")." Ticket: "with a link to "Paste the text"".
test('AC2: the sidebar row "Needs a look" counts the null-summary links, and its filter offers "Paste the text"', UI, () =>
  withApp({}, async (app) => {
    await openBookmarks(app);
    await app.until('__h.row("Needs a look") !== null', "a sidebar row 'Needs a look <count>'");
    assert.equal(await app.h('__h.rowCount("Needs a look")'), NULL_IDS.length, 'the Needs a look count is not the number of null-summary links');
    await pickRow(app, 'Needs a look');
    const got = await app.h('__h.ids()');
    assert.deepEqual([...got].sort((a, b) => a - b), [...NULL_IDS].sort((a, b) => a - b), 'the Needs a look filter is not exactly the null-summary links');
    assert.ok(await app.h('__h.find("Paste the text").length > 0'), "no 'Paste the text' action in the Needs a look filter");
  }));

// AC3: "Search finds a bookmark by a word that is only in its summary."
test('AC3: search for a word that is only in a summary finds that bookmark and no other, in each view', UI, () =>
  withApp({}, async (app) => {
    await openBookmarks(app);
    await searchFor(app, SUMMARY_WORD);
    for (const v of VIEWS) {
      await pickView(app, v);
      assert.deepEqual(await app.h('__h.ids()'), [137], `the ${v} view does not show only the bookmark whose summary holds "${SUMMARY_WORD}"`);
    }
  }));

// AC3. Decision 4: "Case-insensitive ... on title, summary and tags".
test('AC3: search is case-insensitive and finds a word in a title and in a tag', UI, () =>
  withApp({}, async (app) => {
    await openBookmarks(app);
    await searchFor(app, SUMMARY_WORD.toUpperCase());
    assert.deepEqual(await app.h('__h.ids()'), [137], 'an upper-case search does not find the summary word');
    await searchFor(app, 'MarMaLade');
    assert.deepEqual(await app.h('__h.ids()'), [311], 'search does not find a word in a title');
    await searchFor(app, TAG_WORD);
    assert.deepEqual(await app.h('__h.ids()'), [242], 'search does not find a word in a tag');
  }));

// AC3. Decision 4: "NFC-normalized ... Vietnamese diacritics are not ignored."
test('AC3: search matches Vietnamese text in any Unicode form but does not ignore its diacritics', UI, () =>
  withApp({}, async (app) => {
    await openBookmarks(app);
    await searchFor(app, 'phở'.normalize('NFC'));
    assert.deepEqual(await app.h('__h.ids()'), [401], 'an NFC search for "phở" does not find the summary stored in NFD, or finds "pho"');
    await searchFor(app, 'PHỞ'.normalize('NFD'));
    assert.deepEqual(await app.h('__h.ids()'), [401], 'an upper-case NFD search for "PHỞ" does not find it');
    await searchFor(app, 'pho');
    assert.deepEqual(await app.h('__h.ids()'), [402], 'a search for "pho" ignores the diacritics of "phở" or misses "pho"');
  }));

// AC3 and AC4. Decision 4: "within the current folder or filter. Folder counts stay the full counts."
test('AC3: search works within the chosen folder, and the folder counts stay the full counts', UI, () =>
  withApp({}, async (app) => {
    await openBookmarks(app);
    await pickRow(app, 'Work');
    await searchFor(app, SUMMARY_WORD);
    assert.deepEqual(await app.h('__h.ids()'), [], 'a search in Work shows a bookmark from another folder');
    await pickRow(app, 'Recipes');
    await searchFor(app, SUMMARY_WORD);
    assert.deepEqual(await app.h('__h.ids()'), [137], 'a search in Recipes does not find its summary-only word');
    for (const f of FOLDERS) {
      assert.equal(await app.h(`__h.rowCount(${JSON.stringify(f.name)})`), inFolder(f.name).length, `the ${f.name} count changed during a search`);
    }
  }));

// AC4: "A folder count equals the number of bookmarks shown for that folder."
test('AC4: each folder count in the sidebar equals the number of bookmarks shown when that folder is picked', UI, () =>
  withApp({}, async (app) => {
    await openBookmarks(app);
    for (const f of FOLDERS) {
      await app.until(`__h.row(${JSON.stringify(f.name)}) !== null`, `a sidebar row '${f.name} <count>'`);
      const count = await app.h(`__h.rowCount(${JSON.stringify(f.name)})`);
      assert.equal(count, inFolder(f.name).length, `the ${f.name} count is not its number of bookmarks`);
      await pickRow(app, f.name);
      assert.equal((await app.h('__h.ids()')).length, count, `the ${f.name} folder shows a number of bookmarks other than its count ${count}`);
    }
  }));

// AC4. Decision 3: "one section per folder ... with its count, its first 4 items and a "Show all N" button.
// Picking a folder shows all its bookmarks."
test('AC4: each section on All bookmarks has "Show all N" with N the folder count, and it shows N bookmarks', UI, async () => {
  for (const f of FOLDERS) {
    await withApp({}, async (app) => {
      const n = inFolder(f.name).length;
      await openBookmarks(app);
      await app.until(`__h.find("Show all ${n}").length > 0`, `a "Show all ${n}" button for ${f.name}`);
      assert.ok(await app.click(`Show all ${n}`), `no "Show all ${n}" button for ${f.name}`);
      await sleep(300);
      await settle(app);
      assert.deepEqual(await app.h('__h.ids()'), inFolder(f.name), `"Show all ${n}" does not show the ${n} ${f.name} bookmarks newest first`);
    });
  }
});

// AC5: "With 500 bookmarks the page scrolls without a visible delay on both machines." Decision 9: "render every
// row, no virtual scrolling". (The delay itself is checked by hand; this checks every row is rendered.)
test('AC5: a folder of 500 bookmarks renders every row in each view, and the last row is in the page after a scroll', UI, () =>
  withApp({ rows: seed(true) }, async (app) => {
    await openBookmarks(app);
    await pickRow(app, 'Research');
    const want = Array.from({ length: N }, (_, i) => i + 1);
    for (const v of VIEWS) {
      await pickView(app, v);
      assert.deepEqual(await app.h('__h.ids()'), want, `the ${v} view does not render all 500 rows newest first`);
      assert.ok(await app.h(`(() => { const e = __h.holder(${JSON.stringify(TITLE(N))}); if (!e) return false; e.scrollIntoView(); const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })()`),
        `the last bookmark is not in the ${v} view or cannot be scrolled to`);
    }
  }));

// Decision 6: "View kept after restart: `set_setting` key `bookmarks.view`, value `list`, `cards` or `compact`".
test('Decision 6: picking a view saves it with set_setting under bookmarks.view', UI, () =>
  withApp({}, async (app) => {
    await openBookmarks(app);
    for (const [v, value] of [['List', 'list'], ['Compact', 'compact'], ['Cards', 'cards']]) {
      await pickView(app, v);
      await app.until(`window.__calls.filter((c) => c.cmd === 'set_setting').some((c) => JSON.stringify(c.args).includes('"bookmarks.view"') && JSON.stringify(c.args).includes('"${value}"'))`,
        `set_setting("bookmarks.view", "${value}") after picking ${v}`);
      const last = (await app.calls('set_setting')).filter((c) => JSON.stringify(c.args).includes('"bookmarks.view"')).at(-1);
      assert.deepEqual({ key: last.args.key, value: last.args.value }, { key: 'bookmarks.view', value }, `the last saved view is not ${value}`);
    }
  }));

// Decision 6: "The chosen view is kept after restart" ... "default `cards`".
test('Decision 6: after a restart the saved view is the chosen one, and with none saved Cards is chosen', UI, async () => {
  for (const [saved, v] of [['list', 'List'], ['compact', 'Compact'], [null, 'Cards']]) {
    await withApp({ settings: saved ? { 'bookmarks.view': saved } : {} }, async (app) => {
      await openBookmarks(app);
      const state = await app.h(`(${JSON.stringify(VIEWS)}).map((x) => __h.find(x).filter((e) => __h.main().contains(e)).some((e) => __h.chosen(e)))`);
      assert.deepEqual(state, VIEWS.map((x) => x === v), `with bookmarks.view = ${saved}, the chosen view is not ${v} alone (List, Cards, Compact: ${state})`);
      assert.ok((await app.calls('get_setting')).some((c) => JSON.stringify(c.args).includes('"bookmarks.view"')), 'the page did not read bookmarks.view');
    });
  }
});

// Decision 5: "click, or Enter on a focused row or card, opens a ds dialog with the full link card and "Open in
// browser". The button calls a new core command `open_link(id)` ... The UI gets no opener permission."
test('Decision 5: clicking a bookmark opens a dialog whose "Open in browser" calls open_link with its id, and the UI has no opener permission', UI, () =>
  withApp({}, async (app) => {
    await openBookmarks(app);
    await pickRow(app, 'Recipes');
    for (const v of VIEWS) {
      await pickView(app, v);
      const before = (await app.calls('open_link')).length;
      assert.ok(await app.h(`(() => { const e = __h.holder(${JSON.stringify(TITLE(137))}); if (!e) return false; e.click(); return true; })()`), `no bookmark 137 in the ${v} view`);
      await app.until(`(() => { const d = __h.dialog(); return !!d && __h.norm(d.innerText).includes(${JSON.stringify(TITLE(137))}); })()`, `a dialog with the card of bookmark 137 (${v})`);
      assert.ok(await app.h(`__h.norm(__h.dialog().innerText).includes(${JSON.stringify(SUMMARY_WORD)})`), `the dialog does not show the full card with its summary (${v})`);
      assert.ok(await app.h(`(() => { const b = __h.find("Open in browser").find((e) => __h.dialog().contains(e)); if (!b) return false; b.click(); return true; })()`), `no "Open in browser" in the dialog (${v})`);
      await app.until(`window.__calls.filter((c) => c.cmd === 'open_link').length > ${before}`, `an open_link call (${v})`);
      const call = (await app.calls('open_link')).at(-1);
      assert.equal(call.args?.id, 'bm-0137', `open_link was not called with the id of bookmark 137: ${JSON.stringify(call.args)}`);
      await closeDialog(app);
    }
    const plugin = (await app.allCalls()).filter((c) => /opener|shell/i.test(c.cmd));
    assert.deepEqual(plugin, [], 'the UI called an opener or shell plugin itself');
    const capDir = p('src-tauri', 'capabilities');
    for (const f of readdirSync(capDir)) {
      const txt = readFileSync(join(capDir, f), 'utf8');
      assert.doesNotMatch(txt, /opener|shell:/i, `the capability file ${f} grants the UI an opener or shell permission`);
    }
  }));
// The frontend rules: "Escape closes overlays".
async function closeDialog(app) {
  await app.key('Escape');
  await app.until('!__h.dialog()', 'Escape to close the dialog');
}

// Decision 5: "click, or Enter on a focused row or card, opens a ds dialog with the full link card".
test('Decision 5: Enter on a focused row or card opens the dialog of that bookmark, in each view', UI, () =>
  withApp({}, async (app) => {
    await openBookmarks(app);
    await pickRow(app, 'Recipes');
    for (const v of VIEWS) {
      await pickView(app, v);
      assert.ok(await app.h(`(() => {
        const t = __h.holder(${JSON.stringify(TITLE(137))});
        if (!t) return false;
        for (let e = t; e && e !== __h.main(); e = e.parentElement) {
          if (e.tabIndex >= 0 && (e.matches('a[href], button, [tabindex], [role=button], [role=link], [role=option], [role=row], [role=article], [role=listitem], article, li'))) { e.focus(); return document.activeElement === e; }
        }
        return false; })()`), `no focusable row or card holds bookmark 137 in the ${v} view`);
      await app.key('Enter');
      await app.until(`(() => { const d = __h.dialog(); return !!d && __h.norm(d.innerText).includes(${JSON.stringify(TITLE(137))}); })()`, `Enter to open the dialog of bookmark 137 (${v})`);
      await closeDialog(app);
    }
  }));
