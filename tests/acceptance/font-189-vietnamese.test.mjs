// Issue 189: Vietnamese letters (ệ ớ ỷ ư ơ đ) must be drawn in the bundled fonts, not in a system fallback.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/font-189-vietnamese.test.mjs
// Black box. Vite serves the app on a private port, headless Google Chrome loads the Bookmarks screen with the Tauri
// bridge replaced by an in-page fake, and the DevTools call CSS.getPlatformFontsForNode says which font drew each
// node's glyphs. The test skips when no Chrome is found (set MNEMO_CHROME). It does not run WebKitGTK: the same
// @fontsource files are served to both engines, and the real Linux build was checked by hand (see the PR).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = [process.env.MNEMO_CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((c) => c && existsSync(c));
// Chrome names the bundled variable file by its default instance ("Source Sans 3 ExtraLight"), so match the family prefix.
const isOwn = (name) => name.startsWith('Source Sans 3') || name.startsWith('JetBrains Mono');

const TITLE = 'Mô hình làm việc mới trong kỷ nguyên AI: ệ ớ ỷ ư ơ đ';
const FAKE = `(() => {
  const now = '2026-11-26T09:00:00Z';
  const card = { id: 'b1', createdAt: now, updatedAt: now, deletedAt: null, url: 'https://example.org/vi', title: ${JSON.stringify(TITLE)},
    summary: 'Hướng dẫn đọc sách hiệu quả cho người bận rộn, Nguyễn Thị Hương.', reason: null, reasonIsGuess: false,
    site: 'example.org', summaryStatus: 'done', tags: [], labels: [] };
  const invoke = async (cmd) => {
    if (cmd === 'list_bookmark_cards') return { items: [card], next: null };
    if (cmd === 'ping') return 'pong';
    if (cmd === 'plugin:app|version') return '0.1.0';
    return null;
  };
  let cb = 1;
  window.__TAURI_INTERNALS__ = { invoke, transformCallback: () => cb++, unregisterCallback() {}, convertFileSrc: (s) => s, metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } } };
  window.isTauri = true;
})();`;

const run = async (fn) => {
  const port = await new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port: pt } = s.address(); s.close(() => ok(pt)); }); });
  const vite = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-font189-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', `--user-data-dir=${dir}`, '--remote-debugging-port=0', 'about:blank'], { detached: true, stdio: 'ignore' });
  try {
    for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/index.html`)).ok) break; } catch { /* not yet */ } await sleep(100); }
    let wsUrl;
    for (let i = 0; i < 300 && !wsUrl; i++) {
      await sleep(100);
      const f = join(dir, 'DevToolsActivePort');
      if (existsSync(f)) { const [pt, path] = readFileSync(f, 'utf8').trim().split('\n'); if (path) wsUrl = `ws://127.0.0.1:${pt}${path}`; }
    }
    assert.ok(wsUrl, 'Chrome did not start');
    const ws = new WebSocket(wsUrl);
    await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); const w = pending.get(d.id); if (w) { pending.delete(d.id); d.error ? w.bad(new Error(JSON.stringify(d.error))) : w.ok(d.result); } };
    const send = (method, params = {}, sessionId) => new Promise((ok, bad) => { const i = ++id; pending.set(i, { ok, bad }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, pr) => send(m, pr, sessionId);
    await S('Page.enable');
    await S('DOM.enable');
    await S('CSS.enable');
    await S('Runtime.enable');
    await S('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
    await S('Page.navigate', { url: `http://127.0.0.1:${port}/#/bookmarks` });
    const ev = async (expr) => (await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
    for (let i = 0; i < 100 && !(await ev(`document.body.innerText.includes('ệ ớ ỷ ư ơ đ')`)); i++) await sleep(200);
    await ev('document.fonts.ready.then(() => true)');
    await sleep(500);
    await fn({ S, ev });
    ws.close();
  } finally {
    try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* gone */ }
    vite.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
};

after(() => {});

test('AC1: every glyph of a Vietnamese title and summary, and of the sidebar, is drawn in a bundled font', { timeout: 120000, skip: CHROME ? false : 'no Chrome found (set MNEMO_CHROME)' }, () => run(async ({ S, ev }) => {
  const { root } = await S('DOM.getDocument', { depth: -1 });
  const targets = [];
  // Every element that holds its own text: the card, the sidebar and the page head.
  const { nodeIds } = await S('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'body *' });
  for (const nodeId of nodeIds) targets.push(nodeId);
  const used = new Map();
  for (const nodeId of targets) {
    const { fonts } = await S('CSS.getPlatformFontsForNode', { nodeId });
    for (const f of fonts ?? []) used.set(f.familyName, (used.get(f.familyName) ?? 0) + f.glyphCount);
  }
  assert.ok([...used].some(([name, n]) => name.startsWith('Source Sans 3') && n > 100), `Source Sans 3 drew too few glyphs: ${JSON.stringify([...used])}`);
  const other = [...used].filter(([name]) => !isOwn(name));
  assert.deepEqual(other, [], `glyphs drawn by a system fallback font: ${JSON.stringify(other)}`);
  assert.ok(await ev(`document.body.innerText.includes('ệ ớ ỷ ư ơ đ')`), 'the Vietnamese sample is not on the page');
}));
