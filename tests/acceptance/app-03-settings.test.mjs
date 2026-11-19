// Acceptance tests for #12 [APP-03] Settings screen and theme choice.
// Run: node --test tests/acceptance/app-03-settings.test.mjs
// Same harness as app-02: Vite build served on a private port, headless Google Chrome driven through the
// DevTools protocol, the Tauri bridge replaced by an in-page fake that keeps the settings store in
// localStorage (so it survives a reload, like Quit and start again). The OS theme is emulated with
// Emulation.setEmulatedMedia. UI tests skip when no Chrome is found (set MNEMO_CHROME).
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

const CHROME = [process.env.MNEMO_CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((c) => c && existsSync(c));
const SKIP_UI = CHROME ? false : 'no Chrome found (set MNEMO_CHROME)';
let distDir = null;
let server = null;
let port = 0;
let buildError = null;

before(async () => {
  if (SKIP_UI) return;
  distDir = mkdtempSync(join(tmpdir(), 'mnemo-app12-dist-'));
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

// In-page fake of the Tauri bridge. MODE: 'ok', 'down' (every settings command rejects),
// 'save-fails' (reads work, writes reject). SEED is a JSON object put in the store on a first visit.
const bridgeScript = (mode, seed) => `(() => {
  const MODE = ${JSON.stringify(mode)};
  const SEED = ${JSON.stringify(seed ?? null)};
  const KEY = '__mnemo_fake_settings__';
  if (SEED && localStorage.getItem(KEY) === null) localStorage.setItem(KEY, JSON.stringify(SEED));
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
  window.__calls = [];
  window.__paint = { themeAt: null, themeVal: null, firstPaint: null };
  new MutationObserver(() => {
    const v = document.documentElement.getAttribute('data-theme');
    if (v && window.__paint.themeAt === null) { window.__paint.themeAt = performance.now(); window.__paint.themeVal = v; }
  }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-theme'] });
  const invoke = async (cmd, args) => {
    window.__calls.push({ cmd, args });
    if (/setting/i.test(cmd)) {
      if (MODE === 'down') throw { code: 'storage', message: 'The data file could not be read.' };
      const store = read();
      if (args && Object.prototype.hasOwnProperty.call(args, 'value') && args.value !== undefined) {
        if (MODE === 'save-fails') throw { code: 'storage', message: 'The data file could not be written.' };
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

async function openApp(mode = 'ok', { profile, seed } = {}) {
  assert.equal(buildError, null, buildError ?? '');
  const dir = profile ?? mkdtempSync(join(tmpdir(), 'mnemo-app12-chrome-'));
  // A reused profile still holds the last Chrome's DevToolsActivePort file. Remove it, or
  // the next start reads the old port and connects to a Chrome that is gone.
  rmSync(join(dir, 'DevToolsActivePort'), { force: true });
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--window-size=1100,720', 'about:blank'], { stdio: 'ignore' });
  // If anything below fails, the test never gets `app` to close: kill Chrome here, or the
  // orphan keeps node (and CI) waiting forever.
  try {
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
  await S('Page.addScriptToEvaluateOnNewDocument', { source: bridgeScript(mode, seed) });
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
    async gotoPath(path, ready) {
      await S('Page.navigate', { url: `http://127.0.0.1:${port}${path}` });
      await app.until(`document.readyState === 'complete' && (${ready})`, `${path} to render`, 15000);
      await sleep(400);
    },
    // emulate the OS theme: 'dark' or 'light'
    media: (scheme) => S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }),
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
      // Close Chrome the normal way first, so it writes localStorage (the fake settings
      // store) to the profile like a real Quit. SIGKILL only when it does not exit.
      const exited = new Promise((ok) => { if (proc.exitCode !== null) ok(); else proc.once('exit', ok); });
      try { await Promise.race([send('Browser.close'), sleep(2000)]); } catch { /* already closing */ }
      await Promise.race([exited, sleep(5000)]);
      try { ws.close(); } catch { /* closed */ }
      if (proc.exitCode === null) proc.kill('SIGKILL');
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
  } catch (error) {
    proc.kill('SIGKILL');
    if (!profile) rmSync(dir, { recursive: true, force: true });
    throw error;
  }
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


async function withAppOpts(mode, opts, fn) {
  const app = await openApp(mode, opts);
  try { await app.goto(); await fn(app); } finally { await app.close(); }
}

// page helpers for the Settings screen and for colour checks
const SETTINGS_HELPERS = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const labelOf = (el) => {
    if (el.getAttribute('aria-label')) return norm(el.getAttribute('aria-label'));
    if (el.labels && el.labels.length) return norm([...el.labels].map((l) => l.textContent).join(' '));
    return norm(el.textContent);
  };
  const main = () => document.querySelector('main') || document.body;
  // section rows: controls whose name starts with the section name
  const row = (n) => [...main().querySelectorAll('a, button, [role=tab], [role=link], [role=button], [role=menuitem], li, input[type=radio]')].filter((e) => { const l = labelOf(e); return (l === n || l.startsWith(n + ' ')) && shown(e); })[0];
  // theme choices: exact name, a radio, button, option or tab (never the section row)
  const choice = (n) => [...main().querySelectorAll('button, [role=radio], [role=option], [role=tab], [role=menuitemradio], input[type=radio], option')].filter((e) => labelOf(e) === n && (e.tagName === 'OPTION' || shown(e)))[0];
  const pick = (n) => {
    const e = choice(n);
    if (!e) return false;
    if (e.tagName === 'OPTION') { const s = e.closest('select'); s.value = e.value; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }
    else e.click();
    return true;
  };
  const toRgba = (c) => { const x = document.createElement('canvas'); x.width = x.height = 1; const g = x.getContext('2d', { willReadFrequently: true }); g.clearRect(0, 0, 1, 1); g.fillStyle = c; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (f, b) => { const a = f[3] + b[3] * (1 - f[3]); return a === 0 ? [0, 0, 0, 0] : [0, 1, 2].map((i) => (f[i] * f[3] + b[i] * b[3] * (1 - f[3])) / a).concat(a); };
  const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const canvas = () => { const cs = getComputedStyle(document.documentElement).colorScheme; return /dark/.test(cs) && !/light/.test(cs) ? [18, 18, 18, 1] : [255, 255, 255, 1]; };
  // effective background of an element: composite ancestors' backgrounds; null when an image or gradient is in the way
  const bgOf = (el) => {
    let acc = [0, 0, 0, 0];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== 'none') return null;
      acc = over(acc, toRgba(cs.backgroundColor));
      if (acc[3] >= 0.999) return acc;
    }
    return over(acc, canvas());
  };
  const opacityOf = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  const surface = () => { const b = bgOf(document.querySelector('main') || document.body); return b; };
  // every visible text-bearing element with its contrast ratio
  const contrast = () => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (['SCRIPT', 'STYLE', 'SVG', 'PATH'].includes(el.tagName.toUpperCase())) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3 && norm(n.textContent)).map((n) => norm(n.textContent)).join(' ');
      if (!own || !shown(el)) continue;
      if (el.disabled || el.closest('[disabled], [aria-disabled=true], [hidden]')) continue;
      const bg = bgOf(el);
      if (!bg) continue;
      const cs = getComputedStyle(el);
      let fg = toRgba(cs.color);
      fg[3] *= opacityOf(el);
      fg = over(fg, bg);
      out.push({ text: own.slice(0, 40), ratio: Math.round(ratio(fg, bg) * 100) / 100 });
    }
    return out;
  };
  window.__s = { norm, shown, row, choice, pick, surface, contrast, lum, main };
})();`;
const HS = (app, expr) => app.eval(`${SETTINGS_HELPERS}; (() => { return ${expr}; })()`);
const openSettings = async (app) => { await openItem(app, 'Settings'); await app.until(`/Changes are saved at once\\./.test(document.body.innerText)`, 'the Settings screen', 5000); await sleep(200); };
const theme = (app) => app.eval(`(() => ({ attr: document.documentElement.getAttribute('data-theme'), scheme: getComputedStyle(document.documentElement).colorScheme, inline: document.documentElement.style.colorScheme }))()`);
const surfaceOf = (app) => HS(app, '__s.surface()');
const same = (a, b) => a && b && a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) < 2);


// choose a theme in Settings and return the page surface colour afterwards
async function choose(app, name) {
  assert.equal(await HS(app, `__s.pick(${JSON.stringify(name)})`), true, `Appearance offers no '${name}' choice`);
  await sleep(300);
}

// ---------------------------------------------------------------- AC1
test("AC1: Settings opens from 'Apps and settings' with the title and the saved-at-once line", UI, () =>
  withApp('ok', async (app) => {
    await openSettings(app);
    const r = await HS(app, `({ h: [...document.querySelectorAll('h1, h2')].map((h) => __s.norm(h.textContent)), t: __s.main().innerText })`);
    assert.ok(r.h.includes('Settings'), `no heading 'Settings' (headings: ${r.h})`);
    const lines = r.t.split('\n').map((l) => l.trim()).filter(Boolean);
    const i = lines.indexOf('Settings');
    assert.ok(i >= 0, 'main has no line that is exactly Settings');
    assert.equal(lines[i + 1], 'Changes are saved at once.', "the line under the title is not 'Changes are saved at once.'");
  }));

test('AC1: a section list on the left shows Appearance, AI and Data, each with its current value', UI, () =>
  withApp('ok', async (app) => {
    await openSettings(app);
    const r = await HS(app, `(() => { const o = {}; for (const n of ['Appearance', 'AI', 'Data']) { const e = __s.row(n); o[n] = e ? { text: __s.norm(e.textContent), x: e.getBoundingClientRect().left, right: e.getBoundingClientRect().right } : null; } return o; })()`);
    for (const n of ['Appearance', 'AI', 'Data']) assert.ok(r[n], `no '${n}' section row`);
    assert.match(r.Appearance.text, /\bSystem\b/, `the Appearance row does not show System: ${r.Appearance.text}`);
    assert.ok(r.AI.text.length > 'AI'.length, `the AI row shows no value: ${r.AI.text}`);
    assert.ok(r.Data.text.length > 'Data'.length, `the Data row shows no value: ${r.Data.text}`);
    const vw = await app.eval('innerWidth');
    assert.ok(r.Appearance.x < vw / 2, 'the section list is not on the left');
  }));

test('AC1: section content is on the right of the section list', UI, () =>
  withApp('ok', async (app) => {
    await openSettings(app);
    const r = await HS(app, `(() => { const row = __s.row('Appearance').getBoundingClientRect(); const c = __s.choice('Dark'); return { rowRight: row.right, choice: c ? c.getBoundingClientRect().left : null }; })()`);
    assert.ok(r.choice !== null, 'no Dark choice shown for the default section');
    assert.ok(r.choice >= r.rowRight - 1, `the content (${r.choice}) is not right of the section list (${r.rowRight})`);
  }));

test('AC1: the AI and Data sections open and are empty', UI, () =>
  withApp('ok', async (app) => {
    await openSettings(app);
    for (const n of ['AI', 'Data']) {
      assert.equal(await HS(app, `(() => { const e = __s.row(${JSON.stringify(n)}); if (!e) return false; e.click(); return true; })()`), true, `no ${n} row`);
      await sleep(200);
      const r = await HS(app, `({ choice: !!__s.choice('Dark') || !!__s.choice('Light'), controls: __s.main().querySelectorAll('button, input, select, textarea').length, rows: 3 })`);
      assert.equal(r.choice, false, `${n} still shows the theme choices`);
      assert.ok(r.controls <= 3 + 1, `${n} is not empty: ${r.controls} controls in the screen`);
    }
  }));

// ---------------------------------------------------------------- AC2
test('AC2: Appearance offers System, Light and Dark and nothing else', UI, () =>
  withApp('ok', async (app) => {
    await openSettings(app);
    const r = await HS(app, `({ yes: ['System', 'Light', 'Dark'].map((n) => !!__s.choice(n)), extra: ['Beige', 'Charcoal', 'Ocean', 'Pine'].filter((n) => new RegExp('\\\\b' + n + '\\\\b').test(__s.main().innerText)) })`);
    assert.deepEqual(r.yes, [true, true, true], 'System, Light and Dark must all be offered');
    assert.deepEqual(r.extra, [], 'the prototype extra themes must not be offered');
  }));

test('AC2: choosing Dark applies at once: data-theme and color-scheme, no reload; the row value updates', UI, () =>
  withApp('ok', async (app) => {
    await app.media('light');
    await openSettings(app);
    await app.eval(`window.__marker = 'same-document'`);
    const before = await surfaceOf(app);
    await choose(app, 'Dark');
    const t = await theme(app);
    assert.equal(t.attr, 'dark');
    assert.equal(t.scheme, 'dark', 'color-scheme is not dark');
    assert.equal(await app.eval('window.__marker'), 'same-document', 'the page reloaded');
    const after = await surfaceOf(app);
    assert.ok(!same(before, after), 'the colours did not change');
    assert.ok(await HS(app, `__s.lum(${JSON.stringify(after)}) < 0.2`), `Dark surface is not dark: ${after}`);
    const row = await HS(app, `__s.norm(__s.row('Appearance').textContent)`);
    assert.match(row, /\bDark\b/, `the row did not update: ${row}`);
  }));

test('AC2: choosing Light overrides a dark OS and updates the row', UI, () =>
  withApp('ok', async (app) => {
    await app.media('dark');
    await openSettings(app);
    await choose(app, 'Light');
    const t = await theme(app);
    assert.equal(t.attr, 'light');
    assert.equal(t.scheme, 'light');
    const s = await surfaceOf(app);
    assert.ok(await HS(app, `__s.lum(${JSON.stringify(s)}) > 0.5`), `Light surface is not light: ${s}`);
    assert.match(await HS(app, `__s.norm(__s.row('Appearance').textContent)`), /\bLight\b/);
  }));

test('AC2: choosing Dark overrides a light OS', UI, () =>
  withApp('ok', async (app) => {
    await app.media('light');
    await openSettings(app);
    await choose(app, 'Dark');
    const s = await surfaceOf(app);
    assert.ok(await HS(app, `__s.lum(${JSON.stringify(s)}) < 0.2`), `Dark surface is not dark: ${s}`);
  }));

// ---------------------------------------------------------------- AC3
test("AC3: the choice is saved under the key 'theme' through set_setting", UI, () =>
  withApp('ok', async (app) => {
    await openSettings(app);
    for (const [label, value] of [['Dark', 'dark'], ['Light', 'light'], ['System', 'system']]) {
      await choose(app, label);
      const store = await app.eval(`JSON.parse(localStorage.getItem('__mnemo_fake_settings__') || '{}')`);
      assert.equal(store.theme, value, `after choosing ${label} the stored theme is ${JSON.stringify(store.theme)}`);
    }
    const calls = await app.eval('window.__calls');
    const sets = calls.filter((c) => c.cmd === 'set_setting' && c.args && c.args.key === 'theme');
    assert.ok(sets.length >= 3, `expected set_setting calls for theme, saw: ${JSON.stringify(calls.map((c) => c.cmd))}`);
    assert.deepEqual(calls.filter((c) => /setting/i.test(c.cmd) && !['get_setting', 'set_setting'].includes(c.cmd)), [], 'a second settings command was used');
  }));

test("AC3: the theme is read with get_setting on key 'theme' at start", UI, () =>
  withApp('ok', async (app) => {
    const calls = await app.eval('window.__calls');
    assert.ok(calls.some((c) => c.cmd === 'get_setting' && c.args && c.args.key === 'theme'), `no get_setting for theme: ${JSON.stringify(calls)}`);
  }));

test('AC3: a missing value means System', UI, () =>
  withApp('ok', async (app) => {
    assert.notEqual((await theme(app)).attr, 'light');
    assert.notEqual((await theme(app)).attr, 'dark');
    await openSettings(app);
    assert.match(await HS(app, `__s.norm(__s.row('Appearance').textContent)`), /\bSystem\b/);
  }));

test('AC3: an unknown stored value means System', UI, () =>
  withAppOpts('ok', { seed: { theme: 'purple' } }, async (app) => {
    const t = await theme(app);
    assert.ok(t.attr !== 'light' && t.attr !== 'dark', `data-theme is ${t.attr}`);
    await openSettings(app);
    assert.match(await HS(app, `__s.norm(__s.row('Appearance').textContent)`), /\bSystem\b/);
    await app.media('dark');
    await sleep(300);
    const d = await surfaceOf(app);
    await app.media('light');
    await sleep(300);
    const l = await surfaceOf(app);
    assert.ok(!same(d, l), 'an unknown value did not follow the OS theme');
  }));

test('AC3: the saved Dark is applied before the first paint and survives Quit and start', UI, async () => {
  const profile = mkdtempSync(join(tmpdir(), 'mnemo-app12-profile-'));
  try {
    const first = await openApp('ok', { profile });
    try {
      await first.goto();
      await first.media('light');
      await openSettings(first);
      await choose(first, 'Dark');
    } finally { await first.close(); }
    const second = await openApp('ok', { profile });
    try {
      await second.goto();
      const t = await theme(second);
      assert.equal(t.attr, 'dark', 'still Dark after Quit and start');
      const paint = await second.eval(`(() => { const fp = performance.getEntriesByType('paint').find((e) => e.name === 'first-paint' || e.name === 'first-contentful-paint'); return { themeAt: window.__paint.themeAt, val: window.__paint.themeVal, fp: fp ? fp.startTime : null }; })()`);
      assert.equal(paint.val, 'dark', 'data-theme was never set to dark');
      if (paint.fp !== null) assert.ok(paint.themeAt <= paint.fp, `the theme was set at ${paint.themeAt} ms, after the first paint at ${paint.fp} ms`);
      await openSettings(second);
      assert.match(await HS(second, `__s.norm(__s.row('Appearance').textContent)`), /\bDark\b/);
    } finally { await second.close(); }
  } finally { rmSync(profile, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- AC4
test('AC4: with System chosen the app follows the OS theme live, without a restart', UI, () =>
  withApp('ok', async (app) => {
    await app.media('light');
    await openSettings(app);
    await choose(app, 'System');
    await app.eval(`window.__marker = 'same-document'`);
    await sleep(200);
    const light = await surfaceOf(app);
    await app.media('dark');
    await sleep(400);
    const dark = await surfaceOf(app);
    assert.ok(!same(light, dark), 'the colours did not change when the OS went dark');
    assert.ok(await HS(app, `__s.lum(${JSON.stringify(dark)}) < 0.2`), `not dark under a dark OS: ${dark}`);
    await app.media('light');
    await sleep(400);
    const back = await surfaceOf(app);
    assert.ok(same(light, back), 'the colours did not return when the OS went light');
    assert.equal(await app.eval('window.__marker'), 'same-document');
  }));

test('AC4: Light and Dark ignore OS changes', UI, () =>
  withApp('ok', async (app) => {
    await openSettings(app);
    await choose(app, 'Dark');
    await app.media('light');
    await sleep(300);
    const a = await surfaceOf(app);
    await app.media('dark');
    await sleep(300);
    const b = await surfaceOf(app);
    assert.ok(same(a, b), 'Dark changed with the OS');
    assert.ok(await HS(app, `__s.lum(${JSON.stringify(a)}) < 0.2`));
  }));

test('AC4: tokens.css has attribute overrides for light and dark', () => {
  const t = readFileSync(p('ui', 'src', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(t, /\[data-theme=["']?dark["']?\]/, 'no [data-theme=dark] rule in tokens.css');
  assert.match(t, /\[data-theme=["']?light["']?\]/, 'no [data-theme=light] rule in tokens.css');
  assert.match(t, /prefers-color-scheme\s*:\s*dark/i, 'the prefers-color-scheme rule must stay for System');
});

test('AC4: no raw colour values outside tokens.css (CSS and TypeScript)', () => {
  const RAW = /#[0-9a-f]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch|hwb|lab|lch)\(/i;
  const files = walk(p('ui')).filter((f) => /\.(css|ts|html)$/.test(f) && !/tokens\.css$/.test(f) && !/\.test\.ts$/.test(f));
  const bad = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (RAW.test(src)) bad.push(f.slice(ROOT.length + 1));
  }
  assert.deepEqual(bad, [], `raw colours in: ${bad.join(', ')}`);
});

// ---------------------------------------------------------------- AC5
const MIN = 4.5;
async function readable(app, where) {
  const rows = await HS(app, '__s.contrast()');
  assert.ok(rows.length > 0, `${where}: no text found`);
  const low = rows.filter((r) => r.ratio < MIN).map((r) => `${JSON.stringify(r.text)} ${r.ratio}`);
  assert.deepEqual(low, [], `${where}: text below ${MIN}:1: ${low.join('; ')}`);
}

for (const mode of ['light', 'dark']) {
  test(`AC5: the frame, empty states and Settings are readable in ${mode} (contrast at least 4.5:1)`, UI, () =>
    withAppOpts('ok', { seed: { theme: mode } }, async (app) => {
      assert.equal((await theme(app)).attr, mode, `the ${mode} theme was not applied at start`);
      await readable(app, `app frame (${mode})`);
      for (const item of ['Today', 'Files (PDF)', 'Everything']) {
        await openItem(app, item);
        await readable(app, `${item} (${mode})`);
      }
      await openSettings(app);
      await readable(app, `Settings Appearance (${mode})`);
      for (const n of ['AI', 'Data']) {
        await HS(app, `__s.row(${JSON.stringify(n)}).click()`);
        await sleep(200);
        await readable(app, `Settings ${n} (${mode})`);
      }
      const s = await surfaceOf(app);
      assert.ok(await HS(app, mode === 'dark' ? `__s.lum(${JSON.stringify(s)}) < 0.2` : `__s.lum(${JSON.stringify(s)}) > 0.5`), `${mode} surface looks wrong: ${s}`);
    }));
}

for (const mode of ['light', 'dark']) {
  test(`AC5: the startup error page is readable under a ${mode} OS (contrast at least 4.5:1)`, UI, async () => {
    const app = await openApp('down');
    try {
      await app.media(mode);
      await app.gotoPath('/error.html', `!!document.querySelector('main')`);
      await readable(app, `error page (${mode})`);
      const s = await surfaceOf(app);
      assert.ok(await HS(app, mode === 'dark' ? `__s.lum(${JSON.stringify(s)}) < 0.2` : `__s.lum(${JSON.stringify(s)}) > 0.5`), `error page is not ${mode}: ${s}`);
    } finally { await app.close(); }
  });
}

// ---------------------------------------------------------------- AC7
const FAIL_WORDS = /(could not|couldn't|can't|cannot|failed|unable|not saved|not read|did not)/i;
const themeLine = (app) => app.eval(`document.body.innerText.split('\\n').map((l) => l.trim()).filter((l) => /theme|appearance/i.test(l) && /(could not|couldn't|can't|cannot|failed|unable|not saved|not read|did not)/i.test(l))`);

test('AC7: a failed read of the theme shows a plain line and the app works with the system theme', UI, () =>
  withApp('down', async (app) => {
    await app.media('dark');
    await sleep(300);
    const lines = await themeLine(app);
    assert.ok(lines.length > 0, 'no visible line says the theme could not be read');
    for (const l of lines) assert.match(l, FAIL_WORDS);
    const t = await theme(app);
    assert.ok(t.attr !== 'light' && t.attr !== 'dark', `data-theme is ${t.attr} though nothing could be read`);
    // the app still renders and the system theme is used
    assert.ok(await app.eval(`!!document.querySelector('nav')`), 'the sidebar is gone');
    const dark = await surfaceOf(app);
    assert.ok(await HS(app, `__s.lum(${JSON.stringify(dark)}) < 0.2`), 'the system (dark) theme is not used');
    await openItem(app, 'Settings');
    await sleep(300);
    assert.match(await app.mainText(), /Changes are saved at once\./, 'Settings does not open when the store is down');
  }));

test('AC7: a failed save of the theme shows a plain line and the app keeps working', UI, () =>
  withApp('save-fails', async (app) => {
    await openSettings(app);
    await choose(app, 'Dark');
    await app.until(`/(theme|appearance)/i.test(document.body.innerText) && document.body.innerText.split('\\n').some((l) => /theme|appearance/i.test(l) && /(could not|couldn't|can't|cannot|failed|unable|not saved|did not)/i.test(l))`, 'a visible line that the theme was not saved', 5000);
    const lines = await themeLine(app);
    assert.ok(lines.length > 0);
    assert.ok(await app.eval(`!!document.querySelector('nav')`), 'the sidebar is gone');
    assert.match(await app.mainText(), /Changes are saved at once\./, 'Settings went blank after the failed save');
    // still usable: another choice can be made
    assert.equal(await HS(app, `!!__s.choice('Light')`), true, 'the choices disappeared after the failure');
  }));

test('AC7: no second store: a failed save never writes the theme anywhere else', UI, () =>
  withApp('save-fails', async (app) => {
    await openSettings(app);
    await choose(app, 'Dark');
    const extra = await app.eval(`[...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((k) => k !== '__mnemo_fake_settings__' && /theme/i.test(k + (localStorage.getItem(k) || '') + (sessionStorage.getItem(k) || '')))`);
    assert.deepEqual(extra, [], `the theme was written to ${extra}`);
  }));
