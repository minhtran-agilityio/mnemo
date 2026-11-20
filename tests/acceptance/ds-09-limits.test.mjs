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
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${dir}`, `--window-size=${w},${h}`, 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { proc.kill('SIGKILL'); } catch { /* gone */ } try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp dir, left for the OS */ } };
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
    const send = (method, params = {}, sessionId) => new Promise((ok, bad) => { const i = ++id; pending.set(i, { ok, bad }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
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
// hclip: overflow-x hidden or clip boxes that hide text without an ellipsis
// vclip: text whose line box, plus 15% of the font size for stacked marks, leaves a clipping ancestor
const AUDIT = `(() => {
  const IN_CATALOG = location.hash.startsWith('#/ui-catalog');
  const out = { scroll: [], hclip: [], vclip: [] };
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) out.scroll.push('document ' + de.scrollWidth + ' > ' + de.clientWidth);
  if (document.body.scrollWidth > de.clientWidth + 1) out.scroll.push('body ' + document.body.scrollWidth + ' > ' + de.clientWidth);
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const label = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(' ')[0] : '') + ' "' + (el.textContent || '').trim().slice(0, 30) + '"';
  const range = document.createRange();
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    // a deliberate counter-example (its caption starts with 'counter-example') is meant to be cut
    let demo = false;
    for (let a = el, i = 0; a && i < 4; a = a.parentElement, i++) { const nx = a.nextElementSibling; if (nx && /^counter-example/i.test((nx.textContent || '').trim())) demo = true; }
    if (demo) continue;
    const cs = getComputedStyle(el);
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const wide = el.scrollWidth > el.clientWidth + 1;
    if (!IN_CATALOG && (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && wide) out.scroll.push(label(el) + ' ' + el.scrollWidth + ' > ' + el.clientWidth);
    if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && hasText && wide && cs.textOverflow !== 'ellipsis') out.hclip.push(label(el) + ' ' + el.scrollWidth + ' > ' + el.clientWidth);
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own.length) continue;
    const fs = parseFloat(cs.fontSize);
    const pad = 0.15 * fs;
    let flagged = false;
    for (const n of own) {
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 1 || flagged) continue;
        for (let a = el; a && a !== de; a = a.parentElement) {
          const acs = getComputedStyle(a);
          if (acs.overflowY === 'visible') continue;
          const ar = a.getBoundingClientRect();
          if (ar.width <= 1 || ar.height <= 1) continue;
          if ((acs.overflowY === 'auto' || acs.overflowY === 'scroll') && a.scrollHeight > a.clientHeight + 1) continue;
          if (acs.webkitLineClamp && acs.webkitLineClamp !== 'none') continue;
          const top = ar.top + parseFloat(acs.borderTopWidth);
          const bottom = ar.bottom - parseFloat(acs.borderBottomWidth);
          if (r.bottom < top || r.top > bottom) continue; // scrolled or laid out away from this box: not cut by it
          if (r.top - pad < top - 0.5 || r.bottom + pad > bottom + 0.5) { out.vclip.push(label(el) + ' inside ' + label(a) + ' text ' + Math.round(r.top) + '-' + Math.round(r.bottom) + ' box ' + Math.round(top) + '-' + Math.round(bottom)); flagged = true; break; }
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

const collect = (kind) => async (scheme) => {
  const problems = [];
  for (const s of SIZES) {
    await withApp({ ...s, scheme }, async (app) => {
      await eachAppScreen(app, (l, r) => { for (const x of r[kind]) problems.push(`${l} @ ${s.label}: ${x}`); });
    });
    await withApp({ ...s, scheme, mode: 'down' }, async (app) => {
      await errorPage(app, (l, r) => { for (const x of r[kind]) problems.push(`${l} @ ${s.label}: ${x}`); });
    });
    await withApp({ ...s, scheme }, async (app) => {
      await eachCatalogTab(app, (l, r) => { for (const x of r[kind]) problems.push(`${l} @ ${s.label}: ${x}`); });
    });
  }
  return problems;
};

// ---------------------------------------------------------------- AC2
for (const scheme of ['light', 'dark']) {
  test(`AC2: no horizontal scroll at 800 x 560 and at 200% zoom on any app screen or catalog tab (${scheme})`, UI, async () => {
    assert.deepEqual(await collect('scroll')(scheme), []);
  });
}

// ---------------------------------------------------------------- AC3
for (const scheme of ['light', 'dark']) {
  test(`AC3: no text is clipped sideways without an ellipsis, and no line is cut above or below (marks safe) (${scheme})`, UI, async () => {
    const problems = [...(await collect('hclip')(scheme)), ...(await collect('vclip')(scheme))];
    assert.deepEqual(problems, []);
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

test('AC5: control, with motion on and no reduced-motion setting the catalog does animate (so the checks above can fail)', UI, () =>
  withApp({}, async (app) => {
    await app.goto('/#/ui-catalog', CATALOG_READY);
    let animated = 0;
    for (const t of await catalogTabs(app)) {
      await app.click(t);
      await sleep(300);
      animated += (await app.eval(MOTION)).running.length;
    }
    assert.ok(animated > 0, 'nothing animates even with motion on: spinner, skeleton or pulse missing from the catalog');
  }));
