// The developer test prompt of Settings > AI: one tiny fixed task that proves the runner works.
// It follows the feature pattern of `sample.rs`: take `&dyn AiRunner`, build an `AiTask`, parse
// `structured_output` into a typed struct, and invent nothing on an error.

use std::time::Duration;

use serde::Deserialize;

use super::runner::{AiError, AiRunner, AiTask};

/// The answer shape of the test prompt.
#[derive(Debug, Deserialize)]
struct TestAnswer {
    answer: String,
}

/// The fixed task: no tools, the small model, and a short timeout.
pub fn task() -> AiTask {
    AiTask {
        name: "test_prompt".to_string(),
        prompt: "Write one short friendly sentence for the owner of a notes app. Put it in the answer field."
            .to_string(),
        schema:
            r#"{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"]}"#
                .to_string(),
        tools: vec![],
        model: "haiku".to_string(),
        effort: None,
        timeout: Duration::from_secs(60),
    }
}

/// Runs the test prompt and gives the answer text. An empty answer is a schema mismatch.
pub fn run(runner: &dyn AiRunner) -> Result<String, AiError> {
    let output = runner.run_task(&task())?;
    let parsed: TestAnswer =
        serde_json::from_str(&output.structured_output).map_err(|_| AiError::SchemaMismatch)?;
    let answer = parsed.answer.trim().to_string();
    if answer.is_empty() {
        return Err(AiError::SchemaMismatch);
    }
    Ok(answer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::fake::{FakeResult, FakeRunner};

    #[test]
    fn test_prompt_gives_the_answer_and_asks_for_no_tools() {
        let fake = FakeRunner::new(FakeResult::Timeout);
        fake.push(FakeResult::Valid(r#"{"answer":" Hello! "}"#.into()));
        assert_eq!(run(&fake), Ok("Hello!".to_string()));
        let seen = fake.requests();
        assert_eq!(seen.len(), 1);
        assert!(seen[0].tools.is_empty());
        assert!(seen[0].schema.contains("answer"));
        assert_eq!(seen[0].name, "test_prompt");
    }

    #[test]
    fn test_prompt_gives_each_error_of_the_runner() {
        let cases = [
            (FakeResult::SchemaMismatch, AiError::SchemaMismatch),
            (
                FakeResult::ExitError(2),
                AiError::ExitError { code: Some(2) },
            ),
            (FakeResult::Timeout, AiError::Timeout),
            (FakeResult::UsageLimit, AiError::UsageLimit),
        ];
        for (result, want) in cases {
            let fake = FakeRunner::new(result);
            assert_eq!(run(&fake), Err(want));
        }
    }

    #[test]
    fn test_prompt_refuses_an_empty_or_misshapen_answer() {
        for text in [r#"{"answer":"  "}"#, r#"{"other":"x"}"#, "not json"] {
            let fake = FakeRunner::new(FakeResult::Valid(text.into()));
            assert_eq!(run(&fake), Err(AiError::SchemaMismatch), "{text}");
        }
    }
}
