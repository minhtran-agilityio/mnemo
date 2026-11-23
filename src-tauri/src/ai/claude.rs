// One `claude -p` run: build the command, run it with bounded output and a timeout, and turn
// what it printed into `AiOutput` or a typed `AiError`.
//
// What was seen (spike-02, Claude Code 2.1.327): `--output-format json` with `--json-schema`
// puts the answer in `structured_output` of the `type: "result"` element. On Ubuntu the output
// is one object; on macOS it is an array of events whose last `result` element holds it. Both
// shapes are read here. Anything the spike did not see is marked **Unverified** below.
//
// Honest failure: a run that gives no valid `structured_output` gives an error, never text the
// app made up and never the model's free text. Output can hold account data, so no error value
// and no log line carries any of it.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::Value;

use super::cancel::CancelToken;
use super::config::ClaudeConfig;
use super::health::{ClaudeCli, SystemClaude};
use super::process::{self, Limits, ProcessError};
use super::run_dir::RunDir;
use super::runner::{AiError, AiOutput, AiRunner, AiTask};
use super::usage::{UsageReading, UsageSink};

/// The most output read from one run. A structured answer is small; this is a safety cap.
const MAX_OUTPUT: u64 = 4 * 1024 * 1024;
/// How long to wait for the end of the output after `claude` has exited.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

/// Environment variables that would send a run to a key, token, host or cloud other than the
/// owner's Claude subscription. They are removed from every run's environment.
pub const ROUTING_ENV: [&str; 5] = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
];

/// The two output formats the runner reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputMode {
    /// One answer at the end (`--output-format json`).
    Json,
    /// Events as they happen (`--output-format stream-json --verbose`).
    StreamJson,
}

/// The `claude -p` command for one task. Mnemo's own settings only: no `--bare`, the
/// subscription is used (no API key in the child), and the run starts in `work_dir`.
pub fn build_command(
    program: &Path,
    task: &AiTask,
    work_dir: &Path,
    config: &ClaudeConfig,
    mode: OutputMode,
) -> Command {
    let mut command = Command::new(program);
    // The prompt is not an argument: other local accounts can read a command line (`ps`), and
    // one argument is capped in size. `claude -p` with no prompt argument reads it from stdin,
    // which the runner writes (see `run_claude`). So the command line holds fixed flags only.
    command.arg("-p");
    command.arg("--output-format").arg(match mode {
        OutputMode::Json => "json",
        OutputMode::StreamJson => "stream-json",
    });
    if mode == OutputMode::StreamJson {
        command.arg("--verbose");
    }
    if !task.schema.is_empty() {
        command.arg("--json-schema").arg(&task.schema);
    }
    // No tools means no `--allowedTools`: `dontAsk` then refuses every tool that needs a
    // permission.
    if !task.tools.is_empty() {
        command.arg("--allowedTools").arg(task.tools.join(","));
    }
    command
        .args(["--permission-mode", "dontAsk"])
        .args(["--setting-sources", "project"])
        .arg("--strict-mcp-config")
        .arg("--mcp-config")
        .arg(config.mcp_path())
        .arg("--settings")
        .arg(config.settings_path())
        .arg("--no-session-persistence")
        .arg("--model")
        .arg(&task.model);
    if let Some(effort) = &task.effort {
        command.arg("--effort").arg(effort);
    }
    command
        .current_dir(work_dir)
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    // Runs use the owner's subscription sign-in only: no key, token, other host or other cloud.
    for name in ROUTING_ENV {
        command.env_remove(name);
    }
    command
}

/// How the process ended: only what the parser needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExitInfo {
    pub success: bool,
    /// `None` when a signal ended the process.
    pub code: Option<i32>,
}

impl ExitInfo {
    pub fn of(status: std::process::ExitStatus) -> Self {
        ExitInfo {
            success: status.success(),
            code: status.code(),
        }
    }
}

/// One event of the output. Only the fields Mnemo needs are read; the rest is dropped.
#[derive(Deserialize, Default)]
pub(super) struct Event {
    #[serde(rename = "type", default)]
    pub(super) kind: String,
    #[serde(default)]
    subtype: Option<String>,
    #[serde(default)]
    is_error: Option<bool>,
    #[serde(default)]
    api_error_status: Option<Value>,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    structured_output: Option<Value>,
    /// Kept as raw JSON and read field by field: a field of an unexpected type must not drop
    /// the whole event, or a `rejected` status would be lost with it (see `ai::usage`).
    #[serde(default)]
    rate_limit_info: Option<Value>,
}

impl Event {
    pub(super) fn is_result(&self) -> bool {
        self.kind == "result"
    }

    /// True for a `rate_limit_event` that says the request was refused.
    /// **Unverified:** the spike saw only `status: "allowed"`. `rejected` is the expected
    /// word at the limit; any other status (a warning, for example) is not a refusal.
    pub(super) fn is_rejected_rate_limit(&self) -> bool {
        self.kind == "rate_limit_event"
            && self
                .rate_limit_info
                .as_ref()
                .and_then(|i| i.get("status"))
                .and_then(Value::as_str)
                == Some("rejected")
    }

    /// The usage reading of a `rate_limit_event`, or `None` for any other event and for one
    /// that holds no usage number and no reset time.
    pub(super) fn usage_reading(&self) -> Option<UsageReading> {
        if self.kind != "rate_limit_event" {
            return None;
        }
        self.rate_limit_info
            .as_ref()
            .and_then(UsageReading::from_rate_limit_info)
    }
}

/// Words that mark a usage-limit error in `subtype` or `result`. **Unverified:** the spike did
/// not see a run at the limit; these are matched in memory and never kept or logged.
const LIMIT_MARKERS: [&str; 5] = [
    "usage limit",
    "rate limit",
    "rate_limit",
    "hit your limit",
    "limit reached",
];

fn says_limit(text: &str) -> bool {
    let lower = text.to_lowercase();
    LIMIT_MARKERS.iter().any(|m| lower.contains(m))
}

/// A failed run whose output was not a readable result can still be a usage limit: the limit
/// message may come as plain text on stdout or on stderr. **Unverified:** the spike did not see
/// the at-limit output. Only a failed exit is looked at, and only lines that are not JSON: JSON
/// output holds Claude's own reply, which may mention a limit without being one (the JSON events
/// are judged by `is_limit_error` and `rate_limit_event`). Matched in memory, never kept.
pub(super) fn limit_from_raw(error: AiError, exit: ExitInfo, raw: &[&[u8]]) -> AiError {
    let unread = matches!(error, AiError::ExitError { .. } | AiError::SchemaMismatch);
    if !exit.success && unread && raw.iter().any(|r| plain_lines_say_limit(r)) {
        AiError::UsageLimit
    } else {
        error
    }
}

/// True when a line of `raw` that is not JSON names a limit. Output that is one JSON value as a
/// whole (the macOS event array spans many lines) is skipped too.
fn plain_lines_say_limit(raw: &[u8]) -> bool {
    if serde_json::from_slice::<Value>(raw).is_ok() {
        return false;
    }
    String::from_utf8_lossy(raw)
        .lines()
        .filter(|line| serde_json::from_str::<Value>(line).is_err())
        .any(says_limit)
}

/// An error result at the usage limit. **Unverified** shape: HTTP 429, or a known marker.
fn is_limit_error(result: &Event) -> bool {
    if result.is_error != Some(true) {
        return false;
    }
    result.api_error_status.as_ref().and_then(Value::as_i64) == Some(429)
        || result.subtype.as_deref().is_some_and(says_limit)
        || result
            .result
            .as_ref()
            .and_then(Value::as_str)
            .is_some_and(says_limit)
}

/// What a run that gave no usable result is called: the exit decides.
pub(super) fn failure(exit: ExitInfo) -> AiError {
    if exit.success {
        AiError::SchemaMismatch
    } else {
        AiError::ExitError { code: exit.code }
    }
}

/// Turns the `result` event of a run into the answer or a typed error. `limit_seen` is true
/// when a `rate_limit_event` before it was a refusal. Shared by the json and stream readers.
pub(super) fn finish(
    result: &Event,
    limit_seen: bool,
    schema: &str,
    exit: ExitInfo,
) -> Result<AiOutput, AiError> {
    let failed = result.is_error == Some(true);
    let no_answer = result
        .structured_output
        .as_ref()
        .map_or(true, Value::is_null);
    if is_limit_error(result) || (limit_seen && (failed || no_answer)) {
        return Err(AiError::UsageLimit);
    }
    if failed || !exit.success {
        return Err(AiError::ExitError { code: exit.code });
    }
    // Free text in `result` is never an answer: only `structured_output` counts.
    let Some(answer) = result.structured_output.as_ref().filter(|v| !v.is_null()) else {
        return Err(AiError::SchemaMismatch);
    };
    if !matches_schema(answer, schema) {
        return Err(AiError::SchemaMismatch);
    }
    serde_json::to_string(answer)
        .map(|structured_output| AiOutput { structured_output })
        .map_err(|_| AiError::SchemaMismatch)
}

/// Reads the output of a `--output-format json` run: one result object, or an array of events
/// whose last `type: "result"` element is the result. Runs read their output with
/// `parse_output_with_usage`; this form is for the tests.
#[cfg(test)]
pub fn parse_output(bytes: &[u8], schema: &str, exit: ExitInfo) -> Result<AiOutput, AiError> {
    parse_output_with_usage(bytes, schema, exit, None)
}

/// `parse_output`, and each usage reading of the output's `rate_limit_event` elements goes to
/// `usage`, in order, before the result is judged. A reading never changes the result.
pub fn parse_output_with_usage(
    bytes: &[u8],
    schema: &str,
    exit: ExitInfo,
    usage: Option<&UsageSink>,
) -> Result<AiOutput, AiError> {
    let Ok(value) = serde_json::from_slice::<Value>(bytes) else {
        return Err(failure(exit));
    };
    let events: Vec<Event> = match value {
        Value::Array(items) => items
            .into_iter()
            .filter_map(|v| serde_json::from_value(v).ok())
            .collect(),
        object @ Value::Object(_) => serde_json::from_value(object).ok().into_iter().collect(),
        _ => Vec::new(),
    };
    if let Some(sink) = usage {
        for reading in events.iter().filter_map(Event::usage_reading) {
            sink(reading);
        }
    }
    let Some(result) = events.iter().rev().find(|e| e.is_result()) else {
        return Err(failure(exit));
    };
    let limit_seen = events.iter().any(Event::is_rejected_rate_limit);
    finish(result, limit_seen, schema, exit)
}

/// The smallest schema check Mnemo makes itself: the top-level `type` and the top-level
/// `required` keys. The feature parses and validates the rest. A schema that is not JSON
/// matches nothing, and an empty schema checks nothing.
fn matches_schema(answer: &Value, schema: &str) -> bool {
    if schema.trim().is_empty() {
        return true;
    }
    let Ok(Value::Object(schema)) = serde_json::from_str::<Value>(schema) else {
        return false;
    };
    if let Some(kind) = schema.get("type").and_then(Value::as_str) {
        let ok = match kind {
            "object" => answer.is_object(),
            "array" => answer.is_array(),
            "string" => answer.is_string(),
            "number" => answer.is_number(),
            // JSON Schema counts a number with no fractional part (such as 5.0) as an integer.
            "integer" => {
                answer.is_i64()
                    || answer.is_u64()
                    || answer.as_f64().is_some_and(|f| f.fract() == 0.0)
            }
            "boolean" => answer.is_boolean(),
            "null" => answer.is_null(),
            _ => true,
        };
        if !ok {
            return false;
        }
    }
    if let Some(required) = schema.get("required").and_then(Value::as_array) {
        let Some(object) = answer.as_object() else {
            return false;
        };
        return required
            .iter()
            .filter_map(Value::as_str)
            .all(|key| object.contains_key(key));
    }
    true
}

/// The kind of an error, as one fixed word for logs.
pub fn error_kind(error: &AiError) -> &'static str {
    match error {
        AiError::SchemaMismatch => "schema_mismatch",
        AiError::ExitError { .. } => "exit_error",
        AiError::Timeout => "timeout",
        AiError::UsageLimit => "usage_limit",
        AiError::Unavailable => "unavailable",
        AiError::Cancelled => "cancelled",
    }
}

/// The log line of one run: the task name, the outcome kind and the time. It never holds the
/// prompt, the output or the answer.
pub fn outcome_line(name: &str, result: &Result<AiOutput, AiError>, elapsed: Duration) -> String {
    let kind = match result {
        Ok(_) => "ok",
        Err(e) => error_kind(e),
    };
    format!("ai task {name}: {kind} in {} ms", elapsed.as_millis())
}

pub(super) fn limits_for(task: &AiTask) -> Limits {
    Limits {
        timeout: task.timeout,
        max_output: MAX_OUTPUT,
        drain: DRAIN_TIMEOUT,
    }
}

/// What a process error means for a task. The output is too large to be an answer; a read
/// failure has no exit code to show.
pub(super) fn process_error(error: ProcessError) -> AiError {
    match error {
        ProcessError::Timeout => AiError::Timeout,
        ProcessError::Spawn => AiError::Unavailable,
        ProcessError::TooLarge => AiError::SchemaMismatch,
        ProcessError::Read => AiError::ExitError { code: None },
        ProcessError::Cancelled => AiError::Cancelled,
    }
}

/// Runs one task with `claude` at `program`, in a new owner-only folder inside `runs_dir` (see
/// `run_dir`). This does not check for a test: the guard lives in `ClaudeRunner::run_task`, so
/// unit tests pass a stand-in program here.
/// When `cancel` is set, the process group is killed and the result is `AiError::Cancelled`.
pub fn run_claude(
    program: &Path,
    task: &AiTask,
    runs_dir: &Path,
    config: &ClaudeConfig,
    cancel: &CancelToken,
) -> Result<AiOutput, AiError> {
    run_claude_with_usage(program, task, runs_dir, config, cancel, None)
}

/// `run_claude`, and each usage reading in the output goes to `usage` (see
/// `parse_output_with_usage`).
pub fn run_claude_with_usage(
    program: &Path,
    task: &AiTask,
    runs_dir: &Path,
    config: &ClaudeConfig,
    cancel: &CancelToken,
    usage: Option<&UsageSink>,
) -> Result<AiOutput, AiError> {
    let started = Instant::now();
    let run_dir = RunDir::create(runs_dir).map_err(|_| AiError::Unavailable)?;
    let command = build_command(program, task, run_dir.path(), config, OutputMode::Json);
    let result = process::run_bounded_with(
        command,
        limits_for(task),
        Some(task.prompt.as_bytes()),
        cancel,
        &mut |_| {},
    )
    .map_err(process_error)
    .and_then(|out| {
        let exit = ExitInfo::of(out.status);
        parse_output_with_usage(&out.stdout, &task.schema, exit, usage)
            .map_err(|e| limit_from_raw(e, exit, &[&out.stdout, &out.stderr]))
    });
    log::info!("{}", outcome_line(&task.name, &result, started.elapsed()));
    result
}

/// The real runner with a usage sink: one `claude -p` process per task, like
/// `runner::ClaudeRunner`, and every usage reading of a run goes to the sink (the app's AI
/// control stores it). The app uses this runner when AI is real.
pub struct UsageClaudeRunner {
    /// Mnemo's folder for per-run folders; `None` when the data folder could not be found.
    runs_dir: Option<PathBuf>,
    /// Mnemo's own Claude config files; `None` when they could not be made. Either `None`
    /// starts no run (see `runner::prepare`).
    config: Option<ClaudeConfig>,
    usage: UsageSink,
}

impl UsageClaudeRunner {
    pub fn new(runs_dir: Option<PathBuf>, config: Option<ClaudeConfig>, usage: UsageSink) -> Self {
        UsageClaudeRunner {
            runs_dir,
            config,
            usage,
        }
    }
}

/// Stops a test that reaches the real runner. Tests never call the real Claude.
fn guard_against_test_use() {
    #[cfg(test)]
    panic!("the real AI runner was used in a test");
}

impl AiRunner for UsageClaudeRunner {
    fn run_task(&self, task: &AiTask, cancel: &CancelToken) -> Result<AiOutput, AiError> {
        guard_against_test_use();
        let (runs_dir, config) =
            super::runner::prepare(self.runs_dir.as_ref(), self.config.as_ref())?;
        let Some(program) = SystemClaude::from_env().locate() else {
            return Err(AiError::Unavailable);
        };
        run_claude_with_usage(&program, task, runs_dir, config, cancel, Some(&self.usage))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::config::{ensure_config, test_config};
    use std::ffi::OsStr;
    use std::path::PathBuf;

    /// A runs folder of the test's own: `/tmp` itself is not the owner's, so it is refused.
    fn runs() -> PathBuf {
        std::env::temp_dir().join(format!("mnemo-test-runs-{}", uuid::Uuid::new_v4()))
    }

    const SCHEMA: &str =
        r#"{"type":"object","properties":{"greeting":{"type":"string"}},"required":["greeting"]}"#;
    /// A marker that must never come back out of an error or a log line.
    const SECRET: &str = "SECRET-ACCOUNT-MARKER-4711";

    fn task() -> AiTask {
        AiTask {
            name: "greet".into(),
            prompt: "Say hi".into(),
            schema: SCHEMA.into(),
            tools: vec!["Read".into(), "Grep".into()],
            model: "haiku".into(),
            effort: Some("low".into()),
            timeout: Duration::from_secs(5),
        }
    }

    fn args_of(command: &Command) -> Vec<String> {
        command
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    fn has_pair(args: &[String], flag: &str, value: &str) -> bool {
        args.windows(2).any(|w| w[0] == flag && w[1] == value)
    }

    const OK: ExitInfo = ExitInfo {
        success: true,
        code: Some(0),
    };
    const FAILED: ExitInfo = ExitInfo {
        success: false,
        code: Some(1),
    };

    // The shape seen in spike-02, with a marker in the free text.
    fn result_object() -> String {
        format!(
            r#"{{"type":"result","subtype":"success","is_error":false,"result":"{SECRET}","structured_output":{{"greeting":"Hi!"}}}}"#
        )
    }

    #[test]
    fn the_command_args_hold_each_required_flag_with_the_task_values() {
        let command = build_command(
            Path::new("/x/claude"),
            &task(),
            Path::new("/work"),
            &test_config(),
            OutputMode::Json,
        );
        let args = args_of(&command);
        assert_eq!(args[0], "-p");
        // The prompt goes on stdin, never on the command line (other accounts can read it).
        assert!(!args.iter().any(|a| a.contains("Say hi")));
        assert!(has_pair(&args, "--output-format", "json"));
        assert!(has_pair(&args, "--json-schema", SCHEMA));
        assert!(has_pair(&args, "--allowedTools", "Read,Grep"));
        assert!(has_pair(&args, "--permission-mode", "dontAsk"));
        assert!(has_pair(&args, "--setting-sources", "project"));
        assert!(has_pair(&args, "--model", "haiku"));
        assert!(has_pair(&args, "--effort", "low"));
        assert!(args.contains(&"--strict-mcp-config".to_string()));
        assert!(args.contains(&"--no-session-persistence".to_string()));
        assert!(!args.contains(&"--verbose".to_string()));
    }

    #[test]
    fn the_command_args_never_hold_bare() {
        for mode in [OutputMode::Json, OutputMode::StreamJson] {
            let command = build_command(
                Path::new("/x/claude"),
                &task(),
                Path::new("/w"),
                &test_config(),
                mode,
            );
            assert!(!args_of(&command).iter().any(|a| a == "--bare"));
        }
    }

    #[test]
    fn the_verbose_flag_and_stream_json_come_only_in_stream_mode() {
        let command = build_command(
            Path::new("/x/claude"),
            &task(),
            Path::new("/w"),
            &test_config(),
            OutputMode::StreamJson,
        );
        let args = args_of(&command);
        assert!(has_pair(&args, "--output-format", "stream-json"));
        assert!(args.contains(&"--verbose".to_string()));
    }

    #[test]
    fn a_task_without_tools_or_effort_passes_neither_flag() {
        let mut t = task();
        t.tools.clear();
        t.effort = None;
        let command = build_command(
            Path::new("/x/claude"),
            &t,
            Path::new("/w"),
            &test_config(),
            OutputMode::Json,
        );
        let args = args_of(&command);
        assert!(!args.contains(&"--allowedTools".to_string()));
        assert!(!args.contains(&"--effort".to_string()));
        assert!(has_pair(&args, "--permission-mode", "dontAsk"));
    }

    #[test]
    fn the_api_key_is_removed_from_the_child_environment() {
        // The command is inspected, so the test does not change the process environment.
        let command = build_command(
            Path::new("/x/claude"),
            &task(),
            Path::new("/w"),
            &test_config(),
            OutputMode::Json,
        );
        let key = command
            .get_envs()
            .find(|(name, _)| *name == OsStr::new("ANTHROPIC_API_KEY"));
        assert_eq!(key, Some((OsStr::new("ANTHROPIC_API_KEY"), None)));
        assert_eq!(command.get_current_dir(), Some(Path::new("/w")));
    }

    #[test]
    fn an_array_of_events_gives_the_structured_output_of_the_last_result() {
        let events = format!(
            r#"[{{"type":"system","subtype":"init"}},{{"type":"assistant","message":{{"content":[{{"type":"text","text":"x"}}]}}}},{{"type":"rate_limit_event","rate_limit_info":{{"status":"allowed"}}}},{}]"#,
            result_object()
        );
        let got = parse_output(events.as_bytes(), SCHEMA, OK).unwrap();
        assert_eq!(got.structured_output, r#"{"greeting":"Hi!"}"#);
    }

    #[test]
    fn a_single_result_object_gives_the_structured_output() {
        let got = parse_output(result_object().as_bytes(), SCHEMA, OK).unwrap();
        assert_eq!(got.structured_output, r#"{"greeting":"Hi!"}"#);
    }

    #[test]
    fn a_non_zero_exit_gives_an_exit_error() {
        let got = parse_output(result_object().as_bytes(), SCHEMA, FAILED);
        assert_eq!(got, Err(AiError::ExitError { code: Some(1) }));
        let error = r#"{"type":"result","is_error":true,"subtype":"error_during_execution"}"#;
        let got = parse_output(error.as_bytes(), SCHEMA, OK);
        assert!(matches!(got, Err(AiError::ExitError { .. })));
        // A signal gives no code.
        let signalled = ExitInfo {
            success: false,
            code: None,
        };
        assert_eq!(
            parse_output(b"", SCHEMA, signalled),
            Err(AiError::ExitError { code: None })
        );
    }

    #[test]
    fn a_missing_structured_output_gives_a_schema_mismatch() {
        for text in [
            r#"{"type":"result","is_error":false,"subtype":"success"}"#,
            r#"{"type":"result","is_error":false,"structured_output":null}"#,
            r#"[{"type":"system"}]"#,
        ] {
            assert_eq!(
                parse_output(text.as_bytes(), SCHEMA, OK),
                Err(AiError::SchemaMismatch),
                "{text}"
            );
        }
    }

    #[test]
    fn free_text_without_structured_output_is_an_error_never_the_text() {
        let text = format!(r#"{{"type":"result","is_error":false,"result":"{SECRET}"}}"#);
        let got = parse_output(text.as_bytes(), SCHEMA, OK);
        assert_eq!(got, Err(AiError::SchemaMismatch));
    }

    #[test]
    fn output_that_is_not_json_is_an_error() {
        assert_eq!(
            parse_output(b"Hello, here is a plain answer", SCHEMA, OK),
            Err(AiError::SchemaMismatch)
        );
        assert_eq!(
            parse_output(b"oops", SCHEMA, FAILED),
            Err(AiError::ExitError { code: Some(1) })
        );
        assert_eq!(
            parse_output(&[0xff, 0xfe], SCHEMA, OK),
            Err(AiError::SchemaMismatch)
        );
    }

    #[test]
    fn a_wrong_top_level_type_gives_a_schema_mismatch() {
        for answer in [r#"["Hi"]"#, r#""Hi""#] {
            let text =
                format!(r#"{{"type":"result","is_error":false,"structured_output":{answer}}}"#);
            assert_eq!(
                parse_output(text.as_bytes(), SCHEMA, OK),
                Err(AiError::SchemaMismatch),
                "{answer}"
            );
        }
    }

    #[test]
    fn a_missing_required_key_gives_a_schema_mismatch() {
        let text = r#"{"type":"result","is_error":false,"structured_output":{"other":1}}"#;
        assert_eq!(
            parse_output(text.as_bytes(), SCHEMA, OK),
            Err(AiError::SchemaMismatch)
        );
    }

    #[test]
    fn a_schema_that_is_not_json_matches_nothing() {
        let got = parse_output(result_object().as_bytes(), "{not json", OK);
        assert_eq!(got, Err(AiError::SchemaMismatch));
    }

    #[test]
    fn an_error_with_status_429_gives_a_usage_limit_even_with_a_failing_exit() {
        let text = r#"{"type":"result","is_error":true,"api_error_status":429,"result":"x"}"#;
        assert_eq!(
            parse_output(text.as_bytes(), SCHEMA, FAILED),
            Err(AiError::UsageLimit)
        );
        let text = r#"{"type":"result","is_error":true,"result":"Claude AI usage limit reached"}"#;
        assert_eq!(
            parse_output(text.as_bytes(), SCHEMA, FAILED),
            Err(AiError::UsageLimit)
        );
    }

    #[test]
    fn a_rejected_rate_limit_event_gives_a_usage_limit() {
        let text = r#"[{"type":"rate_limit_event","rate_limit_info":{"status":"rejected"}},{"type":"result","is_error":true,"result":"x"}]"#;
        assert_eq!(
            parse_output(text.as_bytes(), SCHEMA, FAILED),
            Err(AiError::UsageLimit)
        );
    }

    /// A sink that keeps every reading it gets.
    fn collecting_sink() -> (
        UsageSink,
        std::sync::Arc<std::sync::Mutex<Vec<UsageReading>>>,
    ) {
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let kept = seen.clone();
        let sink: UsageSink = std::sync::Arc::new(move |r| kept.lock().unwrap().push(r));
        (sink, seen)
    }

    const WINDOWS_EVENT: &str = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1794999600,"rateLimitType":"five_hour","unifiedWindows":{"five_hour":{"utilization":0.57,"resetsAt":1794999600,"status":"allowed"},"seven_day":{"utilization":0.18,"resetsAt":1795557600,"status":"allowed"}}}}"#;

    #[test]
    fn usage_reading_comes_from_the_json_output_array_and_the_answer_is_unchanged() {
        let text = format!(
            r#"[{{"type":"system","subtype":"init"}},{WINDOWS_EVENT},{}]"#,
            result_object()
        );
        let (sink, seen) = collecting_sink();
        let got = parse_output_with_usage(text.as_bytes(), SCHEMA, OK, Some(&sink)).unwrap();
        assert_eq!(got.structured_output, r#"{"greeting":"Hi!"}"#);
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].five_hour.as_ref().unwrap().percent(), Some(57));
        assert_eq!(seen[0].seven_day.as_ref().unwrap().percent(), Some(18));
        assert_eq!(
            seen[0].seven_day.as_ref().unwrap().resets_at,
            Some(1_795_557_600)
        );
    }

    #[test]
    fn usage_reading_json_output_without_windows_or_as_one_object_gives_no_reading() {
        let (sink, seen) = collecting_sink();
        let allowed_only = format!(
            r#"[{{"type":"rate_limit_event","rate_limit_info":{{"status":"allowed"}}}},{}]"#,
            result_object()
        );
        parse_output_with_usage(allowed_only.as_bytes(), SCHEMA, OK, Some(&sink)).unwrap();
        parse_output_with_usage(result_object().as_bytes(), SCHEMA, OK, Some(&sink)).unwrap();
        let _ = parse_output_with_usage(b"not json", SCHEMA, OK, Some(&sink));
        assert!(seen.lock().unwrap().is_empty());
    }

    #[test]
    fn a_rejected_rate_limit_event_with_broken_windows_is_still_a_usage_limit() {
        let text = r#"[{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":"x","unifiedWindows":{"five_hour":{"utilization":"full","resetsAt":"x"}}}},{"type":"result","is_error":true,"result":"x"}]"#;
        let (sink, seen) = collecting_sink();
        assert_eq!(
            parse_output_with_usage(text.as_bytes(), SCHEMA, FAILED, Some(&sink)),
            Err(AiError::UsageLimit)
        );
        // No usage number and no time in it, so no reading either.
        assert!(seen.lock().unwrap().is_empty());
    }

    #[test]
    fn usage_reading_of_a_stand_in_claude_run_reaches_the_sink() {
        let output = format!("[{WINDOWS_EVENT},{}]", result_object());
        let program = stand_in("usage", &format!("cat <<'EOF'\n{output}\nEOF"));
        let (sink, seen) = collecting_sink();
        let got = run_claude_with_usage(
            &program,
            &task(),
            &runs(),
            &test_config(),
            &CancelToken::default(),
            Some(&sink),
        )
        .unwrap();
        assert_eq!(got.structured_output, r#"{"greeting":"Hi!"}"#);
        assert_eq!(seen.lock().unwrap().len(), 1);
    }

    #[test]
    fn the_usage_claude_runner_panics_in_a_test() {
        let sink: UsageSink = std::sync::Arc::new(|_| {});
        let runner = UsageClaudeRunner::new(Some(std::env::temp_dir()), Some(test_config()), sink);
        let caught = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            runner.run_task(&task(), &CancelToken::default())
        }));
        let payload = caught.expect_err("the real runner must refuse to run in a test");
        let text = payload
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_default();
        assert_eq!(text, "the real AI runner was used in a test");
    }

    #[test]
    fn an_allowed_or_warning_rate_limit_event_is_not_a_usage_limit() {
        for status in ["allowed", "allowed_warning"] {
            let text = format!(
                r#"[{{"type":"rate_limit_event","rate_limit_info":{{"status":"{status}"}}}},{}]"#,
                result_object()
            );
            assert!(
                parse_output(text.as_bytes(), SCHEMA, OK).is_ok(),
                "{status}"
            );
        }
    }

    #[test]
    fn errors_carry_no_output_text_in_display_debug_or_the_log_line() {
        let bodies = [
            format!(r#"{{"type":"result","is_error":true,"result":"{SECRET}"}}"#),
            format!(r#"{{"type":"result","is_error":false,"result":"{SECRET}"}}"#),
            format!(r#"{{"type":"result","is_error":false,"structured_output":{{"{SECRET}":1}}}}"#),
            format!("{SECRET} is not json"),
        ];
        for body in bodies {
            for exit in [OK, FAILED] {
                let got = parse_output(body.as_bytes(), SCHEMA, exit);
                let error = got.clone().unwrap_err();
                assert!(!format!("{error}").contains(SECRET));
                assert!(!format!("{error:?}").contains(SECRET));
                let line = outcome_line("t", &got, Duration::from_millis(7));
                assert!(!line.contains(SECRET));
                assert!(line.starts_with("ai task t: "));
            }
        }
        // The task's Debug hides the prompt; the success line never holds the answer.
        assert!(!format!("{:?}", task()).contains("Say hi"));
        let answer = Ok(AiOutput {
            structured_output: SECRET.into(),
        });
        assert!(!outcome_line("t", &answer, Duration::ZERO).contains(SECRET));
    }

    // A stand-in `claude`: a shell script. Real `claude` is never started in a test.
    fn stand_in(name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!(
            "mnemo-claude-{name}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("claude");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[test]
    fn a_stand_in_claude_that_prints_a_result_gives_the_answer() {
        let program = stand_in("ok", &format!("cat <<'EOF'\n{}\nEOF", result_object()));
        let got = run_claude(
            &program,
            &task(),
            &runs(),
            &test_config(),
            &CancelToken::default(),
        )
        .unwrap();
        assert_eq!(got.structured_output, r#"{"greeting":"Hi!"}"#);
    }

    #[test]
    fn a_stand_in_claude_with_a_failing_exit_gives_an_exit_error() {
        let program = stand_in("fail", &format!("echo '{}'; exit 1", result_object()));
        let got = run_claude(
            &program,
            &task(),
            &runs(),
            &test_config(),
            &CancelToken::default(),
        );
        assert_eq!(got, Err(AiError::ExitError { code: Some(1) }));
    }

    #[test]
    fn a_slow_claude_is_killed_at_the_timeout_and_its_process_is_gone() {
        let marker = std::env::temp_dir().join(format!("mnemo-slow-pid-{}", std::process::id()));
        let _ = std::fs::remove_file(&marker);
        let program = stand_in(
            "slow",
            &format!("echo $$ > '{}'; sleep 30", marker.display()),
        );
        let mut t = task();
        t.timeout = Duration::from_secs(1);
        let started = Instant::now();
        let got = run_claude(
            &program,
            &t,
            &runs(),
            &test_config(),
            &CancelToken::default(),
        );
        assert_eq!(got, Err(AiError::Timeout));
        assert!(started.elapsed() < Duration::from_secs(5));
        let pid = std::fs::read_to_string(&marker).unwrap().trim().to_string();
        let _ = std::fs::remove_file(&marker);
        let alive = || {
            Command::new("kill")
                .args(["-0", &pid])
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        };
        let end = Instant::now() + Duration::from_secs(3);
        while alive() && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(!alive(), "the slow process {pid} is still running");
    }

    #[test]
    fn each_run_starts_in_its_own_folder_inside_the_runs_dir_and_it_is_removed_after() {
        let runs = std::env::temp_dir().join(format!("mnemo-runs-{}", uuid::Uuid::new_v4()));
        let seen = std::env::temp_dir().join(format!("mnemo-cwd-{}", uuid::Uuid::new_v4()));
        let program = stand_in(
            "cwd",
            &format!(
                "pwd > '{}'\ncat <<'EOF'\n{}\nEOF",
                seen.display(),
                result_object()
            ),
        );
        run_claude(
            &program,
            &task(),
            &runs,
            &test_config(),
            &CancelToken::default(),
        )
        .unwrap();
        let cwd = PathBuf::from(std::fs::read_to_string(&seen).unwrap().trim());
        let _ = std::fs::remove_file(&seen);
        let runs_real = std::fs::canonicalize(&runs).unwrap();
        assert!(
            cwd.starts_with(&runs_real),
            "{cwd:?} is not inside {runs_real:?}"
        );
        assert_ne!(cwd, runs_real);
        assert!(!cwd.exists(), "the run folder was not removed");
        let _ = std::fs::remove_dir_all(&runs);
    }

    #[test]
    fn a_runs_dir_that_cannot_be_made_is_unavailable_and_starts_nothing() {
        let file = std::env::temp_dir().join(format!("mnemo-runs-file-{}", uuid::Uuid::new_v4()));
        std::fs::write(&file, "not a folder").unwrap();
        let marker = std::env::temp_dir().join(format!("mnemo-ran-{}", uuid::Uuid::new_v4()));
        let program = stand_in("noruns", &format!("touch '{}'", marker.display()));
        let got = run_claude(
            &program,
            &task(),
            &file,
            &test_config(),
            &CancelToken::default(),
        );
        let ran = marker.exists();
        let _ = std::fs::remove_file(&file);
        let _ = std::fs::remove_file(&marker);
        assert_eq!(got, Err(AiError::Unavailable));
        assert!(!ran, "claude was started without a private folder");
    }

    #[test]
    fn every_routing_variable_is_removed_from_the_child_env() {
        let command = build_command(
            Path::new("/x/claude"),
            &task(),
            Path::new("/w"),
            &test_config(),
            OutputMode::Json,
        );
        for name in ROUTING_ENV {
            let found = command.get_envs().find(|(n, _)| *n == OsStr::new(name));
            assert_eq!(found, Some((OsStr::new(name), None)), "{name} is passed on");
        }
    }

    #[test]
    fn the_prompt_reaches_claude_on_stdin_and_not_on_the_command_line() {
        let seen = std::env::temp_dir().join(format!("mnemo-stdin-{}", uuid::Uuid::new_v4()));
        let program = stand_in(
            "stdin",
            &format!(
                "cat > '{0}.in'\nprintf '%s\\n' \"$@\" > '{0}.args'\ncat <<'EOF'\n{1}\nEOF",
                seen.display(),
                result_object()
            ),
        );
        run_claude(
            &program,
            &task(),
            &runs(),
            &test_config(),
            &CancelToken::default(),
        )
        .unwrap();
        let input = std::fs::read_to_string(format!("{}.in", seen.display())).unwrap();
        let args = std::fs::read_to_string(format!("{}.args", seen.display())).unwrap();
        let _ = std::fs::remove_file(format!("{}.in", seen.display()));
        let _ = std::fs::remove_file(format!("{}.args", seen.display()));
        assert_eq!(input, "Say hi");
        assert!(!args.contains("Say hi"));
    }

    #[test]
    fn a_failed_run_with_a_plain_limit_line_on_stderr_is_the_usage_limit() {
        let program = stand_in(
            "limit-stderr",
            "echo 'Claude AI usage limit reached|1700000000' >&2; exit 1",
        );
        assert_eq!(
            run_claude(
                &program,
                &task(),
                &runs(),
                &test_config(),
                &CancelToken::default()
            ),
            Err(AiError::UsageLimit)
        );
    }

    #[test]
    fn a_failed_run_whose_reply_mentions_a_limit_is_not_the_usage_limit() {
        // macOS shape: one JSON array over many lines, with Claude's reply quoting a limit.
        let events = r#"[
{"type":"assistant","message":{"content":[{"type":"text","text":"The article explains the API rate limit and the usage limit."}]}},
{"type":"result","subtype":"error_during_execution","is_error":true}
]"#;
        let program = stand_in(
            "reply-limit",
            &format!("cat <<'EOF'\n{events}\nEOF\nexit 1"),
        );
        assert_eq!(
            run_claude(
                &program,
                &task(),
                &runs(),
                &test_config(),
                &CancelToken::default()
            ),
            Err(AiError::ExitError { code: Some(1) })
        );
    }

    #[test]
    fn a_lot_of_stderr_does_not_break_the_run() {
        // More than the 64 KiB kept: the rest is still read, so the child never gets EPIPE.
        let program = stand_in(
            "noisy",
            &format!(
                "head -c 300000 /dev/zero | tr '\\0' 'w' >&2 || exit 9\ncat <<'EOF'\n{}\nEOF",
                result_object()
            ),
        );
        let got = run_claude(
            &program,
            &task(),
            &runs(),
            &test_config(),
            &CancelToken::default(),
        )
        .unwrap();
        assert_eq!(got.structured_output, r#"{"greeting":"Hi!"}"#);
    }

    #[test]
    fn a_failed_run_with_a_plain_limit_line_on_stdout_is_the_usage_limit() {
        let program = stand_in(
            "limit-stdout",
            "echo 'Claude AI usage limit reached'; exit 1",
        );
        assert_eq!(
            run_claude(
                &program,
                &task(),
                &runs(),
                &test_config(),
                &CancelToken::default()
            ),
            Err(AiError::UsageLimit)
        );
    }

    #[test]
    fn limit_words_in_a_run_that_did_not_fail_are_not_a_usage_limit() {
        let exit = ExitInfo {
            success: true,
            code: Some(0),
        };
        let got = limit_from_raw(AiError::SchemaMismatch, exit, &[b"you hit your limit"]);
        assert_eq!(got, AiError::SchemaMismatch);
        let failed = ExitInfo {
            success: false,
            code: Some(1),
        };
        let got = limit_from_raw(AiError::Timeout, failed, &[b"usage limit"]);
        assert_eq!(got, AiError::Timeout);
        let got = limit_from_raw(
            AiError::ExitError { code: Some(1) },
            failed,
            &[b"other error"],
        );
        assert_eq!(got, AiError::ExitError { code: Some(1) });
    }

    #[test]
    fn a_whole_number_written_with_a_point_is_an_integer() {
        assert!(matches_schema(
            &serde_json::json!(5.0),
            r#"{"type":"integer"}"#
        ));
        assert!(!matches_schema(
            &serde_json::json!(5.5),
            r#"{"type":"integer"}"#
        ));
    }

    #[test]
    fn a_missing_program_is_unavailable() {
        let got = run_claude(
            Path::new("/nonexistent/claude"),
            &task(),
            &runs(),
            &test_config(),
            &CancelToken::default(),
        );
        assert_eq!(got, Err(AiError::Unavailable));
    }

    #[test]
    fn the_config_args_come_in_json_and_stream_mode_each() {
        let dir = std::env::temp_dir().join(format!("mnemo-args-config-{}", uuid::Uuid::new_v4()));
        let config = ensure_config(&dir).unwrap();
        for mode in [OutputMode::Json, OutputMode::StreamJson] {
            let command = build_command(
                Path::new("/x/claude"),
                &task(),
                Path::new("/w"),
                &config,
                mode,
            );
            let args = args_of(&command);
            let mcp = dir.join("mcp.json").display().to_string();
            let settings = dir.join("settings.json").display().to_string();
            assert!(has_pair(&args, "--mcp-config", &mcp), "{mode:?}");
            assert!(has_pair(&args, "--settings", &settings), "{mode:?}");
            assert!(has_pair(&args, "--setting-sources", "project"), "{mode:?}");
            assert!(
                args.contains(&"--strict-mcp-config".to_string()),
                "{mode:?}"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_run_folder_is_never_the_config_dir_and_the_config_files_stay() {
        let runs = std::env::temp_dir().join(format!("mnemo-runs-{}", uuid::Uuid::new_v4()));
        let seen = std::env::temp_dir().join(format!("mnemo-cwd-{}", uuid::Uuid::new_v4()));
        let config = test_config();
        let program = stand_in(
            "cwdconfig",
            &format!(
                "pwd > '{}'\ncat <<'EOF'\n{}\nEOF",
                seen.display(),
                result_object()
            ),
        );
        run_claude(&program, &task(), &runs, &config, &CancelToken::default()).unwrap();
        let cwd = PathBuf::from(std::fs::read_to_string(&seen).unwrap().trim());
        let _ = std::fs::remove_file(&seen);
        assert!(!cwd.starts_with(std::fs::canonicalize(config.dir()).unwrap()));
        assert!(!cwd.starts_with(std::env::temp_dir().join("mnemo-test-config")));
        assert!(config.is_ready());
        let _ = std::fs::remove_dir_all(&runs);
    }
}
