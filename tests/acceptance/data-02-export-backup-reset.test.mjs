// Acceptance tests for #17 [DATA-02] Export, backup and reset.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/data-02-export-backup-reset.test.mjs
// No design exists for this ticket: the ticket text, the owner-confirmed decisions and the criteria are the whole
// public interface. So:
// - The Settings Data section is driven in headless Google Chrome (harness as in app-03-settings), by role,
//   label and visible text. The Tauri bridge is an in-page fake that records every call. The command names are
//   not published, so the fake answers by what a command is about: the native folder dialog
//   (plugin:dialog|open) returns a picked folder (or null for Cancel), a command about export returns a folder,
//   a command about reset or opening returns null, and a command about the data folder (data/folder/dir/path)
//   returns the data folder path. UI tests skip when no Chrome is found (set MNEMO_CHROME).
// - The Rust tests the criteria ask for (export counts, soft-deleted rows, reset, restore) are found in the Rust
//   test list of the storage module and run.
// - The README and the Cargo/capability files are read as text.
// - AC11 "npm test exits 0" runs npm test itself, so it skips inside npm test (MNEMO_NESTED set) and runs when
//   this file is run alone without MNEMO_NESTED.
// Not covered by a test here: "Never overwrites an existing folder" (AC1) and "makes no automatic backup" (AC5) have no outside handle beyond the Rust tests named below.
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
const DATA_DIR = '/home/owner/.local/share/io.mnemo.desktop';
const PICKED = '/home/owner/Exports';

// ---------------------------------------------------------------- Chrome + DevTools harness (as app-03-settings)
const CHROME = [process.env.MNEMO_CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((c) => c && existsSync(c));
const SKIP_UI = CHROME ? false : 'no Chrome found (set MNEMO_CHROME)';
let distDir = null;
let server = null;
let port = 0;
let buildError = null;

before(async () => {
  if (SKIP_UI) return;
  distDir = mkdtempSync(join(tmpdir(), 'mnemo-data02-dist-'));
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

// In-page fake of the Tauri bridge. PICK is what the native folder dialog returns (null = the owner cancelled).
const bridgeScript = ({ pick = PICKED, theme = null } = {}) => `(() => {
  const PICK = ${JSON.stringify(pick)};
  const DATA_DIR = ${JSON.stringify(DATA_DIR)};
  const store = ${JSON.stringify(theme ? { theme } : {})};
  window.__calls = [];
  const invoke = async (cmd, args) => {
    window.__calls.push({ cmd, args: JSON.parse(JSON.stringify(args ?? null)) });
    if (/^plugin:dialog\\|/.test(cmd)) return /open/.test(cmd) ? PICK : null;
    if (/setting/i.test(cmd)) {
      if (args && args.value !== undefined) { store[args.key] = args.value; return null; }
      return Object.prototype.hasOwnProperty.call(store, args && args.key) ? store[args.key] : null;
    }
    if (/export/i.test(cmd)) return PICK + '/mnemo-export-20261121-120000';
    if (/reset/i.test(cmd)) return null;
    if (/open|reveal/i.test(cmd)) return null;
    if (/data|folder|dir|path/i.test(cmd)) return DATA_DIR;
    if (/^list_/.test(cmd)) return { items: [], next: null };
    if (/ping/i.test(cmd)) return 'pong';
    if (/version/i.test(cmd)) return '0.1.0';
    return null;
  };
  let cb = 1;
  window.__TAURI_INTERNALS__ = { invoke, transformCallback: () => cb++, unregisterCallback() {}, convertFileSrc: (s) => s, metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } } };
  window.isTauri = true;
})();`;

async function openApp(opts = {}) {
  assert.equal(buildError, null, buildError ?? '');
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-data02-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--window-size=1200,800', 'about:blank'], { stdio: 'ignore' });
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
    await S('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
    await S('Page.addScriptToEvaluateOnNewDocument', { source: bridgeScript(opts) });
    const evalJs = async (expr) => {
      const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`page error: ${JSON.stringify(r.exceptionDetails).slice(0, 500)}`);
      return r.result.value;
    };
    const app = {
      eval: evalJs,
      async until(expr, what, ms = 8000) {
        const end = Date.now() + ms;
        while (Date.now() < end) { try { if (await evalJs(expr)) return; } catch { /* retry */ } await sleep(100); }
        assert.fail(`timed out waiting for ${what}`);
      },
      media: (scheme) => S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }),
      typeText: (t) => S('Input.insertText', { text: t }),
      async close() {
        try { await Promise.race([send('Browser.close'), sleep(2000)]); } catch { /* closing */ }
        try { ws.close(); } catch { /* closed */ }
        if (proc.exitCode === null) proc.kill('SIGKILL');
        await sleep(200);
        rmSync(dir, { recursive: true, force: true });
      },
    };
    if (opts.theme) await app.media(opts.theme);
    await S('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
    await app.until(`document.readyState === 'complete' && !!document.querySelector('nav')`, 'the sidebar (a nav landmark) to render', 15000);
    await sleep(400);
    return app;
  } catch (error) {
    proc.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

// page helpers: names by aria-label, label or text; only shown elements
const HELPERS = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const name = (el) => {
    if (el.getAttribute('aria-label')) return norm(el.getAttribute('aria-label'));
    const lb = el.getAttribute('aria-labelledby');
    if (lb) return norm(lb.split(' ').map((i) => document.getElementById(i)?.textContent).join(' '));
    if (el.labels && el.labels.length) return norm([...el.labels].map((l) => l.textContent).join(' '));
    return norm(el.textContent || el.getAttribute('title'));
  };
  const CTL = 'a, button, [role=link], [role=button], [role=menuitem], [role=tab]';
  const find = (n, root = document, sel = CTL) => [...root.querySelectorAll(sel)].filter((e) => { const l = name(e); return (l === n || l.startsWith(n + ' ')) && shown(e); });
  const dialog = () => [...document.querySelectorAll('dialog[open], [role=dialog], [role=alertdialog]')].find(shown) || null;
  const button = (root, n) => [...root.querySelectorAll('button, [role=button]')].find((e) => { const l = name(e); return (l === n || l.startsWith(n + ' ')) && shown(e); }) || null;
  const disabled = (e) => !!(e.disabled || e.getAttribute('aria-disabled') === 'true');
  const main = () => document.querySelector('main') || document.body;
  window.__h = { norm, shown, name, find, dialog, button, disabled, main };
})();`;
const H = (app, expr) => app.eval(`${HELPERS}; (() => { return ${expr}; })()`);
const click = (app, label, root = 'document', sel = null) => H(app, `(() => { const e = __h.find(${JSON.stringify(label)}, ${root}${sel ? `, ${JSON.stringify(sel)}` : ''})[0]; if (!e) return false; e.click(); return true; })()`);
const calls = (app) => app.eval('window.__calls');

async function openData(app) {
  if (!(await click(app, 'Settings'))) {
    assert.ok(await click(app, 'Apps and settings'), "no 'Apps and settings' control to reach Settings");
    await sleep(200);
    assert.ok(await click(app, 'Settings'), "no sidebar item named 'Settings'");
  }
  await app.until(`/Changes are saved at once\\./.test(document.body.innerText)`, 'the Settings screen', 5000);
  // the section row, as app-03-settings finds it
  assert.ok(await click(app, 'Data', '__h.main()', 'a, button, [role=tab], [role=link], [role=button], [role=menuitem], li, input[type=radio]'), "no 'Data' section row in Settings");
  await sleep(400);
}
async function withData(opts, fn) {
  const app = await openApp(opts);
  try { await openData(app); await fn(app); } finally { await app.close(); }
}
const UI = { timeout: 120000, skip: SKIP_UI };

// open the Reset dialog from the Data section and return nothing; fails when no dialog appears
async function openResetDialog(app) {
  assert.ok(await click(app, 'Reset', '__h.main()'), "the Data section has no 'Reset' control");
  await app.until('(() => { ' + HELPERS + '; return !!__h.dialog(); })()', 'the Reset confirm dialog', 4000);
}
// replace the text of the dialog's text box with `word`, typed as the owner would
async function typeConfirm(app, word) {
  const ok = await H(app, `(() => { const d = __h.dialog(); const i = d && d.querySelector('input:not([type=hidden]), textarea'); if (!i) return false; i.focus(); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  assert.ok(ok, 'the Reset dialog has no text box to type the confirm word');
  await app.typeText(word);
  await sleep(200);
}
const confirmDisabled = (app) => H(app, `(() => { const b = __h.button(__h.dialog(), 'Reset'); return b ? __h.disabled(b) : 'missing'; })()`);
const resetCalls = async (app) => (await calls(app)).filter((c) => /reset/i.test(c.cmd));

// ---------------------------------------------------------------- AC1
// AC1: "Export creates a new mnemo-export-<timestamp>/ folder inside the folder the owner picked in a native
// folder dialog, and never overwrites an existing folder."
test('AC1: Export opens a native folder dialog and exports into the folder the owner picked', UI, () =>
  withData({}, async (app) => {
    assert.ok(await click(app, 'Export', '__h.main()'), "the Data section has no 'Export' control");
    await app.until(`window.__calls.some((c) => /export/i.test(c.cmd))`, 'an export command after the folder was picked', 5000);
    const all = await calls(app);
    const dlg = all.find((c) => /^plugin:dialog\|open$/.test(c.cmd));
    assert.ok(dlg, `no native dialog was opened: ${JSON.stringify(all.map((c) => c.cmd))}`);
    assert.equal(dlg.args?.options?.directory, true, `the dialog is not a folder dialog: ${JSON.stringify(dlg.args)}`);
    const exp = all.filter((c) => /export/i.test(c.cmd));
    assert.equal(exp.length, 1, 'Export must run exactly once');
    assert.ok(all.indexOf(dlg) < all.indexOf(exp[0]), 'the export ran before the folder was picked');
    assert.ok(JSON.stringify(exp[0].args ?? null).includes(PICKED), `the export was not given the picked folder: ${JSON.stringify(exp[0].args)}`);
  }));

test('AC1: cancelling the folder dialog exports nothing', UI, () =>
  withData({ pick: null }, async (app) => {
    assert.ok(await click(app, 'Export', '__h.main()'), "the Data section has no 'Export' control");
    await app.until(`window.__calls.some((c) => /^plugin:dialog\\|open$/.test(c.cmd))`, 'the native folder dialog', 5000);
    await sleep(600);
    const exp = (await calls(app)).filter((c) => /export/i.test(c.cmd));
    assert.deepEqual(exp, [], 'an export ran though the owner cancelled the folder dialog');
  }));

test('AC1: the native folder dialog is the Tauri dialog plugin, allowed in the capability file', () => {
  const cargo = readFileSync(p('src-tauri', 'Cargo.toml'), 'utf8');
  assert.match(cargo, /^\s*tauri-plugin-dialog\s*=/m, 'src-tauri/Cargo.toml has no tauri-plugin-dialog dependency');
  const caps = readdirSync(p('src-tauri', 'capabilities')).filter((f) => f.endsWith('.json'))
    .map((f) => readFileSync(p('src-tauri', 'capabilities', f), 'utf8')).join('\n');
  assert.match(caps, /"dialog:/, 'no dialog permission in src-tauri/capabilities');
});

// ---------------------------------------------------------------- Rust tests the criteria ask for
const cargo = (args) => spawnSync('cargo', ['test', '--manifest-path', p('src-tauri', 'Cargo.toml'), ...args], { encoding: 'utf8', timeout: 580000 });
let listed = null;
const storageTests = () => {
  if (!listed) {
    const r = cargo(['--lib', '--', '--list']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    listed = r.stdout.split('\n').filter((l) => l.endsWith(': test')).map((l) => l.slice(0, -6)).filter((n) => n.startsWith('storage::'));
  }
  return listed;
};
const runs = (filter) => {
  const r = cargo(['--lib', filter]);
  assert.equal(r.status, 0, `cargo test ${filter} failed\n${r.stdout}${r.stderr}`);
  assert.ok(/test result: ok\. [1-9]\d* passed/.test(r.stdout), `cargo test ${filter} ran no tests`);
};
const RUST = { timeout: 600000 };

// AC2: "... A Rust test compares the database count of live records with the export count for every item type."
// AC3: "Soft-deleted rows are absent from the export (the same Rust test seeds soft-deleted rows of each type and
// checks they are not exported)."
test('AC2 AC3: a storage Rust test about export exists and passes', RUST, () => {
  const names = storageTests().filter((n) => /export/i.test(n));
  assert.ok(names.length > 0, 'no Rust test in the storage module names export');
  runs('export');
});

// AC4: "... A test shows that without confirmation the data stays."
// AC5: "... A test shows the database and files folder equal a fresh install (same schema version, zero rows in
// every table, no files folder content)."
test('AC4 AC5: a storage Rust test about reset exists and passes', RUST, () => {
  const names = storageTests().filter((n) => /reset/i.test(n));
  assert.ok(names.length > 0, 'no Rust test in the storage module names reset');
  runs('reset');
});

// AC7: "... A Rust test copies a data folder (database plus files), opens the copy with Storage::open, and finds
// all data."
test('AC7: a storage Rust test about restoring a copied data folder exists and passes', RUST, () => {
  const names = storageTests().filter((n) => /restore|backup|copied|copy/i.test(n));
  assert.ok(names.length > 0, 'no Rust test in the storage module names restore, backup or copy');
  for (const n of names) runs(n);
});

// ---------------------------------------------------------------- AC4
// AC4: "Reset does nothing until the owner types RESET exactly; the Reset button stays disabled until the word
// matches; Cancel leaves all data. The dialog says in a plain sentence what will be deleted and points to Export
// and backup. A test shows that without confirmation the data stays."
test('AC4: the Reset dialog says what will be deleted and points to Export and backup', UI, () =>
  withData({}, async (app) => {
    await openResetDialog(app);
    const text = await H(app, '__h.norm(__h.dialog().innerText)');
    assert.match(text, /delete/i, `the dialog does not say what will be deleted: ${text}`);
    assert.match(text, /files/i, `the dialog does not say the files are deleted: ${text}`);
    assert.match(text, /settings/i, `the dialog does not say the settings are deleted: ${text}`);
    assert.match(text, /export/i, `the dialog does not point to Export: ${text}`);
    assert.match(text, /back ?up/i, `the dialog does not point to backup: ${text}`);
    assert.deepEqual(await resetCalls(app), [], 'opening the dialog already reset the data');
  }));

test('AC4: the Reset button stays disabled until RESET is typed exactly', UI, () =>
  withData({}, async (app) => {
    await openResetDialog(app);
    assert.equal(await confirmDisabled(app), true, 'the Reset button in the dialog is not disabled at first');
    for (const w of ['reset', 'Reset', 'RESE', 'RESET!']) {
      await typeConfirm(app, w);
      assert.equal(await confirmDisabled(app), true, `the Reset button is enabled after typing ${JSON.stringify(w)}`);
    }
    // a click on the disabled button does nothing
    await H(app, `__h.button(__h.dialog(), 'Reset').click()`);
    await sleep(300);
    assert.deepEqual(await resetCalls(app), [], 'Reset ran before the word matched');
    await typeConfirm(app, 'RESET');
    assert.equal(await confirmDisabled(app), false, 'the Reset button stays disabled after typing RESET');
  }));

test('AC4: Cancel closes the dialog and leaves all data (no reset runs)', UI, () =>
  withData({}, async (app) => {
    await openResetDialog(app);
    await typeConfirm(app, 'RESET');
    const ok = await H(app, `(() => { const b = __h.button(__h.dialog(), 'Cancel'); if (!b) return false; b.click(); return true; })()`);
    assert.ok(ok, "the Reset dialog has no 'Cancel' button");
    await app.until('(() => { ' + HELPERS + '; return !__h.dialog(); })()', 'the dialog to close after Cancel', 4000);
    await sleep(300);
    assert.deepEqual(await resetCalls(app), [], 'Cancel reset the data');
  }));

// ---------------------------------------------------------------- AC5
// AC5: "A confirmed Reset deletes the whole database (rows, settings, theme) and the files/ folder, makes no
// automatic backup, and reopens an empty database. ..."
test('AC5: typing RESET and pressing Reset runs the reset once, with no export first', UI, () =>
  withData({}, async (app) => {
    await openResetDialog(app);
    await typeConfirm(app, 'RESET');
    await H(app, `__h.button(__h.dialog(), 'Reset').click()`);
    await app.until(`window.__calls.some((c) => /reset/i.test(c.cmd))`, 'a reset command after the confirmed Reset', 5000);
    await sleep(300);
    const all = await calls(app);
    assert.equal(all.filter((c) => /reset/i.test(c.cmd)).length, 1, 'the reset must run exactly once');
    assert.deepEqual(all.filter((c) => /export|backup/i.test(c.cmd)), [], 'an automatic export or backup ran with the Reset');
  }));

// ---------------------------------------------------------------- AC6
// AC6: "The Data section shows the data folder path and a one-line copy command for macOS and for Ubuntu, with
// 'close Mnemo first'. There is no 'Back up now' button."
test('AC6: the Data section shows the data folder path, copy commands for macOS and Ubuntu and close Mnemo first', UI, () =>
  withData({}, async (app) => {
    await app.until(`(document.querySelector('main') || document.body).innerText.includes(${JSON.stringify(DATA_DIR)})`, 'the data folder path in the Data section', 5000);
    const text = await H(app, '__h.main().innerText');
    assert.match(text, /close Mnemo first/i, "the Data section does not say 'close Mnemo first'");
    assert.match(text, /macOS/, 'the Data section names no macOS command');
    assert.match(text, /Ubuntu/, 'the Data section names no Ubuntu command');
    const copyLines = text.split('\n').map((l) => l.trim()).filter((l) => /^(\$\s*)?(cp|rsync|ditto)\s/.test(l));
    assert.ok(copyLines.length >= 2, `expected a one-line copy command for macOS and for Ubuntu, found: ${JSON.stringify(copyLines)}`);
    const backUpNow = await H(app, `[...document.querySelectorAll('button, [role=button], a')].filter((e) => /back ?up now/i.test(__h.name(e))).length`);
    assert.equal(backUpNow, 0, "there must be no 'Back up now' button");
  }));

// ---------------------------------------------------------------- AC7
// AC7: "The README has backup and restore steps. ..."
// (Ticket: "A backup copy put back in place opens with all data. The steps are written in the README." Owner
// decision 4: "The README gets backup steps and restore steps.")
test('AC7: the README has backup and restore steps', () => {
  const lines = readFileSync(p('README.md'), 'utf8').split('\n');
  const isStep = (l) => /^\s*(\d+[.)]|[-*+])\s+\S/.test(l) || /^\s*```/.test(l);
  // a line that names the topic, followed (within 20 lines) by a step: a numbered or bulleted line, or a code block
  const hasSteps = (topic) => lines.some((l, i) => topic.test(l) && lines.slice(i + 1, i + 21).some(isStep));
  assert.ok(hasSteps(/back ?up/i), 'the README has no backup steps');
  assert.ok(hasSteps(/restore/i), 'the README has no restore steps');
});

// ---------------------------------------------------------------- AC8
// AC8: "Open data folder opens the data folder in the system file manager."
test('AC8: Open data folder asks the core to open the data folder', UI, () =>
  withData({}, async (app) => {
    const before = (await calls(app)).length;
    assert.ok(await click(app, 'Open data folder', '__h.main()'), "the Data section has no 'Open data folder' control");
    await app.until(`window.__calls.slice(${before}).some((c) => /open|reveal/i.test(c.cmd) && !/^plugin:dialog/.test(c.cmd))`, 'a command that opens the data folder', 5000);
    const after = (await calls(app)).slice(before);
    assert.deepEqual(after.filter((c) => /^plugin:dialog/.test(c.cmd)), [], 'Open data folder must not show a dialog');
    assert.deepEqual(after.filter((c) => /export|reset/i.test(c.cmd)), [], 'Open data folder ran an export or a reset');
  }));

// ---------------------------------------------------------------- AC9
// AC9: "All export and reset reads and writes live in src-tauri/src/storage; Tauri commands stay thin and return
// AppError. No migration is added."
const walk = (d, out = []) => {
  for (const n of readdirSync(d)) {
    const f = join(d, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
};
test('AC9: the export folder is made in storage only, and no migration is added for export or reset', () => {
  const src = p('src-tauri', 'src');
  const storage = `${join(src, 'storage')}/`;
  const rs = walk(src).filter((f) => f.endsWith('.rs'));
  const inStorage = rs.filter((f) => f.startsWith(storage) && readFileSync(f, 'utf8').includes('mnemo-export'));
  assert.ok(inStorage.length > 0, "no file in src-tauri/src/storage names the 'mnemo-export' folder");
  const outside = rs.filter((f) => !f.startsWith(storage) && readFileSync(f, 'utf8').includes('mnemo-export'));
  assert.deepEqual(outside.map((f) => f.slice(ROOT.length + 1)), [], 'the export folder is built outside storage');
  const migs = readdirSync(p('src-tauri', 'migrations')).filter((n) => /export|reset|backup/i.test(n));
  assert.deepEqual(migs, [], 'a migration was added for export, reset or backup');
});

// ---------------------------------------------------------------- AC10
// AC10: "UI parts come from ui/src/ds only, each asked for through a UI-ASK to Mnemo #UA-04; no temporary style.
// The PR has Ubuntu screenshots of the Data section in light and dark."
// (The UI-ASK and the screenshots are PR steps; the ds-only rule is guarded by the ds guard tests.)
test('AC10: no temporary style in the Data section', UI, () =>
  withData({}, async (app) => {
    // precondition, so the check does not pass on an empty section: the ticket's "Data" section in Settings
    // "with three actions: Export, Open data folder, Reset" is shown
    for (const n of ['Export', 'Open data folder', 'Reset']) {
      assert.ok((await H(app, `__h.find(${JSON.stringify(n)}, __h.main()).length`)) > 0, `the Data section has not rendered its '${n}' action`);
    }
    const inline = await H(app, `[...__h.main().querySelectorAll('[style]')].filter((e) => __h.shown(e) && /color|background|border|font|margin|padding/i.test(e.getAttribute('style'))).map((e) => e.tagName + ' ' + e.getAttribute('style'))`);
    assert.deepEqual(inline, [], 'temporary inline styles in the Data section');
  }));

// ---------------------------------------------------------------- AC11
// AC11: "npm test exits 0." (Owner-confirmed Verify: "npm test exits 0.")
// npm test runs this file, so this test skips inside it (MNEMO_NESTED set) and runs when the file is run alone.
const NESTED = process.env.MNEMO_NESTED ? 'nested run (inside npm test; run this file without MNEMO_NESTED)' : false;
test('AC11: npm test exits 0', { timeout: 1800000, skip: NESTED }, () => {
  const r = spawnSync('npm', ['test'], { cwd: ROOT, encoding: 'utf8', timeout: 1790000, maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, (r.stdout || '').slice(-3000) + (r.stderr || '').slice(-2000));
});
