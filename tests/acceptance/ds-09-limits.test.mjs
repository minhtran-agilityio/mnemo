// Acceptance tests for #113 [DS-09] Limits tab: hard content, small window, both machines.
// Run: node --test --test-isolation=none tests/acceptance/ds-09-limits.test.mjs
// Black box. The UI Catalog is dev only, so the Vite dev server runs on a private port and headless Google
// Chrome is driven through the DevTools protocol, with the Tauri bridge replaced by an in-page fake (same
// idea as app-03-settings). The smallest window is 800 x 560; 200% zoom at that size is a 400 x 280 CSS
// viewport at device scale 2. UI tests skip when no Chrome is found (set MNEMO_CHROME).
// Not testable here: AC4 numbers written in the PR, AC7 screenshots and the PR notes, the design-system label.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const p = (...a) => join(ROOT, ...a);
const read = (...a) => readFileSync(p(...a), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const walk = (d, out = []) => {
  if (!existsSync(d)) return out;
  for (const n of readdirSync(d)) {
    if (['node_modules', 'target', '.git', 'dist', 'gen'].includes(n)) continue;
    const f = join(d, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
};

// ---------------------------------------------------------------- AC1 (config)
test('AC1: the main window has minWidth 800 and minHeight 560, and starts at 900 x 640', () => {
  const w = JSON.parse(read('src-tauri', 'tauri.conf.json')).app.windows[0];
  assert.equal(w.minWidth, 800);
  assert.equal(w.minHeight, 560);
  assert.equal(w.width, 900);
  assert.equal(w.height, 640);
});

test('AC1: the window is built from the config (WebviewWindowBuilder::from_config) so the minimum applies', () => {
  const rs = walk(p('src-tauri', 'src')).filter((f) => f.endsWith('.rs'));
  const hit = rs.filter((f) => /WebviewWindowBuilder::from_config/.test(readFileSync(f, 'utf8')));
  assert.ok(hit.length > 0, 'no WebviewWindowBuilder::from_config in src-tauri/src');
});

test('AC1: a test other than this file holds the window minimum', () => {
  const files = [
    ...walk(p('src-tauri', 'src')).filter((f) => f.endsWith('.rs') && /#\[test\]/.test(readFileSync(f, 'utf8'))),
    ...walk(p('src-tauri', 'tests')).filter((f) => f.endsWith('.rs')),
    ...readdirSync(p('tests')).filter((f) => f.endsWith('.test.mjs')).map((f) => p('tests', f)),
  ];
  const hit = files.filter((f) => {
    const t = readFileSync(f, 'utf8');
    return /minWidth|min_width|min_inner_size/.test(t) && /\b800\b/.test(t) && /\b560\b/.test(t);
  });
  assert.ok(hit.length > 0, 'no Rust test or config test checks minWidth 800 and minHeight 560');
});

// ---------------------------------------------------------------- AC6 (static)
test('AC6: KNOWN_EXCEPTIONS stays empty', async () => {
  const m = await import(p('tests', 'lib', 'ds-guard.mjs'));
  assert.deepEqual(m.KNOWN_EXCEPTIONS, []);
});

test("AC6: no 'sqlite' and no 'sign in' in ui files", () => {
  const bad = walk(p('ui')).filter((f) => /\.(ts|css|html|js|mjs|json|svg)$/.test(f)).filter((f) => /sqlite|sign[\s-]?in\b/i.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- harness
const CHROME = [process.env.MNEMO_CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((c) => c && existsSync(c));
const SKIP_UI = CHROME ? false : 'no Chrome found (set MNEMO_CHROME)';
const UI = { timeout: 300000, skip: SKIP_UI };
let vite = null;
let port = 0;
let viteLog = '';

const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port: pt } = s.address(); s.close(() => ok(pt)); }); });

let started = null;
const ensureServer = () => (started ??= (async () => {
  port = await freePort();
  // Start Vite with node directly, not through npx: killing npx left the real Vite running with
  // its pipes open, so node --test never exited after the last test.
  vite = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  vite.stdout.on('data', (d) => { viteLog += d; });
  vite.stderr.on('data', (d) => { viteLog += d; });
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/index.html`); if (r.ok) return; } catch { /* not yet */ }
    await sleep(100);
  }
  assert.fail(`vite dev server did not start:\n${viteLog.slice(-800)}`);
})());
after(() => {
  if (!vite) return;
  vite.stdout?.destroy();
  vite.stderr?.destroy();
  vite.kill('SIGKILL');
});

const bridgeScript = (mode) => `(() => {
  const MODE = ${JSON.stringify(mode)};
  const KEY = '__mnemo_fake_settings__';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
  const invoke = async (cmd, args) => {
    if (/setting/i.test(cmd)) {
      if (MODE === 'down') throw { code: 'storage', message: 'The data file could not be read.' };
      const store = read();
      if (args && Object.prototype.hasOwnProperty.call(args, 'value') && args.value !== undefined) { store[args.key] = args.value; localStorage.setItem(KEY, JSON.stringify(store)); return null; }
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

// size: { w, h, dsf } in CSS pixels; scheme: 'light' | 'dark'; reduce: emulate prefers-reduced-motion
async function openApp({ w = 800, h = 560, dsf = 1, scheme = 'light', reduce = false, mode = 'ok' } = {}) {
  await ensureServer();
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-ds09-chrome-'));
  // detached: Chrome leads its own process group, so one kill takes the crashpad and zygote helpers too.
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-crash-reporter', '--disable-breakpad', '--remote-debugging-port=0', `--user-data-dir=${dir}`, `--window-size=${w},${h}`, 'about:blank'], { stdio: 'ignore', detached: true });
  const cleanup = () => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { try { proc.kill('SIGKILL'); } catch { /* gone */ } } try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp dir, left for the OS */ } };
  try {
    let wsUrl;
    for (let i = 0; i < 300 && !wsUrl; i++) {
      await sleep(100);
      const f = join(dir, 'DevToolsActivePort');
      if (existsSync(f)) { const [pt, path] = readFileSync(f, 'utf8').trim().split('\n'); if (path) wsUrl = `ws://127.0.0.1:${pt}${path}`; }
    }
    assert.ok(wsUrl, 'Chrome did not start within 30 s');
    const ws = new WebSocket(wsUrl);
    await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { ok, bad } = pending.get(d.id); pending.delete(d.id); d.error ? bad(new Error(JSON.stringify(d.error))) : ok(d.result); } };
    // when the socket closes (Chrome crashed or was closed) every call still waiting fails at once
    ws.onclose = () => { for (const { bad } of pending.values()) bad(new Error('Chrome closed the DevTools connection')); pending.clear(); };
    const send = (method, params = {}, sessionId) => new Promise((ok, bad) => { if (ws.readyState !== 1) return bad(new Error('Chrome closed the DevTools connection')); const i = ++id; pending.set(i, { ok, bad }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, pr) => send(m, pr, sessionId);
    await S('Page.enable');
    await S('Runtime.enable');
    await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile: false });
    const features = [{ name: 'prefers-color-scheme', value: scheme }];
    if (reduce) features.push({ name: 'prefers-reduced-motion', value: 'reduce' });
    await S('Emulation.setEmulatedMedia', { features });
    await S('Page.addScriptToEvaluateOnNewDocument', { source: bridgeScript(mode) });
    const ev = async (expr) => {
      const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`page error: ${JSON.stringify(r.exceptionDetails).slice(0, 500)}`);
      return r.result.value;
    };
    const app = {
      eval: ev,
      async until(expr, what, ms = 10000) {
        const end = Date.now() + ms;
        while (Date.now() < end) { try { if (await ev(expr)) return; } catch { /* retry */ } await sleep(100); }
        assert.fail(`timed out waiting for ${what}`);
      },
      async goto(path, ready) {
        await S('Page.navigate', { url: `http://127.0.0.1:${port}${path}` });
        await app.until(`document.readyState === 'complete' && (${ready})`, `${path} to render`, 30000);
        await sleep(500);
      },
      // click a visible a/button/tab whose name is the label (or starts with it)
      click: (label) => ev(`(() => {
        const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
        const name = (e) => norm(e.getAttribute('aria-label') || e.textContent || e.getAttribute('title'));
        const shown = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const l = ${JSON.stringify(label)};
        const e = [...document.querySelectorAll('a, button, [role=link], [role=button], [role=menuitem], [role=tab], [role=switch]')].find((x) => { const n = name(x); return (n === l || n.startsWith(l + ' ')) && shown(x); });
        if (!e) return false; e.click(); return true; })()`),
      async openItem(label) {
        if (!(await app.click(label))) { await app.click('Apps and settings'); await sleep(200); assert.ok(await app.click(label), `no sidebar item '${label}'`); }
        await sleep(400);
      },
      toggleSidebar: () => ev(`(() => {
        const nav = document.querySelector('nav');
        const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
        const b = [...nav.querySelectorAll('button, [role=button]')].find((e) => /collaps|expand|toggle|sidebar|menu/i.test(norm(e.getAttribute('aria-label') || '') + ' ' + norm(e.textContent) + ' ' + (e.getAttribute('title') || '')));
        if (!b) return false; b.click(); return true; })()`),
      async close() { try { await Promise.race([send('Browser.close'), sleep(2000)]); } catch { /* closing */ } try { ws.close(); } catch { /* closed */ } cleanup(); },
    };
    return app;
  } catch (e) { cleanup(); throw e; }
}

async function withApp(opts, fn) {
  const app = await openApp(opts);
  try { await fn(app); } finally { await app.close(); }
}

// ---- in-page audits
// scroll: horizontal scroll of the document, and in app screens of any visible scroll box (the catalog's own
//   specimen frames are fixed-size windows on purpose, so inside the catalog only the document counts)
// hclip: text cut sideways: an overflow hidden or clip box that hides its own text without an ellipsis, or text
//   whose line box leaves (even wholly) a hidden, clip or non-scrolling ancestor on the left or right
// vclip: text whose line box, plus 15% of the font size for stacked marks, leaves a clipping ancestor above or below
// Skipped on purpose: a real scroll box that does scroll, a line clamp, a text-overflow ellipsis on the text's own
// inline line, and the one specimen element that a caption calls a counter-example.
const AUDIT = `(() => {
  const IN_CATALOG = location.hash.startsWith('#/ui-catalog');
  const out = { scroll: [], hclip: [], vclip: [], texts: 0 };
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) out.scroll.push('document ' + de.scrollWidth + ' > ' + de.clientWidth);
  if (document.body.scrollWidth > de.clientWidth + 1) out.scroll.push('body ' + document.body.scrollWidth + ' > ' + de.clientWidth);
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const label = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(' ')[0] : '') + ' "' + (el.textContent || '').trim().slice(0, 30) + '"';
  const scrolls = (cs) => cs === 'auto' || cs === 'scroll';
  const range = document.createRange();
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    // the specimen of a deliberate counter-example (the next sibling is its caption, which starts with 'counter-example') is meant to be cut
    const nx = el.nextElementSibling;
    if (nx && nx.classList.contains('cap') && /^counter-example/i.test((nx.textContent || '').trim())) continue;
    const cs = getComputedStyle(el);
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const wide = el.scrollWidth > el.clientWidth + 1;
    if (!IN_CATALOG && scrolls(cs.overflowX) && wide) out.scroll.push(label(el) + ' ' + el.scrollWidth + ' > ' + el.clientWidth);
    if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && hasText && wide && cs.textOverflow !== 'ellipsis') out.hclip.push(label(el) + ' ' + el.scrollWidth + ' > ' + el.clientWidth);
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own.length) continue;
    out.texts++;
    const fs = parseFloat(cs.fontSize);
    const pad = 0.15 * fs;
    const inline = (a) => { for (let n = el; n && n !== a; n = n.parentElement) if (getComputedStyle(n).display !== 'inline') return false; return true; };
    let hFlag = false;
    let vFlag = false;
    for (const n of own) {
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 1) continue;
        // The part of this line that can still be seen. A box that scrolls the text, a text-overflow ellipsis or a
        // line clamp cuts it by design, so the visible part shrinks to that box and the outer boxes are tested with
        // what is left. A box that cuts it any other way, even wholly, is a finding.
        let hl = r.left;
        let hr = r.right;
        let vt = r.top - pad;
        let vb = r.bottom + pad;
        let hDone = false;
        let vDone = false;
        for (let a = el; a && a !== de && !(hDone && vDone); a = a.parentElement) {
          const acs = getComputedStyle(a);
          if (acs.overflowX === 'visible' && acs.overflowY === 'visible') continue;
          const ar = a.getBoundingClientRect();
          if (ar.width <= 1 || ar.height <= 1) continue;
          const clamped = acs.webkitLineClamp && acs.webkitLineClamp !== 'none';
          if (!vDone && acs.overflowY !== 'visible') {
            const top = ar.top + parseFloat(acs.borderTopWidth);
            const bottom = ar.bottom - parseFloat(acs.borderBottomWidth);
            if (clamped || (scrolls(acs.overflowY) && a.scrollHeight > a.clientHeight + 1)) {
              vt = Math.max(vt, top);
              vb = Math.min(vb, bottom);
              if (vt >= vb) vDone = true;
            } else if (vt < top - 0.5 || vb > bottom + 0.5) {
              if (!vFlag) out.vclip.push(label(el) + ' inside ' + label(a) + ' text ' + Math.round(r.top) + '-' + Math.round(r.bottom) + ' box ' + Math.round(top) + '-' + Math.round(bottom));
              vFlag = true;
              vDone = true;
            }
          }
          if (!hDone && acs.overflowX !== 'visible') {
            const left = ar.left + parseFloat(acs.borderLeftWidth);
            const right = ar.right - parseFloat(acs.borderRightWidth);
            if ((scrolls(acs.overflowX) && a.scrollWidth > a.clientWidth + 1) || (acs.textOverflow === 'ellipsis' && inline(a))) {
              hl = Math.max(hl, left);
              hr = Math.min(hr, right);
              if (hl >= hr) hDone = true;
            } else if (hl < left - 0.5 || hr > right + 0.5) {
              if (!hFlag) out.hclip.push(label(el) + ' inside ' + label(a) + ' text ' + Math.round(r.left) + '-' + Math.round(r.right) + ' box ' + Math.round(left) + '-' + Math.round(right));
              hFlag = true;
              hDone = true;
            }
          }
        }
      }
    }
  }
  return out;
})()`;

const MOTION = `(() => {
  const bad = [];
  const nz = (v) => v.split(',').some((x) => parseFloat(x) > 0);
  const name = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(' ')[0] : '');
  for (const el of [document.documentElement, ...document.querySelectorAll('*')]) {
    for (const ps of [null, '::before', '::after']) {
      const cs = getComputedStyle(el, ps);
      if (cs.animationName !== 'none' && nz(cs.animationDuration)) bad.push('animation ' + cs.animationName + ' on ' + name(el) + (ps || ''));
      if (cs.transitionProperty !== 'none' && nz(cs.transitionDuration)) bad.push('transition ' + cs.transitionDuration + ' on ' + name(el) + (ps || ''));
    }
  }
  const running = document.getAnimations().filter((a) => a.playState === 'running').map((a) => (a.animationName || a.transitionProperty || 'animation'));
  return { bad: [...new Set(bad)], running };
})()`;

const SIZES = [
  { label: '800 x 560', w: 800, h: 560, dsf: 1 },
  { label: '200% zoom (400 x 280 CSS px)', w: 400, h: 280, dsf: 2 },
];
const CATALOG_READY = `!!document.querySelector('[role=tab]')`;
// visible tabs only: the note-editor specimens carry their own hidden tab lists
const catalogTabs = (app) => app.eval(`[...document.querySelectorAll('[role="tab"]')].filter((t) => t.getBoundingClientRect().width > 0).map((t) => t.textContent.trim())`);

// runs fn(label, auditResult) for each app screen
async function eachAppScreen(app, fn) {
  await app.goto('/index.html', `!!document.querySelector('nav')`);
  await app.openItem('Today');
  await fn('Today, sidebar open', await app.eval(AUDIT));
  assert.ok(await app.toggleSidebar(), 'no sidebar toggle');
  await sleep(500);
  await fn('Today, sidebar collapsed', await app.eval(AUDIT));
  assert.ok(await app.toggleSidebar());
  await sleep(500);
  await app.openItem('Files (PDF)');
  await fn('empty state (Files (PDF))', await app.eval(AUDIT));
  await app.openItem('Settings');
  await app.until(`/Changes are saved at once\\./.test(document.body.innerText)`, 'Settings');
  await fn('Settings', await app.eval(AUDIT));
}
async function eachCatalogTab(app, fn) {
  await app.goto('/#/ui-catalog', CATALOG_READY);
  const tabs = await catalogTabs(app);
  assert.ok(tabs.includes('Limits'), `no Limits tab among ${tabs}`);
  for (const t of tabs) {
    assert.ok(await app.click(t), `cannot open tab ${t}`);
    await sleep(500);
    await fn(`catalog tab ${t}`, await app.eval(AUDIT));
  }
}
const errorPage = async (app, fn) => {
  await app.goto('/error.html', `!!document.querySelector('main')`);
  await fn('error page', await app.eval(AUDIT));
};

// One collection per colour scheme, shared by AC2 and the two AC3 tests: every size, app screen, error page
// and catalog tab is opened once, and each problem is filed under its kind (scroll, hclip, vclip).
const collected = new Map();
const collectAll = (scheme) => {
  if (!collected.has(scheme)) {
    collected.set(scheme, (async () => {
      const problems = { scroll: [], hclip: [], vclip: [] };
      // Each page must hold text for the audit to check, else a blank page would pass every check.
      const blank = [];
      let pages = 0;
      const add = (l, s, r) => {
        pages++;
        if (!(r.texts > 0)) blank.push(`${l} @ ${s.label}: no text found to check`);
        for (const kind of Object.keys(problems)) for (const x of r[kind]) problems[kind].push(`${l} @ ${s.label}: ${x}`);
      };
      for (const s of SIZES) {
        await withApp({ ...s, scheme }, (app) => eachAppScreen(app, (l, r) => add(l, s, r)));
        await withApp({ ...s, scheme, mode: 'down' }, (app) => errorPage(app, (l, r) => add(l, s, r)));
        await withApp({ ...s, scheme }, (app) => eachCatalogTab(app, (l, r) => add(l, s, r)));
      }
      if (pages === 0) blank.push('no page was audited');
      return { ...problems, blank };
    })());
  }
  return collected.get(scheme);
};

// ---------------------------------------------------------------- AC2
for (const scheme of ['light', 'dark']) {
  test(`AC2: no horizontal scroll at 800 x 560 and at 200% zoom on any app screen or catalog tab (${scheme})`, UI, async () => {
    const c = await collectAll(scheme);
    assert.deepEqual(c.blank, []);
    assert.deepEqual(c.scroll, []);
  });
}

// ---------------------------------------------------------------- AC3
for (const scheme of ['light', 'dark']) {
  test(`AC3: no text is clipped sideways without an ellipsis, by its own box or an ancestor (${scheme})`, UI, async () => {
    const c = await collectAll(scheme);
    assert.deepEqual(c.blank, []);
    assert.deepEqual(c.hclip, []);
  });
  test(`AC3: no line is cut above or below, marks safe, by its own box or an ancestor (${scheme})`, UI, async () => {
    const c = await collectAll(scheme);
    assert.deepEqual(c.blank, []);
    assert.deepEqual(c.vclip, []);
  });
}

test('AC3: the Limits tab holds Vietnamese stacked marks and a very long title, and they fit their parts', UI, () =>
  withApp({}, async (app) => {
    await app.goto('/#/ui-catalog', CATALOG_READY);
    assert.ok(await app.click('Limits'), 'no Limits tab');
    await sleep(600);
    const r = await app.eval(`(() => {
      const t = document.body.innerText;
      const viet = /[ẫậặẳỗữỖỘỔỮỰỬẪẬẨẴẶẲỄỆỂ]/.test(t);
      return { viet, audit: ${AUDIT} };
    })()`);
    assert.ok(r.viet, 'no Vietnamese stacked-marks specimen in the Limits tab');
    assert.ok(r.audit.texts > 0, 'the audit found no text in the Limits tab');
    assert.deepEqual([...r.audit.scroll, ...r.audit.hclip, ...r.audit.vclip], []);
  }));

// Issue 171. Text that runs out of its tinted pill is not clipped, so the clip audit above cannot see it. In the
// Records tab every trust label (Written by AI, Guess) keeps its words inside its pill, and in a List row of a
// link the label stays off the meta line (site and date).
const TRUST_AUDIT = `(() => {
  const bad = [];
  const range = document.createRange();
  const x = (n) => Math.round(n);
  let metas = 0;
  for (const pill of document.querySelectorAll('.trust')) {
    const pr = pill.getBoundingClientRect();
    if (pr.width < 1 || pr.height < 1) continue;
    const word = pill.textContent.trim();
    for (const n of pill.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 1) continue;
        if (r.left < pr.left - 0.5 || r.right > pr.right + 0.5 || r.top < pr.top - 0.5 || r.bottom > pr.bottom + 0.5)
          bad.push('"' + word + '" text x' + x(r.left) + '-' + x(r.right) + ' outside its pill x' + x(pr.left) + '-' + x(pr.right));
      }
    }
    const meta = pill.closest('.link-row')?.querySelector('.meta');
    if (meta) {
      metas++;
      const mr = meta.getBoundingClientRect();
      if (pr.right > mr.left + 0.5 && pr.left < mr.right - 0.5 && pr.bottom > mr.top && pr.top < mr.bottom)
        bad.push('"' + word + '" pill x' + x(pr.left) + '-' + x(pr.right) + ' overlaps the meta line x' + x(mr.left) + '-' + x(mr.right));
    }
  }
  return { bad, labels: document.querySelectorAll('.link-row .trust').length, metas };
})()`;

for (const scheme of ['light', 'dark']) {
  test(`AC3: in the Records tab a trust label keeps its words in its pill and off a link row's meta line (${scheme})`, UI, async () => {
    const bad = [];
    for (const s of SIZES) {
      await withApp({ ...s, scheme }, async (app) => {
        await app.goto('/#/ui-catalog', CATALOG_READY);
        assert.ok(await app.click('Records'), 'no Records tab');
        await sleep(500);
        const r = await app.eval(TRUST_AUDIT);
        assert.ok(r.labels > 0, `no labelled link row in the Records tab @ ${s.label}`);
        assert.ok(r.metas > 0, `no meta line found next to a labelled link row @ ${s.label}`);
        for (const b of r.bad) bad.push(`${b} @ ${s.label}`);
      });
    }
    assert.deepEqual(bad, []);
  });
}

// Issues 171 and 172. The List row of a link: the icon, then .link-main, which holds the body and the meta line (the
// app badge, then .link-host with the site, a dot and the date). At the page's own width, and with each list set to
// widths from 280 to 800px (with 420, 500 and 540, the narrow lists of issue 172):
// - no row is wider than its list, and .link-main fills the row after the icon (the row's gap from the icon, up to
//   the row's content edge), so the checks below that use .link-main are checks against the row;
// - a cut site has the whole line of the row after the icon (its .link-host spans it), and keeps at least
//   --size-link-site-min (or the whole line, when that is narrower): no cap leaves room unused;
// - a site's box is never wider than its text (+1px), so a host shorter than --size-link-site-min ("t.me") leaves no
//   gap before its dot (a focused row, whose host wraps, is left out of this one);
// - nothing spills out of the meta line, and the meta line stays inside .link-main;
// - the date is one piece, on the site's row;
// - a meta line that wrapped under the body, and a .link-host that wrapped under the badge, start at the title's edge.
// The counts make sure each check ran.
const ROW_WIDTHS = [280, 320, 360, 400, 420, 440, 480, 500, 520, 540, 560, 600, 640, 680, 720, 760, 800];
const ROW_SEEN = ['rows', 'filled', 'wrapped', 'shared', 'cut', 'metaParts', 'dates', 'badges', 'hostUnderBadge', 'sites', 'shortHosts'];
const ROW_AUDIT = `(() => {
  const bad = [];
  const x = (n) => Math.round(n * 100) / 100;
  const seen = Object.fromEntries(${JSON.stringify(ROW_SEEN)}.map((k) => [k, 0]));
  const sample = [];
  const range = document.createRange();
  // The widest line box of a text, not the sum: Chrome gives a cut text more than one rect.
  const widest = (node) => { range.selectNodeContents(node); return Math.max(0, ...[...range.getClientRects()].map((r) => r.width)); };
  // --size-link-site-min in the site's own font (it is in ch, so it must resolve in the site's 11px mono, not in
  // the 12.5px body font around it): the probe goes inside the site and inherits its font. Call it after the
  // site's text is measured.
  const siteMin = (site) => {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;width:var(--size-link-site-min)';
    site.append(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  };
  const lists = [...new Set([...document.querySelectorAll('.link-row')].map((r) => r.parentElement))];
  const check = (width) => {
    for (const row of document.querySelectorAll('.link-row')) {
      const rr = row.getBoundingClientRect();
      if (rr.width < 1) continue;
      seen.rows++;
      const at = '"' + row.querySelector('.row-title').textContent.slice(0, 24) + '"' + (row.querySelector('.app') ? ' (badge)' : '') + ' @ list ' + width;
      const lr = row.parentElement.getBoundingClientRect();
      if (rr.right > lr.right + 0.5 || rr.left < lr.left - 0.5) bad.push(at + ': row x' + x(rr.left) + '-' + x(rr.right) + ' leaves its list x' + x(lr.left) + '-' + x(lr.right));
      const main = row.querySelector(':scope > .link-main');
      const meta = main?.querySelector(':scope > .meta');
      if (!meta) { bad.push(at + ': no .link-main > .meta'); continue; }
      // .link-main fills the row after the icon.
      const cs = getComputedStyle(row);
      const icon = row.firstElementChild.getBoundingClientRect();
      const lineLeft = icon.right + parseFloat(cs.columnGap);
      const lineRight = rr.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
      const mainR = main.getBoundingClientRect();
      if (Math.abs(mainR.left - lineLeft) > 0.5 || Math.abs(mainR.right - lineRight) > 0.5)
        bad.push(at + ': .link-main x' + x(mainR.left) + '-' + x(mainR.right) + ' does not fill the row after the icon, x' + x(lineLeft) + '-' + x(lineRight));
      else seen.filled++;
      const title = main.querySelector('.row-title').getBoundingClientRect();
      const body = main.querySelector(':scope > .row-body').getBoundingClientRect();
      const mr = meta.getBoundingClientRect();
      const host = meta.querySelector(':scope > .link-host');
      const hr = host?.getBoundingClientRect();
      const site = host?.querySelector(':scope > .site');
      const wrapped = mr.top >= body.bottom - 0.5;
      if (wrapped) {
        seen.wrapped++;
        if (Math.abs(mr.left - title.left) > 0.5) bad.push(at + ': wrapped meta starts at x' + x(mr.left) + ', the title at x' + x(title.left));
      } else seen.shared++;
      if (meta.querySelector(':scope > .app')) {
        seen.badges++;
        if (host && hr.top >= meta.querySelector(':scope > .app').getBoundingClientRect().bottom - 0.5) {
          seen.hostUnderBadge++;
          if (Math.abs(hr.left - title.left) > 0.5) bad.push(at + ': site and date wrapped under the badge start at x' + x(hr.left) + ', the title at x' + x(title.left));
        }
      }
      // Nothing spills: the meta line stays in .link-main, and every part of it stays in the meta line.
      if (mr.left < mainR.left - 0.5 || mr.right > mainR.right + 0.5) bad.push(at + ': meta x' + x(mr.left) + '-' + x(mr.right) + ' leaves .link-main x' + x(mainR.left) + '-' + x(mainR.right));
      for (const part of meta.querySelectorAll('*')) {
        const pr = part.getBoundingClientRect();
        if (pr.width < 1) continue;
        seen.metaParts++;
        if (pr.left < mr.left - 0.5 || pr.right > mr.right + 0.5) bad.push(at + ': "' + part.textContent.slice(0, 20) + '" x' + x(pr.left) + '-' + x(pr.right) + ' spills out of its meta line x' + x(mr.left) + '-' + x(mr.right));
      }
      // scrollWidth and clientWidth are whole pixels, so a site short by a fraction of a pixel (still cut, with an
      // ellipsis) would pass unseen. Compare the text's own width with the site's box instead.
      let siteBox = 0;
      let siteText = 0;
      let floor = 0;
      if (site) {
        siteBox = site.getBoundingClientRect().width;
        siteText = widest(site);
        floor = siteMin(site);
        seen.sites++;
        if (siteText < floor - 0.5) seen.shortHosts++;
        // The box hugs the text: no gap after a short host. A focused row wraps its host, so its widest line is
        // narrower than the box by design.
        if (!row.matches('.is-focus, :focus-visible') && siteBox > siteText + 1)
          bad.push(at + ': site "' + site.textContent.slice(0, 20) + '" box ' + x(siteBox) + 'px is wider than its text ' + x(siteText) + 'px');
      }
      if (site && siteText > siteBox + 0.05) {
        seen.cut++;
        // A cut site has the row's whole line after the icon, and at least its smallest width.
        if (Math.abs(hr.left - lineLeft) > 0.5 || Math.abs(hr.right - lineRight) > 1)
          bad.push(at + ': site cut (' + x(siteBox) + ' of ' + x(siteText) + 'px) while its site and date have x' + x(hr.left) + '-' + x(hr.right) + ' of the row line x' + x(lineLeft) + '-' + x(lineRight));
        const least = Math.min(floor, hr.width);
        if (siteBox < least - 0.5) bad.push(at + ': site cut to ' + x(siteBox) + 'px, under its smallest width ' + x(least) + 'px');
      }
      const date = host?.lastElementChild;
      if (date && date !== site) {
        seen.dates++;
        range.selectNodeContents(date);
        const rects = [...range.getClientRects()].filter((r) => r.width >= 1);
        if (rects.length !== 1) bad.push(at + ': the date "' + date.textContent + '" has ' + rects.length + ' line boxes');
        if (site) {
          const sr = site.getBoundingClientRect();
          const dr = date.getBoundingClientRect();
          const mid = (r) => (r.top + r.bottom) / 2;
          if (Math.abs(mid(sr) - mid(dr)) > sr.height / 2) bad.push(at + ': the date is not on the site row');
        }
      }
      if (row.querySelector('.row-title').textContent === 'Tauri 2 capabilities' && site?.textContent === 'v2.tauri.app' && !row.matches('.is-hover, .is-focus, .is-active')) {
        const kind = row.querySelector('.app') ? 'badge' : 'plain';
        if (!sample.some((s) => s.width === width && s.kind === kind))
          sample.push({ width, kind, site: x(siteBox) + '/' + x(siteText), meta: x(mr.width) + '/' + x(mainR.width), left: { title: x(title.left), meta: x(mr.left), host: x(hr.left) }, wrapped, underBadge: !!row.querySelector('.app') && hr.top > mr.top + 1 });
      }
    }
  };
  check('page');
  for (const w of ${JSON.stringify(ROW_WIDTHS)}) {
    for (const l of lists) l.style.width = w + 'px';
    check(w);
  }
  for (const l of lists) l.style.width = '';
  return { bad, seen, sample };
})()`;

for (const scheme of ['light', 'dark']) {
  test(`AC3: a link's List row fills its row, keeps a short site whole when it has room and a cut one at its smallest width or more, spills nothing, keeps its date on the site's row and a wrapped meta under the title (${scheme})`, UI, async () => {
    const bad = [];
    const seen = Object.fromEntries(ROW_SEEN.map((k) => [k, 0]));
    for (const s of SIZES) {
      await withApp({ ...s, scheme }, async (app) => {
        await app.goto('/#/ui-catalog', CATALOG_READY);
        assert.ok(await app.click('Records'), 'no Records tab');
        await sleep(500);
        const r = await app.eval(ROW_AUDIT);
        assert.ok(r.seen.rows > 0, `no link List row in the Records tab @ ${s.label}`);
        for (const k of ROW_SEEN) seen[k] += r.seen[k];
        for (const b of r.bad) bad.push(`${b} @ ${s.label}`);
        if (process.env.MNEMO_ROW_SAMPLE) for (const line of r.sample) console.log(scheme, s.label, JSON.stringify(line));
      });
    }
    assert.ok(seen.wrapped > 0, 'no wrapped meta line seen, so the title-edge check never ran');
    assert.ok(seen.shared > 0, 'no meta line seen on the body line, so the layout never shared a line');
    assert.ok(seen.cut > 0, 'no cut site seen, so the full-line and smallest-width checks never ran');
    assert.ok(seen.dates > 0, 'no date seen, so the date checks never ran');
    assert.ok(seen.badges > 0, 'no row with an app badge seen');
    assert.ok(seen.hostUnderBadge > 0, 'no site and date seen wrapped under a badge, so that edge check never ran');
    assert.ok(seen.metaParts > 0, 'no meta part measured, so the spill check never ran');
    assert.ok(seen.sites > 0, 'no site measured, so the box-hugs-text check never ran');
    assert.ok(seen.shortHosts > 0, 'no host shorter than --size-link-site-min seen, so a short host was never checked');
    assert.deepEqual(bad, []);
    assert.equal(seen.filled, seen.rows, 'a .link-main does not fill its row after the icon');
  });
}

// Control for the site checks above: a style injected into the page sets the List row sites.
// - Held at exactly --size-link-site-min (8ch of the site's 11px mono font), no site is reported under its smallest
//   width; held 1px under it, a cut site is. A probe that resolved 8ch in the meta line's 12.5px body font (about
//   50px) let 51.8px pass, and fails the second half.
// - With the 8ch floor put back on min-width (min-width wins over max-width: max-content), a short host gets an 8ch
//   box, and the box-hugs-text check reports it.
test('AC3: control, the List row audit reports a site 1px under --size-link-site-min, none at it, and a short host in an 8ch box', UI, () =>
  withApp({}, async (app) => {
    await app.goto('/#/ui-catalog', CATALOG_READY);
    assert.ok(await app.click('Records'), 'no Records tab');
    await sleep(500);
    const under = (r) => r.bad.filter((b) => b.includes('under its smallest width'));
    const hold = (width) => app.eval(`(() => {
      let s = document.getElementById('ds09-site-hold');
      if (!s) { s = document.createElement('style'); s.id = 'ds09-site-hold'; document.head.append(s); }
      s.textContent = '.link-main .link-host > .site { flex: none !important; min-width: 0 !important; width: ${width} !important; max-width: none !important; }';
      return true;
    })()`);
    await hold('var(--size-link-site-min)');
    const at = await app.eval(ROW_AUDIT);
    assert.ok(at.seen.cut > 0, 'no cut site seen with the sites held at their smallest width');
    assert.deepEqual(under(at), []);
    await hold('calc(var(--size-link-site-min) - 1px)');
    const below = await app.eval(ROW_AUDIT);
    assert.ok(below.seen.cut > 0, 'no cut site seen with the sites held under their smallest width');
    assert.ok(under(below).length > 0, 'a site held 1px under its smallest width was not reported');
    await app.eval(`(() => {
      document.getElementById('ds09-site-hold').textContent = '.link-main .link-host > .site { min-width: min(var(--size-link-site-min), 100%) !important; }';
      return true;
    })()`);
    const floored = await app.eval(ROW_AUDIT);
    assert.ok(floored.seen.shortHosts > 0, 'no short host seen with the old 8ch min-width floor');
    assert.ok(floored.bad.some((b) => b.includes('is wider than its text')), 'a short host in an 8ch box was not reported');
  }));

// Issue 175. The Compact row of a link: the title, the reading spinner, the site (.dom) and the date. In the Records
// tab, at the page's own width and with each list set to widths from 150 to 800px (the narrowest catalog column is
// 158px at 200% zoom and 161px at 800 x 560, as issues 172 and 175 measured it; 150, 155 and 166 are where a reading
// row's medium host, github.io or example.org, wraps alone or first wraps):
// - no row is wider than its list, and every part stays inside the row's content box, with no part over another;
// - a cut title keeps at least --size-link-site-min (8ch of the title's own font, or the whole line when that is
//   narrower), so the site is cut before the title drops below it;
// - a cut site keeps at least --size-link-site-min of its own font (or the whole line), so its ellipsis shows;
// - on a line the title shares with a cut site: the title's box is no wider than its text or its minimum, whichever
//   is wider (+1px), so a short title never keeps empty room next to a cut host; and a cut title gets at least the
//   room the site got above its 8ch start (title >= site - 8ch of the site's font - 1px), so a long title is never
//   starved by a long host (a title alone on its line, with the site wrapped under it, takes the line);
// - on a one-line row the date ends at the row's content edge;
// - a site's box is never wider than its text (+1px): a short host ("t.me") has no gap after it (a focused row,
//   whose host wraps, is left out of this one);
// - the date is one piece, never cut; the spinner sits on the title's line, right after it;
// - when the parts do not fit one line, a wrapped part starts at the row's content edge, under the title, and no
//   row wraps at a list of 280px or wider.
// The counts make sure each check ran.
// 145 is under the narrowest catalog column: since the vietnamese subsets are bundled (issue 189) the Vietnamese
// titles are narrower than in the old fallback font, so a reading row's site first wraps near 148px, not at 150px, and
// the control below needs a width where it does.
const COMPACT_WIDTHS = [145, 150, 155, 158, 160, 161, 166, 170, 180, 190, 200, 210, 220, 240, 260, 280, 320, 360, 400, 480, 560, 640, 720, 800];
const COMPACT_SEEN = ['rows', 'cutTitles', 'cutHosts', 'hosts', 'shortHosts', 'dates', 'spinners', 'wrapped', 'oneLine', 'parts', 'titlesBesideCutHost', 'shortTitles', 'longTitlesBesideCutHost', 'datesAtEnd', 'noSite', 'wrappedSites'];
const COMPACT_AUDIT = `(() => {
  const bad = [];
  const x = (n) => Math.round(n * 100) / 100;
  const seen = Object.fromEntries(${JSON.stringify(COMPACT_SEEN)}.map((k) => [k, 0]));
  const sample = [];
  const range = document.createRange();
  const widest = (node) => { range.selectNodeContents(node); return Math.max(0, ...[...range.getClientRects()].map((r) => r.width)); };
  // --size-link-site-min in the element's own font (8ch): the probe goes inside it and inherits its font. Call it
  // after the element's text is measured.
  const floorIn = (el) => {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;width:var(--size-link-site-min)';
    el.append(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  };
  const rowsNow = () => [...document.querySelectorAll('.compact-row')].filter((r) => r.getBoundingClientRect().width >= 1);
  const lists = [...new Set(rowsNow().map((r) => r.parentElement))];
  const check = (width) => {
    for (const row of rowsNow()) {
      seen.rows++;
      const focused = row.matches('.is-focus, :focus-visible');
      const titleEl = row.querySelector(':scope > .row-title');
      const at = '"' + titleEl.textContent.slice(0, 24) + '"' + (row.dataset.status === 'reading' ? ' (reading)' : '') + (focused ? ' (focus)' : '') + ' @ list ' + width;
      const rr = row.getBoundingClientRect();
      const lr = row.parentElement.getBoundingClientRect();
      if (rr.right > lr.right + 0.5 || rr.left < lr.left - 0.5) bad.push(at + ': row x' + x(rr.left) + '-' + x(rr.right) + ' leaves its list x' + x(lr.left) + '-' + x(lr.right));
      const cs = getComputedStyle(row);
      const left = rr.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
      const right = rr.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
      const content = right - left;
      // Nothing spills out of the row's content box, and no part sits over the one before it on its line.
      const parts = [...row.children].filter((c) => c.getBoundingClientRect().width >= 1);
      let prev = null;
      for (const part of parts) {
        seen.parts++;
        const pr = part.getBoundingClientRect();
        if (pr.left < left - 0.5 || pr.right > right + 0.5) bad.push(at + ': ' + part.className + ' "' + part.textContent.slice(0, 20) + '" x' + x(pr.left) + '-' + x(pr.right) + ' spills out of the row x' + x(left) + '-' + x(right));
        if (prev) {
          const qr = prev.getBoundingClientRect();
          const sameLine = pr.top < qr.bottom - 0.5 && pr.bottom > qr.top + 0.5;
          if (sameLine && pr.left < qr.right - 0.5) bad.push(at + ': ' + part.className + ' x' + x(pr.left) + ' sits over ' + prev.className + ' x' + x(qr.right));
          // A part on a new line starts at the row's content edge, under the title.
          if (!sameLine && pr.top >= qr.bottom - 0.5 && part.classList.contains('dom')) seen.wrappedSites++;
          if (!sameLine && pr.top >= qr.bottom - 0.5 && Math.abs(pr.left - left) > 0.5) bad.push(at + ': ' + part.className + ' wrapped to x' + x(pr.left) + ', not the row edge x' + x(left));
        }
        prev = part;
      }
      // The title: a cut title keeps at least 8ch of its font, or the whole line.
      const tBox = titleEl.getBoundingClientRect();
      const tText = widest(titleEl);
      const tFloor = floorIn(titleEl);
      const site = row.querySelector(':scope > .dom');
      const sBox = site ? site.getBoundingClientRect().width : 0;
      const sText = site ? widest(site) : 0;
      const sFloor = site ? floorIn(site) : 0;
      const siteCut = !!site && !focused && sText > sBox + 0.05;
      if (tText > tBox.width + 0.05) {
        seen.cutTitles++;
        const least = Math.min(tFloor, content);
        if (tBox.width < least - 0.5) bad.push(at + ': title cut to ' + x(tBox.width) + 'px, under its minimum ' + x(least) + 'px' + (site ? ', while the site is ' + (siteCut ? 'cut to ' + x(sBox) : 'whole at ' + x(sBox)) + 'px' : ''));
      }
      if (site) {
        seen.hosts++;
        if (sText < sFloor - 0.5) seen.shortHosts++;
        if (!focused && sBox > sText + 1) bad.push(at + ': site "' + site.textContent.slice(0, 20) + '" box ' + x(sBox) + 'px is wider than its text ' + x(sText) + 'px');
        if (siteCut) {
          seen.cutHosts++;
          const least = Math.min(sFloor, content);
          if (sBox < least - 0.5) bad.push(at + ': site cut to ' + x(sBox) + 'px, under its smallest width ' + x(least) + 'px');
          if (getComputedStyle(site).textOverflow !== 'ellipsis') bad.push(at + ': a cut site has no ellipsis');
          const sr = site.getBoundingClientRect();
          const shareLine = sr.top < tBox.bottom - 0.5 && sr.bottom > tBox.top + 0.5;
          if (shareLine) seen.titlesBesideCutHost++;
          if (shareLine && tText > tBox.width + 0.05) {
            seen.longTitlesBesideCutHost++;
            if (tBox.width < sBox - sFloor - 1) bad.push(at + ': title cut to ' + x(tBox.width) + 'px, less than the site got above its 8ch start (' + x(sBox) + ' - ' + x(sFloor) + 'px)');
          }
          if (shareLine && tBox.width > Math.max(tText, tFloor) + 1) bad.push(at + ': title box ' + x(tBox.width) + 'px is wider than its text ' + x(tText) + 'px and its minimum ' + x(tFloor) + 'px while the site is cut to ' + x(sBox) + 'px');
        }
      }
      // The date: one piece, never cut.
      const date = row.querySelector(':scope > .row-meta');
      let wrapped = false;
      if (date) {
        seen.dates++;
        range.selectNodeContents(date);
        const rects = [...range.getClientRects()].filter((r) => r.width >= 1);
        if (rects.length !== 1) bad.push(at + ': the date "' + date.textContent + '" has ' + rects.length + ' line boxes');
        const dr = date.getBoundingClientRect();
        if (widest(date) > dr.width + 0.05) bad.push(at + ': the date is cut');
        wrapped = dr.top >= tBox.bottom - 0.5;
      }
      if (date && !wrapped) {
        seen.datesAtEnd++;
        const dr = date.getBoundingClientRect();
        if (Math.abs(dr.right - right) > 0.5) bad.push(at + ': the date ends at x' + x(dr.right) + ', not the row end x' + x(right));
      }
      if (wrapped) {
        seen.wrapped++;
        if (typeof width === 'number' && width >= 280) bad.push(at + ': the row wraps at a list of ' + width + 'px');
      } else seen.oneLine++;
      // The spinner: on the title's line, right after it (the part order check above keeps it off the title).
      if (!site) seen.noSite++;
      const spin = row.querySelector(':scope > .compact-reading');
      if (spin) {
        seen.spinners++;
        const sr = spin.getBoundingClientRect();
        if (!(sr.top < tBox.bottom && sr.bottom > tBox.top)) bad.push(at + ': the spinner is not on the title line');
      }
      if (tText < tFloor - 0.5 && siteCut && site.getBoundingClientRect().top < tBox.bottom - 0.5) seen.shortTitles++;
      const kind = titleEl.textContent === 'Go' ? 'short' : titleEl.textContent.startsWith('Hướng') ? 'overflow' : row.dataset.status === 'reading' ? 'reading' : site?.textContent === 't.me' ? 't.me' : null;
      if (kind && !row.matches('.is-hover, .is-active') && !sample.some((s) => s.width === width && s.kind === kind + (focused ? '-focus' : '')))
        sample.push({ width, kind: kind + (focused ? '-focus' : ''), title: x(tBox.width) + '/' + x(tText), site: site ? x(sBox) + '/' + x(sText) : '-', titleMin: x(tFloor), wrapped });
    }
  };
  check('page');
  for (const w of ${JSON.stringify(COMPACT_WIDTHS)}) {
    for (const l of lists) l.style.width = w + 'px';
    check(w);
  }
  for (const l of lists) l.style.width = '';
  return { bad, seen, sample };
})()`;

for (const scheme of ['light', 'dark']) {
  test(`AC3: a link's Compact row keeps a cut title at its readable minimum, cuts the site first, spills nothing and wraps only in narrow lists (${scheme})`, UI, async () => {
    const bad = [];
    const seen = Object.fromEntries(COMPACT_SEEN.map((k) => [k, 0]));
    for (const s of SIZES) {
      await withApp({ ...s, scheme }, async (app) => {
        await app.goto('/#/ui-catalog', CATALOG_READY);
        assert.ok(await app.click('Records'), 'no Records tab');
        await sleep(500);
        const r = await app.eval(COMPACT_AUDIT);
        assert.ok(r.seen.rows > 0, `no link Compact row in the Records tab @ ${s.label}`);
        for (const k of COMPACT_SEEN) seen[k] += r.seen[k];
        for (const b of r.bad) bad.push(`${b} @ ${s.label}`);
        if (process.env.MNEMO_COMPACT_SAMPLE) for (const line of r.sample) console.log(scheme, s.label, JSON.stringify(line));
      });
    }
    assert.deepEqual(bad, []);
    assert.ok(seen.cutTitles > 0, 'no cut title seen, so the title minimum check never ran');
    assert.ok(seen.cutHosts > 0, 'no cut site seen, so the site checks never ran');
    assert.ok(seen.shortHosts > 0, 'no host shorter than --size-link-site-min seen, so a short host was never checked');
    assert.ok(seen.spinners > 0, 'no reading spinner seen');
    assert.ok(seen.dates > 0, 'no date seen, so the date checks never ran');
    assert.ok(seen.wrapped > 0, 'no wrapped row seen, so the wrapped-edge check never ran');
    assert.ok(seen.oneLine > 0, 'no one-line row seen');
    assert.ok(seen.parts > 0, 'no part measured, so the spill check never ran');
    assert.ok(seen.titlesBesideCutHost > 0, 'no title measured next to a cut site, so the first-claim check never ran');
    assert.ok(seen.shortTitles > 0, 'no title shorter than its minimum seen next to a cut site');
    assert.ok(seen.longTitlesBesideCutHost > 0, 'no cut title seen next to a cut site, so the long-title check never ran');
    assert.ok(seen.datesAtEnd > 0, 'no one-line row with a date seen, so the date-at-end check never ran');
    assert.ok(seen.noSite > 0, 'no row without a site seen');
    assert.ok(seen.wrappedSites > 0, 'no site wrapped to a second line seen, so its row-edge check never ran');
  });
}

// Control for the Compact checks above, with a style injected into the page:
// - titles held at exactly --size-link-site-min (8ch of the title font): no title is reported under its minimum;
//   held 1px under it, a cut title is;
// - the layout before issue 175 (the title from zero, the site up to half the row, one line): the 161px column's
//   title of a few pixels is reported;
// - the title with no max-content cap (the equal split of the first version of issue 175): the short title's empty
//   box next to a cut long host is reported;
// - the site with first claim on the room (flex-grow 1000, the second version): the long title starved next to a
//   long host is reported;
// - no auto end margin on the title or spinner: a one-line row whose date stops short of the row end is reported;
// - the auto margin on the site instead (fb6db27): a reading row's site wrapped to a second line, pushed off the row
//   edge, is reported;
// - a site that never shrinks: it is reported spilling out of the row.
test('AC3: control, the Compact row audit reports a title 1px under its minimum, none at it, the old layout, an uncapped title, a host-first split, a date short of the row end, a wrapped site off the row edge and a spilling site', UI, () =>
  withApp({}, async (app) => {
    await app.goto('/#/ui-catalog', CATALOG_READY);
    assert.ok(await app.click('Records'), 'no Records tab');
    await sleep(500);
    const under = (r) => r.bad.filter((b) => b.includes('under its minimum'));
    const style = (css) => app.eval(`(() => {
      let s = document.getElementById('ds09-compact-hold');
      if (!s) { s = document.createElement('style'); s.id = 'ds09-compact-hold'; document.head.append(s); }
      s.textContent = ${JSON.stringify(css)};
      return true;
    })()`);
    const hold = (width) => style(`.compact-row .row-title { flex: none !important; min-width: 0 !important; width: ${width} !important; }`);
    await hold('var(--size-link-site-min)');
    const at = await app.eval(COMPACT_AUDIT);
    assert.ok(at.seen.cutTitles > 0, 'no cut title seen with the titles held at their minimum');
    assert.deepEqual(under(at), []);
    await hold('calc(var(--size-link-site-min) - 1px)');
    const below = await app.eval(COMPACT_AUDIT);
    assert.ok(below.seen.cutTitles > 0, 'no cut title seen with the titles held under their minimum');
    assert.ok(under(below).length > 0, 'a title held 1px under its minimum was not reported');
    await style('.compact-row { flex-wrap: nowrap !important; } .compact-row .row-title { min-width: 0 !important; max-width: none !important; } .compact-row .dom { flex: 0 1 auto !important; max-width: 50% !important; }');
    const old = await app.eval(COMPACT_AUDIT);
    assert.ok(under(old).some((b) => b.includes('@ list 161')), 'the old layout, with its title of a few pixels at 161px, was not reported');
    await style('.compact-row .row-title { max-width: none !important; }');
    const equal = await app.eval(COMPACT_AUDIT);
    assert.ok(equal.bad.some((b) => b.startsWith('"Go"') && b.includes('while the site is cut')), 'a short title holding empty room next to a cut host was not reported');
    await style('.compact-row .dom { flex-grow: 1000 !important; }');
    const hostFirst = await app.eval(COMPACT_AUDIT);
    assert.ok(hostFirst.bad.some((b) => b.startsWith('"Hướng') && b.includes('less than the site got')), 'a long title starved by a long host was not reported');
    await style('.compact-row > .row-title, .compact-row > .compact-reading { margin-inline-end: 0 !important; }');
    const noEnd = await app.eval(COMPACT_AUDIT);
    assert.ok(noEnd.bad.some((b) => b.includes('not the row end')), 'a date short of the row end was not reported');
    await style('.compact-row > .row-title, .compact-row > .compact-reading { margin-inline-end: 0 !important; } .compact-row .dom { margin-inline-start: auto !important; }');
    const hostMargin = await app.eval(COMPACT_AUDIT);
    assert.ok(hostMargin.bad.some((b) => b.includes(' (reading)') && b.includes(': dom wrapped to x')), 'a wrapped site pushed off the row edge by its auto margin (fb6db27) was not reported');
    await style('.compact-row { flex-wrap: nowrap !important; } .compact-row .dom { min-width: max-content !important; }');
    const spill = await app.eval(COMPACT_AUDIT);
    assert.ok(spill.bad.some((b) => b.includes('spills out of the row')), 'a site that never shrinks was not reported spilling');
  }));

// Issue 179. The actions of a link card, in its .lcard-action slot. In the Records tab, at each card's own width in
// the catalog (the example columns, and the narrow column of 160px, --size-basis-setting) and with every card that
// has actions set to widths from 120 to 360px (120 and 140 narrower than any catalog column; 160 the narrow column;
// 220 the Cards view's --size-basis-column; 260 the example basis; 360 --size-tags-max, the widest example):
// - every button stays inside the card's content box, and the slot too: nothing spills out of the card;
// - a button's label stays inside its button (a long label wraps in its box);
// - no button sits over another, and two buttons on one line are at least --space-2 apart, in the given order;
// - a button that wrapped to a new line starts at the slot's start edge.
// The counts make sure each check ran: two-button cards, a pair on one line and a wrapped button.
const ACTION_WIDTHS = [120, 140, 160, 200, 220, 260, 300, 360];
const ACTION_SEEN = ['cards', 'buttons', 'twoButtons', 'sharedLine', 'wrapped', 'wrappedLabels'];
const ACTION_AUDIT = `(() => {
  const bad = [];
  const x = (n) => Math.round(n * 100) / 100;
  const seen = Object.fromEntries(${JSON.stringify(ACTION_SEEN)}.map((k) => [k, 0]));
  const sample = [];
  const range = document.createRange();
  const shown = (e) => { const r = e.getBoundingClientRect(); return r.width >= 1 && r.height >= 1; };
  const cards = [...document.querySelectorAll('.lcard')].filter((c) => shown(c) && c.querySelector(':scope > .lcard-action'));
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;width:var(--space-2)';
  document.body.append(probe);
  const gap = probe.getBoundingClientRect().width;
  probe.remove();
  const inner = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { left: r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), right: r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth) };
  };
  const check = (width) => {
    for (const card of cards) {
      seen.cards++;
      const slot = card.querySelector(':scope > .lcard-action');
      const buttons = [...slot.children].filter(shown);
      const names = buttons.map((b) => b.textContent.trim());
      const at = '[' + names.join(' | ').slice(0, 60) + '] @ card ' + width;
      const box = inner(card);
      const sl = inner(slot);
      const sr = slot.getBoundingClientRect();
      if (sr.left < box.left - 0.5 || sr.right > box.right + 0.5) bad.push(at + ': the slot x' + x(sr.left) + '-' + x(sr.right) + ' spills out of the card x' + x(box.left) + '-' + x(box.right));
      if (buttons.length >= 2) seen.twoButtons++;
      let prev = null;
      let wrappedHere = 0;
      for (const b of buttons) {
        seen.buttons++;
        const br = b.getBoundingClientRect();
        const name = '"' + b.textContent.trim().slice(0, 24) + '"';
        if (br.left < box.left - 0.5 || br.right > box.right + 0.5) bad.push(at + ': ' + name + ' x' + x(br.left) + '-' + x(br.right) + ' spills out of the card x' + x(box.left) + '-' + x(box.right));
        // The label stays inside its button.
        let lines = 0;
        for (const n of b.childNodes) {
          if (n.nodeType !== 3 || !n.textContent.trim()) continue;
          range.selectNodeContents(n);
          const rects = [...range.getClientRects()].filter((r) => r.width >= 1);
          lines += new Set(rects.map((r) => Math.round(r.top))).size;
          for (const r of rects)
            if (r.left < br.left - 0.5 || r.right > br.right + 0.5 || r.top < br.top - 0.5 || r.bottom > br.bottom + 0.5)
              bad.push(at + ': the label of ' + name + ' x' + x(r.left) + '-' + x(r.right) + ' spills out of its button x' + x(br.left) + '-' + x(br.right));
        }
        if (lines > 1) seen.wrappedLabels++;
        if (prev) {
          const pr = prev.getBoundingClientRect();
          const overlap = br.left < pr.right - 0.5 && br.right > pr.left + 0.5 && br.top < pr.bottom - 0.5 && br.bottom > pr.top + 0.5;
          if (overlap) bad.push(at + ': ' + name + ' x' + x(br.left) + '-' + x(br.right) + ' sits over the button before it x' + x(pr.left) + '-' + x(pr.right));
          const sameLine = br.top < pr.bottom - 0.5 && br.bottom > pr.top + 0.5;
          if (sameLine) {
            seen.sharedLine++;
            if (br.left < pr.right + gap - 0.5) bad.push(at + ': ' + name + ' starts ' + x(br.left - pr.right) + 'px after the button before it, under the --space-2 gap ' + x(gap) + 'px');
          } else if (br.top >= pr.bottom - 0.5) {
            seen.wrapped++;
            wrappedHere++;
            if (Math.abs(br.left - sl.left) > 0.5) bad.push(at + ': ' + name + ' wrapped to x' + x(br.left) + ', not the slot edge x' + x(sl.left));
          } else bad.push(at + ': ' + name + ' sits above the button before it');
        }
        prev = b;
      }
      if (buttons.length >= 2 && width === 'catalog') sample.push({ width, names: names.join(" | ").slice(0, 40), card: x(card.getBoundingClientRect().width), buttons: names.length, wrapped: wrappedHere, widths: buttons.map((b) => x(b.getBoundingClientRect().width)) });
    }
  };
  check('catalog');
  for (const w of ${JSON.stringify(ACTION_WIDTHS)}) {
    for (const c of cards) c.style.width = w + 'px';
    check(w);
  }
  for (const c of cards) c.style.width = '';
  return { bad, seen, sample, gap };
})()`;

for (const scheme of ['light', 'dark']) {
  test(`AC3: a link card's actions stay inside the card, apart and in order, and a wrapped one starts at the slot edge (${scheme})`, UI, async () => {
    const bad = [];
    const seen = Object.fromEntries(ACTION_SEEN.map((k) => [k, 0]));
    for (const s of SIZES) {
      await withApp({ ...s, scheme }, async (app) => {
        await app.goto('/#/ui-catalog', CATALOG_READY);
        assert.ok(await app.click('Records'), 'no Records tab');
        await sleep(500);
        const r = await app.eval(ACTION_AUDIT);
        assert.ok(r.seen.cards > 0, `no link card with actions in the Records tab @ ${s.label}`);
        assert.ok(r.gap > 0, `--space-2 did not resolve @ ${s.label}`);
        for (const k of ACTION_SEEN) seen[k] += r.seen[k];
        for (const b of r.bad) bad.push(`${b} @ ${s.label}`);
        if (process.env.MNEMO_ACTION_SAMPLE) for (const line of r.sample) console.log(scheme, s.label, JSON.stringify(line));
      });
    }
    assert.deepEqual(bad, []);
    assert.ok(seen.twoButtons > 0, 'no card with two actions seen');
    assert.ok(seen.sharedLine > 0, 'no two actions seen on one line, so the gap and order checks never ran');
    assert.ok(seen.wrapped > 0, 'no wrapped action seen, so the slot-edge check never ran');
    assert.ok(seen.wrappedLabels > 0, 'no label wrapped inside its button seen, so the label spill check never met a long label');
  });
}

// Control for the action checks above, with a style injected into the page:
// - the slot before issue 179 (one line, each button at least its longest word): buttons spill out of narrow cards;
// - the buttons pushed to the end (justify-content: flex-end): a wrapped button off the slot edge is reported;
// - a negative margin on the second button: it is reported over the first;
// - a label that may not wrap (white-space: nowrap): it is reported spilling out of its button.
test('AC3: control, the link card action audit reports the one-line slot spilling, a wrapped button off the edge, an overlap and a label out of its button', UI, () =>
  withApp({}, async (app) => {
    await app.goto('/#/ui-catalog', CATALOG_READY);
    assert.ok(await app.click('Records'), 'no Records tab');
    await sleep(500);
    const style = (css) => app.eval(`(() => {
      let s = document.getElementById('ds09-action-hold');
      if (!s) { s = document.createElement('style'); s.id = 'ds09-action-hold'; document.head.append(s); }
      s.textContent = ${JSON.stringify(css)};
      return true;
    })()`);
    await style('');
    const clean = await app.eval(ACTION_AUDIT);
    assert.deepEqual(clean.bad, []);
    assert.ok(clean.seen.wrapped > 0, 'no wrapped action seen with no style injected');
    await style('.lcard .lcard-action { flex-wrap: nowrap !important; } .lcard .lcard-action > * { min-width: auto !important; overflow-wrap: normal !important; }');
    const old = await app.eval(ACTION_AUDIT);
    assert.equal(old.seen.wrapped, 0, 'a button wrapped with the slot held on one line');
    assert.ok(old.bad.some((b) => b.includes('spills out of the card')), 'the one-line slot before issue 179 was not reported spilling out of a narrow card');
    await style('.lcard .lcard-action { justify-content: flex-end !important; }');
    const end = await app.eval(ACTION_AUDIT);
    assert.ok(end.bad.some((b) => b.includes('not the slot edge')), 'a wrapped button pushed to the end was not reported');
    await style('.lcard .lcard-action > * + * { margin-inline-start: -24px !important; }');
    const over = await app.eval(ACTION_AUDIT);
    assert.ok(over.bad.some((b) => b.includes('sits over the button before it')), 'a button over the one before it was not reported');
    await style('.lcard .lcard-action > * { white-space: nowrap !important; }');
    const nowrap = await app.eval(ACTION_AUDIT);
    assert.ok(nowrap.bad.some((b) => b.includes('spills out of its button')), 'a label that may not wrap was not reported spilling out of its button');
  }));

// The slot's rules touch only the button part, and an icon-only button keeps its own padding (0) and size there: a
// small icon-only button, and a plain span, are put in a link card's slot of the Records tab and compared with the
// same nodes outside any card. A text button in the slot gets its --space-2 block padding (the check can fail).
test('AC3: in a link card\'s slot an icon-only button keeps its own padding and size, and a node that is not a button is not restyled', UI, () =>
  withApp({}, async (app) => {
    await app.goto('/#/ui-catalog', CATALOG_READY);
    assert.ok(await app.click('Records'), 'no Records tab');
    await sleep(500);
    const r = await app.eval(`(() => {
      const slot = document.querySelector('.lcard > .lcard-action');
      if (!slot) return null;
      const keys = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'width', 'height', 'minWidth', 'maxWidth', 'overflowWrap'];
      const look = (e) => { const cs = getComputedStyle(e); return Object.fromEntries(keys.map((k) => [k, cs[k]])); };
      const make = (cls, text) => { const b = document.createElement(cls ? 'button' : 'span'); if (cls) b.className = cls; b.textContent = text; return b; };
      const outIcon = make('btn btn-sm btn-icon', '+');
      const outSpan = make('', 'note');
      const outText = make('btn btn-sm', 'Paste the text');
      document.body.append(outIcon, outSpan, outText);
      const inIcon = make('btn btn-sm btn-icon', '+');
      const inSpan = make('', 'note');
      const inText = make('btn btn-sm', 'Paste the text');
      slot.append(inIcon, inSpan, inText);
      const res = { icon: [look(outIcon), look(inIcon)], span: [look(outSpan), look(inSpan)], text: [look(outText), look(inText)] };
      for (const e of [outIcon, outSpan, outText, inIcon, inSpan, inText]) e.remove();
      return res;
    })()`);
    assert.ok(r, 'no link card with an action slot in the Records tab');
    const [outIcon, inIcon] = r.icon;
    for (const k of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'width', 'height']) assert.equal(inIcon[k], outIcon[k], `icon-only button ${k} in the slot`);
    assert.equal(inIcon.paddingTop, '0px');
    const [outSpan, inSpan] = r.span;
    // A span becomes a flex item in the slot, so its used width and height change, and its min-width stays the flex
    // item's auto (the old rule on every child set it to 0); its padding, cap and wrapping are its own.
    for (const k of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'maxWidth', 'overflowWrap']) assert.equal(inSpan[k], outSpan[k], `a span in the slot was restyled: ${k}`);
    assert.equal(inSpan.minWidth, 'auto', 'a span in the slot was given a min-width');
    assert.equal(inSpan.maxWidth, 'none');
    const [outText, inText] = r.text;
    assert.equal(outText.paddingTop, '0px');
    assert.equal(inText.paddingTop, '4px', 'a text button in the slot has no --space-1 block padding, so this check could not fail');
    assert.equal(inText.overflowWrap, 'anywhere');
  }));

// ---------------------------------------------------------------- AC4
test('AC4: the 1000-row catalog list builds in under 1.5 s and scrolls with no frame stall over 250 ms', UI, () =>
  withApp({ w: 900, h: 640 }, async (app) => {
    await app.goto('/#/ui-catalog', CATALOG_READY);
    const r = await app.eval(`(async () => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === 'Limits');
      tab.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const btn = [...document.querySelectorAll('button')].find((b) => /1000 rows/.test(b.textContent));
      if (!btn) return { error: "no 'Build 1000 rows' button in the Limits tab" };
      const find = () => [...document.querySelectorAll('body *')].find((e) => e.children.length >= 1000) || null;
      const t0 = performance.now();
      btn.click();
      let list = find();
      while (!list && performance.now() - t0 < 8000) { await new Promise((r) => requestAnimationFrame(r)); list = find(); }
      if (!list) return { error: 'no element with 1000 rows' };
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const build = performance.now() - t0;
      let sc = list;
      while (sc && !(sc.scrollHeight > sc.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
      const target = sc || document.scrollingElement;
      target.scrollTop = 0;
      const max = target.scrollHeight - target.clientHeight;
      const frames = [];
      let last = performance.now();
      const start = last;
      for (let i = 1; i <= 60; i++) {
        target.scrollTop = (max * i) / 60;
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        frames.push(now - last);
        last = now;
      }
      return { rows: list.children.length, build, scrollTotal: last - start, worstFrame: Math.max(...frames), scrolled: target.scrollTop > 0 };
    })()`);
    assert.equal(r.error, undefined, r.error);
    assert.ok(r.rows >= 1000, `rows: ${r.rows}`);
    assert.ok(r.scrolled, 'the list did not scroll');
    console.log(`# AC4 measured: build ${r.build.toFixed(0)} ms, scroll ${r.scrollTotal.toFixed(0)} ms, worst frame ${r.worstFrame.toFixed(0)} ms`);
    assert.ok(r.build < 1500, `build took ${r.build} ms`);
    assert.ok(r.worstFrame < 250, `a frame stalled ${r.worstFrame} ms`);
  }));

// ---------------------------------------------------------------- AC5
async function motionAudit(app, where, problems) {
  await sleep(400);
  const r = await app.eval(MOTION);
  for (const b of r.bad) problems.push(`${where}: ${b}`);
  for (const a of r.running) problems.push(`${where}: still running ${a}`);
}

test('AC5: with prefers-reduced-motion nothing animates or transitions, in the catalog and in the app', UI, async () => {
  const problems = [];
  await withApp({ reduce: true }, async (app) => {
    await app.goto('/#/ui-catalog', CATALOG_READY);
    for (const t of await catalogTabs(app)) { await app.click(t); await motionAudit(app, `reduced motion, catalog ${t}`, problems); }
  });
  await withApp({ reduce: true, scheme: 'dark' }, async (app) => {
    await app.goto('/index.html', `!!document.querySelector('nav')`);
    await app.openItem('Today');
    await motionAudit(app, 'reduced motion, Today', problems);
    await app.toggleSidebar();
    await motionAudit(app, 'reduced motion, Today collapsed', problems);
    await app.openItem('Settings');
    await motionAudit(app, 'reduced motion, Settings', problems);
  });
  assert.deepEqual(problems, []);
});

test('AC5: with the catalog Motion switch off nothing animates or transitions on any tab', UI, () =>
  withApp({}, async (app) => {
    await app.goto('/#/ui-catalog', CATALOG_READY);
    assert.ok(await app.eval(`(() => { const sw = document.querySelector('[role="switch"]'); if (sw.getAttribute('aria-checked') === 'true') sw.click(); return sw.getAttribute('aria-checked') === 'false'; })()`), 'Motion switch did not turn off');
    const problems = [];
    for (const t of await catalogTabs(app)) { await app.click(t); await motionAudit(app, `Motion off, catalog ${t}`, problems); }
    assert.deepEqual(problems, []);
  }));

// Each animation and transition the design system has, by name. Every selector must match something in the
// catalog (or the check would pass for nothing), and with reduced motion none of the matches may move.
const NAMED_MOTION = [
  ['spinner', '.spinner'],
  ['skeleton', '.skel span'],
  ['pulse (dot, status light)', '.dot.pulse'],
  ['toast entry', '.toast-region .toast'],
  ['progress (indeterminate)', '.progress.indet > span'],
  ['nav-rail width', '.rail'],
  ['sidebar width', '.sidebar'],
  ['tooltip', '.tip'],
  ['transitions (tab, switch track, switch knob, button)', '.cat-tab, .cat-switch-track, .cat-switch-knob, .btn'],
];
const NAMED_PROBE = `(() => NAMED.map(([name, sel]) => {
  const els = [...document.querySelectorAll(sel)];
  const runs = (v) => v.split(',').some((x) => parseFloat(x) > 0);
  const moving = els.filter((e) => { const cs = getComputedStyle(e); return (cs.animationName !== 'none' && runs(cs.animationDuration)) || (cs.transitionProperty !== 'none' && runs(cs.transitionDuration)); }).length;
  return { name, count: els.length, moving };
}))()`.replace('NAMED', JSON.stringify(NAMED_MOTION));

// Opens every catalog tab, shows a toast from the live demo on the Feedback tab, and adds up the named probe.
async function namedMotion(app) {
  const total = new Map(NAMED_MOTION.map(([name]) => [name, { count: 0, moving: 0 }]));
  const take = async () => { for (const r of await app.eval(NAMED_PROBE)) { const t = total.get(r.name); t.count += r.count; t.moving += r.moving; } };
  for (const t of await catalogTabs(app)) {
    await app.click(t);
    await sleep(300);
    if (t === 'Feedback') {
      assert.ok(await app.click('Delete "Notes on FTS5"'), 'no live toast demo button on the Feedback tab');
      await app.until(`!!document.querySelector('.toast-region .toast')`, 'a toast on screen');
    }
    await take();
  }
  return total;
}

test('AC5: with reduced motion emulated and the catalog Motion switch forced on, every ds animation and transition is still', UI, () =>
  withApp({ reduce: true }, async (app) => {
    await app.goto('/#/ui-catalog', CATALOG_READY);
    // The catalog turns its own Motion switch off under reduced motion; force it on so only the ds rules are tested.
    assert.ok(await app.eval(`(() => { const sw = document.querySelector('[role="switch"]'); if (sw.getAttribute('aria-checked') !== 'true') sw.click(); return sw.getAttribute('aria-checked') === 'true' && !document.documentElement.hasAttribute('data-motion'); })()`), 'Motion switch did not turn on');
    const problems = [];
    const total = await namedMotion(app);
    for (const [name, t] of total) {
      if (t.count === 0) problems.push(`${name}: nothing in the catalog matches, so it was not checked`);
      if (t.moving > 0) problems.push(`${name}: ${t.moving} element(s) still animate or transition with reduced motion`);
    }
    for (const t of await catalogTabs(app)) { await app.click(t); await motionAudit(app, `reduced motion, Motion switch on, catalog ${t}`, problems); }
    assert.deepEqual(problems, []);
  }));

test('AC5: control, with motion on and no reduced-motion setting every named animation and transition is present (so the check above can fail)', UI, () =>
  withApp({}, async (app) => {
    await app.goto('/#/ui-catalog', CATALOG_READY);
    let animated = 0;
    for (const t of await catalogTabs(app)) {
      await app.click(t);
      await sleep(300);
      animated += (await app.eval(MOTION)).running.length;
    }
    assert.ok(animated > 0, 'nothing animates even with motion on: spinner, skeleton or pulse missing from the catalog');
    const total = await namedMotion(app);
    const still = [...total].filter(([, t]) => t.moving === 0).map(([name]) => name);
    assert.deepEqual(still, [], 'these parts do not move even with motion on, so the reduced-motion check proves nothing for them');
  }));
