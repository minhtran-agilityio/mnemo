// The fake AI runner for tests and for `MNEMO_FAKE_AI=1`. It returns fixed results set by the
// caller, in order, and records every request. It never starts a process. One result
// (`BlockUntilCancelled`) holds the run open until its cancel token is set, for cancel tests.

// The AI features of issue #19 and later call these items; until they land, only tests and the
// mode command use them.
#![allow(dead_code)]

use std::collections::VecDeque;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use super::cancel::CancelToken;
use super::runner::{AiError, AiOutput, AiRunner, AiTask};

/// How often a blocked fake run looks at its cancel token.
const CANCEL_POLL: Duration = Duration::from_millis(5);

/// One fixed result the fake can give.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FakeResult {
    /// A good run with this `structured_output` JSON text.
    Valid(String),
    /// The answer did not match the schema.
    SchemaMismatch,
    /// The run ended with this exit code.
    ExitError(i32),
    /// The run timed out.
    Timeout,
    /// The usage limit was reached.
    UsageLimit,
    /// The run blocks until its cancel token is set, then gives `AiError::Cancelled`.
    BlockUntilCancelled,
}

impl FakeResult {
    fn to_result(&self, cancel: &CancelToken) -> Result<AiOutput, AiError> {
        match self {
            FakeResult::Valid(text) => Ok(AiOutput {
                structured_output: text.clone(),
            }),
            FakeResult::SchemaMismatch => Err(AiError::SchemaMismatch),
            FakeResult::ExitError(code) => Err(AiError::ExitError { code: Some(*code) }),
            FakeResult::Timeout => Err(AiError::Timeout),
            FakeResult::UsageLimit => Err(AiError::UsageLimit),
            FakeResult::BlockUntilCancelled => {
                while !cancel.is_cancelled() {
                    std::thread::sleep(CANCEL_POLL);
                }
                Err(AiError::Cancelled)
            }
        }
    }
}

#[derive(Default)]
struct Inner {
    queue: VecDeque<FakeResult>,
    requests: Vec<AiTask>,
}

/// A runner that answers from a queue of fixed results and logs the requests it got.
pub struct FakeRunner {
    default: FakeResult,
    inner: Mutex<Inner>,
}

impl FakeRunner {
    /// A fake that gives `default` whenever the queue is empty.
    pub fn new(default: FakeResult) -> Self {
        FakeRunner {
            default,
            inner: Mutex::new(Inner::default()),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Queues one result. Queued results come out in order, before the default.
    pub fn push(&self, result: FakeResult) {
        self.lock().queue.push_back(result);
    }

    /// Every task this runner was asked to run, oldest first.
    pub fn requests(&self) -> Vec<AiTask> {
        self.lock().requests.clone()
    }
}

impl AiRunner for FakeRunner {
    fn run_task(&self, task: &AiTask, cancel: &CancelToken) -> Result<AiOutput, AiError> {
        // The lock is let go before the result is made, so a blocked run never holds it.
        let next = {
            let mut inner = self.lock();
            inner.requests.push(task.clone());
            inner.queue.pop_front()
        };
        next.as_ref().unwrap_or(&self.default).to_result(cancel)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task() -> AiTask {
        AiTask {
            name: "title".into(),
            prompt: "Title this".into(),
            schema: r#"{"type":"object"}"#.into(),
            tools: vec!["WebFetch".into()],
            model: "haiku".into(),
            effort: None,
            timeout: std::time::Duration::from_secs(5),
        }
    }

    fn run(result: FakeResult) -> Result<AiOutput, AiError> {
        let fake = FakeRunner::new(FakeResult::Timeout);
        fake.push(result);
        fake.run_task(&task(), &CancelToken::default())
    }

    #[test]
    fn gives_a_valid_result() {
        let out = run(FakeResult::Valid(r#"{"a":1}"#.into())).unwrap();
        assert_eq!(out.structured_output, r#"{"a":1}"#);
    }

    #[test]
    fn gives_a_schema_mismatch() {
        assert_eq!(
            run(FakeResult::SchemaMismatch),
            Err(AiError::SchemaMismatch)
        );
    }

    #[test]
    fn gives_an_exit_error() {
        assert_eq!(
            run(FakeResult::ExitError(2)),
            Err(AiError::ExitError { code: Some(2) })
        );
    }

    #[test]
    fn gives_a_timeout() {
        assert_eq!(run(FakeResult::Timeout), Err(AiError::Timeout));
    }

    #[test]
    fn gives_a_usage_limit() {
        assert_eq!(run(FakeResult::UsageLimit), Err(AiError::UsageLimit));
    }

    #[test]
    fn results_come_in_order_then_the_default() {
        let fake = FakeRunner::new(FakeResult::UsageLimit);
        fake.push(FakeResult::Timeout);
        fake.push(FakeResult::SchemaMismatch);
        assert_eq!(
            fake.run_task(&task(), &CancelToken::default()),
            Err(AiError::Timeout)
        );
        assert_eq!(
            fake.run_task(&task(), &CancelToken::default()),
            Err(AiError::SchemaMismatch)
        );
        assert_eq!(
            fake.run_task(&task(), &CancelToken::default()),
            Err(AiError::UsageLimit)
        );
        assert_eq!(
            fake.run_task(&task(), &CancelToken::default()),
            Err(AiError::UsageLimit)
        );
    }

    #[test]
    fn records_the_prompt_schema_tools_and_model() {
        let fake = FakeRunner::new(FakeResult::Timeout);
        let _ = fake.run_task(&task(), &CancelToken::default());
        let seen = fake.requests();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].prompt, "Title this");
        assert_eq!(seen[0].schema, r#"{"type":"object"}"#);
        assert_eq!(seen[0].tools, vec!["WebFetch".to_string()]);
        assert_eq!(seen[0].model, "haiku");
    }

    #[test]
    fn fake_blocks_until_cancelled_then_gives_cancelled() {
        let fake = std::sync::Arc::new(FakeRunner::new(FakeResult::BlockUntilCancelled));
        let token = CancelToken::default();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let (runner, run_token) = (fake.clone(), token.clone());
        std::thread::spawn(move || {
            let _ = done_tx.send(runner.run_task(&task(), &run_token));
        });
        // Still blocked while the token is not set.
        assert!(done_rx.recv_timeout(Duration::from_millis(100)).is_err());
        // Another run on the same fake is not held up by the blocked one.
        fake.push(FakeResult::Timeout);
        assert_eq!(
            fake.run_task(&task(), &CancelToken::default()),
            Err(AiError::Timeout)
        );
        token.cancel();
        let got = done_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(got, Err(AiError::Cancelled));
    }
}
