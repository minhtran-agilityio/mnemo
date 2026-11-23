// The model and the effort of each AI feature: one row per task name. The defaults live here in
// code (the prototype v52 "Balanced" map); an owner choice is stored in the settings table as
// `ai_model.<task>` = `{"model":"..","effort":".."}` and read before each run.
//
// The `claude` CLI help lists the `--model` aliases ('opus', 'sonnet', or a full name) and the
// `--effort` levels (low, medium, high, xhigh, max). Mnemo offers only the three models and the
// three efforts below. Unverified: that `haiku` is accepted by `claude -p` on the Max plan.

use std::fmt;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use super::cancel::CancelToken;
use super::runner::{AiError, AiOutput, AiRunner, AiTask};
use crate::storage::{Storage, StorageError};

/// A model the owner can pick. The value is what `claude --model` gets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiModel {
    Haiku,
    Sonnet,
    Opus,
}

impl AiModel {
    pub const ALL: [AiModel; 3] = [AiModel::Haiku, AiModel::Sonnet, AiModel::Opus];

    /// The `--model` value, also the stored and UI value.
    pub fn value(self) -> &'static str {
        match self {
            AiModel::Haiku => "haiku",
            AiModel::Sonnet => "sonnet",
            AiModel::Opus => "opus",
        }
    }

    /// The name the owner sees.
    pub fn label(self) -> &'static str {
        match self {
            AiModel::Haiku => "Haiku 5.5",
            AiModel::Sonnet => "Sonnet 5.5",
            AiModel::Opus => "Opus 5.5",
        }
    }

    /// Exactly one of the allowed values; anything else (other case, other model) is refused.
    pub fn parse(text: &str) -> Option<AiModel> {
        AiModel::ALL.into_iter().find(|m| m.value() == text)
    }
}

/// An effort level the owner can pick. The value is what `claude --effort` gets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiEffort {
    Low,
    Medium,
    High,
}

impl AiEffort {
    pub const ALL: [AiEffort; 3] = [AiEffort::Low, AiEffort::Medium, AiEffort::High];

    pub fn value(self) -> &'static str {
        match self {
            AiEffort::Low => "low",
            AiEffort::Medium => "medium",
            AiEffort::High => "high",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            AiEffort::Low => "Low",
            AiEffort::Medium => "Medium",
            AiEffort::High => "High",
        }
    }

    /// Exactly one of the allowed values. `xhigh` and `max` exist in the CLI but Mnemo refuses them.
    pub fn parse(text: &str) -> Option<AiEffort> {
        AiEffort::ALL.into_iter().find(|e| e.value() == text)
    }
}

/// One feature's row: its task name, the name the owner sees, and its model and effort.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ModelRow {
    pub feature: &'static str,
    pub label: &'static str,
    pub model: AiModel,
    pub effort: AiEffort,
}

const fn row(
    feature: &'static str,
    label: &'static str,
    model: AiModel,
    effort: AiEffort,
) -> ModelRow {
    ModelRow {
        feature,
        label,
        model,
        effort,
    }
}

use AiEffort::{Low, Medium};
use AiModel::{Haiku, Sonnet};

/// The defaults: the prototype v52 "Balanced" feature map, plus the two tasks that are not
/// features (the Settings test prompt and the sample title task). Every `AiTask` name in code
/// must have a row here; a test checks it.
pub const DEFAULTS: [ModelRow; 10] = [
    row("save", "Save a link: summary, tags and folder", Haiku, Low),
    row("ask", "Ask Mnemo: answers with sources", Sonnet, Medium),
    row("daily", "Daily digest", Haiku, Low),
    row("weekly", "Weekly digest and roast", Sonnet, Medium),
    row("folders", "Folder proposals", Sonnet, Medium),
    row("notes", "Notes: tidy, summarize, idea", Sonnet, Medium),
    row("ideas", "Ideas: draft an idea", Sonnet, Medium),
    row("paths", "Learning paths and cards", Sonnet, Medium),
    row("test_prompt", "Test prompt (Settings)", Haiku, Low),
    row("suggest_title", "Suggest a title (sample)", Haiku, Low),
];

/// The default row of a task name, or `None` for a name with no row.
pub fn default_row(task: &str) -> Option<ModelRow> {
    DEFAULTS.iter().find(|r| r.feature == task).copied()
}

/// The default model and effort of a task name, as the `AiTask` fields. A test makes sure every
/// name in code has a row; a name without one gets the smallest model with no effort set.
pub fn default_choice(task: &str) -> (String, Option<String>) {
    match default_row(task) {
        Some(row) => (
            row.model.value().to_string(),
            Some(row.effort.value().to_string()),
        ),
        None => (AiModel::Haiku.value().to_string(), None),
    }
}

fn key(task: &str) -> String {
    format!("ai_model.{task}")
}

/// What is stored under a key.
#[derive(Deserialize, Serialize)]
struct Stored {
    model: String,
    effort: String,
}

/// The row a run of `task` uses: the stored owner choice, else the default. A stored value that
/// cannot be read or is not allowed reads as the default, so a run never gets an unknown model.
/// `None` only for a task name with no row.
pub fn row_for(storage: &Storage, task: &str) -> Option<ModelRow> {
    let default = default_row(task)?;
    let text = match storage.get_setting(&key(task)) {
        Ok(Some(text)) => text,
        Ok(None) => return Some(default),
        Err(e) => {
            log::error!("could not read the model row of {task}: {e}");
            return Some(default);
        }
    };
    let chosen = serde_json::from_str::<Stored>(&text)
        .ok()
        .and_then(|s| Some((AiModel::parse(&s.model)?, AiEffort::parse(&s.effort)?)));
    match chosen {
        Some((model, effort)) => Some(ModelRow {
            model,
            effort,
            ..default
        }),
        None => {
            log::warn!("the stored model row of {task} is not allowed; using the default");
            Some(default)
        }
    }
}

/// A value and the name the owner sees, for a select.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Choice {
    pub value: &'static str,
    pub label: &'static str,
}

/// Everything the Settings table needs: the rows and the allowed values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AiModelTable {
    pub rows: Vec<ModelRow>,
    pub models: Vec<Choice>,
    pub efforts: Vec<Choice>,
}

/// The table with the owner's choices applied.
pub fn table(storage: &Storage) -> AiModelTable {
    AiModelTable {
        rows: DEFAULTS
            .iter()
            .filter_map(|r| row_for(storage, r.feature))
            .collect(),
        models: AiModel::ALL
            .iter()
            .map(|m| Choice {
                value: m.value(),
                label: m.label(),
            })
            .collect(),
        efforts: AiEffort::ALL
            .iter()
            .map(|e| Choice {
                value: e.value(),
                label: e.label(),
            })
            .collect(),
    }
}

/// Why a row was not changed.
#[derive(Debug)]
pub enum ModelError {
    UnknownFeature,
    UnknownModel(String),
    UnknownEffort(String),
    Storage(StorageError),
}

impl fmt::Display for ModelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ModelError::UnknownFeature => {
                write!(f, "Mnemo does not know that feature. Nothing was changed.")
            }
            ModelError::UnknownModel(m) => write!(
                f,
                "Mnemo does not know the model \"{m}\". Pick Haiku, Sonnet or Opus. Nothing was changed."
            ),
            ModelError::UnknownEffort(e) => write!(
                f,
                "Mnemo does not know the effort \"{e}\". Pick Low, Medium or High. Nothing was changed."
            ),
            ModelError::Storage(_) => {
                write!(f, "Mnemo could not save the choice. Nothing was changed.")
            }
        }
    }
}

impl std::error::Error for ModelError {}

impl From<StorageError> for ModelError {
    fn from(e: StorageError) -> Self {
        ModelError::Storage(e)
    }
}

/// Saves the owner's model and effort for `feature`. It checks all three values first, so a
/// refused call writes nothing and the stored row stays as it was.
pub fn set_row(
    storage: &Storage,
    feature: &str,
    model: &str,
    effort: &str,
) -> Result<AiModelTable, ModelError> {
    default_row(feature).ok_or(ModelError::UnknownFeature)?;
    let model = AiModel::parse(model).ok_or_else(|| ModelError::UnknownModel(model.to_string()))?;
    let effort =
        AiEffort::parse(effort).ok_or_else(|| ModelError::UnknownEffort(effort.to_string()))?;
    let value = serde_json::json!({ "model": model.value(), "effort": effort.value() }).to_string();
    storage.set_setting(&key(feature), &value)?;
    Ok(table(storage))
}

/// Removes every owner choice, so each row is its code default again.
pub fn reset_rows(storage: &Storage) -> Result<AiModelTable, ModelError> {
    let keys: Vec<String> = DEFAULTS.iter().map(|r| key(r.feature)).collect();
    let refs: Vec<&str> = keys.iter().map(String::as_str).collect();
    storage.delete_settings(&refs)?;
    Ok(table(storage))
}

/// Where the runner finds the row of a task. The app reads the settings table; a test can give
/// fixed rows.
pub trait ModelChoices: Send + Sync {
    /// The row for `task`, or `None` to leave the task as built.
    fn row(&self, task: &str) -> Option<ModelRow>;
}

/// A runner that sets the model and effort of each task from its row, then hands the task to the
/// real runner. It reads the row before every run, so a changed row is used by the next run.
///
/// The choices may lock the app storage, so a caller must not hold that lock while it calls
/// `run_task` (a std `Mutex` is not re-entrant).
pub struct ConfiguredRunner {
    inner: Arc<dyn AiRunner>,
    choices: Arc<dyn ModelChoices>,
}

impl ConfiguredRunner {
    pub fn new(inner: Arc<dyn AiRunner>, choices: Arc<dyn ModelChoices>) -> Self {
        ConfiguredRunner { inner, choices }
    }
}

/// The runner the app gives its run queue: `inner` with each task's model and effort from
/// `choices`. lib.rs and the command tests both build the queue runner with this.
pub fn app_runner(inner: Arc<dyn AiRunner>, choices: Arc<dyn ModelChoices>) -> Arc<dyn AiRunner> {
    Arc::new(ConfiguredRunner::new(inner, choices))
}

impl AiRunner for ConfiguredRunner {
    fn run_task(&self, task: &AiTask, cancel: &CancelToken) -> Result<AiOutput, AiError> {
        let task = self.configure(task);
        // Reading the row can wait for the storage lock; a cancel in that time starts no process.
        if cancel.is_cancelled() {
            return Err(AiError::Cancelled);
        }
        self.inner.run_task(&task, cancel)
    }

    /// The task with the model and effort of its row. A task without a row is returned as built.
    /// Stream mode takes an `AiTask` directly, so it must call this on the queue's runner.
    fn configure(&self, task: &AiTask) -> AiTask {
        let mut task = self.inner.configure(task);
        if let Some(row) = self.choices.row(&task.name) {
            task.model = row.model.value().to_string();
            task.effort = Some(row.effort.value().to_string());
        }
        task
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::fake::{FakeResult, FakeRunner};
    use crate::ai::{sample, test_prompt};
    use std::path::PathBuf;
    use std::time::Duration;

    fn open() -> (Storage, PathBuf) {
        let dir = std::env::temp_dir().join(format!("mnemo-models-{}", uuid::Uuid::new_v4()));
        (Storage::open(&dir.join("mnemo.db")).unwrap(), dir)
    }

    fn pair(r: &ModelRow) -> (&'static str, &'static str, &'static str) {
        (r.feature, r.model.value(), r.effort.value())
    }

    #[test]
    fn defaults_match_the_balanced_feature_map() {
        let got: Vec<_> = DEFAULTS.iter().map(pair).collect();
        let want = vec![
            ("save", "haiku", "low"),
            ("ask", "sonnet", "medium"),
            ("daily", "haiku", "low"),
            ("weekly", "sonnet", "medium"),
            ("folders", "sonnet", "medium"),
            ("notes", "sonnet", "medium"),
            ("ideas", "sonnet", "medium"),
            ("paths", "sonnet", "medium"),
            ("test_prompt", "haiku", "low"),
            ("suggest_title", "haiku", "low"),
        ];
        assert_eq!(got, want);
    }

    #[test]
    fn every_task_name_in_code_has_a_row() {
        let mut names = vec![test_prompt::task().name, sample::task("x").name];
        names.extend(DEFAULTS.iter().map(|r| r.feature.to_string()));
        for name in names {
            assert!(default_row(&name).is_some(), "no row for task {name}");
        }
        let mut seen: Vec<_> = DEFAULTS.iter().map(|r| r.feature).collect();
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(seen.len(), DEFAULTS.len(), "a task name has two rows");
    }

    #[test]
    fn unknown_model_or_effort_does_not_parse() {
        for bad in ["gpt-4", "xhigh", "", "Haiku", "max", "fable"] {
            assert_eq!(AiModel::parse(bad), None, "{bad}");
        }
        for bad in ["xhigh", "max", "", "Low", "gpt-4"] {
            assert_eq!(AiEffort::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn only_the_allowed_models_and_efforts_are_accepted() {
        let models: Vec<_> = AiModel::ALL
            .iter()
            .map(|m| (m.value(), m.label()))
            .collect();
        assert_eq!(
            models,
            vec![
                ("haiku", "Haiku 5.5"),
                ("sonnet", "Sonnet 5.5"),
                ("opus", "Opus 5.5")
            ]
        );
        let efforts: Vec<_> = AiEffort::ALL.iter().map(|e| e.value()).collect();
        assert_eq!(efforts, vec!["low", "medium", "high"]);
        for m in ["haiku", "sonnet", "opus"] {
            assert!(AiModel::parse(m).is_some());
        }
        for e in ["low", "medium", "high"] {
            assert!(AiEffort::parse(e).is_some());
        }
        let (s, dir) = open();
        let t = table(&s);
        assert_eq!(t.models.len(), 3);
        assert_eq!(t.efforts.len(), 3);
        assert_eq!(t.rows.len(), DEFAULTS.len());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_row_without_a_choice_is_its_default() {
        let (s, dir) = open();
        for d in DEFAULTS {
            assert_eq!(row_for(&s, d.feature), Some(d));
        }
        assert_eq!(row_for(&s, "no_such_task"), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn set_row_refuses_an_unknown_model_and_keeps_the_stored_row() {
        let (s, dir) = open();
        set_row(&s, "save", "sonnet", "high").unwrap();
        let err = set_row(&s, "save", "gpt-4", "low").unwrap_err();
        assert!(matches!(err, ModelError::UnknownModel(ref m) if m == "gpt-4"));
        let text = err.to_string();
        assert!(text.contains("gpt-4") && text.contains("Nothing was changed"));
        let row = row_for(&s, "save").unwrap();
        assert_eq!(pair(&row), ("save", "sonnet", "high"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn set_row_refuses_an_unknown_effort_and_keeps_the_stored_row() {
        let (s, dir) = open();
        set_row(&s, "save", "sonnet", "high").unwrap();
        let err = set_row(&s, "save", "opus", "xhigh").unwrap_err();
        assert!(matches!(err, ModelError::UnknownEffort(ref e) if e == "xhigh"));
        assert!(err.to_string().contains("Nothing was changed"));
        let row = row_for(&s, "save").unwrap();
        assert_eq!(pair(&row), ("save", "sonnet", "high"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn set_row_refuses_an_unknown_feature_and_writes_nothing() {
        let (s, dir) = open();
        let err = set_row(&s, "nope", "sonnet", "high").unwrap_err();
        assert!(matches!(err, ModelError::UnknownFeature));
        assert_eq!(s.get_setting("ai_model.nope").unwrap(), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_set_row_survives_reopening_the_same_file() {
        let (s, dir) = open();
        set_row(&s, "ask", "opus", "high").unwrap();
        drop(s);
        let s = Storage::open(&dir.join("mnemo.db")).unwrap();
        let row = row_for(&s, "ask").unwrap();
        assert_eq!(pair(&row), ("ask", "opus", "high"));
        // The rows that were not set still read as their defaults.
        assert_eq!(row_for(&s, "save"), default_row("save"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn reset_restores_every_default_and_clears_overrides() {
        let (s, dir) = open();
        s.set_setting("sidebar_collapsed", "true").unwrap();
        for d in DEFAULTS {
            set_row(&s, d.feature, "opus", "high").unwrap();
        }
        let t = reset_rows(&s).unwrap();
        assert_eq!(t.rows, DEFAULTS.to_vec());
        for d in DEFAULTS {
            assert_eq!(s.get_setting(&key(d.feature)).unwrap(), None);
        }
        // Other settings are not touched.
        assert_eq!(
            s.get_setting("sidebar_collapsed").unwrap().as_deref(),
            Some("true")
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_bad_stored_value_reads_as_the_default() {
        let (s, dir) = open();
        for bad in [
            "not json",
            r#"{"model":"gpt-4","effort":"low"}"#,
            r#"{"model":"opus","effort":"xhigh"}"#,
            r#"{"model":"opus"}"#,
        ] {
            s.set_setting("ai_model.save", bad).unwrap();
            assert_eq!(row_for(&s, "save"), default_row("save"), "{bad}");
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Reads the rows from a Storage that is shared with the test, as the app does.
    struct TestChoices(Arc<std::sync::Mutex<Storage>>);

    impl ModelChoices for TestChoices {
        fn row(&self, task: &str) -> Option<ModelRow> {
            row_for(&self.0.lock().unwrap(), task)
        }
    }

    fn save_task() -> AiTask {
        AiTask {
            name: "save".into(),
            prompt: "p".into(),
            schema: "{}".into(),
            tools: vec![],
            model: "literal".into(),
            effort: None,
            timeout: Duration::from_secs(5),
        }
    }

    #[test]
    fn the_next_run_uses_the_changed_model_and_effort() {
        let (s, dir) = open();
        let storage = Arc::new(std::sync::Mutex::new(s));
        let fake = Arc::new(FakeRunner::new(FakeResult::Valid("{}".into())));
        let runner = ConfiguredRunner::new(fake.clone(), Arc::new(TestChoices(storage.clone())));

        runner
            .run_task(&save_task(), &CancelToken::default())
            .unwrap();
        set_row(&storage.lock().unwrap(), "save", "sonnet", "high").unwrap();
        runner
            .run_task(&save_task(), &CancelToken::default())
            .unwrap();

        let seen = fake.requests();
        assert_eq!(seen.len(), 2);
        assert_eq!(seen[0].model, "haiku");
        assert_eq!(seen[0].effort.as_deref(), Some("low"));
        assert_eq!(seen[1].model, "sonnet");
        assert_eq!(seen[1].effort.as_deref(), Some("high"));
        assert_eq!(seen[1].prompt, "p");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn configure_gives_a_stream_task_the_chosen_model_and_effort() {
        let (s, dir) = open();
        let storage = Arc::new(std::sync::Mutex::new(s));
        let fake = Arc::new(FakeRunner::new(FakeResult::Valid("{}".into())));
        let runner = ConfiguredRunner::new(fake, Arc::new(TestChoices(storage.clone())));
        set_row(&storage.lock().unwrap(), "save", "opus", "high").unwrap();
        let dynamic: Arc<dyn AiRunner> = Arc::new(runner);
        let task = dynamic.configure(&save_task());
        assert_eq!(task.model, "opus");
        assert_eq!(task.effort.as_deref(), Some("high"));
        assert_eq!(task.prompt, "p");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_task_without_a_row_passes_through() {
        let (s, dir) = open();
        let storage = Arc::new(std::sync::Mutex::new(s));
        let fake = Arc::new(FakeRunner::new(FakeResult::Valid("{}".into())));
        let runner = ConfiguredRunner::new(fake.clone(), Arc::new(TestChoices(storage)));
        let mut task = save_task();
        task.name = "no_such_task".into();
        runner.run_task(&task, &CancelToken::default()).unwrap();
        let seen = fake.requests();
        assert_eq!(seen[0].model, "literal");
        assert_eq!(seen[0].effort, None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_cancel_token_reaches_the_inner_runner() {
        let (s, dir) = open();
        let storage = Arc::new(std::sync::Mutex::new(s));
        let fake = Arc::new(FakeRunner::new(FakeResult::BlockUntilCancelled));
        let runner = Arc::new(ConfiguredRunner::new(fake, Arc::new(TestChoices(storage))));
        let token = CancelToken::default();
        let (run_token, run) = (token.clone(), runner.clone());
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(run.run_task(&save_task(), &run_token));
        });
        token.cancel();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            Err(AiError::Cancelled)
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_run_cancelled_before_it_starts_never_reaches_the_inner_runner() {
        let (s, dir) = open();
        let storage = Arc::new(std::sync::Mutex::new(s));
        let fake = Arc::new(FakeRunner::new(FakeResult::Valid("{}".into())));
        let runner = ConfiguredRunner::new(fake.clone(), Arc::new(TestChoices(storage)));
        let token = CancelToken::default();
        token.cancel();
        assert_eq!(
            runner.run_task(&save_task(), &token),
            Err(AiError::Cancelled)
        );
        assert!(fake.requests().is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }
}
