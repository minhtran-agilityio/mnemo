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
use std::sync::Arc;

use super::fake::{FakeResult, FakeRunner};

/// The environment variable that starts the whole app with the fake runner.
pub const FAKE_AI_ENV: &str = "MNEMO_FAKE_AI";

/// One AI request: what to ask and what shape the answer must have.
#[derive(Clone, PartialEq, Eq)]
pub struct AiTask {
    /// The text sent to the model.
    pub prompt: String,
    /// The JSON schema the answer must match, as JSON text.
    pub schema: String,
    /// The tools the run may use (the `--allowedTools` list). Empty means none.
    pub tools: Vec<String>,
    /// The model to use for this feature.
    pub model: String,
}

// The prompt can hold the owner's content, so it never goes to a log through Debug.
impl fmt::Debug for AiTask {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AiTask")
            .field("prompt_len", &self.prompt.len())
            .field("schema_len", &self.schema.len())
            .field("tools", &self.tools)
            .field("model", &self.model)
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
        }
    }
}

impl std::error::Error for AiError {}

/// Runs one AI task. The real runner starts `claude -p`; the fake returns fixed results.
pub trait AiRunner: Send + Sync {
    /// Runs `task` and returns its structured output, or why there is none.
    fn run_task(&self, task: &AiTask) -> Result<AiOutput, AiError>;
}

/// The real runner. It is a placeholder until issue #19 builds the `claude -p` process:
/// it spawns nothing and reports `Unavailable`.
pub struct ClaudeRunner;

/// Stops a test that reaches the real runner. Tests never call the real Claude.
fn guard_against_test_use() {
    #[cfg(test)]
    panic!("the real AI runner was used in a test");
}

impl AiRunner for ClaudeRunner {
    fn run_task(&self, _task: &AiTask) -> Result<AiOutput, AiError> {
        guard_against_test_use();
        // Issue #19 replaces this with the `claude -p` process.
        #[allow(unreachable_code)]
        Err(AiError::Unavailable)
    }
}

/// True only when the variable is set to exactly "1".
pub fn fake_requested(value: Option<&OsStr>) -> bool {
    value == Some(OsStr::new("1"))
}

/// The runner the app uses: the fake (one fixed valid answer) or the real one.
pub fn select_runner(fake: bool) -> Arc<dyn AiRunner> {
    if fake {
        Arc::new(FakeRunner::new(FakeResult::Valid(
            r#"{"fake":true}"#.to_string(),
        )))
    } else {
        Arc::new(ClaudeRunner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task() -> AiTask {
        AiTask {
            prompt: "secret owner text".into(),
            schema: "{}".into(),
            tools: vec![],
            model: "m".into(),
        }
    }

    #[test]
    #[should_panic(expected = "the real AI runner was used in a test")]
    fn the_real_runner_panics_in_a_test() {
        let _ = ClaudeRunner.run_task(&task());
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
        let out = select_runner(true).run_task(&task()).unwrap();
        assert_eq!(out.structured_output, r#"{"fake":true}"#);
    }

    #[test]
    fn debug_of_a_task_hides_the_prompt() {
        let text = format!("{:?}", task());
        assert!(!text.contains("secret owner text"));
    }
}
