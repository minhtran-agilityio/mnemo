// The start check for Claude Code: is `claude` installed, does it run, is it signed in.
//
// It runs two cheap commands, `claude --version` and `claude auth status --json`. Neither
// starts a model run. Mnemo reads ONE field of the status JSON, the boolean `loggedIn`, and
// drops the rest at once: no email, organisation, config path or token is kept, logged,
// stored or put in an error. Mnemo never reads Claude's token file and never opens a sign-in.
//
// What was seen (Claude Code 2.1.329, Ubuntu): signed in prints JSON with `loggedIn: true`
// and exits 0; signed out (an empty config folder) prints the same JSON shape with
// `loggedIn: false` and exits 1. Other versions and the macOS output are **Unverified**.
// Because of that, a non-zero exit with usable JSON still counts by `loggedIn`, and anything
// that is not parseable is a Version problem, never Ready.

use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

/// How long one check command may run before it is killed.
const CHECK_TIMEOUT: Duration = Duration::from_secs(10);
/// The most output read from a check command. The status JSON is a few hundred bytes.
const MAX_OUTPUT: u64 = 64 * 1024;
/// How long to wait for the output to end after the command has exited or been killed. A
/// descendant that keeps the pipe open must not hold the check forever.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

/// The four things the start check can find. The UI shows one of them in Settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiState {
    Ready,
    NotInstalled,
    NotSignedIn,
    VersionProblem,
}

/// The check result sent to the UI: the state and a fixed plain message. It never holds
/// output from Claude Code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AiHealth {
    pub state: AiState,
    pub message: &'static str,
}

impl AiHealth {
    pub fn of(state: AiState) -> Self {
        let message = match state {
            AiState::Ready => "Claude Code is installed and signed in. AI features can run.",
            AiState::NotInstalled => {
                "Claude Code is not installed. Install it from claude.com/claude-code, then choose Check again."
            }
            AiState::NotSignedIn => {
                "Claude Code is not signed in. Open a terminal, run `claude`, sign in, then choose Check again."
            }
            AiState::VersionProblem => {
                "Mnemo could not read the answer from this version of Claude Code. Update Claude Code, then choose Check again."
            }
        };
        AiHealth { state, message }
    }
}

/// What a check command gave back: whether it exited 0, and its standard output.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliOutput {
    pub success: bool,
    pub stdout: String,
}

/// The `claude` program, behind a trait so tests use a fake.
pub trait ClaudeCli {
    /// Where the `claude` program is, or `None` when it is not installed.
    fn locate(&self) -> Option<PathBuf>;
    /// Runs `program` with `args`. `Err` means it could not start or did not finish in time.
    fn run(&self, program: &Path, args: &[&str]) -> Result<CliOutput, ()>;
}

/// The OS error "text file busy" (the same number on Linux and macOS).
const ETXTBSY: i32 = 26;

/// Starts `program`. A program that was written a moment ago can be "text file busy" while
/// another thread's fork still holds its write handle; that clears in milliseconds, so retry.
/// The command for one check run. The subscription is used, so an API key in the environment
/// must not change the answer.
fn check_command(program: &Path, args: &[&str]) -> Command {
    let mut command = Command::new(program);
    command
        .args(args)
        .env_remove("ANTHROPIC_API_KEY")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    command
}

fn spawn_retrying_busy(program: &Path, args: &[&str]) -> Result<std::process::Child, ()> {
    let mut tries = 0;
    loop {
        let spawned = check_command(program, args).spawn();
        match spawned {
            Ok(child) => return Ok(child),
            Err(e) if e.raw_os_error() == Some(ETXTBSY) && tries < 20 => {
                tries += 1;
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(_) => return Err(()),
        }
    }
}

/// Runs the start check and maps it to one of the four states.
pub fn check(cli: &dyn ClaudeCli) -> AiHealth {
    AiHealth::of(check_state(cli))
}

/// The start check against the real `claude` on this computer.
pub fn check_system() -> AiHealth {
    check(&SystemClaude::from_env())
}

fn check_state(cli: &dyn ClaudeCli) -> AiState {
    let Some(program) = cli.locate() else {
        return AiState::NotInstalled;
    };
    match cli.run(&program, &["--version"]) {
        Ok(out) if out.success && !out.stdout.trim().is_empty() => {}
        _ => return AiState::VersionProblem,
    }
    let Ok(status) = cli.run(&program, &["auth", "status", "--json"]) else {
        return AiState::VersionProblem;
    };
    match (logged_in(&status.stdout), status.success) {
        (Some(true), true) => AiState::Ready,
        // Signed out exits non-zero on 2.1.329, so `loggedIn: false` counts on any exit code.
        (Some(false), _) => AiState::NotSignedIn,
        // `loggedIn: true` with a failing exit, or no readable `loggedIn`: do not trust it.
        _ => AiState::VersionProblem,
    }
}

/// The top-level boolean `loggedIn` of a JSON object, or `None` when the text is not a JSON
/// object, the field is missing or it is not a boolean. Every other field is skipped
/// without being kept.
pub fn logged_in(text: &str) -> Option<bool> {
    let mut p = Scanner {
        bytes: text.as_bytes(),
        pos: 0,
    };
    p.skip_ws();
    p.expect(b'{')?;
    let mut found = None;
    p.skip_ws();
    if p.peek()? == b'}' {
        return None;
    }
    loop {
        p.skip_ws();
        let key_start = p.pos;
        p.skip_string()?;
        let is_key = &p.bytes[key_start..p.pos] == b"\"loggedIn\"";
        p.skip_ws();
        p.expect(b':')?;
        p.skip_ws();
        if is_key {
            found = match p.literal()? {
                b"true" => Some(true),
                b"false" => Some(false),
                _ => return None,
            };
        } else {
            p.skip_value()?;
        }
        p.skip_ws();
        match p.next()? {
            b',' => continue,
            b'}' => break,
            _ => return None,
        }
    }
    p.skip_ws();
    if p.pos == p.bytes.len() {
        found
    } else {
        None
    }
}

struct Scanner<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl Scanner<'_> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }
    fn next(&mut self) -> Option<u8> {
        let b = self.peek()?;
        self.pos += 1;
        Some(b)
    }
    fn expect(&mut self, want: u8) -> Option<()> {
        (self.next()? == want).then_some(())
    }
    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.pos += 1;
        }
    }
    fn skip_string(&mut self) -> Option<()> {
        self.expect(b'"')?;
        loop {
            match self.next()? {
                b'"' => return Some(()),
                b'\\' => {
                    self.next()?;
                }
                _ => {}
            }
        }
    }
    /// A bare word such as `true`, `false`, `null` or a number.
    fn literal(&mut self) -> Option<&[u8]> {
        let start = self.pos;
        while matches!(self.peek(), Some(b) if b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'+'))
        {
            self.pos += 1;
        }
        (self.pos > start).then(|| &self.bytes[start..self.pos])
    }
    fn skip_value(&mut self) -> Option<()> {
        match self.peek()? {
            b'"' => self.skip_string(),
            b'{' | b'[' => {
                let mut depth = 0usize;
                loop {
                    match self.peek()? {
                        b'"' => self.skip_string()?,
                        b'{' | b'[' => {
                            depth += 1;
                            self.pos += 1;
                        }
                        b'}' | b']' => {
                            depth -= 1;
                            self.pos += 1;
                            if depth == 0 {
                                return Some(());
                            }
                        }
                        _ => self.pos += 1,
                    }
                }
            }
            _ => self.literal().map(|_| ()),
        }
    }
}

/// The real `claude` program: found on PATH and in the usual install folders, run as a child
/// process with a timeout.
pub struct SystemClaude {
    dirs: Vec<PathBuf>,
}

impl SystemClaude {
    /// Looks in these folders, in order.
    pub fn new(dirs: Vec<PathBuf>) -> Self {
        SystemClaude { dirs }
    }

    /// The folders on PATH, then the usual install places on macOS and Linux. A Dock or
    /// launcher start has a short PATH, so the install places matter.
    pub fn from_env() -> Self {
        let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default();
        dirs.extend(install_dirs(std::env::var_os("HOME")));
        SystemClaude::new(dirs)
    }
}

/// The usual places Claude Code installs to. **Unverified** for each on macOS.
fn install_dirs(home: Option<OsString>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = home {
        let home = PathBuf::from(home);
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".claude/local"));
        dirs.push(home.join(".npm-global/bin"));
    }
    dirs.push(PathBuf::from("/usr/local/bin"));
    dirs.push(PathBuf::from("/opt/homebrew/bin"));
    dirs.push(PathBuf::from("/usr/bin"));
    dirs
}

fn is_executable(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

impl ClaudeCli for SystemClaude {
    fn locate(&self) -> Option<PathBuf> {
        self.dirs
            .iter()
            .filter(|d| d.is_absolute())
            .map(|d| d.join("claude"))
            .find(|p| is_executable(p))
    }

    fn run(&self, program: &Path, args: &[&str]) -> Result<CliOutput, ()> {
        let mut child = spawn_retrying_busy(program, args)?;
        let stdout = child.stdout.take().ok_or(())?;
        let (sender, receiver) = std::sync::mpsc::channel();
        let buffer = std::sync::Arc::new(std::sync::Mutex::new(Vec::<u8>::new()));
        let shared = std::sync::Arc::clone(&buffer);
        // The reader is not joined: if a descendant keeps the pipe open it ends when that does.
        // It writes into a shared buffer, so what it read is kept even if it never finishes.
        std::thread::spawn(move || {
            let mut stdout = stdout.take(MAX_OUTPUT);
            let mut chunk = [0u8; 4096];
            loop {
                match stdout.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if let Ok(mut bytes) = shared.lock() {
                            bytes.extend_from_slice(&chunk[..n]);
                        }
                    }
                }
            }
            let _ = sender.send(());
        });
        let deadline = Instant::now() + CHECK_TIMEOUT;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20));
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(());
                }
            }
        };
        // Wait a short while for the end of the stream; on a timeout keep what was read.
        let _ = receiver.recv_timeout(DRAIN_TIMEOUT);
        let bytes = buffer.lock().map(|b| b.clone()).unwrap_or_default();
        // Bytes that are not text read as empty text, which then reads as a problem.
        let stdout = String::from_utf8(bytes).unwrap_or_default();
        Ok(CliOutput {
            success: status.success(),
            stdout,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// A fake `claude`: fixed answers, and a record of what was run.
    struct Fake {
        program: Option<PathBuf>,
        version: Result<CliOutput, ()>,
        status: Result<CliOutput, ()>,
        calls: RefCell<Vec<Vec<String>>>,
    }

    fn out(success: bool, stdout: &str) -> Result<CliOutput, ()> {
        Ok(CliOutput {
            success,
            stdout: stdout.to_string(),
        })
    }

    fn fake(status: Result<CliOutput, ()>) -> Fake {
        Fake {
            program: Some(PathBuf::from("/x/claude")),
            version: out(true, "2.1.329 (Claude Code)\n"),
            status,
            calls: RefCell::new(Vec::new()),
        }
    }

    impl ClaudeCli for Fake {
        fn locate(&self) -> Option<PathBuf> {
            self.program.clone()
        }
        fn run(&self, _program: &Path, args: &[&str]) -> Result<CliOutput, ()> {
            self.calls
                .borrow_mut()
                .push(args.iter().map(|a| a.to_string()).collect());
            if args == ["--version"] {
                self.version.clone()
            } else {
                self.status.clone()
            }
        }
    }

    #[test]
    fn signed_in_is_ready() {
        let cli = fake(out(true, r#"{"loggedIn": true}"#));
        assert_eq!(check(&cli).state, AiState::Ready);
        // Only the two cheap commands run, never `claude -p`.
        assert_eq!(
            *cli.calls.borrow(),
            vec![vec!["--version"], vec!["auth", "status", "--json"]]
        );
    }

    #[test]
    fn missing_program_is_not_installed_and_runs_nothing() {
        let mut cli = fake(out(true, r#"{"loggedIn": true}"#));
        cli.program = None;
        let health = check(&cli);
        assert_eq!(health.state, AiState::NotInstalled);
        assert!(health.message.contains("install"));
        assert!(cli.calls.borrow().is_empty());
    }

    #[test]
    fn logged_out_is_not_signed_in_even_with_a_failing_exit() {
        for success in [true, false] {
            let cli = fake(out(success, r#"{"loggedIn": false, "authMethod": "none"}"#));
            let health = check(&cli);
            assert_eq!(health.state, AiState::NotSignedIn);
            assert!(health.message.contains("run `claude`"));
        }
    }

    #[test]
    fn garbage_or_failing_calls_are_a_version_problem_never_ready() {
        let cases = [
            fake(out(true, "not json at all")),
            fake(out(true, "")),
            fake(out(true, r#"{"signedIn": true}"#)),
            fake(out(true, r#"{"loggedIn": "yes"}"#)),
            fake(out(false, "error: unknown command")),
            // `true` with a failing exit is not trusted.
            fake(out(false, r#"{"loggedIn": true}"#)),
            fake(Err(())),
        ];
        for cli in cases {
            assert_eq!(check(&cli).state, AiState::VersionProblem);
        }
        let mut bad_version = fake(out(true, r#"{"loggedIn": true}"#));
        bad_version.version = out(false, "");
        assert_eq!(check(&bad_version).state, AiState::VersionProblem);
        bad_version.version = Err(());
        assert_eq!(check(&bad_version).state, AiState::VersionProblem);
        bad_version.version = out(true, "   \n");
        assert_eq!(check(&bad_version).state, AiState::VersionProblem);
    }

    #[test]
    fn nothing_from_the_status_reaches_the_result() {
        let json = r#"{"loggedIn": true, "email": "owner@example.com", "orgId": "org-123",
            "orgName": "Secret Org", "configDirectory": "/home/owner/.claude",
            "token": "sk-ant-secret"}"#;
        for success in [true, false] {
            let health = check(&fake(out(success, json)));
            let shown = format!("{health:?}");
            for secret in [
                "owner@example.com",
                "org-123",
                "Secret Org",
                "sk-ant",
                "/home/owner",
            ] {
                assert!(!shown.contains(secret), "{secret} leaked into {shown}");
            }
        }
        // A garbage answer is not echoed either.
        let health = check(&fake(out(true, "owner@example.com sk-ant-secret")));
        assert!(!format!("{health:?}").contains("owner@example.com"));
    }

    #[test]
    fn logged_in_reads_only_the_top_level_field() {
        assert_eq!(logged_in(r#"{"loggedIn":true}"#), Some(true));
        assert_eq!(logged_in(" {\n \"loggedIn\" : false \n} \n"), Some(false));
        // A nested or string-embedded `loggedIn` does not count.
        assert_eq!(logged_in(r#"{"a": {"loggedIn": true}}"#), None);
        assert_eq!(
            logged_in(r#"{"email": "x\"loggedIn\": true", "loggedIn": false}"#),
            Some(false)
        );
        assert_eq!(
            logged_in(r#"{"o": {"x": [1, {"y": "}"}]}, "n": null, "loggedIn": true, "k": 1.5e3}"#),
            Some(true)
        );
        for bad in [
            "",
            "{",
            "{}",
            "[]",
            "true",
            r#"{"loggedIn": null}"#,
            r#"{"loggedIn": 1}"#,
            r#"{"loggedIn": true"#,
            r#"{"loggedIn": true} x"#,
            r#"{"loggedIn" true}"#,
            r#"{"a": [1, 2, "loggedIn": true}"#,
        ] {
            assert_eq!(logged_in(bad), None, "{bad:?}");
        }
    }

    /// Not a check by itself: prints the real start check for the environment it runs in, so
    /// tests/ai-health.test.mjs can run it with a controlled PATH, HOME and fake `claude`.
    /// Run with `-- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn probe_state_from_env() {
        println!("AI_HEALTH_STATE={:?}", check_system().state);
    }

    #[cfg(unix)]
    mod system {
        use super::super::*;
        use std::os::unix::fs::PermissionsExt;

        fn temp_dir(name: &str) -> PathBuf {
            let dir = std::env::temp_dir().join(format!(
                "mnemo-health-{name}-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            dir
        }

        fn write_claude(dir: &Path, script: &str) {
            let path = dir.join("claude");
            std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        const SCRIPT: &str = r#"
case "$1" in
  --version) echo "2.1.329 (Claude Code)";;
  auth) echo '{"loggedIn": LOGGED, "email": "owner@example.com"}'; exit EXIT;;
esac"#;

        fn script(logged: &str, exit: &str) -> String {
            SCRIPT.replace("LOGGED", logged).replace("EXIT", exit)
        }

        #[test]
        fn no_claude_in_any_folder_is_not_installed() {
            let empty = temp_dir("empty");
            let cli = SystemClaude::new(vec![empty.clone()]);
            assert_eq!(cli.locate(), None);
            assert_eq!(check(&cli).state, AiState::NotInstalled);
            // A folder that is not absolute (an empty PATH entry) is ignored.
            assert_eq!(SystemClaude::new(vec![PathBuf::new()]).locate(), None);
            let _ = std::fs::remove_dir_all(empty);
        }

        #[test]
        fn a_file_without_the_execute_bit_is_not_claude() {
            let dir = temp_dir("noexec");
            std::fs::write(dir.join("claude"), "x").unwrap();
            assert_eq!(SystemClaude::new(vec![dir.clone()]).locate(), None);
            let _ = std::fs::remove_dir_all(dir);
        }

        #[test]
        fn a_fake_claude_signed_in_is_ready() {
            let dir = temp_dir("in");
            write_claude(&dir, &script("true", "0"));
            let cli = SystemClaude::new(vec![dir.clone()]);
            assert_eq!(cli.locate(), Some(dir.join("claude")));
            assert_eq!(check(&cli).state, AiState::Ready);
            let _ = std::fs::remove_dir_all(dir);
        }

        #[test]
        fn a_fake_claude_that_prints_logged_in_false_is_not_signed_in() {
            let dir = temp_dir("out");
            write_claude(&dir, &script("false", "1"));
            let cli = SystemClaude::new(vec![dir.clone()]);
            assert_eq!(check(&cli).state, AiState::NotSignedIn);
            let _ = std::fs::remove_dir_all(dir);
        }

        #[test]
        fn a_fake_claude_that_prints_nonsense_is_a_version_problem() {
            let dir = temp_dir("junk");
            write_claude(&dir, "echo hello");
            let cli = SystemClaude::new(vec![dir.clone()]);
            assert_eq!(check(&cli).state, AiState::VersionProblem);
            let _ = std::fs::remove_dir_all(dir);
        }

        #[test]
        fn run_gives_stdout_and_the_exit_result() {
            let dir = temp_dir("run");
            write_claude(&dir, "echo hi; exit 3");
            let cli = SystemClaude::new(vec![dir.clone()]);
            let got = cli.run(&dir.join("claude"), &[]).unwrap();
            assert_eq!(got.stdout.trim(), "hi");
            assert!(!got.success);
            assert!(cli.run(&dir.join("missing"), &[]).is_err());
            let _ = std::fs::remove_dir_all(dir);
        }

        #[test]
        fn a_descendant_holding_the_pipe_open_does_not_hang_the_check() {
            let dir = temp_dir("hold");
            // The background sleep keeps stdout open after `claude` itself has exited.
            write_claude(&dir, "echo hi; sleep 8 &");
            let cli = SystemClaude::new(vec![dir.clone()]);
            let started = Instant::now();
            // The exit was normal, so the text read before the wait ended is kept.
            let got = cli.run(&dir.join("claude"), &[]).unwrap();
            assert_eq!(got.stdout.trim(), "hi");
            assert!(got.success);
            assert!(started.elapsed() < Duration::from_secs(6));
            let _ = std::fs::remove_dir_all(dir);
        }

        #[test]
        fn the_api_key_is_not_passed_to_the_child() {
            // The command is inspected, so the test does not change the process environment.
            let command = check_command(Path::new("/x/claude"), &["--version"]);
            let key = command
                .get_envs()
                .find(|(name, _)| *name == "ANTHROPIC_API_KEY");
            assert_eq!(key, Some((std::ffi::OsStr::new("ANTHROPIC_API_KEY"), None)));
        }

        #[test]
        fn install_dirs_come_after_path_and_include_home_places() {
            let dirs = install_dirs(Some("/home/o".into()));
            assert!(dirs.contains(&PathBuf::from("/home/o/.local/bin")));
            assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
            assert!(!install_dirs(None).is_empty());
        }
    }
}
