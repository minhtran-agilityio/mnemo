// Runs one child process with bounded output and a hard timeout. This is the safe reading
// pattern of the start check (`health.rs`), shared with the `claude -p` runner:
//
// - the output is read by a thread and capped at `max_output` bytes;
// - a deadline kills the child, and on unix the whole process group, so a descendant that
//   holds the pipe is gone too;
// - after the child exits, the read waits only `drain` for the end of the stream, so a
//   descendant that keeps the pipe open can never hold the caller.
//
// Errors carry no output text: output may hold account data and never goes into an error.

use std::fmt;
use std::io::{Read, Write};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

/// The OS error "text file busy" (the same number on Linux and macOS).
const ETXTBSY: i32 = 26;
/// How often the loop looks at the child and the clock.
const POLL: Duration = Duration::from_millis(20);

/// The three bounds of one run.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// How long the child may run before it is killed.
    pub timeout: Duration,
    /// The most output bytes read. Output that reaches this size counts as too large.
    pub max_output: u64,
    /// How long to wait for the end of the stream after the child has exited.
    pub drain: Duration,
}

/// What a finished run gave back.
pub struct ProcessOutput {
    /// How the child ended.
    pub status: ExitStatus,
    /// The standard output that was read.
    pub stdout: Vec<u8>,
    /// True when the stream ended. False when a descendant still held the pipe after `drain`.
    pub finished: bool,
    /// The start of the standard error (at most `MAX_STDERR` bytes), read only to spot a
    /// usage-limit message. It is never kept, logged or shown.
    pub stderr: Vec<u8>,
}

/// The most standard error bytes kept from one run.
const MAX_STDERR: u64 = 64 * 1024;

/// Output can hold account data, so `{:?}` never prints it.
impl fmt::Debug for ProcessOutput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ProcessOutput")
            .field("status", &self.status)
            .field(
                "stdout",
                &format_args!("<{} bytes hidden>", self.stdout.len()),
            )
            .field("finished", &self.finished)
            .field(
                "stderr",
                &format_args!("<{} bytes hidden>", self.stderr.len()),
            )
            .finish()
    }
}

/// Why a run gave no output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessError {
    /// The program could not be started.
    Spawn,
    /// The child ran past the timeout and was killed.
    Timeout,
    /// The output reached the size cap; the child was killed.
    TooLarge,
    /// The output or the child state could not be read.
    Read,
}

impl fmt::Display for ProcessError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProcessError::Spawn => write!(f, "the process could not be started"),
            ProcessError::Timeout => write!(f, "the process timed out"),
            ProcessError::TooLarge => write!(f, "the process output was too large"),
            ProcessError::Read => write!(f, "the process output could not be read"),
        }
    }
}

impl std::error::Error for ProcessError {}

/// Starts the command. A program that was written a moment ago can be "text file busy" while
/// another thread's fork still holds its write handle; that clears in milliseconds, so retry.
fn spawn_retrying_busy(command: &mut Command) -> std::io::Result<Child> {
    let mut tries = 0;
    loop {
        match command.spawn() {
            Err(e) if e.raw_os_error() == Some(ETXTBSY) && tries < 20 => {
                tries += 1;
                std::thread::sleep(Duration::from_millis(10));
            }
            other => return other,
        }
    }
}

/// Kills the child and, on unix, every process in its group (the child leads its own group).
/// The group kill uses the `kill` of the shell, so no `unsafe` code is needed.
fn kill_tree(child: &mut Child) {
    #[cfg(unix)]
    let _ = kill_group(child.id());
    let _ = child.kill();
    let _ = child.wait();
}

/// Kills every process in the group. True when at least one process was still in it.
#[cfg(unix)]
fn kill_group(pgid: u32) -> bool {
    Command::new("/bin/sh")
        .args(["-c", "kill -KILL \"-$1\" 2>/dev/null", "sh"])
        .arg(pgid.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// The text of an output, or `Err` when it may be cut short. Output that hit the size cap or
/// is not valid UTF-8 is never trusted. When the stream did not end (a descendant still holds
/// the pipe), the text is kept only if it ends at a line break, so a half-written line never
/// counts as an answer.
pub fn complete_text(bytes: Vec<u8>, finished: bool, max_output: u64) -> Result<String, ()> {
    if bytes.len() as u64 >= max_output {
        return Err(());
    }
    if !finished && bytes.last() != Some(&b'\n') {
        return Err(());
    }
    String::from_utf8(bytes).map_err(|_| ())
}

/// Runs `command` with its output bounded by `limits`. Stdout and stderr are piped by this
/// function; stdin is as the command set it.
pub fn run_bounded(command: Command, limits: Limits) -> Result<ProcessOutput, ProcessError> {
    run_bounded_with(command, limits, None, &mut |_| {})
}

/// Like `run_bounded`. When `input` is given it is written to the child's stdin, which is then
/// closed (so a prompt never shows on the command line). `on_chunk` gets each piece of output
/// as it arrives (stream mode); the pieces are cut at any byte, not at line breaks.
pub fn run_bounded_with(
    mut command: Command,
    limits: Limits,
    input: Option<&[u8]>,
    on_chunk: &mut dyn FnMut(&[u8]),
) -> Result<ProcessOutput, ProcessError> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    if input.is_some() {
        command.stdin(Stdio::piped());
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = spawn_retrying_busy(&mut command).map_err(|_| ProcessError::Spawn)?;
    let Some(stdout) = child.stdout.take() else {
        kill_tree(&mut child);
        return Err(ProcessError::Read);
    };
    if let Some(input) = input {
        let Some(mut stdin) = child.stdin.take() else {
            kill_tree(&mut child);
            return Err(ProcessError::Read);
        };
        // Written on its own thread, so a child that does not read cannot block this one.
        // Dropping the handle at the end closes stdin.
        let input = input.to_vec();
        std::thread::spawn(move || {
            let _ = stdin.write_all(&input);
        });
    }
    // Stderr is read on its own thread with a cap, so a full stderr pipe never stalls the child.
    let (err_sender, err_receiver) = mpsc::channel::<Vec<u8>>();
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let mut kept = Vec::new();
            let mut stderr = stderr;
            let _ = (&mut stderr).take(MAX_STDERR).read_to_end(&mut kept);
            let _ = err_sender.send(kept);
            // Keep reading and drop the rest: a closed pipe would end the child with EPIPE.
            let _ = std::io::copy(&mut stderr, &mut std::io::sink());
        });
    }
    let (sender, receiver) = mpsc::channel::<Vec<u8>>();
    // The reader is not joined: if a descendant keeps the pipe open it ends when that does.
    // It ends the channel when it stops, so the receiver sees whether the stream finished.
    std::thread::spawn(move || {
        let mut stdout = stdout.take(limits.max_output);
        let mut chunk = [0u8; 4096];
        loop {
            match stdout.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if sender.send(chunk[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    let mut bytes: Vec<u8> = Vec::new();
    let mut finished = false;
    // Takes in what the reader has: Ok(true) when a piece came, and marks the end of stream.
    let mut take_in = |wait: Duration, bytes: &mut Vec<u8>, finished: &mut bool| -> bool {
        match receiver.recv_timeout(wait) {
            Ok(piece) => {
                bytes.extend_from_slice(&piece);
                on_chunk(&piece);
                true
            }
            Err(RecvTimeoutError::Timeout) => false,
            Err(RecvTimeoutError::Disconnected) => {
                *finished = true;
                false
            }
        }
    };

    let deadline = Instant::now() + limits.timeout;
    let status = loop {
        if finished {
            std::thread::sleep(POLL);
        } else {
            take_in(POLL, &mut bytes, &mut finished);
        }
        if bytes.len() as u64 >= limits.max_output {
            kill_tree(&mut child);
            return Err(ProcessError::TooLarge);
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => {}
            Ok(None) => {
                kill_tree(&mut child);
                return Err(ProcessError::Timeout);
            }
            Err(_) => {
                kill_tree(&mut child);
                return Err(ProcessError::Read);
            }
        }
    };

    // The child has exited. End anything left in its group now, not after the drain wait: while
    // a member is alive the group number cannot be reused. If no member is left, the number is
    // free and could in theory be reused within this moment; that needs the whole pid space to
    // wrap in microseconds. What members already wrote stays in the pipe and is still read. If something was
    // still running, the output may be cut short, so it does not count as finished.
    #[cfg(unix)]
    let cut_short = kill_group(child.id());
    #[cfg(not(unix))]
    let cut_short = false;

    // Wait a short while for the end of the stream.
    let drain_deadline = Instant::now() + limits.drain;
    while !finished {
        let left = drain_deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        take_in(left.min(POLL), &mut bytes, &mut finished);
    }
    if cut_short {
        finished = false;
    }
    if bytes.len() as u64 >= limits.max_output {
        return Err(ProcessError::TooLarge);
    }
    // Stderr is closed by now unless a process outside the group holds it: wait only briefly.
    let stderr = err_receiver
        .recv_timeout(Duration::from_millis(200))
        .unwrap_or_default();
    Ok(ProcessOutput {
        status,
        stdout: bytes,
        finished,
        stderr,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn sh(script: &str) -> Command {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", script]);
        command
    }

    fn limits(timeout_ms: u64) -> Limits {
        Limits {
            timeout: Duration::from_millis(timeout_ms),
            max_output: 64 * 1024,
            drain: Duration::from_millis(500),
        }
    }

    fn temp_file(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "mnemo-process-{name}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn a_child_that_sleeps_past_the_timeout_is_killed_and_gives_timeout() {
        let started = Instant::now();
        let got = run_bounded(sh("sleep 30"), limits(1000));
        assert_eq!(got.unwrap_err(), ProcessError::Timeout);
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[cfg(unix)]
    #[test]
    fn a_timeout_kills_the_descendants_that_hold_the_pipe() {
        let file = temp_file("grandchild");
        let script = format!("sleep 30 & echo $! > '{}'; sleep 30", file.display());
        let started = Instant::now();
        let got = run_bounded(sh(&script), limits(1000));
        assert_eq!(got.unwrap_err(), ProcessError::Timeout);
        assert!(started.elapsed() < Duration::from_secs(5));
        let pid = std::fs::read_to_string(&file).unwrap().trim().to_string();
        let _ = std::fs::remove_file(&file);
        // The grandchild is gone: `kill -0` fails. A killed process may take a moment to go.
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
        assert!(!alive(), "the grandchild {pid} is still running");
    }

    #[test]
    fn output_over_the_cap_is_too_large() {
        let mut small = limits(5000);
        small.max_output = 1024;
        let got = run_bounded(
            sh("head -c 100000 /dev/zero | tr '\\0' 'a'; sleep 5"),
            small,
        );
        assert_eq!(got.unwrap_err(), ProcessError::TooLarge);
    }

    #[test]
    fn output_below_the_cap_is_kept_with_the_exit_status() {
        let got = run_bounded(sh("echo hi; exit 3"), limits(5000)).unwrap();
        assert_eq!(got.stdout, b"hi\n");
        assert_eq!(got.status.code(), Some(3));
        assert!(got.finished);
    }

    #[test]
    fn a_descendant_holding_the_pipe_after_a_normal_exit_does_not_hang() {
        let started = Instant::now();
        let got = run_bounded(sh("echo hi; sleep 30 &"), limits(5000)).unwrap();
        assert_eq!(got.stdout, b"hi\n");
        assert!(got.status.success());
        assert!(!got.finished);
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn a_missing_program_is_a_spawn_error() {
        let got = run_bounded(Command::new("/nonexistent/program"), limits(1000));
        assert_eq!(got.unwrap_err(), ProcessError::Spawn);
    }

    #[test]
    fn chunks_reach_the_callback_in_order() {
        let mut seen: Vec<u8> = Vec::new();
        let got = run_bounded_with(sh("echo one; echo two"), limits(5000), None, &mut |c| {
            seen.extend_from_slice(c)
        })
        .unwrap();
        assert_eq!(seen, b"one\ntwo\n");
        assert_eq!(got.stdout, seen);
    }

    #[test]
    fn debug_of_the_output_hides_the_bytes() {
        let got = run_bounded(sh("echo secret-account-data"), limits(5000)).unwrap();
        let text = format!("{got:?}");
        assert!(!text.contains("secret-account-data"));
        assert!(text.contains("bytes hidden"));
    }

    #[test]
    fn complete_text_refuses_cut_or_broken_text() {
        assert_eq!(complete_text(b"hi".to_vec(), true, 100), Ok("hi".into()));
        assert_eq!(
            complete_text(b"hi\n".to_vec(), false, 100),
            Ok("hi\n".into())
        );
        assert_eq!(complete_text(b"hi".to_vec(), false, 100), Err(()));
        assert_eq!(complete_text(vec![0xE2, 0x82], true, 100), Err(()));
        assert_eq!(complete_text(vec![b'a'; 100], true, 100), Err(()));
    }
}
