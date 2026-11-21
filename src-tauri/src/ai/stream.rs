// Stream mode: one `claude -p --output-format stream-json --verbose` run that gives the text
// in pieces as the events arrive, and ends with the final result or a typed error.
//
// The output is one JSON event per line. An `assistant` event holds `message.content[]` pieces
// of type `text`; the last line is the `result` event, read by the same rules as the json mode
// (`claude::finish`). Whether a piece grows letter by letter (`--include-partial-messages`) is
// **Unverified**: this mode hands over each text piece as its event arrives.
//
// No feature uses this yet: Ask Mnemo does later. Tests use fixture lines and a stand-in
// `claude` script; a real run is never started in a test.

use std::path::Path;
use std::time::Instant;

use serde::Deserialize;

use super::claude::{
    self, build_command, failure, limit_from_raw, limits_for, outcome_line, process_error, Event,
    ExitInfo, OutputMode,
};
use super::process;
use super::run_dir::RunDir;
use super::runner::{AiError, AiOutput, AiTask};

#[derive(Deserialize, Default)]
struct AssistantEvent {
    #[serde(default)]
    message: AssistantMessage,
}

#[derive(Deserialize, Default)]
struct AssistantMessage {
    #[serde(default)]
    content: Vec<Piece>,
}

#[derive(Deserialize)]
struct Piece {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    text: Option<String>,
}

/// Reads the stream line by line as chunks arrive. A chunk can end in the middle of a line.
struct StreamReader<'a> {
    pending: Vec<u8>,
    on_text: &'a mut dyn FnMut(&str),
    result: Option<Event>,
    limit_seen: bool,
}

impl<'a> StreamReader<'a> {
    fn new(on_text: &'a mut dyn FnMut(&str)) -> Self {
        StreamReader {
            pending: Vec::new(),
            on_text,
            result: None,
            limit_seen: false,
        }
    }

    /// Takes in a chunk and handles every complete line in it.
    fn push(&mut self, chunk: &[u8]) {
        self.pending.extend_from_slice(chunk);
        while let Some(end) = self.pending.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=end).collect();
            self.line(&line[..end]);
        }
    }

    fn line(&mut self, line: &[u8]) {
        if line.iter().all(u8::is_ascii_whitespace) {
            return;
        }
        // A line that is not an event is skipped. A run without a result line is an error.
        let Ok(event) = serde_json::from_slice::<Event>(line) else {
            return;
        };
        match event.kind.as_str() {
            "assistant" => {
                if let Ok(assistant) = serde_json::from_slice::<AssistantEvent>(line) {
                    for piece in assistant.message.content {
                        if let (true, Some(text)) = (piece.kind == "text", piece.text) {
                            (self.on_text)(&text);
                        }
                    }
                }
            }
            "rate_limit_event" => self.limit_seen |= event.is_rejected_rate_limit(),
            "result" => self.result = Some(event),
            _ => {}
        }
    }

    /// The end of the stream. A half line at the end, or no result line, is an error.
    fn finish(self, schema: &str, exit: ExitInfo) -> Result<AiOutput, AiError> {
        if !self.pending.iter().all(u8::is_ascii_whitespace) {
            return Err(failure(exit));
        }
        match &self.result {
            Some(result) => claude::finish(result, self.limit_seen, schema, exit),
            None => Err(failure(exit)),
        }
    }
}

/// Runs one task in stream mode. `on_text` gets each text piece in order; the return value is
/// the final result, read like a json run. Not used by a feature yet (Ask Mnemo uses it later).
#[allow(dead_code)]
pub fn run_stream(
    program: &Path,
    task: &AiTask,
    runs_dir: &Path,
    on_text: &mut dyn FnMut(&str),
) -> Result<AiOutput, AiError> {
    let started = Instant::now();
    let run_dir = RunDir::create(runs_dir).map_err(|_| AiError::Unavailable)?;
    let command = build_command(program, task, run_dir.path(), OutputMode::StreamJson);
    let mut reader = StreamReader::new(on_text);
    let ran = process::run_bounded_with(
        command,
        limits_for(task),
        Some(task.prompt.as_bytes()),
        &mut |chunk| reader.push(chunk),
    );
    let result = match ran {
        Ok(out) => {
            let exit = ExitInfo::of(out.status);
            reader
                .finish(&task.schema, exit)
                .map_err(|e| limit_from_raw(e, exit, &[&out.stderr]))
        }
        Err(e) => Err(process_error(e)),
    };
    log::info!("{}", outcome_line(&task.name, &result, started.elapsed()));
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::Duration;

    /// A runs folder of the test's own: `/tmp` itself is not the owner's, so it is refused.
    fn runs() -> PathBuf {
        std::env::temp_dir().join(format!("mnemo-test-runs-{}", uuid::Uuid::new_v4()))
    }

    const SCHEMA: &str = r#"{"type":"object","required":["answer"]}"#;
    const OK: ExitInfo = ExitInfo {
        success: true,
        code: Some(0),
    };
    const FAILED: ExitInfo = ExitInfo {
        success: false,
        code: Some(1),
    };
    const STREAM: &str = concat!(
        r#"{"type":"system","subtype":"init"}"#,
        "\n",
        r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}"#,
        "\n",
        r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hel"},{"type":"tool_use","name":"x"},{"type":"text","text":"lo"}]}}"#,
        "\n",
        r#"{"type":"assistant","message":{"content":[{"type":"text","text":" there"}]}}"#,
        "\n",
        r#"{"type":"user","message":{"content":"plain string"}}"#,
        "\n",
        r#"{"type":"result","subtype":"success","is_error":false,"structured_output":{"answer":"Hello there"}}"#,
        "\n",
    );

    /// Feeds `chunks` to a reader and returns the text pieces and the final result.
    fn read(chunks: &[&[u8]], exit: ExitInfo) -> (Vec<String>, Result<AiOutput, AiError>) {
        let mut pieces: Vec<String> = Vec::new();
        let mut on_text = |t: &str| pieces.push(t.to_string());
        let mut reader = StreamReader::new(&mut on_text);
        for chunk in chunks {
            reader.push(chunk);
        }
        let result = reader.finish(SCHEMA, exit);
        (pieces, result)
    }

    #[test]
    fn stream_pieces_come_out_in_order_then_the_result() {
        let (pieces, result) = read(&[STREAM.as_bytes()], OK);
        assert_eq!(pieces, vec!["Hel", "lo", " there"]);
        assert_eq!(
            result.unwrap().structured_output,
            r#"{"answer":"Hello there"}"#
        );
    }

    #[test]
    fn stream_lines_split_across_chunk_borders_are_joined() {
        let bytes = STREAM.as_bytes();
        // One byte at a time is the worst case.
        let chunks: Vec<&[u8]> = bytes.chunks(1).collect();
        let (pieces, result) = read(&chunks, OK);
        assert_eq!(pieces, vec!["Hel", "lo", " there"]);
        assert!(result.is_ok());
    }

    #[test]
    fn a_stream_without_a_result_line_is_a_schema_mismatch() {
        let without: String = STREAM.lines().take(4).map(|l| format!("{l}\n")).collect();
        let (pieces, result) = read(&[without.as_bytes()], OK);
        assert_eq!(pieces.len(), 3);
        assert_eq!(result, Err(AiError::SchemaMismatch));
        // With a failing exit it is an exit error.
        let (_, result) = read(&[without.as_bytes()], FAILED);
        assert_eq!(result, Err(AiError::ExitError { code: Some(1) }));
    }

    #[test]
    fn a_stream_that_ends_in_a_half_line_is_an_error() {
        let cut = format!("{STREAM}{}", r#"{"type":"result","is_err"#);
        let (_, result) = read(&[cut.as_bytes()], OK);
        assert_eq!(result, Err(AiError::SchemaMismatch));
    }

    #[test]
    fn a_stream_result_with_is_error_is_an_exit_error() {
        let text = r#"{"type":"result","is_error":true,"subtype":"error_during_execution"}"#;
        let (_, result) = read(&[format!("{text}\n").as_bytes()], FAILED);
        assert_eq!(result, Err(AiError::ExitError { code: Some(1) }));
    }

    #[test]
    fn a_stream_with_a_rejected_rate_limit_event_is_a_usage_limit() {
        let text = concat!(
            r#"{"type":"rate_limit_event","rate_limit_info":{"status":"rejected"}}"#,
            "\n",
            r#"{"type":"result","is_error":true,"result":"x"}"#,
            "\n"
        );
        let (_, result) = read(&[text.as_bytes()], FAILED);
        assert_eq!(result, Err(AiError::UsageLimit));
    }

    #[test]
    fn a_stream_result_with_a_wrong_schema_shape_is_a_schema_mismatch() {
        let text = r#"{"type":"result","is_error":false,"structured_output":{"other":1}}"#;
        let (_, result) = read(&[format!("{text}\n").as_bytes()], OK);
        assert_eq!(result, Err(AiError::SchemaMismatch));
    }

    fn stand_in(body: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!(
            "mnemo-stream-{}-{:?}",
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

    fn task() -> AiTask {
        AiTask {
            name: "stream_test".into(),
            prompt: "Say hi".into(),
            schema: SCHEMA.into(),
            tools: vec![],
            model: "haiku".into(),
            effort: None,
            timeout: Duration::from_secs(5),
        }
    }

    #[test]
    fn a_stand_in_claude_that_prints_a_stream_works_end_to_end() {
        let program = stand_in(&format!("cat <<'EOF'\n{STREAM}EOF"));
        let mut pieces: Vec<String> = Vec::new();
        let got = run_stream(&program, &task(), &runs(), &mut |t| {
            pieces.push(t.to_string())
        });
        assert_eq!(pieces, vec!["Hel", "lo", " there"]);
        assert_eq!(
            got.unwrap().structured_output,
            r#"{"answer":"Hello there"}"#
        );
    }

    #[test]
    fn a_slow_stand_in_stream_is_killed_at_the_timeout() {
        let program = stand_in("sleep 30");
        let mut t = task();
        t.timeout = Duration::from_secs(1);
        let started = Instant::now();
        let got = run_stream(&program, &t, &runs(), &mut |_| {});
        assert_eq!(got, Err(AiError::Timeout));
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
