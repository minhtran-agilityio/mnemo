// Acceptance tests for #34 [IDEA-01] Ideas with stages (the Ideas screen).
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/idea-01-ui.test.mjs
// Harness as in app-02: the UI is built with Vite, served on a private port and driven in headless Google
// Chrome through the DevTools protocol, by role, label and visible text (never by class name). The Tauri
// bridge is an in-page fake (window.__TAURI_INTERNALS__) that answers the published commands of #34
// (list_ideas, get_idea, add_idea, update_idea, delete_idea, turn_idea_into_project) with Idea records of the
// published shape. The fake keeps its ideas in localStorage, so they survive a restart of the same Chrome
// profile. It returns the stage the core would compute (0-1 checks Spark, 2-3 Shape, 4 Ready; Project only
// after turn_idea_into_project); these tests check what the screen does with it.
// The stage rule itself, tag removal and real persistence are proved in idea-01.test.mjs.
// Not covered: AC4 "word search" moved to #31 by the owner, no test.
// UI tests skip when no Chrome is found (set MNEMO_CHROME to its path). Each test gets its own Chrome profile.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { join, dirname, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const U = '2026-01-01T00:00:00Z';

// ---------------------------------------------------------------- seed ideas, one per number of checks
const STAGES = ['Spark', 'Shape', 'Ready', 'Project'];
const idea = (id, title, { tag, source, why, outline }, extra = {}) => ({
  id, createdAt: U, updatedAt: U, deletedAt: null, title, text: null,
  source: source ? { type: 'link', url: 'https://example.com/' + id } : null,
  why: why ? 'Because it helps' : null,
  outline: outline ? '1. start 2. finish' : null,
  tags: tag ? ['garden'] : [],
  ...extra,
});
const SEED = [
  idea('i-0', 'Zero check thought', {}),
  idea('i-1', 'One check thought', { tag: 1 }),
  idea('i-2', 'Two check thought', { tag: 1, source: 1 }),
  idea('i-3', 'Three check thought', { tag: 1, source: 1, why: 1 }),
  idea('i-4', 'Four check thought', { tag: 1, source: 1, why: 1, outline: 1 }),
  idea('i-5', 'Already a project', { tag: 1, source: 1, why: 1, outline: 1 }, { projectId: 'p-5', stage: 'project' }),
];
// title -> [expected stage, number of checks]
const EXPECT = {
  'Zero check thought': ['spark', 0],
  'One check thought': ['spark', 1],
  'Two check thought': ['shape', 2],
  'Three check thought': ['shape', 3],
  'Four check thought': ['ready', 4],
  'Already a project': ['project', 4],
};
const TITLES = Object.keys(EXPECT);

// ---------------------------------------------------------------- Chrome + DevTools harness (as app-02)
const CHROME = [process.env.MNEMO_CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((c) => c && existsSync(c));
const SKIP_UI = CHROME ? false : 'no Chrome found (set MNEMO_CHROME)';
let distDir = null;
let server = null;
let port = 0;
let buildError = null;

before(async () => {
  if (SKIP_UI) return;
  distDir = mkdtempSync(join(tmpdir(), 'mnemo-idea01-dist-'));
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

// In-page fake of the Tauri bridge with the published #34 commands.
const bridgeScript = (seed) => `(() => {
  const KEY = '__mnemo_fake_ideas__';
  const SKEY = '__mnemo_fake_settings__';
  const SEED = ${JSON.stringify(seed)};
  const now = () => new Date().toISOString();
  const checksOf = (i) => ({ hasTag: i.tags.length > 0, hasSource: i.source !== null, hasWhy: !!i.why, hasOutline: !!i.outline });
  const stageOf = (i) => {
    if (i.projectId) return 'project';
    const n = Object.values(checksOf(i)).filter(Boolean).length;
    return n >= 4 ? 'ready' : n >= 2 ? 'shape' : 'spark';
  };
  const full = (i) => ({ projectId: null, ...i, checks: checksOf(i), stage: stageOf(i) });
  const load = () => {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
    const s = { ideas: SEED.map(full), projects: [], links: [], n: 0 };
    localStorage.setItem(KEY, JSON.stringify(s));
    return s;
  };
  const save = (s) => localStorage.setItem(KEY, JSON.stringify(s));
  const fail = (code, message) => { throw { code, message }; };
  window.__calls = [];
  const invoke = async (cmd, args) => {
    window.__calls.push({ cmd, args: JSON.parse(JSON.stringify(args ?? null)) });
    const s = load();
    const find = (id) => s.ideas.find((i) => i.id === id) || fail('not_found', 'No idea with this id.');
    switch (cmd) {
      case 'list_ideas': {
        const a = (args && args.args) || {};
        const items = s.ideas.filter((i) => a.includeDeleted || !i.deletedAt);
        return { items: items.slice(0, Math.max(1, Math.min(100, a.limit || 100))), next: null };
      }
      case 'get_idea': return find(args.id);
      case 'add_idea': {
        const i = full({ id: 'i-new-' + (++s.n), createdAt: now(), updatedAt: now(), deletedAt: null, ...args.input });
        s.ideas.push(i); save(s); return i;
      }
      case 'update_idea': {
        const old = find(args.id);
        const i = full({ ...old, ...args.input, updatedAt: now(), stage: undefined, checks: undefined });
        s.ideas = s.ideas.map((x) => (x.id === i.id ? i : x)); save(s); return i;
      }
      case 'delete_idea': { const i = find(args.id); i.deletedAt = now(); save(s); return null; }
      case 'turn_idea_into_project': {
        const i = find(args.id);
        if (i.projectId) fail('invalid_input', 'This idea is already a project.');
        const project = { id: 'p-new-' + (++s.n), createdAt: now(), updatedAt: now(), deletedAt: null, title: i.title, status: 'active' };
        s.projects.push(project);
        s.links.push({ a: 'idea:' + i.id, b: 'project:' + project.id });
        i.projectId = project.id; i.stage = 'project'; i.updatedAt = now();
        save(s);
        return { idea: i, project };
      }
    }
    if (/setting/i.test(cmd)) {
      const store = JSON.parse(localStorage.getItem(SKEY) || '{}');
      if (args && args.value !== undefined) { store[args.key] = args.value; localStorage.setItem(SKEY, JSON.stringify(store)); return null; }
      return Object.prototype.hasOwnProperty.call(store, args && args.key) ? store[args.key] : null;
    }
    if (/^list_/.test(cmd)) return { items: [], next: null };
    if (/ping/i.test(cmd)) return 'pong';
    if (/version/i.test(cmd)) return '0.1.0';
    return null;
  };
  let cb = 1;
  window.__TAURI_INTERNALS__ = { invoke, transformCallback: () => cb++, unregisterCallback() {}, convertFileSrc: (s) => s, metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } } };
  window.isTauri = true;
})();`;

async function openApp({ profile } = {}) {
  assert.equal(buildError, null, buildError ?? '');
  const dir = profile ?? mkdtempSync(join(tmpdir(), 'mnemo-idea01-chrome-'));
  rmSync(join(dir, 'DevToolsActivePort'), { force: true });
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
    await S('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await S('Page.addScriptToEvaluateOnNewDocument', { source: bridgeScript(SEED) });
    const evalJs = async (expr) => {
      const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`page error: ${JSON.stringify(r.exceptionDetails).slice(0, 500)}`);
      return r.result.value;
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
        let last;
        while (Date.now() < end) { try { last = await app.h(expr); if (last) return last; } catch { /* retry */ } await sleep(100); }
        assert.fail(`timed out waiting for ${what}`);
      },
      async close() {
        const exitedP = new Promise((ok) => { if (proc.exitCode !== null) ok(); else proc.once('exit', ok); });
        try { await Promise.race([send('Browser.close'), sleep(2000)]); } catch { /* already closing */ }
        await Promise.race([exitedP, sleep(5000)]);
        try { ws.close(); } catch { /* closed */ }
        if (proc.exitCode === null) proc.kill('SIGKILL');
        await sleep(200);
        if (!profile) rmSync(dir, { recursive: true, force: true });
      },
    };
    // Page-side helpers. A stage heading is a shown leaf text in main that reads "Spark", "Shape", "Ready" or
    // "Project", maybe with a count. An idea's group is found by walking up from its title to the nearest
    // ancestor that holds exactly one stage heading (a column or section), or, in a board whose headings sit
    // in their own row, the heading straight above the title. An idea's card is the largest ancestor of its
    // title that holds no other idea's title.
    app.helpers = `(() => {
      const TITLES = ${JSON.stringify(TITLES)};
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
      const name = (el) => norm(el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && el.getAttribute('aria-labelledby').split(' ').map((i) => document.getElementById(i)?.textContent).join(' ')) || el.textContent || el.getAttribute('title') || el.getAttribute('alt'));
      const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const main = () => document.querySelector('main') || document.body;
      const ctl = () => [...document.querySelectorAll('a, button, [role=link], [role=button], [role=menuitem], [role=tab]')];
      const find = (n, root) => ctl().filter((el) => (!root || root.contains(el)) && shown(el) && (name(el) === n || name(el).startsWith(n + ' ')));
      const leaves = (test) => [...main().querySelectorAll('*')].filter((e) => shown(e) && test(norm(e.textContent)) && ![...e.children].some((c) => test(norm(c.textContent))));
      const STAGE_RE = /^(Spark|Shape|Ready|Project)\\b\\s*[(\\[·:\\-–]?\\s*\\d*\\s*[)\\]]?$/i;
      const heads = () => leaves((t) => STAGE_RE.test(t)).map((e) => ({ e, stage: norm(e.textContent).match(STAGE_RE)[1].toLowerCase() }));
      const titleEl = (t) => leaves((x) => x === t).filter((e) => !e.closest('[role=status], [role=alert], [aria-live], [role=dialog], dialog'))[0] || null;
      const groupOf = (t) => {
        const el = titleEl(t);
        if (!el) return null;
        const hs = heads();
        for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
          const inside = hs.filter((h) => a.contains(h.e) && !h.e.contains(el));
          if (inside.length === 1) return inside[0].stage;
          if (inside.length > 1) {
            const r = el.getBoundingClientRect(); const x = r.left + r.width / 2;
            const above = inside.filter((h) => { const q = h.e.getBoundingClientRect(); return q.bottom <= r.top + 1; });
            const col = above.filter((h) => { const p = h.e.parentElement.getBoundingClientRect(); return x >= p.left && x <= p.right; });
            if (col.length === 1) return col[0].stage;
            const near = above.sort((p, q) => q.e.getBoundingClientRect().bottom - p.e.getBoundingClientRect().bottom);
            return near.length ? near[0].stage + '?' : null;
          }
        }
        return null;
      };
      const cardOf = (t) => {
        const el = titleEl(t);
        if (!el) return null;
        const others = TITLES.filter((x) => x !== t).map(titleEl).filter(Boolean);
        let c = el;
        while (c.parentElement && c.parentElement !== main() && !others.some((o) => c.parentElement.contains(o))) c = c.parentElement;
        return c;
      };
      const stagesShown = () => [...new Set(heads().map((h) => h.stage))];
      window.__h = { norm, name, shown, main, ctl, find, heads, titleEl, groupOf, cardOf, stagesShown };
    })();`;
    app.h = async (expr) => { await evalJs(app.helpers); return evalJs(expr); };
    app.click = (label) => app.h(`(() => { const e = __h.find(${JSON.stringify(label)})[0]; if (!e) return false; e.click(); return true; })()`);
    app.mainText = () => evalJs(`(document.querySelector('main') || document.body).innerText`);
    return app;
  } catch (error) {
    proc.kill('SIGKILL');
    if (!profile) rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

const UI = { timeout: 180000, skip: SKIP_UI };

async function openIdeas(app) {
  if (!(await app.click('Ideas'))) assert.fail("no sidebar item named 'Ideas'");
  await app.until(`${JSON.stringify(TITLES)}.every((t) => !!__h.titleEl(t))`, 'every seeded idea title to show on the Ideas screen', 10000);
}
async function withIdeas(fn) {
  const app = await openApp();
  try { await app.goto(); await openIdeas(app); await fn(app); } finally { await app.close(); }
}
const groups = (app) => app.h(`Object.fromEntries(${JSON.stringify(TITLES)}.map((t) => [t, __h.groupOf(t)]))`);
const expectedGroups = (over = {}) => Object.fromEntries(TITLES.map((t) => [t, over[t] ?? EXPECT[t][0]]));

// "Turn into project" in the card of one idea; returns the main text just before the click.
async function turn(app, title) {
  const r = await app.h(`(() => {
    const card = __h.cardOf(${JSON.stringify(title)});
    const b = card && __h.find('Turn into project', card)[0];
    if (!b) return null;
    const before = (document.body.innerText || '');
    b.click();
    return before;
  })()`);
  assert.ok(r !== null, `no 'Turn into project' control in the card of '${title}'`);
  return r;
}

// ---------------------------------------------------------------- AC1
// "The stage follows the four checks." The screen groups ideas by stage: Spark, Shape, Ready, Project.
test('AC1: the Ideas screen shows its name, a phase mark and the stage groups Spark, Shape, Ready and Project', UI, () =>
  withIdeas(async (app) => {
    const text = await app.mainText();
    assert.match(text, /\bIdeas\b/, `main does not show the name Ideas: ${text.slice(0, 160)}`);
    assert.match(text, /\b(phase\s*\d+|P\d+)\b/i, `main does not show a phase mark: ${text.slice(0, 160)}`);
    const shown = await app.h('__h.stagesShown()');
    for (const s of STAGES) assert.ok(shown.includes(s.toLowerCase()), `no stage group '${s}' on the Ideas screen (groups found: ${shown.join(', ')})`);
    const calls = await app.eval(`window.__calls.filter((c) => c.cmd === 'list_ideas').length`);
    assert.ok(calls >= 1, 'the Ideas screen did not ask the core for ideas (list_ideas)');
  }));

// "The stage follows the four checks. A test covers each step from 0 to 4 checks."
test('AC1: each idea with 0, 1, 2, 3 or 4 checks shows under the stage the core gives it (0-1 Spark, 2-3 Shape, 4 Ready)', UI, () =>
  withIdeas(async (app) => {
    assert.deepEqual(await groups(app), expectedGroups());
  }));

test('AC1: each idea card shows how many of the four checks pass (0 of 4 to 4 of 4)', UI, () =>
  withIdeas(async (app) => {
    const r = await app.h(`Object.fromEntries(${JSON.stringify(TITLES)}.map((t) => { const c = __h.cardOf(t); return [t, c ? __h.norm(c.innerText) : null]; }))`);
    const bad = [];
    for (const t of TITLES) {
      const n = EXPECT[t][1];
      const re = new RegExp(`\\b${n}\\s*(of|/)\\s*4\\b`, 'i');
      const other = [0, 1, 2, 3, 4].filter((k) => k !== n).map((k) => new RegExp(`\\b${k}\\s*(of|/)\\s*4\\b`, 'i'));
      if (!r[t] || !re.test(r[t]) || other.some((o) => o.test(r[t]))) bad.push(`${t}: expected '${n} of 4' in ${JSON.stringify(r[t])}`);
    }
    assert.deepEqual(bad, [], bad.join('\n'));
  }));

// ---------------------------------------------------------------- AC2
// "\"Turn into project\" works at any stage and links idea and project both ways."
test('AC2: "Turn into project" is offered on ideas in Spark, Shape and Ready', UI, () =>
  withIdeas(async (app) => {
    const r = await app.h(`Object.fromEntries(${JSON.stringify(TITLES.filter((t) => EXPECT[t][0] !== 'project'))}.map((t) => { const c = __h.cardOf(t); return [t, !!(c && __h.find('Turn into project', c)[0])]; }))`);
    const missing = Object.entries(r).filter(([, v]) => !v).map(([t]) => `${t} (${EXPECT[t][0]})`);
    assert.deepEqual(missing, [], `no 'Turn into project' on: ${missing.join(', ')}`);
  }));

// Out of scope note in the ticket: "Turn into project" creates the project record and shows a confirmation.
// "The idea moves to the stage Project."
for (const title of ['Zero check thought', 'Three check thought', 'Four check thought']) {
  const stage = EXPECT[title][0];
  test(`AC2: "Turn into project" on a ${stage[0].toUpperCase() + stage.slice(1)} idea calls turn_idea_into_project, shows a confirmation and moves the idea to Project`, UI, () =>
    withIdeas(async (app) => {
      const id = SEED.find((i) => i.title === title).id;
      const before = await turn(app, title);
      await app.until(`window.__calls.some((c) => c.cmd === 'turn_idea_into_project')`, 'a turn_idea_into_project call', 5000);
      const calls = await app.eval(`window.__calls.filter((c) => c.cmd === 'turn_idea_into_project').map((c) => c.args)`);
      assert.equal(calls.length, 1, `turn_idea_into_project was called ${calls.length} times`);
      assert.equal(calls[0]?.id, id, `turn_idea_into_project was called with ${JSON.stringify(calls[0])}, not { id: '${id}' }`);
      const seen = new Set(before.split('\n').map((l) => l.trim()));
      const STAGE_LINE = /^(Spark|Shape|Ready|Project)\b\s*[(\[·:\-–]?\s*\d*\s*[)\]]?$/i;
      const confirmation = await app.until(`(() => {
        const lines = (document.body.innerText || '').split('\\n').map((l) => l.trim()).filter(Boolean);
        const seen = new Set(${JSON.stringify([...seen])});
        const fresh = lines.filter((l) => !seen.has(l) && /project/i.test(l) && !${STAGE_LINE}.test(l) && /(created|made|turned|new project|added|is now|done|saved)/i.test(l));
        const live = [...document.querySelectorAll('[role=status], [role=alert], [aria-live]')].map((e) => __h.norm(e.textContent)).filter((t) => /project/i.test(t));
        return fresh[0] || live[0] || null;
      })()`, 'a confirmation that mentions the new project', 5000);
      assert.ok(confirmation);
      await app.until(`__h.groupOf(${JSON.stringify(title)}) === 'project'`, `'${title}' to show under Project`, 5000);
      assert.deepEqual(await groups(app), expectedGroups({ [title]: 'project' }), 'the other ideas moved');
    }));
}

// ---------------------------------------------------------------- AC5
// "Ideas are kept after restart, on Mac and on Ubuntu." The screen reads the ideas again from the core
// after a restart and shows each under its stage, the turned idea under Project.
test('AC5: after a restart the Ideas screen shows the same ideas under the same stages, the turned idea under Project', UI, async () => {
  const profile = mkdtempSync(join(tmpdir(), 'mnemo-idea01-chrome-'));
  try {
    let a = await openApp({ profile });
    try {
      await a.goto();
      await openIdeas(a);
      await turn(a, 'Two check thought');
      await a.until(`__h.groupOf('Two check thought') === 'project'`, "'Two check thought' to show under Project", 5000);
    } finally { await a.close(); }
    a = await openApp({ profile });
    try {
      await a.goto();
      await openIdeas(a);
      assert.deepEqual(await groups(a), expectedGroups({ 'Two check thought': 'project' }));
      const calls = await a.eval(`window.__calls.filter((c) => c.cmd === 'list_ideas').length`);
      assert.ok(calls >= 1, 'after restart the screen did not read the ideas from the core (list_ideas)');
    } finally { await a.close(); }
  } finally { rmSync(profile, { recursive: true, force: true }); }
});
