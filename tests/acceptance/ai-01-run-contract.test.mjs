// Acceptance tests for #19 [AI-01] Run contract: one claude -p process per task with JSON output.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/ai-01-run-contract.test.mjs
// Black box, two parts:
// 1. Rust (AC1-AC8). The criteria name unit tests inside the core. The Rust test list is read from
//    `cargo test --lib -- --list` (same idea as data-01), the tests added for this ticket are found by
//    the words of each criterion in their names, and those tests are run and must pass. Tests that #18
//    and #21 already had (ai::health, ai::fake, ai::sample and the four ai::runner tests) do not count.
//    None of these tests starts a real `claude -p`: the guard from #21 panics in a test.
// 2. UI (AC9). The Vite build is served on a private port and headless Google Chrome is driven through
//    the DevTools protocol, with the Tauri bridge replaced by an in-page fake (same harness as
//    app-03-settings). The fake answers the AI health check with a chosen state and answers the test
//    prompt command (any command whose name has "prompt" or "test" in it) with a fixed answer, a plain
//    error or a usage-limit error. UI tests skip when no Chrome is found (set MNEMO_CHROME).
// Not testable from outside: AC10 (it already holds through the #21 guard), AC11 (real runs, evidence in
// the PR), AC12 (log and data file contents of a real run), AC13 (npm run check and the PR body).
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ Rust test list

// Tests the ai module had before this ticket (#18 health, #21 runner interface, fake and sample).
const EARLIER = new Set([
  'ai::runner::tests::debug_of_a_task_hides_the_prompt',
  'ai::runner::tests::fake_requested_is_true_only_for_one',
  'ai::runner::tests::select_runner_gives_the_fake_answer_when_fake',
  'ai::runner::tests::the_real_runner_panics_in_a_test',
  'commands::tests::ai_health_state_is_empty_until_set_then_keeps_the_latest',
  'commands::tests::ai_health_state_survives_a_poisoned_lock',
  'commands::tests::ai_mode_serialises_as_fake_or_real_and_follows_the_state',
]);
const EARLIER_PREFIX = ['ai::health::', 'ai::fake::', 'ai::sample::'];

let listed = null;
function allTests() {
  if (listed) return listed;
  const r = spawnSync('cargo', ['test', '--manifest-path', CARGO_TOML, '--lib', '--', '--list'], { encoding: 'utf8', timeout: 580000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, `cargo test --list exit ${r.status}:\n${r.stderr.slice(-3000)}`);
  listed = r.stdout.split('\n').filter((l) => l.endsWith(': test')).map((l) => l.slice(0, -': test'.length));
  return listed;
}
const isNew = (n) => !EARLIER.has(n) && !EARLIER_PREFIX.some((pre) => n.startsWith(pre));
// Tests added in the ai module for this ticket.
const newAiTests = () => allTests().filter((n) => n.startsWith('ai::') && isNew(n));
const leaf = (n) => n.split('::').pop().toLowerCase();

/** The new ai tests whose own name matches `re`; fails with the list when there is none. */
function named(re, what, pool = newAiTests()) {
  const hits = pool.filter((n) => re.test(leaf(n)));
  assert.ok(hits.length > 0, `no new Rust test in the ai module checks ${what} (name matching ${re}). New ai tests: ${JSON.stringify(newAiTests())}`);
  return hits;
}

/** Runs these Rust tests by exact name; they must all pass, and none may hang. */
function runExact(names) {
  const r = spawnSync('cargo', ['test', '--manifest-path', CARGO_TOML, '--lib', '--', '--exact', ...names], { encoding: 'utf8', timeout: 580000, maxBuffer: 64 * 1024 * 1024 });
  assert.notEqual(r.signal, 'SIGTERM', `the tests did not finish (hang): ${names.join(', ')}`);
  assert.equal(r.status, 0, `${names.join(', ')}\n${r.stdout.slice(-4000)}${r.stderr.slice(-2000)}`);
  const m = /test result: ok\. (\d+) passed/.exec(r.stdout);
  assert.ok(m && Number(m[1]) >= names.length, `expected ${names.length} passing tests:\n${r.stdout.slice(-2000)}`);
}

const RUST = { timeout: 600000 };

// AC1: `ClaudeRunner::run_task` builds a `claude -p` command whose args include `--output-format json`,
// `--json-schema <task.schema>`, `--allowedTools` (task tools), `--permission-mode dontAsk`,
// `--setting-sources project`, `--model <task.model>`, and never `--bare`. A unit test checks the built
// argument list.
test('AC1: a unit test checks the built claude -p argument list, and it passes', RUST, () => {
  runExact(named(/arg|flag|bare/, 'the built argument list'));
});

// AC2: The child environment has no ANTHROPIC_API_KEY even when the parent has it set. A unit test inspects
// the Command's env (like check_command in health.rs).
test('AC2: a unit test checks the runner child env has no ANTHROPIC_API_KEY, and it passes', RUST, () => {
  runExact(named(/api_key|anthropic/, 'that ANTHROPIC_API_KEY is removed from the child environment'));
});

// AC3: Output parsing reads `structured_output` from a single result object and from a JSON array of events
// (last `type: result` element). Fake/fixture tests cover both shapes and return AiOutput with JSON text.
test('AC3: fixture tests read structured_output from a single object and from an array of events', RUST, () => {
  const arr = named(/array|events/, 'reading structured_output from a JSON array of events');
  const obj = named(/object|single/, 'reading structured_output from a single result object');
  runExact([...new Set([...arr, ...obj])]);
});

// AC4: A schema task returns JSON that matches the schema or a typed error, never free text. Fixture tests
// cover non-zero exit -> ExitError, missing structured_output -> SchemaMismatch, structured_output not
// matching the schema's top-level type/required keys -> SchemaMismatch, a usage-limit result -> UsageLimit,
// and free-text `result` without structured_output -> error.
test('AC4: fixture tests cover non-zero exit, missing structured_output, schema mismatch, usage limit and free text', RUST, () => {
  const groups = [
    named(/exit/, 'a non-zero exit (ExitError)'),
    named(/missing|no_structured|without_structured/, 'a missing structured_output (SchemaMismatch)'),
    named(/schema|mismatch|required|top_level|wrong_type/, 'structured_output that does not match the schema (SchemaMismatch)'),
    named(/limit/, 'a usage-limit result (UsageLimit)'),
    named(/free|plain_text|text_only|only_text|not_json/, 'a free-text result without structured_output (error)'),
  ];
  runExact([...new Set(groups.flat())]);
});

// AC5: A task that passes its timeout has its process (and pipe-holding descendants) killed and returns
// AiError::Timeout. A test with a fake slow child program (not claude) proves the process is gone and that
// there is no hang.
test('AC5: a test with a slow fake child proves the timeout kills it and does not hang', RUST, () => {
  runExact(named(/timeout|slow|kill/, 'a task that passes its timeout'));
});

// AC6: Output reading is bounded (size cap, drain timeout) and reuses or shares the safe pattern from
// ai/health.rs. Error values and log lines never contain raw stdout/stderr. A test checks that the
// Display/Debug of errors carries no output text.
test('AC6: a test checks that Display/Debug of runner errors carries no output text', RUST, () => {
  runExact(named(/display|debug|raw|leak|stdout|stderr|output_text|no_output/, 'that errors carry no output text'));
});

// AC7: A stream-mode function runs `--output-format stream-json --verbose`, gives text pieces in order, and
// ends with the final result or a typed error. It is tested only with fake output; no feature calls it.
test('AC7: stream mode has tests with fake output, and they pass', RUST, () => {
  runExact(named(/stream/, 'stream mode'));
});

// AC8: A Tauri command runs one tiny fixed test task through the selected runner off the main thread
// (spawn_blocking) and returns the answer or a plain error. With MNEMO_FAKE_AI=1 it uses the fake.
test('AC8: a Rust test covers the test-prompt command through the selected runner, and it passes', RUST, () => {
  const pool = allTests().filter(isNew);
  runExact(named(/test_prompt|test_task/, 'the command that runs the test task', pool));
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
  distDir = mkdtempSync(join(tmpdir(), 'mnemo-ai19-dist-'));
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

const ANSWER = 'Hello from the fake runner.';
const FAIL_MESSAGE = 'Claude Code stopped with an error.';

// In-page fake of the Tauri bridge. HEALTH is the AI health state. PROMPT is what the test prompt command
// gives: 'ok' (the fixed answer), 'fail' (a plain error) or 'limit' (a usage-limit error). The command
// waits until the test calls window.__settle(), so the running state can be seen.
const bridgeScript = (health, prompt) => `(() => {
  const HEALTH = ${JSON.stringify(health)};
  const PROMPT = ${JSON.stringify(prompt)};
  const ANSWER = ${JSON.stringify(ANSWER)};
  window.__calls = [];
  window.__prompts = 0;
  const waiting = [];
  window.__settle = () => { while (waiting.length) waiting.shift()(); };
  const healthValue = () => ({ state: HEALTH, message: HEALTH === 'ready' ? 'Claude Code is installed and signed in.' : 'Install it from claude.com/claude-code, then choose Check again.' });
  const answer = () => Object.assign(new String(ANSWER), { answer: ANSWER, text: ANSWER, content: ANSWER, result: ANSWER, output: ANSWER, durationMs: 1234, duration_ms: 1234, elapsedMs: 1234, elapsed_ms: 1234 });
  const invoke = async (cmd, args) => {
    window.__calls.push({ cmd, args });
    if (/setting/i.test(cmd)) return null;
    if (/health/i.test(cmd)) return healthValue();
    if (/mode/i.test(cmd)) return 'real';
    if (/ping/i.test(cmd)) return 'pong';
    if (/version/i.test(cmd)) return '0.1.0';
    if (/prompt|test/i.test(cmd)) {
      window.__prompts += 1;
      await new Promise((done) => waiting.push(done));
      if (PROMPT === 'fail') throw { code: 'exit_error', message: ${JSON.stringify(FAIL_MESSAGE)} };
      if (PROMPT === 'limit') throw { code: 'usage_limit', message: 'Claude is at its usage limit.' };
      return answer();
    }
    return null;
  };
  let cb = 1;
  window.__TAURI_INTERNALS__ = { invoke, transformCallback: () => cb++, unregisterCallback() {}, convertFileSrc: (s) => s, metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } } };
  window.isTauri = true;
})();`;

async function openApp(health, prompt) {
  assert.equal(buildError, null, buildError ?? '');
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-ai19-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--window-size=1100,720', 'about:blank'], { stdio: 'ignore' });
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
    await S('Emulation.setDeviceMetricsOverride', { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
    await S('Page.addScriptToEvaluateOnNewDocument', { source: bridgeScript(health, prompt) });
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
      const buttons = (n) => [...main().querySelectorAll('button')].filter((b) => name(b) === n && shown(b));
      window.__h = { norm, name, shown, find, main, buttons };
    })();`;
    const app = {
      eval: evalJs,
      h: async (expr) => { await evalJs(helpers); return evalJs(expr); },
      async until(expr, what, ms = 8000) {
        const end = Date.now() + ms;
        while (Date.now() < end) { try { await evalJs(helpers); if (await evalJs(expr)) return; } catch { /* retry */ } await sleep(100); }
        assert.fail(`timed out waiting for ${what}`);
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

/** Opens Settings > AI with this health state and test-prompt behaviour, then runs fn. */
async function withAiSection(health, prompt, fn) {
  const app = await openApp(health, prompt);
  try {
    if (!(await app.click('Settings'))) {
      assert.ok(await app.click('Apps and settings'), "no 'Apps and settings' control to reach Settings");
      await sleep(200);
      assert.ok(await app.click('Settings'), "no sidebar item named 'Settings'");
    }
    await app.until(`/Changes are saved at once\\./.test(document.body.innerText)`, 'the Settings screen', 5000);
    // The AI section row of the Settings screen (inside main, not the sidebar's 'AI control').
    const opened = await app.h(`(() => { const e = [...__h.main().querySelectorAll('a, button, [role=tab], [role=link], [role=button]')].find((b) => { const l = __h.name(b); return (l === 'AI' || l.startsWith('AI ')) && __h.shown(b); }); if (!e) return false; e.click(); return true; })()`);
    assert.ok(opened, 'no AI section row in Settings');
    await sleep(500);
    await fn(app);
  } finally {
    await app.close();
  }
}

const sendButtons = (app) => app.h(`__h.buttons('Send test prompt').length`);
async function clickSend(app) {
  await app.until(`__h.buttons('Send test prompt').length === 1`, "a 'Send test prompt' button in Settings > AI");
  await app.h(`__h.buttons('Send test prompt')[0].click()`);
  await app.until('window.__prompts === 1', 'the test prompt command to be called');
}

// AC9: Settings > AI shows 'Send test prompt' (createButton) only when AI health is Ready and not at the
// usage limit. Otherwise it shows buildAiOffState with the matching reason.
test("AC9: with AI Ready, Settings > AI offers one 'Send test prompt' button", UI, () =>
  withAiSection('ready', 'ok', async (app) => {
    await app.until(`__h.buttons('Send test prompt').length === 1`, "one 'Send test prompt' button when AI is Ready");
    assert.equal(await app.h(`__h.buttons('Send test prompt')[0].type`), 'button');
  }));

for (const state of ['not_installed', 'not_signed_in', 'version_problem']) {
  // AC9: ... only when AI health is Ready ... Otherwise it shows buildAiOffState with the matching reason.
  test(`AC9: with AI ${state}, there is no 'Send test prompt' button and the AI-off state shows`, UI, () =>
    withAiSection(state, 'ok', async (app) => {
      await app.until(`/AI is off/.test(__h.main().innerText)`, "the AI-off state ('AI is off') in Settings > AI");
      assert.equal(await sendButtons(app), 0, `'Send test prompt' is offered while AI is ${state}`);
      assert.match(await app.mainText(), /Links still save/, 'the AI-off state does not say links still save');
    }));
}

// AC9: Running: setButtonBusy + buildBusyLine('Waiting for Claude…').
test("AC9: while the test prompt runs, the button is busy and 'Waiting for Claude…' shows", UI, () =>
  withAiSection('ready', 'ok', async (app) => {
    await clickSend(app);
    await app.until(`__h.buttons('Send test prompt').some((b) => b.getAttribute('aria-busy') === 'true')`, "the 'Send test prompt' button to be busy");
    await app.until(`[...__h.main().querySelectorAll('[role=status]')].some((e) => __h.norm(e.textContent) === 'Waiting for Claude…')`, "a status line 'Waiting for Claude…'");
    await app.eval('window.__settle()');
  }));

// AC8: ... returns the answer or a plain error. AC9: Success: buildText answer + buildTrustLabel('ai') + time
// as muted sm buildText.
test("AC9: on success the answer shows, marked 'Written by AI', with the time", UI, () =>
  withAiSection('ready', 'ok', async (app) => {
    await clickSend(app);
    await app.eval('window.__settle()');
    await app.until(`__h.main().innerText.includes(${JSON.stringify(ANSWER)})`, 'the answer of the test prompt');
    const text = await app.mainText();
    assert.match(text, /Written by AI/, "the answer is not marked 'Written by AI'");
    const rest = text.replace(ANSWER, '');
    assert.match(rest, /\d+(\.\d+)?\s?(ms|s|sec|seconds?)\b|\d{1,2}:\d{2}/, 'no time is shown with the answer');
    assert.doesNotMatch(text, /Waiting for Claude…/, 'the busy line stays after the answer');
    assert.equal(await app.eval('window.__prompts'), 1, 'one click ran the test prompt more than once');
  }));

// AC8: ... returns the answer or a plain error. AC9: Error: buildBanner tone bad, lead 'Test prompt failed.',
// with what happened, that nothing changed and the next step.
test("AC9: on failure an alert says 'Test prompt failed.', what happened and that nothing changed", UI, () =>
  withAiSection('ready', 'fail', async (app) => {
    await clickSend(app);
    await app.eval('window.__settle()');
    await app.until(`[...__h.main().querySelectorAll('[role=alert]')].some((e) => e.textContent.includes('Test prompt failed.'))`, "an alert with the lead 'Test prompt failed.'");
    const alert = await app.h(`__h.norm([...__h.main().querySelectorAll('[role=alert]')].find((e) => e.textContent.includes('Test prompt failed.')).textContent)`);
    assert.ok(alert.includes(FAIL_MESSAGE), `the alert does not say what happened: ${alert}`);
    assert.match(alert, /nothing (has |was )?changed/i, `the alert does not say that nothing changed: ${alert}`);
    assert.ok(alert.length > `Test prompt failed. ${FAIL_MESSAGE}`.length + 'Nothing changed.'.length, `the alert gives no next step: ${alert}`);
    assert.doesNotMatch(await app.mainText(), new RegExp(ANSWER), 'a failed run shows an answer');
  }));

// AC9: A reason the app wrote itself is marked with buildTrustLabel('guess').
test("AC9: the failure reason the app wrote is marked 'Guess'", UI, () =>
  withAiSection('ready', 'fail', async (app) => {
    await clickSend(app);
    await app.eval('window.__settle()');
    await app.until(`__h.main().innerText.includes('Test prompt failed.')`, "the 'Test prompt failed.' banner");
    assert.match(await app.mainText(), /\bGuess\b/, "the reason the app wrote is not marked 'Guess'");
  }));

// AC9: ... only when ... not at the usage limit. Otherwise it shows buildAiOffState with the matching reason.
test("AC9: at the usage limit the 'At usage limit' state shows instead of the button", UI, () =>
  withAiSection('ready', 'limit', async (app) => {
    await clickSend(app);
    await app.eval('window.__settle()');
    await app.until(`/At usage limit/.test(__h.main().innerText)`, "the usage-limit state ('At usage limit')");
    assert.equal(await sendButtons(app), 0, "'Send test prompt' is still offered at the usage limit");
    assert.match(await app.mainText(), /Links still save/, 'the usage-limit state does not say links still save');
  }));
