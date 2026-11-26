// Acceptance tests for #9 [APP-01] Desktop app: window, tray, Quit, no sign-in, works offline.
// Run static + Rust-list tests: node --test "tests/acceptance/app-shell-01.test.mjs"
// The desktop tests (AC1-AC7, AC9 log file) start the real app. They are opt-in because they need a
// built binary, an X display, wmctrl, xprop, gdbus, dbus-daemon and /usr/bin/python3 with PyGObject:
//   MNEMO_E2E=1 [MNEMO_BIN=src-tauri/target/debug/mnemo] node --test tests/acceptance/app-shell-01.test.mjs
// Each test gets its own HOME, data folder, private D-Bus session and (when needed) a fake
// StatusNotifierWatcher, so runs never share state. Nothing here reads the app's source code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, rmSync, mkdirSync, realpathSync, readlinkSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const p = (...a) => join(ROOT, ...a);
const NESTED = !!process.env.MNEMO_NESTED;
const E2E = process.env.MNEMO_E2E === '1';
const BIN = process.env.MNEMO_BIN ? resolve(ROOT, process.env.MNEMO_BIN) : p('src-tauri', 'target', 'debug', 'mnemo');
const SKIP_E2E = E2E ? false : 'desktop test: set MNEMO_E2E=1 (needs built binary, X display, D-Bus tools)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, ms = 20000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  assert.fail(`timed out waiting for ${what}`);
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    if (['node_modules', 'target', '.git', 'dist'].includes(n)) continue;
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
}

// ---------- desktop harness ----------
async function makeSession({ watcher }) {
  assert.ok(existsSync(BIN), `app binary missing: ${BIN} (build it with: npm run tauri build -- --debug --no-bundle)`);
  const home = mkdtempSync(join(tmpdir(), 'mnemo-e2e-'));
  const id = `mnemo-e2e-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const dataHome = join(home, 'data');
  mkdirSync(dataHome, { recursive: true });
  const bus = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1', `--address=unix:path=${home}/bus`], { stdio: ['ignore', 'pipe', 'inherit'] });
  const addr = await new Promise((res) => bus.stdout.once('data', (d) => res(String(d).trim())));
  const env = {
    ...process.env,
    HOME: home,
    XDG_DATA_HOME: dataHome,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    DBUS_SESSION_BUS_ADDRESS: addr,
    GDK_BACKEND: 'x11',
    XAUTHORITY: process.env.XAUTHORITY || join(process.env.HOME || '', '.Xauthority'),
    MNEMO_TEST_ID: id,
  };
  delete env.WAYLAND_DISPLAY;
  const regFile = join(home, 'items.txt');
  let watch = null;
  if (watcher) {
    watch = spawn('/usr/bin/python3', [p('tests', 'acceptance', 'helpers', 'sni-watcher.py'), regFile], { env, stdio: 'inherit' });
    await waitFor(() => spawnSync('gdbus', ['call', '--session', '--dest', 'org.kde.StatusNotifierWatcher', '--object-path', '/StatusNotifierWatcher', '--method', 'org.freedesktop.DBus.Properties.Get', 'org.kde.StatusNotifierWatcher', 'ProtocolVersion'], { env }).status === 0, 'fake watcher');
  }
  const bin = realpathSync(BIN);
  const procs = () =>
    readdirSync('/proc')
      .filter((n) => /^\d+$/.test(n))
      .filter((n) => {
        try {
          return readlinkSync(`/proc/${n}/exe`).replace(/ \(deleted\)$/, '') === bin && readFileSync(`/proc/${n}/environ`, 'latin1').includes(`MNEMO_TEST_ID=${id}`);
        } catch {
          return false;
        }
      })
      .map(Number);
  const gdbus = (dest, path, method, ...args) => spawnSync('gdbus', ['call', '--session', '--dest', dest, '--object-path', path, '--method', method, ...args], { env, encoding: 'utf8' });
  const s = {
    home, env, procs,
    dataDir: () => join(dataHome, 'io.mnemo.desktop'),
    start() {
      const c = spawn(bin, [], { env, stdio: 'ignore' });
      c.unref();
      return c;
    },
    // windows of the app, from the window manager
    wins() {
      const pids = new Set(procs());
      const r = spawnSync('wmctrl', ['-lGp'], { env, encoding: 'utf8' });
      return r.stdout.split('\n').map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 9 && pids.has(Number(c[2])))
        .map((c) => ({ id: c[0], x: +c[3], y: +c[4], w: +c[5], h: +c[6], title: c.slice(8).join(' ') }));
    },
    win: () => s.wins()[0],
    async waitWin() {
      return waitFor(() => s.win(), 'the Mnemo window');
    },
    state: (w) => spawnSync('xprop', ['-id', w.id, '_NET_WM_STATE'], { env, encoding: 'utf8' }).stdout,
    setGeom(w, x, y, wd, h) {
      spawnSync('wmctrl', ['-i', '-r', w.id, '-e', `0,${x},${y},${wd},${h}`], { env });
    },
    close: (w) => spawnSync('wmctrl', ['-i', '-c', w.id], { env }),
    activeId: () => spawnSync('xprop', ['-root', '_NET_ACTIVE_WINDOW'], { env, encoding: 'utf8' }).stdout.match(/0x[0-9a-f]+/i)?.[0],
    async trayItem() {
      const line = await waitFor(() => existsSync(regFile) && readFileSync(regFile, 'utf8').trim().split('\n').pop(), 'a tray item registered with the watcher');
      const [sender, arg] = line.split('\t');
      let dest = sender, path = '/StatusNotifierItem';
      if (arg.startsWith('/')) path = arg;
      else if (arg.includes('/')) { dest = arg.slice(0, arg.indexOf('/')); path = arg.slice(arg.indexOf('/')); }
      else dest = arg;
      const m = gdbus(dest, path, 'org.freedesktop.DBus.Properties.Get', 'org.kde.StatusNotifierItem', 'Menu');
      const menuPath = m.stdout.match(/'(\/[^']*)'/)?.[1];
      assert.ok(menuPath, `tray item has no Menu property: ${m.stdout}${m.stderr}`);
      return { dest, menuPath };
    },
    async menu() {
      const { dest, menuPath } = await s.trayItem();
      const r = gdbus(dest, menuPath, 'com.canonical.dbusmenu.GetLayout', '0', 'int32 -1', '[]');
      assert.equal(r.status, 0, r.stderr);
      const entries = [...r.stdout.matchAll(/\((\d+), \{([^{}]*)\}/g)]
        .map((m) => ({ id: m[1], label: (m[2].match(/'label': <'([^']*)'>/)?.[1] ?? '').replace(/_/g, '') }))
        .filter((e) => e.label);
      return { dest, menuPath, entries };
    },
    async click(label) {
      const { dest, menuPath, entries } = await s.menu();
      const e = entries.find((x) => x.label === label);
      assert.ok(e, `no tray menu item ${label}`);
      const r = gdbus(dest, menuPath, 'com.canonical.dbusmenu.Event', e.id, 'clicked', '<int32 0>', '0');
      assert.equal(r.status, 0, r.stderr);
    },
    async cleanup() {
      for (const pid of procs()) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
      watch?.kill('SIGKILL');
      bus.kill('SIGKILL');
      rmSync(home, { recursive: true, force: true });
    },
  };
  return s;
}

async function withSession(opts, fn) {
  const s = await makeSession(opts);
  try {
    await fn(s);
  } finally {
    await s.cleanup();
  }
}
const near = (a, b, msg) => {
  for (const k of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(a[k] - b[k]) <= 2, `${msg}: ${k} ${a[k]} vs ${b[k]}`);
};
const TEST = { timeout: 120000, skip: SKIP_E2E };

// ---------- AC1 ----------
test('AC1: the app starts and the Mnemo window appears, with no sign-in screen', TEST, () =>
  withSession({ watcher: true }, async (s) => {
    s.start();
    const w = await s.waitWin();
    assert.match(w.title, /Mnemo/);
    assert.doesNotMatch(w.title, /sign.?in|log.?in/i);
  }));

test('AC1: the running app makes no network connection at start', TEST, () =>
  withSession({ watcher: true }, async (s) => {
    s.start();
    await s.waitWin();
    await sleep(3000);
    const pids = s.procs();
    const out = spawnSync('ss', ['-H', '-tunp'], { encoding: 'utf8' }).stdout.split('\n')
      .filter((l) => pids.some((pid) => l.includes(`pid=${pid},`)))
      .filter((l) => !/\s(127\.0\.0\.1|\[::1\]|localhost)[:\]]/.test(l.split(/\s+/).slice(5, 6).join(' ') + ' ' + l.split(/\s+/)[5] + ':'))
      .filter((l) => !/\s(127\.0\.0\.1|\[::1\]):\d+\s+(127\.0\.0\.1|\[::1\]):\d+/.test(l));
    assert.deepEqual(out, [], 'the app opened a non-loopback network connection');
  }));

test('AC1: no network crate or http capability is added, and the UI has no sign-in', () => {
  const cargo = readFileSync(p('src-tauri', 'Cargo.toml'), 'utf8');
  const deps = cargo.slice(cargo.indexOf('[dependencies]'));
  assert.doesNotMatch(deps, /^\s*(hyper|ureq|isahc|surf|curl|attohttpc|tungstenite|tokio-tungstenite|tauri-plugin-http|tauri-plugin-updater)\b/m);
  for (const f of walk(p('src-tauri', 'capabilities'))) assert.doesNotMatch(readFileSync(f, 'utf8'), /http|updater/i);
  const ui = walk(p('ui')).filter((f) => /\.(html|ts|tsx|css)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
  assert.doesNotMatch(ui, /sign[ -]?in|log[ -]?in|password/i);
  // The feature must exist: the app now keeps a log, so the `log` facade is a dependency (also AC9).
  assert.match(deps, /^\s*log\b/m, 'the log facade crate is not a dependency');
});

// ---------- AC2 ----------
test('AC2: closing the window keeps the process; the tray item has exactly Open and Quit', TEST, () =>
  withSession({ watcher: true }, async (s) => {
    const c = s.start();
    const w = await s.waitWin();
    const menu = await s.menu();
    assert.deepEqual(menu.entries.map((e) => e.label), ['Open', 'Quit']);
    s.close(w);
    await waitFor(() => !s.win(), 'the window to be hidden');
    await sleep(1500);
    assert.equal(s.procs().length, 1, 'the process must stay alive after close');
    assert.equal(c.exitCode, null);
    assert.deepEqual((await s.menu()).entries.map((e) => e.label), ['Open', 'Quit']);
  }));

// ---------- AC3 ----------
test('AC3: Open brings the window back at the same size and position', TEST, () =>
  withSession({ watcher: true }, async (s) => {
    s.start();
    const w = await s.waitWin();
    s.setGeom(w, 210, 130, 777, 515);
    await sleep(1500);
    const before = s.win();
    s.close(before);
    await waitFor(() => !s.win(), 'the window to be hidden');
    await s.click('Open');
    const after = await waitFor(() => s.win(), 'the window to come back');
    near(after, before, 'geometry after Open');
  }));

// ---------- AC4 ----------
test('AC4: a second start leaves one mnemo process and focuses the running window', TEST, () =>
  withSession({ watcher: true }, async (s) => {
    s.start();
    const w = await s.waitWin();
    s.close(w);
    await waitFor(() => !s.win(), 'the window to be hidden');
    const second = s.start();
    await waitFor(() => second.exitCode !== null || s.procs().length === 1, 'the second start to end');
    await sleep(2000);
    assert.equal(s.procs().length, 1, 'exactly one mnemo process');
    const shown = await waitFor(() => s.win(), 'the running window to be shown');
    await waitFor(() => s.activeId() && parseInt(s.activeId(), 16) === parseInt(shown.id, 16), 'the window to be focused');
  }));

// ---------- AC5 ----------
test('AC5: window size and position survive Quit and restart', TEST, () =>
  withSession({ watcher: true }, async (s) => {
    s.start();
    const w = await s.waitWin();
    s.setGeom(w, 240, 160, 801, 543);
    await sleep(1500);
    const before = s.win();
    await s.click('Quit');
    await waitFor(() => s.procs().length === 0, 'the app to quit');
    s.start();
    const after = await s.waitWin();
    await sleep(1000);
    near(s.win() ?? after, before, 'geometry after restart');
  }));

// ---------- AC6 ----------
test('AC6: Quit leaves no mnemo process', TEST, () =>
  withSession({ watcher: true }, async (s) => {
    s.start();
    await s.waitWin();
    await s.click('Quit');
    await waitFor(() => s.procs().length === 0, 'no mnemo process after Quit', 15000);
  }));

// ---------- AC7 ----------
test('AC7: with no StatusNotifier watcher, closing the window minimises it', TEST, () =>
  withSession({ watcher: false }, async (s) => {
    const c = s.start();
    const w = await s.waitWin();
    s.close(w);
    await sleep(2000);
    const after = s.win();
    assert.ok(after, 'the window must stay on screen (minimised), not be hidden');
    assert.match(s.state(after), /_NET_WM_STATE_HIDDEN/, 'the window must be minimised');
    assert.equal(c.exitCode, null);
    assert.equal(s.procs().length, 1);
  }));

// ---------- AC8 ----------
const cargoList = () => {
  const r = spawnSync('cargo', ['test', '--manifest-path', p('src-tauri', 'Cargo.toml'), '--', '--list'], { encoding: 'utf8', timeout: 580000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.split('\n').filter((l) => l.endsWith(': test')).map((l) => l.slice(0, -6));
};

test('AC8: a Rust test in system covers the data and config folder function', { timeout: 590000 }, () => {
  const names = cargoList();
  assert.ok(names.some((n) => /^system::/.test(n) && /path|dir|folder/i.test(n)), `no system:: test about paths in: ${names.join(', ')}`);
});

test('AC8: only the system module builds the data and config folder paths', () => {
  const src = walk(p('src-tauri', 'src')).filter((f) => f.endsWith('.rs'));
  const rel = (f) => f.slice(p('src-tauri', 'src').length + 1);
  const withConfig = src.filter((f) => /\.config/.test(readFileSync(f, 'utf8')) && /mnemo/.test(readFileSync(f, 'utf8')) && /\.config\W+mnemo|"\.config"/.test(readFileSync(f, 'utf8')));
  assert.ok(withConfig.length >= 1, 'the ~/.config/mnemo folder is not built anywhere');
  for (const f of withConfig) assert.match(rel(f), /^system\//, `${rel(f)} builds the config folder by hand`);
  const withData = src.filter((f) => /app_data_dir\s*\(/.test(readFileSync(f, 'utf8')));
  assert.ok(withData.length >= 1, 'app_data_dir is not used');
  for (const f of withData) assert.match(rel(f), /^system\//, `${rel(f)} builds the data folder by hand`);
});

// ---------- AC9 ----------
test('AC9: a plain error log file is written in the data folder, without tokens', TEST, () =>
  withSession({ watcher: true }, async (s) => {
    s.start();
    await s.waitWin();
    const logs = await waitFor(() => { const l = walk(s.dataDir()).filter((f) => /\.log$/.test(f)); return l.length ? l : null; }, 'a .log file in the data folder');
    for (const f of logs) {
      const t = readFileSync(f, 'utf8');
      assert.doesNotMatch(t, /token|bearer|sk-ant|authorization|password/i);
      assert.ok(!t.includes('\u0000'), 'the log must be plain text');
    }
  }));

test('AC9: the log facade is used and a Rust test covers the log path or setup', { timeout: 590000 }, () => {
  const cargo = readFileSync(p('src-tauri', 'Cargo.toml'), 'utf8');
  assert.match(cargo.slice(cargo.indexOf('[dependencies]')), /^\s*log\b/m, 'the log crate is missing');
  const names = cargoList();
  assert.ok(names.some((n) => /log/i.test(n)), `no Rust test about the log in: ${names.join(', ')}`);
});

// ---------- AC10 ----------
test('AC10: npm run check passes', { timeout: 590000, skip: NESTED ? 'nested run' : false }, () => {
  const r = spawnSync('npm', ['run', 'check'], { cwd: ROOT, encoding: 'utf8', timeout: 580000 });
  assert.equal(r.status, 0, (r.stdout || '').slice(-2000) + (r.stderr || '').slice(-2000));
});
