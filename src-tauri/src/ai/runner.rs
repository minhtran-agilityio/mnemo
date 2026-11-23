// The interface every AI feature calls: one task in, one structured answer or a typed error out.
//
// Features take `&dyn AiRunner`, so tests pass the fake (`ai::fake`) and the real `claude -p`
// runner (issue #19) can replace `ClaudeRunner` without a feature changing. Only the `ai`
// module may start `claude`.

// The AI features of issue #19 and later call these items; until they land, only tests and the
// mode command use them.
#![allow(dead_code)]

use std::ffi::OsStr;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use super::cancel::CancelToken;
use super::claude;
use super::config::ClaudeConfig;
use super::fake::{FakeResult, FakeRunner};
use super::health::{ClaudeCli, SystemClaude};

/// The environment variable that starts the whole app with the fake runner.
pub const FAKE_AI_ENV: &str = "MNEMO_FAKE_AI";

/// One AI request: what to ask and what shape the answer must have.
#[derive(Clone, PartialEq, Eq)]
pub struct AiTask {
    /// A short name for logs, such as "test_prompt". Never the prompt or any owner content.
    pub name: String,
    /// The text sent to the model.
    pub prompt: String,
    /// The JSON schema the answer must match, as JSON text.
    pub schema: String,
    /// The tools the run may use (the `--allowedTools` list). Empty means none.
    pub tools: Vec<String>,
    /// The model to use for this feature.
    pub model: String,
    /// The effort level for this feature (the `--effort` value), or `None` for the default.
    pub effort: Option<String>,
    /// How long the run may take. The runner kills the process after this.
    pub timeout: Duration,
}

// The prompt can hold the owner's content, so it never goes to a log through Debug.
impl fmt::Debug for AiTask {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AiTask")
            .field("name", &self.name)
            .field("prompt_len", &self.prompt.len())
            .field("schema_len", &self.schema.len())
            .field("tools", &self.tools)
            .field("model", &self.model)
            .field("effort", &self.effort)
            .field("timeout", &self.timeout)
            .finish()
    }
}

/// A finished run that passed the Mnemo-side checks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiOutput {
    /// The `structured_output` of the run, as JSON text. The feature parses and validates it.
    pub structured_output: String,
}

/// Why a run gave no answer. Every variant means "no summary": a feature keeps the empty result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AiError {
    /// The run ended but `structured_output` was missing or did not match the schema.
    SchemaMismatch,
    /// `claude -p` ended with a non-zero exit code (`None` when a signal ended it).
    ExitError { code: Option<i32> },
    /// The run took longer than the Mnemo-side timeout and was killed.
    Timeout,
    /// The usage limit of the plan was reached.
    UsageLimit,
    /// No runner could start: Claude Code is missing, signed out, or not built yet.
    Unavailable,
    /// The run was cancelled (by the owner or the queue) before it gave an answer.
    Cancelled,
}

impl fmt::Display for AiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AiError::SchemaMismatch => write!(f, "the AI answer did not match the schema"),
            AiError::ExitError { code: Some(c) } => write!(f, "the AI run exited with code {c}"),
            AiError::ExitError { code: None } => write!(f, "the AI run was ended by a signal"),
            AiError::Timeout => write!(f, "the AI run timed out"),
            AiError::UsageLimit => write!(f, "the AI usage limit was reached"),
            AiError::Unavailable => write!(f, "AI is not available"),
            AiError::Cancelled => write!(f, "the AI run was cancelled"),
        }
    }
}

impl std::error::Error for AiError {}

/// Runs one AI task. The real runner starts `claude -p`; the fake returns fixed results.
pub trait AiRunner: Send + Sync {
    /// Runs `task` and returns its structured output, or why there is none. When `cancel` is
    /// set, the run stops as soon as it can and gives `AiError::Cancelled`.
    fn run_task(&self, task: &AiTask, cancel: &CancelToken) -> Result<AiOutput, AiError>;

    /// The task as this runner would run it (with the owner's model and effort set). A way to
    /// run a task that skips `run_task`, such as stream mode, must call this first on the app's
    /// runner. Only the run queue holds that runner, so the first such caller (none exists yet)
    /// must add a way to reach it. The default returns the task as built.
    fn configure(&self, task: &AiTask) -> AiTask {
        task.clone()
    }
}

/// The real runner: one `claude -p` process per task.
pub struct ClaudeRunner {
    /// The folder inside Mnemo's data folder that holds one new owner-only folder per run (see
    /// `run_dir`). `None` when the data folder could not be found: then no run starts.
    runs_dir: Option<PathBuf>,
    /// Mnemo's own Claude config files (see `config`). `None` when they could not be made: then
    /// no run starts, so a run never falls back to the owner's personal Claude setup.
    config: Option<ClaudeConfig>,
}

impl ClaudeRunner {
    pub fn new(runs_dir: Option<PathBuf>, config: Option<ClaudeConfig>) -> Self {
        ClaudeRunner { runs_dir, config }
    }
}

/// The folders and config a run needs. Fails closed: no runs folder, no config, or a config
/// file that is gone gives `Unavailable`, and no process starts.
pub(crate) fn prepare<'a>(
    runs_dir: Option<&'a PathBuf>,
    config: Option<&'a ClaudeConfig>,
) -> Result<(&'a Path, &'a ClaudeConfig), AiError> {
    match (runs_dir, config) {
        (Some(runs_dir), Some(config)) if config.is_ready() => Ok((runs_dir, config)),
        _ => Err(AiError::Unavailable),
    }
}

/// Stops a test that reaches the real runner. Tests never call the real Claude.
fn guard_against_test_use() {
    #[cfg(test)]
    panic!("the real AI runner was used in a test");
}

impl AiRunner for ClaudeRunner {
    fn run_task(&self, task: &AiTask, cancel: &CancelToken) -> Result<AiOutput, AiError> {
        guard_against_test_use();
        let (runs_dir, config) = prepare(self.runs_dir.as_ref(), self.config.as_ref())?;
        let Some(program) = SystemClaude::from_env().locate() else {
            return Err(AiError::Unavailable);
        };
        claude::run_claude(&program, task, runs_dir, config, cancel)
    }
}

/// True only when the variable is set to exactly "1".
pub fn fake_requested(value: Option<&OsStr>) -> bool {
    value == Some(OsStr::new("1"))
}

/// The folder, inside Mnemo's data folder, that holds the per-run folders.
pub fn runs_dir(data_dir: &std::path::Path) -> PathBuf {
    data_dir.join("ai-runs")
}

/// The runner the app uses: the fake (one fixed valid answer) or the real one. `runs_dir` is
/// Mnemo's own folder for runs (see `runs_dir`), never `/tmp` and never an owner project folder.
pub fn select_runner(
    fake: bool,
    runs_dir: Option<PathBuf>,
    config: Option<ClaudeConfig>,
) -> Arc<dyn AiRunner> {
    if fake {
        Arc::new(FakeRunner::new(FakeResult::Valid(
            r#"{"answer":"Fake answer: AI is in test mode.","fake":true}"#.to_string(),
        )))
    } else {
        Arc::new(ClaudeRunner::new(runs_dir, config))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::config::test_config;

    fn task() -> AiTask {
        AiTask {
            name: "t".into(),
            prompt: "secret owner text".into(),
            schema: "{}".into(),
            tools: vec![],
            model: "m".into(),
            effort: None,
            timeout: Duration::from_secs(5),
        }
    }

    #[test]
    #[should_panic(expected = "the real AI runner was used in a test")]
    fn the_real_runner_panics_in_a_test() {
        let _ = ClaudeRunner::new(Some(std::env::temp_dir()), None)
            .run_task(&task(), &CancelToken::default());
    }

    #[test]
    fn fake_requested_is_true_only_for_one() {
        let cases: [(Option<&str>, bool); 5] = [
            (None, false),
            (Some("1"), true),
            (Some("0"), false),
            (Some("true"), false),
            (Some(""), false),
        ];
        for (value, want) in cases {
            assert_eq!(fake_requested(value.map(OsStr::new)), want, "{value:?}");
        }
    }

    #[test]
    fn select_runner_gives_the_fake_answer_when_fake() {
        let out = select_runner(true, None, None)
            .run_task(&task(), &CancelToken::default())
            .unwrap();
        assert_eq!(
            out.structured_output,
            r#"{"answer":"Fake answer: AI is in test mode.","fake":true}"#
        );
    }

    #[test]
    fn a_runner_with_no_config_is_unavailable_and_starts_nothing() {
        let runs = PathBuf::from("/runs");
        assert_eq!(prepare(Some(&runs), None).err(), Some(AiError::Unavailable));
    }

    #[test]
    fn a_config_with_a_missing_mcp_file_is_unavailable() {
        let runs = PathBuf::from("/runs");
        let config = test_config();
        std::fs::remove_file(config.mcp_path()).unwrap();
        assert_eq!(
            prepare(Some(&runs), Some(&config)).err(),
            Some(AiError::Unavailable)
        );
        let _ = std::fs::remove_dir_all(config.dir());
    }

    #[test]
    fn a_ready_config_and_a_runs_dir_are_ok_and_no_runs_dir_is_unavailable() {
        let runs = PathBuf::from("/runs");
        let config = test_config();
        let (dir, cfg) = prepare(Some(&runs), Some(&config)).unwrap();
        assert_eq!(dir, Path::new("/runs"));
        assert_eq!(cfg, &config);
        assert_eq!(
            prepare(None, Some(&config)).err(),
            Some(AiError::Unavailable)
        );
        let _ = std::fs::remove_dir_all(config.dir());
    }

    #[test]
    fn debug_of_a_task_hides_the_prompt() {
        let text = format!("{:?}", task());
        assert!(!text.contains("secret owner text"));
    }
}
