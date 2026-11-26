// scripts/save-eval.sh starts the real eval (36 paid `claude -p` runs) only for no argument or `run`.
// Any other argument prints the usage and starts nothing. A stand-in `claude` first on PATH records any
// call, so this test never reaches the real Claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'save-eval.sh');

function run(args) {
  const tmp = mkdtempSync(join(tmpdir(), 'mnemo-save-eval-script-'));
  try {
    const bin = join(tmp, 'bin');
    mkdirSync(bin);
    const calls = join(tmp, 'calls.log');
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\necho "$*" >> '${calls}'\nexit 1\n`);
    chmodSync(join(bin, 'claude'), 0o755);
    // No cargo on PATH either: any attempt to start the eval fails at once and is seen as a status.
    const r = spawnSync('bash', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: tmp },
    });
    return { ...r, claudeCalled: existsSync(calls) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('an unknown argument prints the usage, exits 2 and starts nothing', () => {
  for (const args of [['comapre', 'a', 'b'], ['-x'], ['run', 'extra'], ['compare', 'a'], ['usage', 'x']]) {
    const r = run(args);
    assert.equal(r.status, 2, `${args.join(' ')}: exit ${r.status}`);
    assert.match(r.stderr, /usage: bash scripts\/save-eval\.sh/);
    assert.equal(r.claudeCalled, false);
  }
});

test('--help prints the usage with exit 0 and starts nothing', () => {
  for (const flag of ['--help', '-h', 'help']) {
    const r = run([flag]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /usage: bash scripts\/save-eval\.sh/);
    assert.equal(r.claudeCalled, false);
  }
});

test('rescore with a missing output folder stops with exit 2 and writes nothing', () => {
  const r = run(['rescore', '/nonexistent-a/in.json', '/nonexistent-b/out.json', 'note']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not found/);
});
