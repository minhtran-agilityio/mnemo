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
  const out = { scroll: [], hclip: [], vclip: [] };
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
      const add = (l, s, r) => { for (const kind of Object.keys(problems)) for (const x of r[kind]) problems[kind].push(`${l} @ ${s.label}: ${x}`); };
      for (const s of SIZES) {
        await withApp({ ...s, scheme }, (app) => eachAppScreen(app, (l, r) => add(l, s, r)));
        await withApp({ ...s, scheme, mode: 'down' }, (app) => errorPage(app, (l, r) => add(l, s, r)));
        await withApp({ ...s, scheme }, (app) => eachCatalogTab(app, (l, r) => add(l, s, r)));
      }
      return problems;
    })());
  }
  return collected.get(scheme);
};

// ---------------------------------------------------------------- AC2
for (const scheme of ['light', 'dark']) {
  test(`AC2: no horizontal scroll at 800 x 560 and at 200% zoom on any app screen or catalog tab (${scheme})`, UI, async () => {
    assert.deepEqual((await collectAll(scheme)).scroll, []);
  });
}

// ---------------------------------------------------------------- AC3
for (const scheme of ['light', 'dark']) {
  test(`AC3: no text is clipped sideways without an ellipsis, by its own box or an ancestor (${scheme})`, UI, async () => {
    assert.deepEqual((await collectAll(scheme)).hclip, []);
  });
  test(`AC3: no line is cut above or below, marks safe, by its own box or an ancestor (${scheme})`, UI, async () => {
    assert.deepEqual((await collectAll(scheme)).vclip, []);
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

// Issue 171. The List row of a link: the body and the meta line (app, site, date) share .link-main. At the page's
// own width, and with each list stepped from 280 to 800px wide: a cut site means its meta line has the whole line
// (no cap leaves room unused); the date is one piece on the site's row; a meta line that wrapped under the body
// starts at the title's left edge; and no row is wider than its list. The counts make sure the checks ran.
const ROW_AUDIT = `(() => {
  const bad = [];
  const x = (n) => Math.round(n * 10) / 10;
  const seen = { rows: 0, wrapped: 0, cut: 0, shared: 0 };
  const sample = [];
  const lists = [...new Set([...document.querySelectorAll('.link-row')].map((r) => r.parentElement))];
  const check = (width) => {
    for (const row of document.querySelectorAll('.link-row')) {
      const rr = row.getBoundingClientRect();
      if (rr.width < 1) continue;
      seen.rows++;
      const at = '"' + row.querySelector('.row-title').textContent.slice(0, 24) + '" @ list ' + width;
      const lr = row.parentElement.getBoundingClientRect();
      if (rr.right > lr.right + 0.5 || rr.left < lr.left - 0.5) bad.push(at + ': row x' + x(rr.left) + '-' + x(rr.right) + ' leaves its list x' + x(lr.left) + '-' + x(lr.right));
      const main = row.querySelector(':scope > .link-main');
      const meta = main?.querySelector(':scope > .meta');
      if (!meta) { bad.push(at + ': no .link-main > .meta'); continue; }
      const title = main.querySelector('.row-title').getBoundingClientRect();
      const body = main.querySelector(':scope > .row-body').getBoundingClientRect();
      const mainR = main.getBoundingClientRect();
      const mr = meta.getBoundingClientRect();
      const site = meta.querySelector('.site');
      const wrapped = mr.top >= body.bottom - 0.5;
      if (wrapped) {
        seen.wrapped++;
        if (Math.abs(mr.left - title.left) > 0.5) bad.push(at + ': wrapped meta starts at x' + x(mr.left) + ', the title at x' + x(title.left));
      } else seen.shared++;
      // scrollWidth and clientWidth are whole pixels, so a site short by a fraction of a pixel (still cut, with an
      // ellipsis) would pass unseen. Compare the text's own width with the site's box instead.
      const range = document.createRange();
      let siteBox = 0;
      let siteText = 0;
      if (site) {
        siteBox = site.getBoundingClientRect().width;
        range.selectNodeContents(site);
        siteText = [...range.getClientRects()].reduce((w, r) => w + r.width, 0);
      }
      if (site && siteText > siteBox + 0.05) {
        seen.cut++;
        if (mr.width < mainR.width - 1) bad.push(at + ': site cut (' + x(siteBox) + ' of ' + x(siteText) + 'px) while its meta is ' + x(mr.width) + 'px of a ' + x(mainR.width) + 'px line');
      }
      const date = meta.lastElementChild;
      range.selectNodeContents(date);
      const rects = [...range.getClientRects()].filter((r) => r.width >= 1);
      if (rects.length !== 1) bad.push(at + ': the date "' + date.textContent + '" has ' + rects.length + ' line boxes');
      if (site) {
        const sr = site.getBoundingClientRect();
        const dr = date.getBoundingClientRect();
        const mid = (r) => (r.top + r.bottom) / 2;
        if (Math.abs(mid(sr) - mid(dr)) > sr.height / 2) bad.push(at + ': the date is not on the site row');
      }
      if (sample.length < 40 && row.querySelector('.row-title').textContent === 'Tauri 2 capabilities' && site?.textContent === 'v2.tauri.app' && !sample.some((s) => s.width === width))
        sample.push({ width, site: x(siteBox) + '/' + x(siteText), meta: x(mr.width) + '/' + x(mainR.width), metaLeft: x(mr.left), titleLeft: x(title.left), wrapped });
    }
  };
  check('page');
  for (let w = 280; w <= 800; w += 40) {
    for (const l of lists) l.style.width = w + 'px';
    check(w);
  }
  for (const l of lists) l.style.width = '';
  return { bad, seen, sample };
})()`;

for (const scheme of ['light', 'dark']) {
  test(`AC3: a link's List row keeps its site whole when its line has room, its date on the site's row, a wrapped meta under the title, and stays in its list (${scheme})`, UI, async () => {
    const bad = [];
    const seen = { rows: 0, wrapped: 0, cut: 0, shared: 0 };
    for (const s of SIZES) {
      await withApp({ ...s, scheme }, async (app) => {
        await app.goto('/#/ui-catalog', CATALOG_READY);
        assert.ok(await app.click('Records'), 'no Records tab');
        await sleep(500);
        const r = await app.eval(ROW_AUDIT);
        assert.ok(r.seen.rows > 0, `no link List row in the Records tab @ ${s.label}`);
        for (const k of Object.keys(seen)) seen[k] += r.seen[k];
        for (const b of r.bad) bad.push(`${b} @ ${s.label}`);
        if (process.env.MNEMO_ROW_SAMPLE) console.log(scheme, s.label, JSON.stringify(r.sample));
      });
    }
    assert.ok(seen.wrapped > 0, 'no wrapped meta line seen, so the title-edge check never ran');
    assert.ok(seen.shared > 0, 'no meta line seen on the body line, so the layout never shared a line');
    assert.ok(seen.cut > 0, 'no cut site seen, so the full-line check never ran');
    assert.deepEqual(bad, []);
  });
}

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
