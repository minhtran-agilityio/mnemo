// Acceptance proof for #19: two tiny REAL `claude -p` runs. They are `#[ignore]`, so `npm test`
// and `npm run check` never run them. `scripts/ai-runner-proof.sh` runs them on purpose, with
// `MNEMO_REAL_AI_PROOF=1`; each run uses a little Claude usage. A test returns at once without
// that variable (or `MNEMO_REAL_CLAUDE=1`), so a plain `--ignored` run starts nothing.
//
// These call `claude::run_claude` and never `ClaudeRunner::run_task`, so the guard that stops a
// test from using the real runner stays as it is. Only the answer text and the names of refused
// tools are printed: never raw output, an account detail or a token.

use std::path::PathBuf;
use std::time::Duration;

use serde_json::Value;

use super::claude::{build_command, run_claude, OutputMode};
use super::health::{ClaudeCli, SystemClaude};
use super::process::{self, Limits};
use super::run_dir::RunDir;
use super::runner::AiTask;
use super::test_prompt;

fn proof_enabled() -> bool {
    ["MNEMO_REAL_AI_PROOF", "MNEMO_REAL_CLAUDE"]
        .iter()
        .any(|name| std::env::var(name).is_ok_and(|v| v == "1"))
}

/// Like the app, real runs start inside an owner-only folder under the home folder, never
/// under `/tmp` (see `run_dir`).
fn proof_runs_dir() -> PathBuf {
    let home = std::env::var_os("HOME").expect("HOME is not set, so the proof cannot run");
    PathBuf::from(home)
        .join(".cache")
        .join("mnemo-proof")
        .join("ai-runs")
}

fn real_claude() -> PathBuf {
    SystemClaude::from_env()
        .locate()
        .expect("claude is not installed, so the proof cannot run")
}

/// A task that may use only `Read` and asks for a tool that is not in that list.
fn disallowed_tool_task() -> AiTask {
    let mut task = test_prompt::task();
    task.name = "proof_tool_refused".to_string();
    // `echo` is a read-only command that Claude Code allows without a permission, so the
    // command here writes a file: it needs a permission, and `dontAsk` must refuse it.
    task.prompt = "Use the Bash tool to run the command `touch mnemo-proof-file`. If you \
                   cannot, say so in one short sentence."
        .to_string();
    task.tools = vec!["Read".to_string()];
    task.timeout = Duration::from_secs(120);
    task
}

/// The names in `permission_denials` of the raw result (an object or an array of events).
fn refused_tools(raw: &[u8]) -> Vec<String> {
    let Ok(value) = serde_json::from_slice::<Value>(raw) else {
        return Vec::new();
    };
    let result = match &value {
        Value::Array(events) => events
            .iter()
            .rev()
            .find(|e| e["type"] == "result")
            .cloned()
            .unwrap_or(Value::Null),
        other => other.clone(),
    };
    result["permission_denials"]
        .as_array()
        .map(|denials| {
            denials
                .iter()
                .filter_map(|d| d["tool_name"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn a_fixture_with_a_permission_denial_names_the_refused_tool() {
    let object = br#"{"type":"result","permission_denials":[{"tool_name":"Bash","tool_input":{"command":"x"}}]}"#;
    assert_eq!(refused_tools(object), vec!["Bash".to_string()]);
    let array = br#"[{"type":"system"},{"type":"result","permission_denials":[]}]"#;
    assert!(refused_tools(array).is_empty());
    assert!(refused_tools(b"not json").is_empty());
}

#[test]
#[ignore = "starts a real claude -p run; run it with scripts/ai-runner-proof.sh"]
fn real_run_gives_an_answer() {
    if !proof_enabled() {
        return;
    }
    let out = run_claude(&real_claude(), &test_prompt::task(), &proof_runs_dir())
        .expect("the real test prompt gave no answer");
    let answer: Value = serde_json::from_str(&out.structured_output).unwrap();
    let text = answer["answer"].as_str().unwrap_or_default();
    assert!(!text.trim().is_empty());
    println!("answer: {}", text.trim());
}

#[test]
#[ignore = "starts a real claude -p run; run it with scripts/ai-runner-proof.sh"]
fn real_run_refuses_a_tool_not_in_the_allowed_list() {
    if !proof_enabled() {
        return;
    }
    let task = disallowed_tool_task();
    // A folder of its own, so a wrongly allowed command could touch nothing else.
    let run_dir = RunDir::create(&proof_runs_dir()).unwrap();
    let dir = run_dir.path().to_path_buf();
    let command = build_command(&real_claude(), &task, &dir, OutputMode::Json);
    let limits = Limits {
        timeout: task.timeout,
        max_output: 4 * 1024 * 1024,
        drain: Duration::from_secs(2),
    };
    let out = process::run_bounded_with(command, limits, Some(task.prompt.as_bytes()), &mut |_| {})
        .expect("the real run did not finish");
    let refused = refused_tools(&out.stdout);
    let written = dir.join("mnemo-proof-file").exists();
    drop(run_dir);
    assert!(!written, "the refused command still ran");
    println!("refused tools: {}", refused.join(", "));
    assert!(refused.iter().any(|t| t == "Bash"), "Bash was not refused");
}
