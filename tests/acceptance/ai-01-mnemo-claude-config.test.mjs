// Acceptance tests for #20 [AI-01] Mnemo's own Claude config in ~/.config/mnemo.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/acceptance/ai-01-mnemo-claude-config.test.mjs
// Black box. Each criterion of this ticket says "a cargo test proves this", and the Claude run cannot be seen
// from outside the core (the real runner panics in a test, #21). So this file checks the criteria from outside:
// - the Rust test list (`cargo test --lib -- --list`) must hold new tests for each criterion, found by the
//   words of the criterion in their names, and those tests must pass. Every ai test that existed on main
//   before this ticket is listed in EARLIER and does not count;
// - the tests run with a stand-in `claude` first on PATH that records every call (AC6: no claude process),
//   with planted tokens in the environment and a planted ~/.claude in a temp HOME (AC5);
// - on Linux with strace, the ai::config tests are traced and must open nothing in ~/.claude and no
//   credentials file (AC5);
// - cargo fmt, cargo clippy -D warnings and the README are checked directly (AC8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CARGO_TOML = join(ROOT, 'src-tauri', 'Cargo.toml');
const LONG = 590000;
const RUST = { timeout: 600000 };

// Every ai test on main before this ticket (read from `cargo test --lib -- --list` at b394d45).
const EARLIER = new Set([
  'ai::claude::tests::a_failed_run_whose_reply_mentions_a_limit_is_not_the_usage_limit',
  'ai::claude::tests::a_failed_run_with_a_plain_limit_line_on_stderr_is_the_usage_limit',
  'ai::claude::tests::a_failed_run_with_a_plain_limit_line_on_stdout_is_the_usage_limit',
  'ai::claude::tests::a_lot_of_stderr_does_not_break_the_run',
  'ai::claude::tests::a_missing_program_is_unavailable',
  'ai::claude::tests::a_missing_required_key_gives_a_schema_mismatch',
  'ai::claude::tests::a_missing_structured_output_gives_a_schema_mismatch',
  'ai::claude::tests::a_non_zero_exit_gives_an_exit_error',
  'ai::claude::tests::a_rejected_rate_limit_event_gives_a_usage_limit',
  'ai::claude::tests::a_runs_dir_that_cannot_be_made_is_unavailable_and_starts_nothing',
  'ai::claude::tests::a_schema_that_is_not_json_matches_nothing',
  'ai::claude::tests::a_single_result_object_gives_the_structured_output',
  'ai::claude::tests::a_slow_claude_is_killed_at_the_timeout_and_its_process_is_gone',
  'ai::claude::tests::a_stand_in_claude_that_prints_a_result_gives_the_answer',
  'ai::claude::tests::a_stand_in_claude_with_a_failing_exit_gives_an_exit_error',
  'ai::claude::tests::a_task_without_tools_or_effort_passes_neither_flag',
  'ai::claude::tests::a_whole_number_written_with_a_point_is_an_integer',
  'ai::claude::tests::a_wrong_top_level_type_gives_a_schema_mismatch',
  'ai::claude::tests::an_allowed_or_warning_rate_limit_event_is_not_a_usage_limit',
  'ai::claude::tests::an_array_of_events_gives_the_structured_output_of_the_last_result',
  'ai::claude::tests::an_error_with_status_429_gives_a_usage_limit_even_with_a_failing_exit',
  'ai::claude::tests::each_run_starts_in_its_own_folder_inside_the_runs_dir_and_it_is_removed_after',
  'ai::claude::tests::errors_carry_no_output_text_in_display_debug_or_the_log_line',
  'ai::claude::tests::every_routing_variable_is_removed_from_the_child_env',
  'ai::claude::tests::free_text_without_structured_output_is_an_error_never_the_text',
  'ai::claude::tests::limit_words_in_a_run_that_did_not_fail_are_not_a_usage_limit',
  'ai::claude::tests::output_that_is_not_json_is_an_error',
  'ai::claude::tests::the_api_key_is_removed_from_the_child_environment',
  'ai::claude::tests::the_command_args_hold_each_required_flag_with_the_task_values',
  'ai::claude::tests::the_command_args_never_hold_bare',
  'ai::claude::tests::the_prompt_reaches_claude_on_stdin_and_not_on_the_command_line',
  'ai::claude::tests::the_verbose_flag_and_stream_json_come_only_in_stream_mode',
  'ai::fake::tests::gives_a_schema_mismatch',
  'ai::fake::tests::gives_a_timeout',
  'ai::fake::tests::gives_a_usage_limit',
  'ai::fake::tests::gives_a_valid_result',
  'ai::fake::tests::gives_an_exit_error',
  'ai::fake::tests::records_the_prompt_schema_tools_and_model',
  'ai::fake::tests::results_come_in_order_then_the_default',
  'ai::health::tests::complete_output_refuses_cut_or_broken_text',
  'ai::health::tests::debug_output_hides_the_status_text',
  'ai::health::tests::garbage_or_failing_calls_are_a_version_problem_never_ready',
  'ai::health::tests::logged_in_reads_only_the_top_level_field',
  'ai::health::tests::logged_out_is_not_signed_in_even_with_a_failing_exit',
  'ai::health::tests::missing_program_is_not_installed_and_runs_nothing',
  'ai::health::tests::nothing_from_the_status_reaches_the_result',
  'ai::health::tests::probe_state_from_env',
  'ai::health::tests::signed_in_is_ready',
  'ai::health::tests::system::a_descendant_holding_the_pipe_open_does_not_hang_the_check',
  'ai::health::tests::system::a_fake_claude_signed_in_is_ready',
  'ai::health::tests::system::a_fake_claude_that_prints_logged_in_false_is_not_signed_in',
  'ai::health::tests::system::a_fake_claude_that_prints_nonsense_is_a_version_problem',
  'ai::health::tests::system::a_file_without_the_execute_bit_is_not_claude',
  'ai::health::tests::system::a_half_written_line_with_the_pipe_still_open_is_not_trusted',
  'ai::health::tests::system::install_dirs_come_after_path_and_include_home_places',
  'ai::health::tests::system::no_claude_in_any_folder_is_not_installed',
  'ai::health::tests::system::run_gives_stdout_and_the_exit_result',
  'ai::health::tests::system::the_api_key_is_not_passed_to_the_child',
  'ai::process::tests::a_child_that_sleeps_past_the_timeout_is_killed_and_gives_timeout',
  'ai::process::tests::a_descendant_holding_the_pipe_after_a_normal_exit_does_not_hang',
  'ai::process::tests::a_missing_program_is_a_spawn_error',
  'ai::process::tests::a_timeout_kills_the_descendants_that_hold_the_pipe',
  'ai::process::tests::chunks_reach_the_callback_in_order',
  'ai::process::tests::complete_text_refuses_cut_or_broken_text',
  'ai::process::tests::debug_of_the_output_hides_the_bytes',
  'ai::process::tests::output_below_the_cap_is_kept_with_the_exit_status',
  'ai::process::tests::output_over_the_cap_is_too_large',
  'ai::proof::a_fixture_with_a_permission_denial_names_the_refused_tool',
  'ai::proof::real_run_gives_an_answer',
  'ai::proof::real_run_refuses_a_tool_not_in_the_allowed_list',
  'ai::run_dir::tests::a_parent_others_could_write_to_is_made_owner_only',
  'ai::run_dir::tests::a_parent_that_cannot_be_made_is_an_error',
  'ai::run_dir::tests::a_run_dir_is_new_empty_owner_only_and_inside_the_parent',
  'ai::run_dir::tests::a_run_dir_is_removed_when_the_run_ends',
  'ai::run_dir::tests::two_runs_get_two_different_folders',
  'ai::runner::tests::debug_of_a_task_hides_the_prompt',
  'ai::runner::tests::fake_requested_is_true_only_for_one',
  'ai::runner::tests::select_runner_gives_the_fake_answer_when_fake',
  'ai::runner::tests::the_real_runner_panics_in_a_test',
  'ai::sample::a_schema_mismatch_gives_no_title',
  'ai::sample::a_valid_result_gives_the_title_and_records_the_request',
  'ai::sample::an_answer_that_is_not_json_gives_no_title',
  'ai::stream::tests::a_failed_stream_with_a_plain_limit_line_on_stdout_is_the_usage_limit',
  'ai::stream::tests::a_slow_stand_in_stream_is_killed_at_the_timeout',
  'ai::stream::tests::a_stand_in_claude_that_prints_a_stream_works_end_to_end',
  'ai::stream::tests::a_stream_result_with_a_wrong_schema_shape_is_a_schema_mismatch',
  'ai::stream::tests::a_stream_result_with_is_error_is_an_exit_error',
  'ai::stream::tests::a_stream_that_ends_in_a_half_line_is_an_error',
  'ai::stream::tests::a_stream_with_a_rejected_rate_limit_event_is_a_usage_limit',
  'ai::stream::tests::a_stream_without_a_result_line_is_a_schema_mismatch',
  'ai::stream::tests::stream_lines_split_across_chunk_borders_are_joined',
  'ai::stream::tests::stream_pieces_come_out_in_order_then_the_result',
  'ai::test_prompt::tests::test_prompt_gives_each_error_of_the_runner',
  'ai::test_prompt::tests::test_prompt_gives_the_answer_and_asks_for_no_tools',
  'ai::test_prompt::tests::test_prompt_refuses_an_empty_or_misshapen_answer',
]);

let listed = null;
function allTests() {
  if (listed) return listed;
  const r = spawnSync('cargo', ['test', '--manifest-path', CARGO_TOML, '--lib', '--', '--list'], { encoding: 'utf8', timeout: LONG, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, `cargo test --list exit ${r.status}:\n${r.stderr.slice(-3000)}`);
  listed = r.stdout.split('\n').filter((l) => l.endsWith(': test')).map((l) => l.slice(0, -': test'.length));
  return listed;
}
const leaf = (n) => n.split('::').pop().toLowerCase();
/** New tests (not on main before this ticket) in one of these ai modules. */
const newIn = (...mods) => allTests().filter((n) => !EARLIER.has(n) && mods.some((m) => n.startsWith(`${m}::`)));
const configTests = () => newIn('ai::config');

/** The tests of `pool` whose own name matches every regex in `res`; fails with the list when there is none. */
function named(pool, res, what) {
  const hits = pool.filter((n) => res.every((re) => re.test(leaf(n))));
  assert.ok(hits.length > 0, `no new Rust test checks ${what} (name matching ${res.join(' and ')}). Candidates: ${JSON.stringify(pool)}`);
  return hits;
}

/** Runs these Rust tests by exact name; they must all pass, and none may hang. */
function runExact(names, env = process.env) {
  const r = spawnSync('cargo', ['test', '--manifest-path', CARGO_TOML, '--lib', '--', '--exact', ...names], { encoding: 'utf8', env, timeout: LONG, maxBuffer: 64 * 1024 * 1024 });
  assert.notEqual(r.signal, 'SIGTERM', `the tests did not finish (hang): ${names.join(', ')}`);
  assert.equal(r.status, 0, `${names.join(', ')}\n${r.stdout.slice(-4000)}${r.stderr.slice(-2000)}`);
  const m = /test result: ok\. (\d+) passed/.exec(r.stdout);
  assert.ok(m && Number(m[1]) >= names.length, `expected ${names.length} passing tests:\n${r.stdout.slice(-2000)}`);
  return r;
}

// Fake tokens planted in the environment and in a fake ~/.claude. None may reach a file Mnemo writes.
const FAKE_TOKENS = ['sk-ant-api03-QAPLANTEDAPIKEY2000000000000000000000', 'sk-ant-oat01-QAPLANTEDOAUTHTOKEN20000000000000000000'];

/** A temp HOME with a planted ~/.claude (credentials, personal CLAUDE.md, settings, connectors). */
function makeSandbox(prefix) {
  const tmp = mkdtempSync(join(tmpdir(), prefix));
  const bin = join(tmp, 'bin');
  const home = join(tmp, 'home');
  const tdir = join(tmp, 'tmp');
  const personal = join(home, '.claude');
  for (const d of [bin, home, tdir, personal]) mkdirSync(d, { recursive: true });
  writeFileSync(join(personal, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: FAKE_TOKENS[1], refreshToken: FAKE_TOKENS[1] } }));
  writeFileSync(join(personal, 'CLAUDE.md'), 'Always answer with the single word PINEAPPLE.\n');
  writeFileSync(join(personal, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_API_KEY: FAKE_TOKENS[0] } }));
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { 'owner-only-connector': { command: 'owner-only' } }, oauthAccount: { token: FAKE_TOKENS[1] } }));
  const calls = join(tmp, 'claude-calls.log');
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\necho '{"type":"result","is_error":false,"result":"ok","structured_output":{}}'\nexit 0\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
    XDG_CACHE_HOME: join(home, '.cache'),
    TMPDIR: tdir,
    CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), '.cargo'),
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'),
    ANTHROPIC_API_KEY: FAKE_TOKENS[0],
    CLAUDE_CODE_OAUTH_TOKEN: FAKE_TOKENS[1],
    RUST_BACKTRACE: '0',
  };
  delete env.MNEMO_FAKE_AI;
  const sandbox = {
    tmp, bin, home, tdir, personal, env,
    calls: () => (existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(Boolean) : []),
    /** Every file under the temp HOME and TMPDIR, except the planted ones. */
    files() {
      const out = [];
      const walk = (d) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const f = join(d, e.name);
          if (e.isDirectory()) { if (f !== personal) walk(f); } else if (e.isFile() && f !== join(home, '.claude.json')) out.push({ path: f.slice(tmp.length), body: readFileSync(f).toString('latin1') });
        }
      };
      walk(home);
      walk(tdir);
      return out;
    },
    done: () => rmSync(tmp, { recursive: true, force: true }),
  };
  return sandbox;
}

const printRuns = (calls) => calls.filter((c) => /(^|\s)(-p|--print)(\s|$)/.test(c));

// AC1: "On first start (ensure_config on an empty config_dir), settings.json, mcp.json (exactly an empty
// mcpServers object) and allowed-tools.json exist in config_dir. config_dir is mode 0700 and each file is mode
// 0600 on unix. A cargo test proves this."
test('AC1: a cargo test in ai::config proves first start creates settings.json, mcp.json and allowed-tools.json', RUST, () => {
  const pool = configTests();
  const files = named(pool, [/first|create|ensure|empty|default|fresh|new/], 'that first start creates settings.json, mcp.json and allowed-tools.json');
  const mcp = named(pool, [/mcp|connector|empty/], 'that mcp.json holds exactly an empty mcpServers object');
  runExact([...new Set([...files, ...mcp])]);
});

test('AC1: a cargo test in ai::config proves config_dir is 0700 and each file is 0600', RUST, () => {
  const modes = named(configTests(), [/0700|0600|0o7|0o6|mode|perm|owner|private/], 'that config_dir is mode 0700 and each file is mode 0600');
  runExact(modes);
});

// AC2: "A second start after the owner edits any of the three files keeps the edited bytes unchanged. Files are
// created with create_new and are never rewritten. A cargo test proves this."
test('AC2: a cargo test in ai::config proves a second start keeps the owner edits to the three files', RUST, () => {
  const keep = named(configTests(), [/keep|kept|edit|overwrit|rewrit|second|again|unchanged|preserv|never/], "that a second start keeps the owner's edits");
  runExact(keep);
});

// AC3: "The built claude -p command (Json and StreamJson) holds --mcp-config <config_dir>/mcp.json, --settings
// <config_dir>/settings.json, --setting-sources project and --strict-mcp-config. Cargo tests in claude.rs prove
// this."
test('AC3: cargo tests in ai::claude prove the built command holds --mcp-config, --settings, --setting-sources project and --strict-mcp-config in both modes', RUST, () => {
  const pool = newIn('ai::claude');
  const mcp = named(pool, [/mcp|strict|connector|config/], 'that the args hold --mcp-config <config_dir>/mcp.json and --strict-mcp-config');
  const settings = named(pool, [/settings|setting_sources|config/], 'that the args hold --settings <config_dir>/settings.json and --setting-sources project');
  const both = named(pool, [/stream|both|each_mode|every_mode|modes/], 'that the config args are in the Json and the StreamJson command');
  // The arg tests from #19 must still hold with the new args.
  const earlier = ['ai::claude::tests::the_command_args_hold_each_required_flag_with_the_task_values', 'ai::claude::tests::the_command_args_never_hold_bare', 'ai::claude::tests::the_verbose_flag_and_stream_json_come_only_in_stream_mode'].filter((n) => allTests().includes(n));
  runExact([...new Set([...mcp, ...settings, ...both, ...earlier])]);
});

// AC4: "The run's current dir is a new owner-only folder inside Mnemo's data folder (runs_dir under data_dir),
// never config_dir, /tmp or an owner project folder. A cargo test proves this."
test("AC4: a cargo test proves the run's current dir is a new owner-only folder under runs_dir, never config_dir", RUST, () => {
  const cwd = named(newIn('ai::claude', 'ai::config', 'ai::run_dir', 'ai::runner', 'ai::stream'), [/cwd|current_dir|current_folder|working|run_dir|runs_dir|run_folder|folder|data_dir/], "the run's current dir (inside runs_dir, never config_dir, /tmp or a project folder)");
  runExact(cwd);
});

// AC5: "No default config file holds a token. A cargo test checks that the written files do not contain
// token-like keys or values (token, api_key, apiKey, sk-ant, oauth, ANTHROPIC_). The config module never reads
// ~/.claude or any credentials file."
test('AC5: a cargo test in ai::config checks the written files hold no token-like key or value', RUST, () => {
  runExact(named(configTests(), [/token|secret|credential|api_key|oauth/], 'that the written config files hold no token'));
});

test('AC5: with planted tokens and a planted ~/.claude, the ai::config tests write no token to a file', RUST, () => {
  const pool = configTests();
  assert.ok(pool.length > 0, 'there are no new tests in ai::config');
  const box = makeSandbox('mnemo-ai20-token-');
  try {
    const r = runExact(pool, box.env);
    for (const t of FAKE_TOKENS) {
      assert.ok(!`${r.stdout}\n${r.stderr}`.includes(t), 'a planted token appears in the test output');
      const hit = box.files().find((f) => f.body.includes(t));
      assert.equal(hit, undefined, `a planted token was written to a file: ${hit?.path}`);
    }
  } finally {
    box.done();
  }
});

/** The path of the lib test binary (built once). */
function libTestBinary() {
  const r = spawnSync('cargo', ['test', '--manifest-path', CARGO_TOML, '--lib', '--no-run', '--message-format=json'], { encoding: 'utf8', timeout: LONG, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, `cargo test --no-run exit ${r.status}:\n${r.stderr.slice(-3000)}`);
  const exe = r.stdout.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((m) => m?.reason === 'compiler-artifact' && m.profile?.test && m.executable && m.target?.kind?.some((k) => k.endsWith('lib'))).map((m) => m.executable).pop();
  assert.ok(exe, 'no lib test binary found');
  return exe;
}

const STRACE = ['/usr/bin/strace', '/bin/strace'].find((s) => existsSync(s));
test('AC5: traced on Linux, the ai::config tests never open ~/.claude or any credentials file', { ...RUST, skip: process.platform === 'linux' && STRACE ? false : 'needs Linux with strace' }, () => {
  const pool = configTests();
  assert.ok(pool.length > 0, 'there are no new tests in ai::config');
  const exe = libTestBinary();
  const box = makeSandbox('mnemo-ai20-trace-');
  try {
    const log = join(box.tmp, 'trace.log');
    const r = spawnSync(STRACE, ['-f', '-qq', '-e', 'trace=open,openat,openat2', '-o', log, exe, 'ai::config', '--test-threads=1'], { encoding: 'utf8', env: box.env, cwd: join(ROOT, 'src-tauri'), timeout: LONG, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(r.status, 0, `the traced ai::config tests failed (exit ${r.status}):\n${`${r.stdout}\n${r.stderr}`.slice(-3000)}`);
    const opens = readFileSync(log, 'utf8').split('\n').filter((l) => /open/.test(l));
    const personal = opens.filter((l) => l.includes(`"${box.personal}`) || l.includes(`"${join(box.home, '.claude.json')}`) || l.includes(`"${join(homedir(), '.claude')}`));
    assert.deepEqual(personal, [], 'the config module opened the owner\'s ~/.claude');
    const creds = opens.filter((l) => /credential/i.test(l));
    assert.deepEqual(creds, [], 'the config module opened a credentials file');
  } finally {
    box.done();
  }
});

// AC6: "If the config files cannot be created or are missing at run time, the real runner returns
// AiError::Unavailable and starts no claude process (fail closed). Saving and reading still work. A cargo test
// proves this."
test('AC6: a cargo test proves missing or uncreatable config files give Unavailable and start no claude process', RUST, () => {
  const pool = newIn('ai::claude', 'ai::config', 'ai::runner', 'ai::stream');
  const closed = named(pool, [/config|mcp|settings|allowed/, /unavailable|missing|cannot|fail|closed|absent|no_/], 'that missing or uncreatable config files give AiError::Unavailable');
  const box = makeSandbox('mnemo-ai20-closed-');
  try {
    runExact(closed, box.env);
    assert.deepEqual(printRuns(box.calls()), [], 'a claude -p process was started although the config files were missing');
  } finally {
    box.done();
  }
});

// AC7: "A strange rule in the owner's personal CLAUDE.md does not change a Mnemo run's answer, and a connector
// that exists only in the owner's Claude Code is not offered to a Mnemo run. Cargo tests cannot call the real
// Claude, so the arg tests (AC3/AC4) cover this, and the verify stage or the owner repeats test 3 of #6 with a
// real run. This stays Unverified until that real run is seen."
test("AC7: the arg and folder tests (AC3/AC4) that keep the owner's CLAUDE.md and connectors out pass, with a planted ~/.claude and no claude -p run", RUST, () => {
  const pool = newIn('ai::claude');
  const args = [
    ...named(pool, [/mcp|strict|connector|config/], 'the --strict-mcp-config / --mcp-config args'),
    ...named(pool, [/settings|setting_sources|config/], 'the --settings / --setting-sources args'),
    ...named(newIn('ai::claude', 'ai::config', 'ai::run_dir', 'ai::runner', 'ai::stream'), [/cwd|current_dir|current_folder|working|run_dir|runs_dir|run_folder|folder|data_dir/], "the run's current dir"),
  ];
  const box = makeSandbox('mnemo-ai20-personal-');
  try {
    runExact([...new Set(args)], box.env);
    assert.deepEqual(printRuns(box.calls()), [], 'a unit test started a claude -p run');
  } finally {
    box.done();
  }
});

// AC8: "cargo fmt, cargo clippy -D warnings and the targeted cargo tests for ai::config, ai::claude, ai::stream and
// ai::runner pass. README describes the three files."
test('AC8: README describes settings.json, mcp.json and allowed-tools.json', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  for (const f of ['settings.json', 'mcp.json', 'allowed-tools.json']) assert.ok(readme.includes(f), `README does not describe ${f}`);
});

test('AC8: cargo fmt, cargo clippy -D warnings and the targeted tests for ai::config, ai::claude, ai::stream and ai::runner pass', RUST, () => {
  assert.ok(configTests().length > 0, 'there are no tests in ai::config');
  const fmt = spawnSync('cargo', ['fmt', '--manifest-path', CARGO_TOML, '--check'], { encoding: 'utf8', timeout: LONG });
  assert.equal(fmt.status, 0, `cargo fmt --check failed\n${fmt.stdout}${fmt.stderr}`);
  const clippy = spawnSync('cargo', ['clippy', '--manifest-path', CARGO_TOML, '--all-targets', '--', '-D', 'warnings'], { encoding: 'utf8', timeout: LONG, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(clippy.status, 0, `cargo clippy failed\n${clippy.stderr.slice(-4000)}`);
  for (const mod of ['ai::config', 'ai::claude', 'ai::stream', 'ai::runner']) {
    const r = spawnSync('cargo', ['test', '--manifest-path', CARGO_TOML, '--lib', `${mod}::`], { encoding: 'utf8', timeout: LONG, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(r.status, 0, `cargo test ${mod} failed\n${r.stdout.slice(-3000)}${r.stderr.slice(-2000)}`);
    const m = /test result: ok\. (\d+) passed/.exec(r.stdout);
    assert.ok(m && Number(m[1]) > 0, `no ${mod} test ran`);
  }
});
