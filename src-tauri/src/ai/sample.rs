// A sample feature test: the pattern every AI feature follows.
//
// A feature takes `&dyn AiRunner`, builds an `AiTask`, and parses the `structured_output` into a
// typed struct. On any `AiError` it returns the empty result (`None`) and invents nothing.
// A test makes a `FakeRunner`, pushes the result it wants, calls the feature, and checks both
// what the feature returned and what the runner was asked (`requests()`).
// This module is test-only; real features live in their own modules.

use serde::Deserialize;

use super::fake::{FakeResult, FakeRunner};
use super::runner::{AiRunner, AiTask};

#[derive(Deserialize)]
struct TitleAnswer {
    title: String,
}

/// Asks the model for a short title. `None` when the run failed or the answer is unusable.
fn suggest_title(runner: &dyn AiRunner, text: &str) -> Option<String> {
    let task = AiTask {
        prompt: format!("Give a short title for: {text}"),
        schema:
            r#"{"type":"object","properties":{"title":{"type":"string"}},"required":["title"]}"#
                .to_string(),
        tools: vec![],
        model: "haiku".to_string(),
    };
    let output = runner.run_task(&task).ok()?;
    let answer: TitleAnswer = serde_json::from_str(&output.structured_output).ok()?;
    Some(answer.title).filter(|t| !t.trim().is_empty())
}

#[test]
fn a_valid_result_gives_the_title_and_records_the_request() {
    let fake = FakeRunner::new(FakeResult::Timeout);
    fake.push(FakeResult::Valid(r#"{"title":"Rust notes"}"#.into()));
    assert_eq!(
        suggest_title(&fake, "ownership and borrowing"),
        Some("Rust notes".to_string())
    );
    let seen = fake.requests();
    assert_eq!(seen.len(), 1);
    assert!(seen[0].prompt.contains("ownership and borrowing"));
    assert!(seen[0].schema.contains("title"));
    assert_eq!(seen[0].model, "haiku");
    assert!(seen[0].tools.is_empty());
}

#[test]
fn a_schema_mismatch_gives_no_title() {
    let fake = FakeRunner::new(FakeResult::Timeout);
    fake.push(FakeResult::SchemaMismatch);
    assert_eq!(suggest_title(&fake, "anything"), None);
}

#[test]
fn an_answer_that_is_not_json_gives_no_title() {
    let fake = FakeRunner::new(FakeResult::Valid("not json".into()));
    assert_eq!(suggest_title(&fake, "anything"), None);
}
