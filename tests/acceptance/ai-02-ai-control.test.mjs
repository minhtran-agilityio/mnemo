// Acceptance tests for #23 [AI-02] AI control: master switch, usage and pause.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/ai-02-ai-control.test.mjs
// Black box, three parts:
// 1. Rust (AC1, AC2, AC4-AC8, AC10). The criteria name tests in the core run with the fake runner and an
//    injected clock (`cargo test --manifest-path src-tauri/Cargo.toml ai_control`). The Rust test list is
//    read with `cargo test --lib -- --list`; tests that existed on the base (#22 branch) do not count. The
//    tests added for this ticket are found by the words of each criterion in their names, and must pass in
//    one `cargo test --lib` run. Criteria that say "Test: cargo test ai_control" need the test inside that
//    filter (its path holds `ai_control`).
// 2. UI (AC3-AC7, AC10). The Vite build is served on a private port and headless Google Chrome is
//    driven through the DevTools protocol (same harness as ai-01-run-contract and app-03-settings). The Tauri
//    bridge is an in-page fake that answers the five AI control commands of the public interface
//    (get_ai_control, set_ai_enabled, set_ai_thresholds, pause_background, resume_ai) with an
//    AiControlView, and records every call. UI tests skip when no Chrome is found (set MNEMO_CHROME).
// 3. AC11. `cargo test ai_control` and `npx vitest run ui/src/screens/settings` must exit 0 with new tests;
//    `npm run check` runs only outside a nested run (npm test sets MNEMO_NESTED=1). The Ubuntu screenshots on
//    the pr-assets branch are a pull-request step and are not checked here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { join, dirname, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CARGO_TOML = join(ROOT, 'src-tauri', 'Cargo.toml');
const NESTED = process.env.MNEMO_NESTED === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LONG = 600000;

// ------------------------------------------------------------------ Rust tests

// Every lib test on the base (the #22 branch at ed67f0a), one name per line, from
// `cargo test --lib -- --list`. They do not count as tests for this ticket.
const EARLIER = new Set(readFileSync(join(ROOT, 'tests', 'acceptance', 'helpers', 'ai-02-base-rust-tests.txt'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean));

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
  assert.equal(res.status, 0, `cargo test --manifest-path src-tauri/Cargo.toml ${key} exit ${res.status}:\n${res.out.slice(-5000)}`);
  return res;
}
const leaf = (n) => n.split('::').pop().toLowerCase();
/** Tests added for this ticket (lib tests not on the base). */
const newTests = () => cargo('--lib', '--', '--list').stdout.split('\n').filter((l) => l.endsWith(': test')).map((l) => l.slice(0, -': test'.length)).filter((n) => !EARLIER.has(n));
const inGate = (n) => n.includes('ai_control');

/** The new tests in `pool` whose own name matches every regex must exist and pass in one `cargo test --lib`. */
function proved(pool, res, what) {
  const hits = pool.filter((n) => res.every((re) => re.test(leaf(n))));
  assert.ok(hits.length > 0, `no new Rust test checks ${what} (names matching ${res.join(' and ')}). New tests: ${JSON.stringify(pool)}`);
  const passed = new Set(cargo('--lib').passed);
  const good = hits.filter((n) => passed.has(n));
  assert.ok(good.length > 0, `the tests for ${what} do not pass: ${hits.join(', ')}`);
  return good;
}
const gateTests = () => newTests().filter(inGate);
const RUST = { timeout: LONG };

// AC1: "One function in the core, AiControl::may_run(priority, now), returns Allow or Deny{reason} where reason
// is one of Off, Limit, Threshold, OwnerPause (serialised for the UI). Every AI feature entry point (today
// run_test_prompt) calls it before it queues, and RunQueue calls it before each start. A denied task never
// starts a process."
test('AC1: a passing ai_control test checks the deny reasons (Off, Limit, Threshold, OwnerPause) as the UI gets them', RUST, () => {
  proved(gateTests(), [/reason|serial|json|snake/], 'the deny reasons serialised for the UI');
});
test('AC1: a passing test checks that RunQueue asks the gate before each start', RUST, () => {
  const pool = newTests().filter((n) => /queue|ai_control/.test(n));
  proved(pool, [/queue|dispatch|before_(each_)?start/], 'that RunQueue asks may_run before each start');
});
test('AC1: a passing test checks that the test prompt asks the gate before it queues', RUST, () => {
  proved(newTests(), [/prompt/, /off|den|gate|may_run|limit|refus|ask/], 'that run_test_prompt calls may_run before it queues');
});
test('AC1: a passing ai_control test checks that a denied task never starts a process', RUST, () => {
  proved(gateTests(), [/start|process|spawn/, /den|off|limit|pause|threshold|wait|never|no_|zero/], 'that a denied task starts no process');
});

// AC2: "With the switch off (setting ai_enabled=false), the fake runner records 0 process starts for an owner
// task and for a background task; both get reason Off. Turning the switch off lets running runs finish, ends
// every waiting run as cancelled, and starts nothing new. Test: cargo test ai_control."
test('AC2: a passing ai_control test checks switch off gives 0 process starts and reason Off', RUST, () => {
  proved(gateTests(), [/off|switch|disabled|enabled/, /start|process|zero|0|reason/], 'that the switch off gives 0 process starts and reason Off for owner and background');
});
test('AC2: a passing ai_control test checks turning the switch off cancels every waiting run', RUST, () => {
  proved(gateTests(), [/off|switch/, /cancel/], 'that switching off ends every waiting run as cancelled');
});
test('AC2: a passing ai_control test checks turning the switch off lets running runs finish', RUST, () => {
  proved(gateTests(), [/off|switch/, /running|finish|runs_on|keeps_going/], 'that switching off lets a running run finish');
});

// AC4: "At or above the pause line (higher of five_hour and seven_day utilization >= ai_pause_at), a background
// task waits (stays queued, is not started) and an owner task runs. Below it, both run. At or above ai_warn_at,
// the screen shows a warn banner with the owner's numbers. Tested with the fake runner."
test('AC4: a passing ai_control test checks a background task waits at or above the pause line', RUST, () => {
  proved(gateTests(), [/threshold|pause_line|pause_at|above/, /background/], 'that a background task waits at or above the pause line');
});
test('AC4: a passing ai_control test checks an owner task runs at or above the pause line', RUST, () => {
  proved(gateTests(), [/threshold|pause_line|pause_at|above/, /owner/], 'that an owner task runs at or above the pause line');
});
test('AC4: a passing ai_control test checks that below the pause line both run', RUST, () => {
  proved(gateTests(), [/below|under/], 'that below the pause line both priorities run');
});
test('AC4: a passing ai_control test checks the higher of the two windows drives the pause line', RUST, () => {
  proved(gateTests(), [/higher|max|seven_day|five_hour|window/], 'that the higher of five_hour and seven_day is used');
});

// AC5: "A run that ends with AiError::UsageLimit (fake limit-reached result) pauses background work and also
// holds owner tasks (reason Limit); the screen shows a plain message via buildAiOffState({reason:'limit',
// resetAt?}). The pause state is stored in settings (ai_paused_until, ai_pause_reason)."
test('AC5: a passing ai_control test checks a limit result pauses background work and holds owner tasks', RUST, () => {
  proved(gateTests(), [/limit/, /owner|hold|held/], 'that a fake limit-reached result holds owner tasks with reason Limit');
  proved(gateTests(), [/limit/, /background|pause/], 'that a fake limit-reached result pauses background work');
});
test('AC5: a passing test checks the pause state is stored in settings', RUST, () => {
  const pool = newTests().filter((n) => /ai_control|setting|storage/.test(n));
  proved(pool, [/pause|limit/, /stor|setting|persist|saved|reopen|round_trip|key/], 'that the pause state is stored in settings (ai_paused_until, ai_pause_reason)');
});

// AC6: "The limit pause lifts at the stored resetsAt of the window that hit the limit (taken only from a
// reading of that run, only if in the future); with no resetsAt only Resume lifts it. No time is ever guessed.
// Tested with an injected clock: before resetsAt denied, at/after resetsAt allowed; Resume lifts it at once."
test('AC6: a passing ai_control test checks the limit pause lifts at resetsAt with an injected clock', RUST, () => {
  proved(gateTests(), [/reset/, /lift|allow|before|after|clock|at_/], 'that the limit pause is denied before resetsAt and lifted at it');
});
test('AC6: a passing ai_control test checks that with no resetsAt only Resume lifts the pause', RUST, () => {
  proved(gateTests(), [/no_reset|without_reset|only_resume|resume_only|no_time|guess|missing_reset|unknown_reset|past/], 'that with no resetsAt only Resume lifts the limit pause');
});
test('AC6: a passing ai_control test checks Resume lifts the limit pause at once', RUST, () => {
  proved(gateTests(), [/resume/], 'that Resume lifts the pause at once');
});

// AC7: "One Pause/Resume control in Settings sets the same pause state as the automatic pause (reason
// OwnerPause); background work waits, owner tasks still run; Resume lifts any pause."
test('AC7: a passing ai_control test checks a manual pause holds background work and lets owner tasks run', RUST, () => {
  proved(gateTests(), [/owner_pause|manual|by_hand|pause_background|by_the_owner|owner_paused|paused_by/], 'that a manual pause gives OwnerPause for background work only');
});

// AC8: "The rate_limit_event parser reads unifiedWindows.five_hour and seven_day utilization and resetsAt
// (stream-json lines and the json output array), and the last reading is stored as ai_usage_last JSON with its
// read time. The utilization scale stays Unverified in code comments, docs/spikes/spike-02-claude-p.md and the
// UI (unverified flag on the meter)."
const parserTests = () => newTests().filter((n) => /usage|claude|stream|rate_limit/.test(n));
test('AC8: a passing parser test reads five_hour and seven_day utilization and resetsAt', RUST, () => {
  proved(parserTests(), [/five_hour|seven_day|window|unified|utiliz|reading/], 'that the parser reads both windows');
});
test('AC8: a passing parser test reads a reading from a stream-json line', RUST, () => {
  proved(parserTests(), [/stream|line/], 'a reading from a stream-json rate_limit_event line');
});
test('AC8: a passing parser test reads a reading from the json output array', RUST, () => {
  proved(parserTests(), [/json|array|output/], 'a reading from the json output array');
});
test('AC8: a passing test checks the last reading is stored as ai_usage_last with its read time', RUST, () => {
  const pool = newTests().filter((n) => /ai_control|setting|storage|usage/.test(n));
  proved(pool, [/usage_last|reading|last/, /stor|save|read_at|setting|round_trip|key/], 'that the last reading is stored as ai_usage_last with its read time');
});

// AC9: "... otherwise buildRunCount with Mnemo runs today and this week counted from the run table ..."
test('AC9: a passing test counts Mnemo runs today and this week from the run table', RUST, () => {
  proved(newTests(), [/count|runs/, /today|week/], 'the count of Mnemo runs today and this week from the run table');
});

// AC10: "Warn and pause thresholds are whole numbers 1-100 with warn < pause; anything else is rejected by the
// core with a plain message and shown in place with setFieldError; defaults 60 and 95 come from the one config
// place; keys live in the existing settings table with no migration."
test('AC10: a passing ai_control test checks thresholds outside 1-100 or warn >= pause are rejected', RUST, () => {
  proved(gateTests(), [/threshold|warn|pause/, /reject|invalid|bad|outside|range|out_of|refus|lower|whole/], 'that thresholds outside 1-100 or with warn >= pause are rejected');
});
test('AC10: a passing ai_control test checks the defaults 60 and 95', RUST, () => {
  proved(gateTests(), [/default/], 'the defaults 60 and 95');
});

// ------------------------------------------------------------------ UI: Settings > AI

const CHROME = [process.env.MNEMO_CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((c) => c && existsSync(c));
const SKIP_UI = CHROME ? false : 'no Chrome found (set MNEMO_CHROME)';
const UI = { timeout: 180000, skip: SKIP_UI };
let distDir = null;
let server = null;
let port = 0;
let buildError = null;

before(async () => {
  if (SKIP_UI) return;
  distDir = mkdtempSync(join(tmpdir(), 'mnemo-ai23-dist-'));
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

const NOW = () => Math.floor(Date.now() / 1000);

/**
 * An AiControlView (design §5) for the fake core. `level` sets both windows (five_hour, seven_day); null means
 * no reading (run counts instead). Window fields are given in both the stored form (utilization 0..1) and the
 * display form (percent), so the UI may read either.
 */
function view({ enabled = true, warnAt = 60, pauseAt = 95, pause = null, five = null, seven = null, runs = { today: 4, week: 19 } } = {}) {
  const now = NOW();
  const win = (p) => (p === null ? null : { utilization: p / 100, percent: p, resetsAt: now + 3 * 3600, status: 'allowed' });
  const level = Math.max(five ?? -1, seven ?? -1);
  const reading = five !== null || seven !== null;
  const deny = (reason) => ({ Deny: { reason }, deny: { reason }, reason, kind: 'deny', decision: 'deny' });
  let gate = 'Allow';
  if (!enabled) gate = deny('off');
  else if (pause?.reason === 'limit') gate = deny('limit');
  else if (pause?.reason === 'owner') gate = deny('owner_pause');
  else if (reading && level >= pauseAt) gate = deny('threshold');
  return {
    enabled, warnAt, pauseAt, pause, backgroundGate: gate,
    warn: reading && level >= warnAt,
    usage: reading ? { kind: 'reading', readAt: now - 2 * 3600, fiveHour: win(five), sevenDay: win(seven) } : { kind: 'runs', ...runs },
  };
}

// In-page fake of the Tauri bridge. START is the first AiControlView. The AI health check is Ready and the
// mode is real.
const bridgeScript = (start) => `(() => {
  let V = ${JSON.stringify(start)};
  window.__calls = [];
  window.__prompts = 0;
  const firstBool = (a) => { for (const v of Object.values(a || {})) if (typeof v === 'boolean') return v; return undefined; };
  const nums = (a) => Object.values(a || {}).filter((v) => typeof v === 'number');
  const copy = () => JSON.parse(JSON.stringify(V));
  const gateFor = () => {
    const deny = (reason) => ({ Deny: { reason }, deny: { reason }, reason, kind: 'deny', decision: 'deny' });
    if (!V.enabled) return deny('off');
    if (V.pause && V.pause.reason === 'limit') return deny('limit');
    if (V.pause && V.pause.reason === 'owner') return deny('owner_pause');
    return 'Allow';
  };
  const invoke = async (cmd, args) => {
    window.__calls.push({ cmd, args });
    if (cmd === 'get_ai_control') return copy();
    if (cmd === 'set_ai_enabled') { V.enabled = firstBool(args) ?? !V.enabled; V.backgroundGate = gateFor(); return copy(); }
    if (cmd === 'set_ai_thresholds') {
      const n = nums(args); const w = args && (args.warn ?? args.warnAt ?? n[0]); const p = args && (args.pause ?? args.pauseAt ?? n[1]);
      V.warnAt = w; V.pauseAt = p; return copy();
    }
    if (cmd === 'pause_background') { V.pause = { reason: 'owner', until: null }; V.backgroundGate = gateFor(); return copy(); }
    if (cmd === 'resume_ai') { V.pause = null; V.backgroundGate = gateFor(); return copy(); }
    if (cmd.startsWith('plugin:event')) return 1;
    if (/setting/i.test(cmd)) return null;
    if (/health/i.test(cmd)) return { state: 'ready', message: 'Claude Code is installed and signed in.' };
    if (/mode/i.test(cmd)) return 'real';
    if (/ping/i.test(cmd)) return 'pong';
    if (/version/i.test(cmd)) return '0.1.0';
    if (/prompt|test/i.test(cmd)) {
      window.__prompts += 1;
      if (!V.enabled) throw { code: 'ai_off', message: 'AI is off.' };
      return { answer: 'Hello.', text: 'Hello.', durationMs: 10 };
    }
    return null;
  };
  let cb = 1;
  window.__TAURI_INTERNALS__ = { invoke, transformCallback: () => cb++, unregisterCallback() {}, convertFileSrc: (s) => s, metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } } };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.isTauri = true;
})();`;

async function openApp(script) {
  assert.equal(buildError, null, buildError ?? '');
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-ai23-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--window-size=1100,900', 'about:blank'], { stdio: 'ignore' });
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
    await S('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
    await S('Page.addScriptToEvaluateOnNewDocument', { source: script });
    const evalJs = async (expr) => {
      const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`page error: ${JSON.stringify(r.exceptionDetails).slice(0, 500)}`);
      return r.result.value;
    };
    const helpers = `(() => {
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
      const name = (el) => norm(el.getAttribute('aria-label') || el.textContent || el.getAttribute('title'));
      const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const ctl = () => [...document.querySelectorAll('a, button, [role=link], [role=button], [role=menuitem], [role=tab]')];
      const find = (n) => ctl().filter((el) => { const l = name(el); return (l === n || l.startsWith(n + ' ')) && shown(el); });
      const main = () => document.querySelector('main') || document.body;
      const buttons = (re) => [...main().querySelectorAll('button')].filter((b) => re.test(name(b)) && shown(b));
      const sw = () => [...main().querySelectorAll('[role=switch]')].filter((s) => /\\bAI\\b/.test(norm(s.textContent) + ' ' + norm(s.getAttribute('aria-label'))) && shown(s));
      const statuses = () => [...main().querySelectorAll('[role=status]')].filter((e) => !e.querySelector('[role=meter]')).map((e) => norm(e.textContent));
      const numeric = () => [...main().querySelectorAll('input[inputmode=numeric]')].filter(shown);
      const byValue = (v) => numeric().find((i) => i.value === String(v));
      const typeIn = (input, v) => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(input, String(v));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const commit = (input) => { input.dispatchEvent(new Event('change', { bubbles: true })); input.blur(); };
      const errOf = (input) => {
        if (input.getAttribute('aria-invalid') !== 'true') return null;
        const ids = (input.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean);
        return norm(ids.map((i) => document.getElementById(i)?.textContent || '').join(' '));
      };
      const calls = (c) => window.__calls.filter((x) => x.cmd === c);
      window.__h = { norm, name, shown, find, main, buttons, sw, statuses, numeric, byValue, typeIn, commit, errOf, calls };
    })();`;
    const app = {
      eval: evalJs,
      h: async (expr) => { await evalJs(helpers); return evalJs(expr); },
      async until(expr, what, ms = 8000) {
        const end = Date.now() + ms;
        while (Date.now() < end) { try { await evalJs(helpers); if (await evalJs(expr)) return; } catch { /* retry */ } await sleep(100); }
        let text = '';
        try { text = await evalJs(`(document.querySelector('main') || document.body).innerText.replace(/\\s+/g, ' ').slice(0, 1500)`); } catch { /* none */ }
        assert.fail(`timed out waiting for ${what}. Screen: ${text}`);
      },
      click: (label) => app.h(`(() => { const e = __h.find(${JSON.stringify(label)})[0]; if (!e) return false; e.click(); return true; })()`),
      mainText: () => app.h(`__h.norm(__h.main().innerText)`),
      async close() {
        const gone = new Promise((ok) => { if (proc.exitCode !== null) ok(); else proc.once('exit', ok); });
        try { await Promise.race([send('Browser.close'), sleep(2000)]); } catch { /* already closing */ }
        await Promise.race([gone, sleep(5000)]);
        try { ws.close(); } catch { /* closed */ }
        if (proc.exitCode === null) proc.kill('SIGKILL');
        await sleep(200);
        rmSync(dir, { recursive: true, force: true });
      },
    };
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

/** Opens Settings > AI with this AiControlView (and core behaviour), then runs fn. */
async function withAi(start, fn) {
  const app = await openApp(bridgeScript(start));
  try {
    if (!(await app.click('Settings'))) {
      assert.ok(await app.click('Apps and settings'), "no 'Apps and settings' control to reach Settings");
      await sleep(200);
      assert.ok(await app.click('Settings'), "no sidebar item named 'Settings'");
    }
    await app.until(`/Changes are saved at once\\./.test(document.body.innerText)`, 'the Settings screen', 5000);
    const opened = await app.h(`(() => { const e = [...__h.main().querySelectorAll('a, button, [role=tab], [role=link], [role=button]')].find((b) => { const l = __h.name(b); return (l === 'AI' || l.startsWith('AI ')) && __h.shown(b); }); if (!e) return false; e.click(); return true; })()`);
    assert.ok(opened, 'no AI section row in Settings');
    await sleep(500);
    await fn(app);
  } finally {
    await app.close();
  }
}

// AC3: "With the switch off, the Settings screen shows buildAiOffState({reason:'off'}) and a feature that needs
// AI (the test prompt) shows why it is off instead of running."
test("AC3: with the switch off, Settings > AI shows 'AI is off' and the switch named AI is off", UI, () =>
  withAi(view({ enabled: false }), async (app) => {
    await app.until(`/AI is off/.test(__h.main().innerText)`, "the AI-off state ('AI is off')");
    await app.until(`__h.sw().length === 1`, 'one switch named AI in Settings > AI');
    assert.equal(await app.h(`__h.sw()[0].getAttribute('aria-checked')`), 'false', 'the AI switch shows On while AI is off');
  }));

test('AC3: with the switch off, the test prompt shows why AI is off instead of running', UI, () =>
  withAi(view({ enabled: false }), async (app) => {
    await app.until(`/AI is off/.test(__h.main().innerText)`, "the AI-off state ('AI is off')");
    await sleep(500);
    assert.equal(await app.h(`__h.buttons(/^Send test prompt/).length`), 0, "'Send test prompt' is offered while the switch is off");
    assert.equal(await app.eval('window.__prompts'), 0, 'the test prompt ran while the switch is off');
  }));

// AC4: "At or above ai_warn_at, the screen shows a warn banner with the owner's numbers."
// A banner is a status message apart from the usage meters (the meter's own note does not count).
test("AC4: at or above the warn line, a warn banner shows the usage and the owner's warn line", UI, () =>
  withAi(view({ warnAt: 50, pauseAt: 90, five: 64, seven: 41 }), async (app) => {
    await app.until(`__h.statuses().some((t) => /\\b64\\b/.test(t) && /\\b50\\b/.test(t))`, "a status banner with the usage 64 and the warn line 50");
  }));

test('AC4: below the warn line no warn banner shows', UI, () =>
  withAi(view({ warnAt: 50, pauseAt: 90, five: 30, seven: 20 }), async (app) => {
    await app.until(`__h.main().querySelectorAll('[role=meter]').length > 0`, 'the usage meters');
    await sleep(300);
    const banners = await app.h(`__h.statuses().filter((t) => /\\b50\\b/.test(t) && /warn/i.test(t))`);
    assert.deepEqual(banners, [], 'a warn banner shows below the warn line');
  }));

// AC5: "... the screen shows a plain message via buildAiOffState({reason:'limit', resetAt?})."
// AC6: "The limit pause lifts at the stored resetsAt ... No time is ever guessed."
test("AC5: after a limit error with a stored reset time, the 'At usage limit' state shows that time", UI, () =>
  withAi(view({ pause: { reason: 'limit', until: NOW() + 3 * 3600 }, five: 100, seven: 40 }), async (app) => {
    await app.until(`/At usage limit/.test(__h.main().innerText)`, "the usage-limit state ('At usage limit')");
    const box = await app.h(`__h.norm([...__h.main().querySelectorAll('b')].find((b) => b.textContent === 'At usage limit').parentElement.textContent)`);
    assert.match(box, /\d{1,2}[:.]\d{2}|\d{1,2}\s?(am|pm)/i, `the limit state does not show the stored reset time: ${box}`);
  }));

test('AC6: after a limit error with no reset time, the limit state shows no time', UI, () =>
  withAi(view({ pause: { reason: 'limit', until: null } }), async (app) => {
    await app.until(`/At usage limit/.test(__h.main().innerText)`, "the usage-limit state ('At usage limit')");
    const box = await app.h(`__h.norm([...__h.main().querySelectorAll('b')].find((b) => b.textContent === 'At usage limit').parentElement.textContent)`);
    assert.doesNotMatch(box, /\d{1,2}[:.]\d{2}|\d{1,2}\s?(am|pm)/i, `a time is shown with no stored reset time: ${box}`);
  }));

// AC7: "One Pause/Resume control in Settings sets the same pause state as the automatic pause (reason
// OwnerPause); background work waits, owner tasks still run; Resume lifts any pause."
test('AC7: with background work paused by the owner, the test prompt (an owner task) is still offered', UI, () =>
  withAi(view({ pause: { reason: 'owner', until: null } }), async (app) => {
    await app.until(`__h.buttons(/^Resume/).length === 1`, 'one Resume control');
    await app.until(`__h.buttons(/^Send test prompt/).length === 1`, "the 'Send test prompt' button while paused by the owner");
  }));

// AC10: "Warn and pause thresholds are whole numbers 1-100 with warn < pause; anything else is rejected by the
// core with a plain message and shown in place with setFieldError ..."
for (const [what, bad] of [['0', '0'], ['101', '101'], ['a decimal', '12.5'], ['a warn line not below the pause line', '95']]) {
  test(`AC10: a warn line of ${what} shows an error in place on the field and is not saved`, UI, () =>
    withAi(view({ warnAt: 60, pauseAt: 95 }), async (app) => {
      await app.until(`!!__h.byValue('60') && !!__h.byValue('95')`, 'the warn (60) and pause (95) number fields');
      await app.h(`(() => { const i = __h.byValue('60'); i.setAttribute('data-qa', 'warn'); __h.typeIn(i, ${JSON.stringify(bad)}); })()`);
      await app.until(`!!__h.errOf(document.querySelector('[data-qa=warn]'))`, `an error in place on the warn field for ${bad}`);
      await app.h(`__h.commit(document.querySelector('[data-qa=warn]'))`);
      await sleep(300);
      assert.equal(await app.h(`__h.calls('set_ai_thresholds').length`), 0, `a warn line of ${bad} was sent to the core`);
    }));
}

// ------------------------------------------------------------------ AC11

// AC11: "Verify commands exit 0: cargo test --manifest-path src-tauri/Cargo.toml ai_control; npx vitest run
// ui/src/screens/settings (switch, meter or run count, label of which number, pause banner); npm run check."
test('AC11: cargo test ai_control exits 0 and runs new tests', RUST, () => {
  const r = cargo('ai_control');
  assert.ok(r.passed.some((n) => n.includes('ai_control') && !EARLIER.has(n)), 'cargo test ai_control ran no new test');
});

// The settings screen tests on the base. They do not count.
const EARLIER_UI = new Set([
  'it shows the title, the note and a section list with the current value of each row',
  'Appearance offers System, Light and Dark, and no other theme',
  'the Data section opens and has no controls',
  'the AI row shows the state of the first check without opening the section',
  'the AI section shows the state, the fix message and a Check again button',
  'every state has its own plain word on the row',
  'a first check that is still running shows Checking, then the result',
  'a first check that never ends stops at a plain line with Check again, not Checking',
  'Check again asks once, shows the new state and does not double submit',
  'a check that cannot be asked for shows a plain line and keeps the button',
  'a first read that fails shows a plain line, never a Ready state',
  'choosing a theme applies it at once, updates the row and saves it',
  'saves run one at a time, in the order of the choices',
  'a failed save shows a plain line, keeps the theme applied and keeps the choices',
  'a later save that works clears the line',
  'a failed save after the owner left Settings is still reported',
  'clicking a section row keeps keyboard focus on that row',
  'a good save while Settings is open clears an earlier detached failure',
  'the AI section shows the Fake AI banner first when the mode is fake',
  'the Fake AI banner shows up when the mode is read after the section opened',
  'the AI section shows no banner when the mode is real',
  'the AI section shows no banner, and the failure is logged, when the mode cannot be read',
  'the test prompt button is offered when AI is Ready',
  'with AI %s the button is hidden and the AI-off state shows',
  'with the fake AI the button is offered even when Claude Code is not Ready',
  'while the test prompt runs, the button is busy, the busy line shows and a second click is ignored',
  'leaving Settings during a run and coming back shows it still running, and its answer then shows',
  'a good answer shows the text, the Written by AI label and the time',
  'a failure shows the bad banner with what happened, that nothing changed, the next step and a Guess label',
  'a failure that is not from the core still gives a plain banner',
  'the usage limit shows the limit state instead of the button, and Check again brings the button back',
]);

let vitestRun = null;
function settingsVitest() {
  if (!vitestRun) {
    const dir = mkdtempSync(join(tmpdir(), 'mnemo-ai23-vitest-'));
    const out = join(dir, 'report.json');
    const r = spawnSync('npx', ['vitest', 'run', '--no-color', '--reporter=default', '--reporter=json', `--outputFile.json=${out}`, 'ui/src/screens/settings'], { cwd: ROOT, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    let passed = [];
    if (existsSync(out)) {
      const rep = JSON.parse(readFileSync(out, 'utf8'));
      passed = rep.testResults.flatMap((f) => f.assertionResults).filter((a) => a.status === 'passed').map((a) => a.title);
    }
    rmSync(dir, { recursive: true, force: true });
    vitestRun = { status: r.status, out: `${r.stdout}\n${r.stderr}`, passed };
  }
  assert.equal(vitestRun.status, 0, `npx vitest run ui/src/screens/settings exit ${vitestRun.status}:\n${vitestRun.out.slice(-4000)}`);
  return vitestRun.passed.filter((t) => !EARLIER_UI.has(t));
}
for (const [what, re] of [['the switch', /switch/i], ['the meter or the run count', /meter|run count|runs|usage|window/i], ['the label of which number is shown', /label|which/i], ['the pause banner', /pause/i]]) {
  test(`AC11: npx vitest run ui/src/screens/settings exits 0 with a new passing test for ${what}`, { timeout: 320000 }, () => {
    const fresh = settingsVitest();
    assert.ok(fresh.some((t) => re.test(t)), `no new passing settings test for ${what}. New tests: ${JSON.stringify(fresh)}`);
  });
}

test('AC11: npm run check passes', { timeout: LONG, skip: NESTED ? 'nested run (npm test runs this file)' : false }, () => {
  const r = spawnSync('npm', ['run', 'check'], { cwd: ROOT, encoding: 'utf8', timeout: 590000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, `npm run check exit ${r.status}:\n${(r.stdout || '').slice(-3000)}${(r.stderr || '').slice(-3000)}`);
});
