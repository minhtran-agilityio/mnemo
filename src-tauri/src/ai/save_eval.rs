// The save eval (#30, BM-04): one score for the save summaries on a fixed set of stored pages, so a
// change of prompt or model is compared with numbers. It is `#[ignore]`, so `npm test` and
// `npm run check` never run it. `scripts/save-eval.sh` runs it on purpose with `MNEMO_SAVE_EVAL=1`
// (each run uses the owner's Claude usage); without that variable the test returns at once and
// starts nothing. It is built like `proof.rs`: it calls `claude::run_claude_with_usage` and never
// `ClaudeRunner::run_task`, so the guard that stops a test from using the real runner stays as it is.
//
// For each page in `evals/save/expected.json`:
// - the stored raw HTML goes through the real HTML-to-text step (`fetch::page_text`);
// - an unreadable page passes only when that step gives it up, so the save stays link only with no
//   summary (nothing is sent to Claude);
// - a readable page goes through the real save task (`bookmark_save::task`, its model and effort) and
//   is checked in plain code: a valid answer in the length limits, no forbidden text, and a tag
//   overlap. A Claude judge (Sonnet, low effort, prompt in `evals/save/judge.md`) only decides which
//   of the expected statements the summary contains.
// The page score is the mean of the four parts, 0 to 1; the total is the sum over the pages. The
// result goes to the file named by `MNEMO_SAVE_EVAL_RESULT`. Only the summaries and tags the run made
// are written: never raw output, an account detail or a token.
//
// **Unverified**: the usage percent comes from one tiny stream-mode probe run before the pages and one
// after them (see `usage.rs`, whose scale is unverified). The probes are counted in "runs used".

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::bookmark_save;
use super::cancel::CancelToken;
use super::claude::run_claude_with_usage;
use super::config::{ensure_config, ClaudeConfig};
use super::fetch::{page_text, FetchError, PageText, DEFAULT_LIMITS};
use super::health::{ClaudeCli, SystemClaude};
use super::limits::MAX_TEXT_CHARS;
use super::models::{AiEffort, AiModel};
use super::runner::{AiError, AiOutput, AiTask};
use super::stream::run_stream_with_usage;
use super::test_prompt;
use super::usage::{UsageReading, UsageSink};
use crate::storage::bookmarks::{BookmarkSummary, MAX_TAGS};

/// The gate variable. Only `scripts/save-eval.sh` sets it.
const GATE: &str = "MNEMO_SAVE_EVAL";
/// Where the result file goes. Unset: the scores are printed and no file is written.
const RESULT_PATH: &str = "MNEMO_SAVE_EVAL_RESULT";
/// How many pages are worked on at the same time: at most 2 `claude -p` runs at once (backend rules).
const WORKERS: usize = 2;
/// The summary length the save prompt asks for.
const SUMMARY_LIMIT_CHARS: usize = 600;
/// The judge's answer shape: one item per expected statement.
const JUDGE_SCHEMA: &str = r#"{"type":"object","properties":{"facts":{"type":"array","items":{"type":"object","properties":{"fact":{"type":"string"},"present":{"type":"boolean"}},"required":["fact","present"],"additionalProperties":false}}},"required":["facts"],"additionalProperties":false}"#;

fn enabled() -> bool {
    std::env::var(GATE).is_ok_and(|v| v == "1")
}

/// The folder `evals/save/` of the repository.
fn eval_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("evals")
        .join("save")
}

// ---------------------------------------------------------------- the expectations

#[derive(Debug, Deserialize)]
struct ExpectedFile {
    pages: BTreeMap<String, Expected>,
}

/// What the save of one page must give. `expect: "link_only"` marks a page the app cannot read.
#[derive(Debug, Deserialize)]
struct Expected {
    file: String,
    #[serde(default)]
    expect: Option<String>,
    facts: Vec<String>,
    tags: Vec<String>,
    must_not: Vec<String>,
}

impl Expected {
    fn link_only(&self) -> bool {
        self.expect.as_deref() == Some("link_only")
    }
}

fn load_expected(dir: &Path) -> Result<BTreeMap<String, Expected>, String> {
    let text = std::fs::read_to_string(dir.join("expected.json"))
        .map_err(|e| format!("expected.json was not read: {e}"))?;
    let file: ExpectedFile =
        serde_json::from_str(&text).map_err(|e| format!("expected.json is not valid: {e}"))?;
    Ok(file.pages)
}

/// The stored page through the real HTML-to-text step, as the page reader does it.
fn read_stored(dir: &Path, expected: &Expected) -> Result<PageText, FetchError> {
    let body = std::fs::read(dir.join(&expected.file)).map_err(|_| FetchError::TooLittleText)?;
    page_text(&body, "text/html", &DEFAULT_LIMITS)
}

// ---------------------------------------------------------------- plain-code checks

/// A summary of at most 600 characters, and 1 to `MAX_TAGS` lower-case tags of at most 80.
fn format_ok(summary: &BookmarkSummary) -> bool {
    let tags = &summary.tags;
    !summary.summary.trim().is_empty()
        && summary.summary.chars().count() <= SUMMARY_LIMIT_CHARS
        && (1..=MAX_TAGS).contains(&tags.len())
        && tags
            .iter()
            .all(|t| !t.is_empty() && t.chars().count() <= 80 && *t == t.to_lowercase())
}

/// True when one saved tag and one expected tag are the same word or phrase, or one holds the other.
fn tags_overlap(tags: &[String], expected: &[String]) -> bool {
    let norm = |s: &str| s.trim().to_lowercase();
    tags.iter().any(|t| {
        let t = norm(t);
        !t.is_empty()
            && expected.iter().any(|e| {
                let e = norm(e);
                !e.is_empty() && (t == e || t.contains(&e) || e.contains(&t))
            })
    })
}

/// The `must_not` entries found in the summary or the tags (case does not matter).
fn forbidden_found(summary: &BookmarkSummary, must_not: &[String]) -> Vec<String> {
    let all = format!("{}\n{}", summary.summary, summary.tags.join("\n")).to_lowercase();
    must_not
        .iter()
        .filter(|m| !m.trim().is_empty() && all.contains(&m.to_lowercase()))
        .cloned()
        .collect()
}

/// The share of expected statements the judge found present. No expected statement: 1.
fn fact_share(present: &[bool]) -> f64 {
    if present.is_empty() {
        return 1.0;
    }
    present.iter().filter(|p| **p).count() as f64 / present.len() as f64
}

/// The mean of the four parts of a readable page, 0 to 1.
fn page_score(format: bool, no_forbidden: bool, tags: bool, facts: f64) -> f64 {
    let flag = |b: bool| if b { 1.0 } else { 0.0 };
    (flag(format) + flag(no_forbidden) + flag(tags) + facts) / 4.0
}

/// How far two totals are apart, in percent of their mean. Two zero totals are 0 apart.
fn spread_percent(a: f64, b: f64) -> f64 {
    let mean = (a + b) / 2.0;
    if mean == 0.0 {
        0.0
    } else {
        (a - b).abs() / mean * 100.0
    }
}

// ---------------------------------------------------------------- the judge

fn judge_prompt(template: &str, summary: &str, facts: &[String]) -> String {
    let list = facts
        .iter()
        .enumerate()
        .map(|(i, f)| format!("{}. {f}", i + 1))
        .collect::<Vec<_>>()
        .join("\n");
    // The summary goes in last, so text inside it is never read as a placeholder.
    template
        .replace("{{FACTS}}", &list)
        .replace("{{SUMMARY}}", summary)
}

fn judge_task(prompt: String) -> AiTask {
    AiTask {
        name: "save_eval_judge".to_string(),
        prompt,
        schema: JUDGE_SCHEMA.to_string(),
        tools: vec![],
        model: AiModel::Sonnet.value().to_string(),
        effort: Some(AiEffort::Low.value().to_string()),
        timeout: super::limits::SUMMARY_TIMEOUT,
    }
}

/// One `present` per expected statement, in order. A different count is a bad answer: nothing is guessed.
fn parse_judge(output: &AiOutput, expected: usize) -> Result<Vec<bool>, String> {
    let value: Value = serde_json::from_str(&output.structured_output)
        .map_err(|_| "the judge answer is not JSON".to_string())?;
    let items = value["facts"]
        .as_array()
        .ok_or_else(|| "the judge answer has no facts".to_string())?;
    if items.len() != expected {
        return Err(format!(
            "the judge gave {} items for {expected} statements",
            items.len()
        ));
    }
    items
        .iter()
        .map(|i| {
            i["present"]
                .as_bool()
                .ok_or_else(|| "a judge item has no present".to_string())
        })
        .collect()
}

// ---------------------------------------------------------------- the result

#[derive(Debug, Serialize, Deserialize)]
struct PageResult {
    score: f64,
    readable: bool,
    /// Why the page lost points, or why it could not be scored. Empty when nothing is wrong.
    notes: Vec<String>,
    summary: Option<String>,
    tags: Vec<String>,
    facts_present: Vec<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
struct EvalResult {
    date: String,
    /// Set when the plain-code checks were scored again from a stored result (see `rescore`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
    save_model: String,
    save_effort: Option<String>,
    judge_model: String,
    judge_effort: String,
    pages: BTreeMap<String, PageResult>,
    /// The sum of the page scores.
    total: f64,
    /// The most the total can be: one point per page.
    max_total: usize,
    total_percent: f64,
    runs_used: usize,
    /// The five-hour usage percent at the first and the last reading. **Unverified** scale.
    usage_before_percent: Option<i64>,
    usage_after_percent: Option<i64>,
}

fn write_result(path: &Path, result: &EvalResult) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut text = serde_json::to_string_pretty(result)?;
    text.push('\n');
    std::fs::write(path, text)
}

fn fail(notes: &str) -> PageResult {
    PageResult {
        score: 0.0,
        readable: true,
        notes: vec![notes.to_string()],
        summary: None,
        tags: vec![],
        facts_present: vec![],
    }
}

/// The score of a page the app cannot read: 1 only when the read gave up, so the save stays link
/// only and no summary is made (and no run is started).
fn score_unreadable(read: &Result<PageText, FetchError>) -> PageResult {
    let (score, notes) = match read {
        Err(e) => (1.0, vec![format!("link only ({e})")]),
        Ok(_) => (
            0.0,
            vec!["the page was read, so a save would run Claude on it".to_string()],
        ),
    };
    PageResult {
        score,
        readable: false,
        notes,
        summary: None,
        tags: vec![],
        facts_present: vec![],
    }
}

/// The checks and the judged statements put together for one readable page.
fn score_readable(
    expected: &Expected,
    summary: &BookmarkSummary,
    judged: Result<Vec<bool>, String>,
) -> PageResult {
    let mut notes = Vec::new();
    let format = format_ok(summary);
    if !format {
        notes.push("the summary or the tags are outside the length limits".to_string());
    }
    let forbidden = forbidden_found(summary, &expected.must_not);
    if !forbidden.is_empty() {
        notes.push(format!("must not appear: {}", forbidden.join(", ")));
    }
    let tags = tags_overlap(&summary.tags, &expected.tags);
    if !tags {
        notes.push("no saved tag overlaps the expected tags".to_string());
    }
    let (facts, present) = match judged {
        Ok(p) => {
            for (fact, ok) in expected.facts.iter().zip(&p) {
                if !ok {
                    notes.push(format!("missing: {fact}"));
                }
            }
            (fact_share(&p), p)
        }
        Err(e) => {
            notes.push(format!("not judged: {e}"));
            (0.0, vec![])
        }
    };
    PageResult {
        score: page_score(format, forbidden.is_empty(), tags, facts),
        readable: true,
        notes,
        summary: Some(summary.summary.clone()),
        tags: summary.tags.clone(),
        facts_present: present,
    }
}

// ---------------------------------------------------------------- the real runs

/// Real runs start inside an owner-only folder under the home folder, like the app and the proof.
fn eval_runs_dir() -> PathBuf {
    let home = std::env::var_os("HOME").expect("HOME is not set, so the eval cannot run");
    PathBuf::from(home)
        .join(".cache")
        .join("mnemo-eval")
        .join("ai-runs")
}

struct Runs {
    program: PathBuf,
    runs_dir: PathBuf,
    config: ClaudeConfig,
    started: AtomicUsize,
}

impl Runs {
    /// Starts one `claude -p` run and counts it, whatever its end.
    fn run(&self, task: &AiTask) -> Result<AiOutput, AiError> {
        self.started.fetch_add(1, Ordering::SeqCst);
        run_claude_with_usage(
            &self.program,
            task,
            &self.runs_dir,
            &self.config,
            &CancelToken::default(),
            None,
        )
    }

    /// One tiny `claude -p` run in stream mode, only to read the usage percent: the json output of
    /// this Claude Code version on Ubuntu carries no usage reading, the stream does. It is counted
    /// as a run. `None` when the run gave no five-hour reading (or failed).
    fn probe_usage(&self) -> Option<i64> {
        self.started.fetch_add(1, Ordering::SeqCst);
        let seen: Arc<Mutex<Option<i64>>> = Arc::default();
        let sink: UsageSink = {
            let seen = Arc::clone(&seen);
            Arc::new(move |r: UsageReading| {
                if let (Some(p), Ok(mut last)) = (five_hour_percent(&r), seen.lock()) {
                    *last = Some(p);
                }
            })
        };
        let _ = run_stream_with_usage(
            &self.program,
            &test_prompt::task(),
            &self.runs_dir,
            &self.config,
            &CancelToken::default(),
            &mut |_| {},
            Some(&sink),
        );
        let got = seen.lock().ok().and_then(|g| *g);
        got
    }
}

fn score_page(runs: &Runs, dir: &Path, judge: &str, expected: &Expected) -> PageResult {
    let read = read_stored(dir, expected);
    if expected.link_only() {
        return score_unreadable(&read);
    }
    let page = match read {
        Ok(page) => page,
        Err(e) => return fail(&format!("a readable page could not be read ({e})")),
    };
    debug_assert!(page.text.chars().count() <= MAX_TEXT_CHARS);
    let task = bookmark_save::task(page.title.as_deref(), &page.text);
    let summary = match runs.run(&task).and_then(|o| bookmark_save::parse(&o)) {
        Ok(s) => s,
        Err(e) => return fail(&format!("the save gave no summary ({e})")),
    };
    let prompt = judge_prompt(judge, &summary.summary, &expected.facts);
    let judged = runs
        .run(&judge_task(prompt))
        .map_err(|e| format!("the judge run failed ({e})"))
        .and_then(|o| parse_judge(&o, expected.facts.len()));
    score_readable(expected, &summary, judged)
}

/// A stored result scored again with the current expectations, with no run: the checks in plain code
/// are done again from the stored summary and tags, and the stored judge answers are kept. A page
/// that has no stored summary keeps its score. `note` says why, and goes in the result.
fn rescore(old: &EvalResult, expected: &BTreeMap<String, Expected>, note: &str) -> EvalResult {
    let mut pages = BTreeMap::new();
    for (id, exp) in expected {
        let Some(page) = old.pages.get(id) else {
            continue;
        };
        let again = match (&page.summary, exp.link_only()) {
            (Some(text), false) => {
                let summary = BookmarkSummary {
                    summary: text.clone(),
                    reason: String::new(),
                    tags: page.tags.clone(),
                };
                let judged = if page.facts_present.len() == exp.facts.len() {
                    Ok(page.facts_present.clone())
                } else {
                    Err("no stored judge answer".to_string())
                };
                score_readable(exp, &summary, judged)
            }
            _ => PageResult {
                score: page.score,
                readable: page.readable,
                notes: page.notes.clone(),
                summary: page.summary.clone(),
                tags: page.tags.clone(),
                facts_present: page.facts_present.clone(),
            },
        };
        pages.insert(id.clone(), again);
    }
    let total: f64 = pages.values().map(|p| p.score).sum();
    EvalResult {
        notes: Some(note.to_string()),
        max_total: pages.len(),
        total_percent: total / pages.len().max(1) as f64 * 100.0,
        total,
        pages,
        date: old.date.clone(),
        save_model: old.save_model.clone(),
        save_effort: old.save_effort.clone(),
        judge_model: old.judge_model.clone(),
        judge_effort: old.judge_effort.clone(),
        runs_used: old.runs_used,
        usage_before_percent: old.usage_before_percent,
        usage_after_percent: old.usage_after_percent,
    }
}

/// `scripts/save-eval.sh rescore <in> <out> <note>`: starts no run. It is `#[ignore]` only because it
/// writes a file in the repository.
#[test]
#[ignore = "writes a result file; run it with scripts/save-eval.sh rescore"]
fn rescore_a_stored_result() {
    let (Some(from), Some(to), Ok(note)) = (
        std::env::var_os("MNEMO_SAVE_RESCORE_FROM"),
        std::env::var_os(RESULT_PATH),
        std::env::var("MNEMO_SAVE_RESCORE_NOTE"),
    ) else {
        return;
    };
    let old: EvalResult =
        serde_json::from_str(&std::fs::read_to_string(from).expect("the result was not read"))
            .expect("the stored result is not valid");
    let new = rescore(
        &old,
        &load_expected(&eval_dir()).expect("expectations"),
        &note,
    );
    write_result(Path::new(&to), &new).expect("the result file was not written");
    println!(
        "eval: rescored total: {:.2} of {} (was {:.2})",
        new.total, new.max_total, old.total
    );
}

fn five_hour_percent(reading: &UsageReading) -> Option<i64> {
    reading.five_hour.as_ref().and_then(|w| w.percent())
}

/// The setup of real runs, shared by the eval and the one-run usage check.
fn real_runs() -> Runs {
    let program = SystemClaude::from_env()
        .locate()
        .expect("claude is not installed, so the eval cannot run");
    let runs_dir = eval_runs_dir();
    let config =
        ensure_config(&runs_dir.with_file_name("config")).expect("the eval config was not made");
    Runs {
        program,
        runs_dir,
        config,
        started: AtomicUsize::new(0),
    }
}

/// One probe run, to see that the stream gives a usage reading: `bash scripts/save-eval.sh usage`.
#[test]
#[ignore = "starts one real claude -p run; run it with scripts/save-eval.sh usage"]
fn usage_probe_once() {
    if !enabled() {
        return;
    }
    let got = real_runs().probe_usage();
    println!(
        "eval: usage now: {} (five-hour window, Unverified scale)",
        got.map_or("unknown".to_string(), |p| format!("{p}%"))
    );
}

#[test]
#[ignore = "starts real claude -p runs; run it with scripts/save-eval.sh"]
fn save_eval() {
    if !enabled() {
        return;
    }
    let dir = eval_dir();
    let expected = load_expected(&dir).expect("the expectations were not loaded");
    let judge = std::fs::read_to_string(dir.join("judge.md")).expect("judge.md was not read");
    let runs = real_runs();
    let usage_before = runs.probe_usage();

    let entries: Vec<(&String, &Expected)> = expected.iter().collect();
    let next = AtomicUsize::new(0);
    let done: Mutex<BTreeMap<String, PageResult>> = Mutex::default();
    std::thread::scope(|scope| {
        for _ in 0..WORKERS {
            scope.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::SeqCst);
                let Some((id, exp)) = entries.get(i) else {
                    break;
                };
                let result = score_page(&runs, &dir, &judge, exp);
                println!("eval: page {id}: {:.2}", result.score);
                for note in &result.notes {
                    println!("eval:   {id}: {note}");
                }
                if let Ok(mut all) = done.lock() {
                    all.insert((*id).clone(), result);
                }
            });
        }
    });
    let usage_after = runs.probe_usage();
    let pages = done.into_inner().expect("a worker failed");
    assert_eq!(pages.len(), expected.len(), "a page was not scored");

    let total: f64 = pages.values().map(|p| p.score).sum();
    let result = EvalResult {
        date: std::env::var("MNEMO_SAVE_EVAL_DATE").unwrap_or_default(),
        notes: None,
        save_model: bookmark_save::task(None, "x").model,
        save_effort: bookmark_save::task(None, "x").effort,
        judge_model: AiModel::Sonnet.value().to_string(),
        judge_effort: AiEffort::Low.value().to_string(),
        max_total: pages.len(),
        total_percent: total / pages.len() as f64 * 100.0,
        total,
        pages,
        runs_used: runs.started.load(Ordering::SeqCst),
        usage_before_percent: usage_before,
        usage_after_percent: usage_after,
    };
    let show = |p: Option<i64>| p.map_or("unknown".to_string(), |p| format!("{p}%"));
    println!(
        "eval: total: {:.2} of {} ({:.1}%)",
        result.total, result.max_total, result.total_percent
    );
    println!("eval: runs used: {}", result.runs_used);
    println!(
        "eval: usage before: {} (five-hour window, Unverified scale)",
        show(result.usage_before_percent)
    );
    println!("eval: usage after: {}", show(result.usage_after_percent));
    match std::env::var_os(RESULT_PATH) {
        Some(path) => {
            write_result(Path::new(&path), &result).expect("the result file was not written");
            println!("eval: result written to {}", Path::new(&path).display());
        }
        None => println!("eval: {RESULT_PATH} is not set, so no result file was written"),
    }
}

// ---------------------------------------------------------------- tests (they never start Claude)

#[cfg(test)]
mod tests {
    use super::*;

    fn summary(text: &str, tags: &[&str]) -> BookmarkSummary {
        BookmarkSummary {
            summary: text.to_string(),
            reason: "r".to_string(),
            tags: tags.iter().map(|t| t.to_string()).collect(),
        }
    }

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn expected(facts: &[&str], tags: &[&str], must_not: &[&str]) -> Expected {
        Expected {
            file: "pages/x.html".to_string(),
            expect: None,
            facts: strings(facts),
            tags: strings(tags),
            must_not: strings(must_not),
        }
    }

    #[test]
    fn the_stored_expectations_cover_every_page_and_every_file_exists() {
        let dir = eval_dir();
        let pages = load_expected(&dir).unwrap();
        let readable = pages.values().filter(|p| !p.link_only()).count();
        let link_only = pages.values().filter(|p| p.link_only()).count();
        assert_eq!((readable, link_only), (17, 3));
        for (id, page) in &pages {
            assert!(
                dir.join(&page.file).is_file(),
                "{id}: {} is missing",
                page.file
            );
            assert!(!page.must_not.is_empty(), "{id}: no must_not entry");
            if page.link_only() {
                assert!(page.facts.is_empty() && page.tags.is_empty(), "{id}");
            } else {
                assert!(!page.facts.is_empty() && !page.tags.is_empty(), "{id}");
            }
        }
    }

    #[test]
    fn the_real_html_step_reads_every_readable_page_and_gives_up_on_every_other() {
        let dir = eval_dir();
        for (id, page) in load_expected(&dir).unwrap() {
            let read = read_stored(&dir, &page);
            if page.link_only() {
                assert!(read.is_err(), "{id} was read, but it must stay link only");
            } else {
                let text = read.unwrap_or_else(|e| panic!("{id} was not read: {e}"));
                assert!(text.text.chars().count() >= 200, "{id}");
            }
        }
    }

    #[test]
    fn the_judge_prompt_file_has_both_placeholders() {
        let judge = std::fs::read_to_string(eval_dir().join("judge.md")).unwrap();
        assert!(judge.contains("{{SUMMARY}}") && judge.contains("{{FACTS}}"));
    }

    #[test]
    fn a_save_task_for_a_stored_page_has_no_tools_and_the_page_text() {
        let dir = eval_dir();
        let pages = load_expected(&dir).unwrap();
        let page = read_stored(&dir, &pages["rust-book-cargo"]).unwrap();
        let task = bookmark_save::task(page.title.as_deref(), &page.text);
        assert!(task.tools.is_empty());
        assert!(task.prompt.contains("release profiles"));
    }

    #[test]
    fn the_judge_runs_on_sonnet_at_low_effort_with_no_tools() {
        let task = judge_task("p".to_string());
        assert_eq!(task.model, "sonnet");
        assert_eq!(task.effort.as_deref(), Some("low"));
        assert!(task.tools.is_empty());
        assert!(serde_json::from_str::<Value>(&task.schema).is_ok());
    }

    #[test]
    fn the_format_check_holds_the_length_limits() {
        assert!(format_ok(&summary("A short summary.", &["rust", "memory"])));
        assert!(!format_ok(&summary("", &["rust"])));
        assert!(!format_ok(&summary(&"x".repeat(601), &["rust"])));
        assert!(format_ok(&summary(&"x".repeat(600), &["rust"])));
        assert!(!format_ok(&summary("ok", &[])));
        assert!(!format_ok(&summary("ok", &["Rust"])));
        let seven = ["a", "b", "c", "d", "e", "f", "g"];
        assert!(!format_ok(&summary("ok", &seven)));
    }

    #[test]
    fn tags_overlap_by_word_or_phrase_and_never_by_nothing() {
        let want = strings(&["rust", "error handling"]);
        assert!(tags_overlap(&strings(&["Rust"]), &want));
        assert!(tags_overlap(&strings(&["rust error handling"]), &want));
        assert!(tags_overlap(&strings(&["handling"]), &want));
        assert!(!tags_overlap(&strings(&["python"]), &want));
        assert!(!tags_overlap(&strings(&[""]), &want));
        assert!(!tags_overlap(&[], &want));
    }

    #[test]
    fn forbidden_text_is_found_in_the_summary_or_a_tag_without_case() {
        let s = summary("It uses a Garbage Collector.", &["java"]);
        let found = forbidden_found(&s, &strings(&["garbage collector", "java", "python", ""]));
        assert_eq!(found, strings(&["garbage collector", "java"]));
        assert!(forbidden_found(&s, &[]).is_empty());
    }

    #[test]
    fn the_page_score_is_the_mean_of_four_parts() {
        assert_eq!(page_score(true, true, true, 1.0), 1.0);
        assert_eq!(page_score(false, false, false, 0.0), 0.0);
        assert_eq!(page_score(true, true, false, 0.5), 0.625);
        assert_eq!(fact_share(&[true, false, true, false]), 0.5);
        assert_eq!(fact_share(&[]), 1.0);
    }

    #[test]
    fn a_page_the_app_cannot_read_passes_only_when_the_read_gives_up() {
        let gave_up = score_unreadable(&Err(FetchError::TooLittleText));
        assert_eq!((gave_up.score, gave_up.readable), (1.0, false));
        assert!(gave_up.summary.is_none());
        let page = PageText {
            title: None,
            text: "x".repeat(300),
            cut: false,
        };
        assert_eq!(score_unreadable(&Ok(page)).score, 0.0);
    }

    #[test]
    fn a_readable_page_loses_a_point_for_each_failed_check_and_says_why() {
        let e = expected(&["a", "b"], &["rust"], &["java"]);
        let good = score_readable(&e, &summary("About rust.", &["rust"]), Ok(vec![true, true]));
        assert_eq!(good.score, 1.0);
        assert!(good.notes.is_empty());
        let bad = score_readable(
            &e,
            &summary("About java.", &["java"]),
            Ok(vec![true, false]),
        );
        assert_eq!(bad.score, 0.375);
        assert_eq!(bad.notes.len(), 3, "{:?}", bad.notes);
        let unjudged = score_readable(&e, &summary("About rust.", &["rust"]), Err("x".into()));
        assert_eq!(unjudged.score, 0.75);
        assert!(unjudged.notes[0].starts_with("not judged"));
    }

    #[test]
    fn the_judge_answer_needs_one_boolean_per_statement() {
        let out = |text: &str| AiOutput {
            structured_output: text.to_string(),
        };
        let ok = out(r#"{"facts":[{"fact":"a","present":true},{"fact":"b","present":false}]}"#);
        assert_eq!(parse_judge(&ok, 2).unwrap(), vec![true, false]);
        assert!(parse_judge(&ok, 3).is_err());
        assert!(parse_judge(&out(r#"{"facts":[{"fact":"a"}]}"#), 1).is_err());
        assert!(parse_judge(&out(r#"{"other":1}"#), 0).is_err());
        assert!(parse_judge(&out("not json"), 0).is_err());
    }

    #[test]
    fn the_judge_prompt_lists_the_statements_and_the_summary_cannot_add_one() {
        let template = "S:{{SUMMARY}}\nF:\n{{FACTS}}";
        let prompt = judge_prompt(template, "text {{FACTS}}", &strings(&["one", "two"]));
        assert_eq!(prompt, "S:text {{FACTS}}\nF:\n1. one\n2. two");
    }

    #[test]
    fn the_spread_is_a_percent_of_the_mean_of_two_totals() {
        assert_eq!(spread_percent(10.0, 10.0), 0.0);
        assert_eq!(spread_percent(0.0, 0.0), 0.0);
        assert!((spread_percent(9.0, 11.0) - 20.0).abs() < 1e-9);
    }

    #[test]
    fn a_result_is_written_as_json_with_a_score_per_page_and_a_total() {
        let dir = std::env::temp_dir().join(format!("mnemo-save-eval-{}", uuid::Uuid::new_v4()));
        let path = dir.join("results").join("r.json");
        let mut pages = BTreeMap::new();
        pages.insert(
            "p1".to_string(),
            score_unreadable(&Err(FetchError::NotText)),
        );
        let result = EvalResult {
            date: "2026-11-26".to_string(),
            notes: None,
            save_model: "haiku".to_string(),
            save_effort: Some("low".to_string()),
            judge_model: "sonnet".to_string(),
            judge_effort: "low".to_string(),
            total: 1.0,
            max_total: 1,
            total_percent: 100.0,
            pages,
            runs_used: 0,
            usage_before_percent: None,
            usage_after_percent: Some(3),
        };
        write_result(&path, &result).unwrap();
        let back: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(back["pages"]["p1"]["score"], 1.0);
        assert_eq!(back["total"], 1.0);
        assert_eq!(back["usage_after_percent"], 3);
        assert!(back["usage_before_percent"].is_null());
    }

    #[test]
    fn a_rescore_uses_the_stored_summary_and_judge_answers_and_starts_no_run() {
        let e = expected(&["a", "b"], &["rust"], &["java"]);
        let first = score_readable(
            &e,
            &summary("About java.", &["rust"]),
            Ok(vec![true, false]),
        );
        assert_eq!(first.score, 0.625);
        let mut pages = BTreeMap::new();
        pages.insert("p".to_string(), first);
        pages.insert("u".to_string(), score_unreadable(&Err(FetchError::NotText)));
        let old = EvalResult {
            date: "d".into(),
            notes: None,
            save_model: "haiku".into(),
            save_effort: None,
            judge_model: "sonnet".into(),
            judge_effort: "low".into(),
            pages,
            total: 1.625,
            max_total: 2,
            total_percent: 81.25,
            runs_used: 3,
            usage_before_percent: None,
            usage_after_percent: None,
        };
        let mut want = BTreeMap::new();
        want.insert(
            "p".to_string(),
            expected(&["a", "b"], &["rust"], &["new york"]),
        );
        let mut u = expected(&[], &[], &["any summary"]);
        u.expect = Some("link_only".to_string());
        want.insert("u".to_string(), u);
        let new = rescore(&old, &want, "why");
        assert_eq!(new.pages["p"].score, 0.875);
        assert_eq!(new.pages["u"].score, 1.0);
        assert_eq!((new.total, new.runs_used), (1.875, 3));
        assert_eq!(new.notes.as_deref(), Some("why"));
    }

    #[test]
    fn the_eval_starts_nothing_without_its_gate_variable() {
        // This test is run with the variable unset by `npm test`; if a developer has it set, there
        // is nothing to check here.
        if !enabled() {
            assert!(std::env::var(GATE).map_or(true, |v| v != "1"));
        }
    }
}
