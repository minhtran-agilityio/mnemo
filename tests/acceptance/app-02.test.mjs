// Acceptance tests for #11 [APP-02] App frame and navigation.
// Run: node --test tests/acceptance/app-02.test.mjs
// Static and Rust-list tests need only node and cargo. The UI tests build the UI with Vite, serve the
// build on a private port and drive it in headless Google Chrome through the DevTools protocol, by role,
// label and visible text. The Tauri bridge is replaced by a small in-page fake (window.__TAURI_INTERNALS__):
// any command whose name contains "setting" is a key/value store kept in localStorage (so it survives a
// reload, like Quit and start again); commands that fail in "storage down" mode reject with
// { code, message }. The fake's get returns the stored value as sent (or null when missing).
// UI tests skip when no Chrome is found (set MNEMO_CHROME to its path). Each test gets its own Chrome profile.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { join, dirname, relative, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const p = (...a) => join(ROOT, ...a);
const NESTED = !!process.env.MNEMO_NESTED;
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

// ---------------------------------------------------------------- the sidebar, from the ticket
const DAILY = ['Today', 'Ask Mnemo', 'Calendar', 'Daily digest', 'Goals', 'Trending'];
const LIBRARY = ['Bookmarks', 'Deep research', 'Notes', 'Ideas', 'Projects', 'Files (PDF)', 'Videos', 'Shared', 'Learning', 'Everything'];
const LIFE = ['Workout', 'Diary'];
const KNOWLEDGE = ['About me', 'Graph'];
const AGENTS = ['Background runs', 'Needs approval', 'Mnemo memory', 'Daily report', 'Quiet notifications'];
const APPS = ['Apps and account', 'AI control', 'Settings'];
const SECTION_ITEMS = [...DAILY, ...LIBRARY, ...LIFE, ...KNOWLEDGE, ...AGENTS];
const ALL_ITEMS = [...SECTION_ITEMS, ...APPS];
const LATER = ['Files (PDF)', 'Videos'];

// ---------------------------------------------------------------- Chrome + DevTools harness
const CHROME = [process.env.MNEMO_CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((c) => c && existsSync(c));
const SKIP_UI = CHROME ? false : 'no Chrome found (set MNEMO_CHROME)';
let distDir = null;
let server = null;
let port = 0;
let buildError = null;

before(async () => {
  if (SKIP_UI) return;
  distDir = mkdtempSync(join(tmpdir(), 'mnemo-app02-dist-'));
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
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
});
after(() => {
  server?.close();
  if (distDir) rmSync(distDir, { recursive: true, force: true });
});

// In-page fake of the Tauri bridge. MODE is 'ok' or 'down' (the settings store is unavailable).
const bridgeScript = (mode) => `(() => {
  const MODE = ${JSON.stringify(mode)};
  const KEY = '__mnemo_fake_settings__';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
  window.__calls = [];
  const invoke = async (cmd, args) => {
    window.__calls.push({ cmd, args });
    if (/setting/i.test(cmd)) {
      if (MODE === 'down') throw { code: 'storage', message: 'The data file could not be read.' };
      const store = read();
      if (args && Object.prototype.hasOwnProperty.call(args, 'value') && args.value !== undefined) {
        store[args.key] = args.value;
        localStorage.setItem(KEY, JSON.stringify(store));
        return null;
      }
      const k = args && args.key;
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    }
    if (/ping/i.test(cmd)) return 'pong';
    if (/version/i.test(cmd)) return '0.1.0';
    return null;
  };
  let cb = 1;
  window.__TAURI_INTERNALS__ = { invoke, transformCallback: () => cb++, unregisterCallback() {}, convertFileSrc: (s) => s, metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } } };
  window.isTauri = true;
})();`;

async function openApp(mode = 'ok', { profile } = {}) {
  assert.equal(buildError, null, buildError ?? '');
  const dir = profile ?? mkdtempSync(join(tmpdir(), 'mnemo-app02-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--window-size=1100,720', 'about:blank'], { stdio: 'ignore' });
  let wsUrl;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    await sleep(100);
    const f = join(dir, 'DevToolsActivePort');
    if (existsSync(f)) { const [pt, path] = readFileSync(f, 'utf8').trim().split('\n'); if (path) wsUrl = `ws://127.0.0.1:${pt}${path}`; }
  }
  assert.ok(wsUrl, 'Chrome did not start');
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const { ok, bad } = pending.get(d.id); pending.delete(d.id); d.error ? bad(new Error(JSON.stringify(d.error))) : ok(d.result); }
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, bad) => { const i = ++id; pending.set(i, { ok, bad }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, pr) => send(m, pr, sessionId);
  await S('Page.enable');
  await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
  await S('Page.addScriptToEvaluateOnNewDocument', { source: bridgeScript(mode) });
  const evalJs = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page error: ${JSON.stringify(r.exceptionDetails).slice(0, 500)}`);
    return r.result.value;
  };
  const key = async (k, code, text, vk) => {
    const base = { key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await S('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', text, ...base });
    await S('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  };
  const app = {
    dir,
    eval: evalJs,
    async goto() {
      await S('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
      await app.until(`document.readyState === 'complete' && !!document.querySelector('nav')`, 'the sidebar (a nav landmark) to render', 15000);
      await sleep(400);
    },
    async until(expr, what, ms = 8000) {
      const end = Date.now() + ms;
      while (Date.now() < end) { try { if (await evalJs(expr)) return; } catch { /* retry */ } await sleep(100); }
      assert.fail(`timed out waiting for ${what}`);
    },
    tab: () => key('Tab', 'Tab', undefined, 9),
    enter: () => key('Enter', 'Enter', '\r', 13),
    space: () => key(' ', 'Space', ' ', 32),
    async typeText(t) { await S('Input.insertText', { text: t }); },
    async close() {
      try { ws.close(); } catch { /* closed */ }
      proc.kill('SIGKILL');
      await sleep(200);
      if (!profile) rmSync(dir, { recursive: true, force: true });
    },
  };
  // page-side helpers, installed on each use
  app.helpers = `(() => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
    const name = (el) => norm(el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && el.getAttribute('aria-labelledby').split(' ').map((i) => document.getElementById(i)?.textContent).join(' ')) || el.textContent || el.getAttribute('title') || el.getAttribute('alt'));
    const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const ctl = () => [...document.querySelectorAll('a, button, [role=link], [role=button], [role=menuitem], [role=tab]')];
    const find = (n, all) => ctl().filter((el) => { const l = name(el); return (l === n || l.startsWith(n + ' ')) && (all || shown(el)); });
    window.__h = { norm, name, shown, ctl, find };
  })();`;
  app.h = async (expr) => { await evalJs(app.helpers); return evalJs(expr); };
  app.click = (label) => app.h(`(() => { const e = __h.find(${JSON.stringify(label)})[0]; if (!e) return false; e.click(); return true; })()`);
  app.mainText = () => evalJs(`(document.querySelector('main') || document.body).innerText`);
  app.navRect = () => evalJs(`(() => { const r = document.querySelector('nav').getBoundingClientRect(); return { w: r.width, h: r.height, x: r.x, y: r.y, bottom: r.bottom }; })()`);
  return app;
}

async function withApp(mode, fn) {
  const app = await openApp(mode);
  try { await app.goto(); await fn(app); } finally { await app.close(); }
}
const UI = { timeout: 120000, skip: SKIP_UI };

// opens an item, expanding the 'Apps and settings' list when the item is hidden inside it
async function openItem(app, label) {
  if (!(await app.click(label))) {
    assert.ok(await app.click('Apps and settings'), `no 'Apps and settings' control to reach ${label}`);
    await sleep(200);
    assert.ok(await app.click(label), `no sidebar item named '${label}'`);
  }
  await sleep(150);
}

// ---------------------------------------------------------------- AC1
test('AC1: every sidebar item exists and opens a screen that shows its name and phase', UI, () =>
  withApp('ok', async (app) => {
    const failures = [];
    for (const item of ALL_ITEMS) {
      await openItem(app, item);
      const text = await app.mainText();
      if (!text.toLowerCase().includes(item.toLowerCase())) failures.push(`${item}: main shows no name (${JSON.stringify(text.slice(0, 80))})`);
      else if (!/\b(phase\s*\d+|P\d+)\b/i.test(text)) failures.push(`${item}: main shows no phase (${JSON.stringify(text.slice(0, 80))})`);
    }
    assert.deepEqual(failures, [], failures.join('\n'));
  }));

test("AC1: 'Save or ask' opens an empty state", UI, () =>
  withApp('ok', async (app) => {
    await openItem(app, 'Today');
    await openItem(app, 'Save or ask');
    const text = await app.mainText();
    assert.match(text, /save or ask/i, `main after Save or ask: ${text.slice(0, 120)}`);
  }));

test('AC1: no sidebar item does nothing (the screen changes on every click)', UI, () =>
  withApp('ok', async (app) => {
    let prev = null;
    const dead = [];
    for (const item of SECTION_ITEMS) {
      await openItem(app, item);
      const t = await app.mainText();
      if (t === prev) dead.push(item);
      prev = t;
    }
    assert.deepEqual(dead, [], `items that left the screen unchanged: ${dead.join(', ')}`);
  }));

// ---------------------------------------------------------------- AC2
test("AC2: Files (PDF) and Videos carry a 'Later' mark and open the same empty state", UI, () =>
  withApp('ok', async (app) => {
    for (const item of LATER) {
      const labels = await app.h(`__h.find(${JSON.stringify(item)}).map((e) => __h.name(e))`);
      assert.ok(labels.length, `no item ${item}`);
      assert.match(labels[0], /\bLater\b/, `${item} has no Later mark: ${labels[0]}`);
      await openItem(app, item);
      const text = await app.mainText();
      assert.match(text, /\bLater\b/, `${item} screen does not say Later`);
      assert.ok(text.toLowerCase().includes(item.toLowerCase()), `${item} screen does not show its name`);
    }
    // the two Later screens share one empty state: same text once the name is taken out
    await openItem(app, LATER[0]);
    const a = (await app.mainText()).replace(/Files \(PDF\)/gi, 'X');
    await openItem(app, LATER[1]);
    const b = (await app.mainText()).replace(/Videos/gi, 'X');
    assert.equal(a, b, 'Later items do not open the same empty state');
  }));

test('AC2: the items that are not Later have no Later mark (Today, Bookmarks, Notes)', UI, () =>
  withApp('ok', async (app) => {
    for (const item of ['Today', 'Bookmarks', 'Notes']) {
      const labels = await app.h(`__h.find(${JSON.stringify(item)}).map((e) => __h.name(e))`);
      assert.ok(labels.length, `no item ${item}`);
      assert.doesNotMatch(labels[0], /\bLater\b/);
    }
  }));

test('AC2: there is no Tags section and no count or badge in the sidebar', UI, () =>
  withApp('ok', async (app) => {
    const r = await app.h(`(() => {
      const nav = document.querySelector('nav');
      const texts = [...nav.querySelectorAll('*')].filter((e) => e.children.length === 0).map((e) => __h.norm(e.textContent)).filter(Boolean);
      const digits = texts.filter((t) => /\\d/.test(t.replace(/P\\d/g, '')));
      return { tags: texts.filter((t) => /^tags?$/i.test(t)), digits, badge: [...nav.querySelectorAll('[class*=badge i],[class*=count i],[class*=pill i]')].map((e) => e.className) };
    })()`);
    assert.deepEqual(r.tags, [], 'a Tags section exists');
    assert.deepEqual(r.digits, [], `numbers in the sidebar: ${r.digits}`);
    assert.deepEqual(r.badge, [], 'a count or badge element exists');
  }));

// ---------------------------------------------------------------- AC3
test("AC3: the sidebar top is the 'Mnemo' logo with a collapse toggle, then 'Save or ask', then the search box", UI, () =>
  withApp('ok', async (app) => {
    const r = await app.h(`(() => {
      const nav = document.querySelector('nav');
      const toggle = __h.ctl().find((e) => nav.contains(e) && /collaps|expand|toggle|sidebar|menu/i.test(__h.name(e) + ' ' + (e.getAttribute('title') || '')));
      const save = __h.find('Save or ask')[0];
      const search = [...document.querySelectorAll('input')].find((i) => i.placeholder === 'Search everything');
      const logo = [...nav.querySelectorAll('*')].find((e) => e.children.length === 0 && __h.norm(e.textContent) === 'Mnemo');
      const y = (e) => e && e.getBoundingClientRect().top;
      return { toggle: !!toggle, save: !!save, search: !!search, logo: !!logo, ty: y(toggle), ly: y(logo), sy: y(save), iy: y(search), firstItem: y(__h.find('Today')[0]) };
    })()`);
    assert.ok(r.logo, "no 'Mnemo' logo text in the sidebar");
    assert.ok(r.toggle, 'no collapse toggle button in the sidebar');
    assert.ok(r.save, "no 'Save or ask' button");
    assert.ok(r.search, "no search box with placeholder 'Search everything'");
    assert.ok(r.ly <= r.sy && r.ty <= r.sy, 'logo and toggle must come before Save or ask');
    assert.ok(r.sy < r.iy, 'Save or ask must come before the search box');
    assert.ok(r.iy < r.firstItem, 'the search box must come before Today');
  }));

test("AC3: 'Apps and settings' is pinned at the bottom and opens and closes a list", UI, () =>
  withApp('ok', async (app) => {
    const pos = await app.h(`(() => { const e = __h.find('Apps and settings')[0]; if (!e) return null; const r = e.getBoundingClientRect(); return { bottom: r.bottom, vh: innerHeight, top: r.top, lowest: Math.max(...__h.find('Everything').map((x) => x.getBoundingClientRect().bottom)) }; })()`);
    assert.ok(pos, "no 'Apps and settings' control");
    assert.ok(pos.vh - pos.bottom < 48, `Apps and settings is not pinned at the bottom (bottom ${pos.bottom} of ${pos.vh})`);
    const vis = (n) => app.h(`__h.find(${JSON.stringify(n)}).length > 0`);
    assert.equal(await vis('AI control'), false, 'the list is open before it was asked to open');
    await app.click('Apps and settings');
    await sleep(200);
    for (const n of APPS) assert.equal(await vis(n), true, `${n} not shown after opening the list`);
    const pinned = await app.h(`(() => { const r = __h.find('Apps and settings')[0].getBoundingClientRect(); return innerHeight - r.bottom; })()`);
    assert.ok(pinned < 48, 'Apps and settings moved off the bottom when opened');
    await app.click('Apps and settings');
    await sleep(200);
    assert.equal(await vis('AI control'), false, 'the list did not close');
  }));

// ---------------------------------------------------------------- AC4
const TOGGLE = `(() => { const nav = document.querySelector('nav'); return __h.ctl().find((e) => nav.contains(e) && /collaps|expand|toggle|sidebar|menu/i.test(__h.name(e) + ' ' + (e.getAttribute('title') || ''))); })()`;
const clickToggle = (app) => app.h(`(() => { const t = ${TOGGLE}; t.click(); return true; })()`);
async function focusToggleByTab(app) {
  await app.eval(`document.activeElement && document.activeElement.blur(); window.scrollTo(0,0);`);
  for (let i = 0; i < 12; i++) {
    await app.tab();
    if (await app.h(`document.activeElement === ${TOGGLE}`)) return;
  }
  assert.fail('Tab never reached the collapse toggle');
}

test('AC4: the sidebar collapses and opens again by mouse', UI, () =>
  withApp('ok', async (app) => {
    const open = (await app.navRect()).w;
    await clickToggle(app);
    await sleep(500);
    const small = (await app.navRect()).w;
    assert.ok(small < open * 0.6, `sidebar did not shrink: ${open} -> ${small}`);
    await clickToggle(app);
    await sleep(500);
    assert.ok(Math.abs((await app.navRect()).w - open) < 4, 'sidebar did not open again');
  }));

test('AC4: the sidebar collapses and opens again by keyboard (Tab to the toggle, Enter, then Space)', UI, () =>
  withApp('ok', async (app) => {
    const open = (await app.navRect()).w;
    await focusToggleByTab(app);
    await app.enter();
    await sleep(500);
    const small = (await app.navRect()).w;
    assert.ok(small < open * 0.6, `Enter did not collapse: ${open} -> ${small}`);
    assert.equal(await app.h(`document.activeElement === ${TOGGLE}`), true, 'focus left the toggle');
    await app.space();
    await sleep(500);
    assert.ok(Math.abs((await app.navRect()).w - open) < 4, 'Space did not open the sidebar again');
  }));

test('AC4: every collapsed icon keeps an accessible name and shows a visible focus ring', UI, () =>
  withApp('ok', async (app) => {
    await clickToggle(app);
    await sleep(500);
    const bad = await app.h(`(() => [...document.querySelector('nav').querySelectorAll('a, button')].filter((e) => !__h.name(e) || e.getAttribute('aria-hidden') === 'true').map((e) => e.outerHTML.slice(0, 80)))()`);
    assert.deepEqual(bad, [], 'collapsed controls without an accessible name');
    const named = await app.h(`['Today', 'Bookmarks', 'Everything', 'Save or ask'].map((n) => __h.find(n, true).length)`);
    assert.ok(named.every((n) => n >= 1), `collapsed items lost their names: ${named}`);
    // walk the focus order and check the ring on every stop inside the sidebar
    await app.eval(`document.activeElement && document.activeElement.blur()`);
    let seen = 0;
    for (let i = 0; i < 40; i++) {
      await app.tab();
      const r = await app.h(`(() => { const e = document.activeElement; const nav = document.querySelector('nav'); if (!e || !nav.contains(e) || e.tagName === 'INPUT') return null; const cs = getComputedStyle(e); const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none'); return { n: __h.name(e), ring: !!ring }; })()`);
      if (!r) continue;
      seen++;
      assert.ok(r.ring, `no visible focus ring on '${r.n}'`);
    }
    assert.ok(seen >= 10, `only ${seen} sidebar controls were reachable by Tab`);
  }));

// ---------------------------------------------------------------- AC5
test('AC5: collapsed state is written to the settings store and is still collapsed after restart', UI, async () => {
  const profile = mkdtempSync(join(tmpdir(), 'mnemo-app02-chrome-'));
  try {
    let open;
    let a = await openApp('ok', { profile });
    try {
      await a.goto();
      open = (await a.navRect()).w;
      await clickToggle(a);
      await sleep(500);
      const calls = await a.eval(`window.__calls.filter((c) => /setting/i.test(c.cmd) && c.args && c.args.value !== undefined).length`);
      assert.ok(calls >= 1, 'collapsing did not write a setting through the Tauri bridge');
    } finally { await a.close(); }
    a = await openApp('ok', { profile });
    try {
      await a.goto();
      await sleep(500);
      assert.ok((await a.navRect()).w < open * 0.6, 'sidebar is open again after restart');
      const reads = await a.eval(`window.__calls.filter((c) => /setting/i.test(c.cmd)).length`);
      assert.ok(reads >= 1, 'the saved state was not read through the settings store');
      await clickToggle(a);
      await sleep(500);
    } finally { await a.close(); }
    a = await openApp('ok', { profile });
    try {
      await a.goto();
      await sleep(500);
      assert.ok(Math.abs((await a.navRect()).w - open) < 4, 'an opened sidebar did not stay open after restart');
    } finally { await a.close(); }
  } finally { rmSync(profile, { recursive: true, force: true }); }
});

test('AC5: a start with an empty data folder shows the sidebar open', UI, () =>
  withApp('ok', async (app) => {
    const r = await app.navRect();
    assert.ok(r.w > 150, `sidebar is not open at first start (width ${r.w})`);
    assert.equal(await app.h(`__h.find('Today').length > 0 && /Today/.test(__h.find('Today')[0].innerText)`), true, 'item labels are not visible when open');
  }));

// ---------------------------------------------------------------- AC6
const typeSearch = async (app, text) => {
  await app.eval(`document.querySelector('input[placeholder="Search everything"]').focus()`);
  await app.typeText(text);
  await app.enter();
  await sleep(400);
};

test('AC6: a word typed in the search box and Enter opens Everything with the word in its empty state', UI, () =>
  withApp('ok', async (app) => {
    await openItem(app, 'Today');
    await typeSearch(app, 'zebrafinch');
    const text = await app.mainText();
    assert.match(text, /everything/i, `main is not Everything: ${text.slice(0, 120)}`);
    assert.ok(text.includes('zebrafinch'), `the word is not shown: ${text.slice(0, 120)}`);
  }));

test('AC6: the searched text is inserted as text, never as HTML', UI, () =>
  withApp('ok', async (app) => {
    const evil = '<img src=x onerror="window.__pwned=1"><b>bold</b>';
    await typeSearch(app, evil);
    const r = await app.eval(`({ text: (document.querySelector('main') || document.body).innerText, imgs: document.querySelectorAll('main img, main b').length, pwned: window.__pwned === 1 })`);
    assert.ok(r.text.includes(evil), `the markup was not shown as plain text: ${r.text.slice(0, 160)}`);
    assert.equal(r.imgs, 0, 'markup from the search box became elements');
    assert.equal(r.pwned, false, 'script ran from the search text');
  }));

test('AC6: no UI source of the frame uses an HTML sink', () => {
  const files = walk(p('ui', 'src')).filter((f) => /\.(ts|tsx|js)$/.test(f) && !/\.test\./.test(f));
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /innerHTML|outerHTML|insertAdjacentHTML/, `${relative(ROOT, f)} uses an HTML sink`);
});

// ---------------------------------------------------------------- AC7
const cargoList = () => {
  const r = spawnSync('cargo', ['test', '--manifest-path', p('src-tauri', 'Cargo.toml'), '--', '--list'], { encoding: 'utf8', timeout: 580000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.split('\n').filter((l) => l.endsWith(': test')).map((l) => l.slice(0, -6));
};
const GIT_ENV = { cwd: ROOT, encoding: 'utf8' };

test('AC7: the settings store has Rust tests for read, write, overwrite and a missing key', { timeout: 590000 }, () => {
  const names = cargoList().filter((n) => /^storage::/.test(n) && /setting/i.test(n));
  const has = (re) => names.some((n) => re.test(n));
  assert.ok(has(/(get|read|load|return|round_?trip)/i), `no storage settings test for read in: ${names}`);
  assert.ok(has(/(set|write|save|store|round_?trip)/i), `no storage settings test for write in: ${names}`);
  assert.ok(has(/(overwrit|replace|update|twice|again|last)/i), `no storage settings test for overwrite in: ${names}`);
  assert.ok(has(/(missing|absent|unknown|none|not_found|no_such|unset|never)/i), `no storage settings test for a missing key in: ${names}`);
});

test('AC7: migration 0002 creates the settings table and has a test on a database built by migration 1', { timeout: 590000 }, () => {
  const dir = p('src-tauri', 'migrations');
  const m2 = readdirSync(dir).filter((f) => /^0002[_-].*\.sql$/.test(f));
  assert.equal(m2.length, 1, `expected one 0002 migration, found: ${readdirSync(dir)}`);
  assert.match(readFileSync(join(dir, m2[0]), 'utf8'), /create\s+table[^;]*setting/i);
  const names = cargoList().filter((n) => /^storage::/.test(n));
  assert.ok(names.some((n) => /(0002|migration_2|migration_two|from_(version_)?1|from_v1|v1_to_v2|upgrade|existing)/i.test(n) && /(setting|migrat)/i.test(n)), `no storage test for migration 2 in: ${names}`);
});

test('AC7: migration 1 is not edited', () => {
  const sha = createHash('sha256').update(readFileSync(p('src-tauri', 'migrations', '0001_init.sql'))).digest('hex');
  assert.equal(sha, 'd709edb0a9ad1ddf10ba49a377a11d44b196a5ae1d73b624dc0bdc221f6a834e');
});

test('AC7: only the storage module touches SQLite', () => {
  const src = walk(p('src-tauri', 'src')).filter((f) => f.endsWith('.rs') && !relative(p('src-tauri', 'src'), f).startsWith('storage/'));
  for (const f of src) assert.doesNotMatch(readFileSync(f, 'utf8'), /rusqlite|\bConnection::open|\bCREATE\s+TABLE\b/i, `${relative(ROOT, f)} touches SQLite outside storage`);
  const ui = walk(p('ui', 'src')).filter((f) => /\.(ts|js)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
  assert.doesNotMatch(ui, /sqlite|\.db['"]/i);
});

// ---------------------------------------------------------------- AC8
test('AC8: the main page no longer mounts the kanban proof or the style sample', () => {
  const html = readFileSync(p('ui', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /kanban-proof|id=["']board["']|id=["']sample["']|UI approach proof|Style sample/i);
});

test('AC8: the page renders the frame and not the proof (built page, no kanban or sample on screen)', UI, () =>
  withApp('ok', async (app) => {
    const r = await app.eval(`({ board: !!document.querySelector('#board, .kanban-proof, .board'), sample: !!document.querySelector('#sample, [aria-label="Style sample"]'), proof: /Proof screen for the UI approach/i.test(document.body.innerText) })`);
    assert.deepEqual(r, { board: false, sample: false, proof: false });
  }));

test('AC8: the kanban and sample source files and their tests stay', () => {
  for (const f of [['screens', 'kanban', 'kanban.ts'], ['screens', 'kanban', 'kanban.css'], ['screens', 'sample', 'sample.ts'], ['screens', 'sample', 'sample.css'], ['shared', 'card.ts'], ['shared', 'card.test.ts'], ['shared', 'store.ts'], ['shared', 'store.test.ts']])
    assert.ok(existsSync(p('ui', 'src', ...f)), `ui/src/${f.join('/')} is gone`);
});

test('AC8: earlier acceptance tests were not removed', () => {
  for (const f of ['app-03', 'app-shell-01', 'setup-05', 'spike-01', 'setup-06'])
    assert.ok(existsSync(p('tests', 'acceptance', `${f}.test.mjs`)), `${f}.test.mjs is gone`);
  const t = readFileSync(p('tests', 'acceptance', 'app-03.test.mjs'), 'utf8');
  assert.match(t, /raw colour/i);
});

// ---------------------------------------------------------------- AC9
test('AC9: the frame has its own CSS that uses tokens, and no CSS outside tokens.css holds a raw colour', () => {
  const css = walk(p('ui')).filter((f) => f.endsWith('.css') && !f.endsWith('tokens.css'));
  const frame = css.filter((f) => /sidebar|frame|shell|nav/i.test(relative(p('ui'), f)));
  assert.ok(frame.length >= 1, 'no frame/sidebar css file under ui/ (name it with sidebar, frame, shell or nav)');
  assert.match(frame.map((f) => readFileSync(f, 'utf8')).join('\n'), /var\(\s*--/, 'frame css uses no token');
  for (const f of css) {
    for (const l of readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n'))
      assert.doesNotMatch(l, /#[0-9a-f]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|hwb)\(/i, `raw colour in ${relative(ROOT, f)}: ${l.trim()}`);
  }
});

test('AC9: with the settings store unavailable the frame shows the sidebar open and is not blank', UI, () =>
  withApp('down', async (app) => {
    const r = await app.navRect();
    assert.ok(r.w > 150, `sidebar is not open when storage fails (width ${r.w})`);
    const text = await app.eval(`document.body.innerText`);
    assert.ok(text.trim().length > 40, 'blank screen');
    assert.ok(await app.click('Today'), 'cannot use the sidebar when storage fails');
    await sleep(200);
    assert.match(await app.mainText(), /today/i);
    // collapsing still works for the session even though it cannot be saved
    await clickToggle(app);
    await sleep(400);
    assert.ok((await app.navRect()).w < r.w * 0.6, 'the toggle stopped working when storage is down');
  }));

// ---------------------------------------------------------------- AC10
test('AC10: npm run check passes', { timeout: 590000, skip: NESTED ? 'nested run' : false }, () => {
  const r = spawnSync('npm', ['run', 'check'], { cwd: ROOT, encoding: 'utf8', timeout: 580000 });
  assert.equal(r.status, 0, (r.stdout || '').slice(-2000) + (r.stderr || '').slice(-2000));
});

// Review fixes (#11): the frame must not wait for the saved sidebar state, and the read-failure
// line and the save-failure line must be separate.
test('start() shows the sidebar before the saved state is read', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ui', 'src', 'main.ts'), 'utf8');
  const start = src.slice(src.indexOf('async function start()'));
  assert.ok(start.indexOf('createSidebar(') < start.indexOf('await loadCollapsed()'), 'createSidebar must come before awaiting the read');
});

test('a read failure and a save failure use separate note lines', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ui');
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.match(html, /id="setting-read-note"/);
  assert.match(html, /id="setting-save-note"/);
});
