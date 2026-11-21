// Mnemo's own Claude config: the three files every `claude -p` run uses instead of the owner's
// personal Claude Code setup.
//
// The files live in `config_dir` (`~/.config/mnemo`, built by `system::paths`):
// - `settings.json`: passed with `--settings`.
// - `mcp.json`: passed with `--mcp-config` (with `--strict-mcp-config`), no connectors by default.
// - `allowed-tools.json`: the tools each feature may use. An empty list means no tool.
//
// Mnemo creates each file once (`create_new`, owner-only) and never rewrites it, so the owner's
// edits stay. This module never reads `~/.claude`, a credentials file or an environment token,
// and it writes only the fixed text below.

use std::collections::BTreeMap;
use std::fmt;
use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

const SETTINGS_FILE: &str = "settings.json";
const MCP_FILE: &str = "mcp.json";
const ALLOWED_TOOLS_FILE: &str = "allowed-tools.json";

// The effect of `disableAllHooks` in a `--settings` file is Unverified until a real run.
const DEFAULT_SETTINGS: &str = "{\n  \"disableAllHooks\": true\n}\n";
const DEFAULT_MCP: &str = "{\n  \"mcpServers\": {}\n}\n";
const DEFAULT_ALLOWED_TOOLS: &str = "{\n  \"test_prompt\": []\n}\n";

/// The place of Mnemo's three Claude config files.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeConfig {
    dir: PathBuf,
    settings: PathBuf,
    mcp: PathBuf,
    allowed_tools: PathBuf,
}

impl ClaudeConfig {
    fn in_dir(dir: &Path) -> Self {
        ClaudeConfig {
            dir: dir.to_path_buf(),
            settings: dir.join(SETTINGS_FILE),
            mcp: dir.join(MCP_FILE),
            allowed_tools: dir.join(ALLOWED_TOOLS_FILE),
        }
    }

    #[cfg(test)]
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn settings_path(&self) -> &Path {
        &self.settings
    }

    pub fn mcp_path(&self) -> &Path {
        &self.mcp
    }

    pub fn allowed_tools_path(&self) -> &Path {
        &self.allowed_tools
    }

    /// True when all three files are there as regular files. A run starts only then.
    pub fn is_ready(&self) -> bool {
        [&self.settings, &self.mcp, &self.allowed_tools]
            .iter()
            .all(|p| p.is_file())
    }
}

/// Makes `config_dir` (owner-only) and each missing file with its default. A file that is
/// already there is not touched. A path that is a file, or a folder that cannot be made, is an
/// error.
pub fn ensure_config(config_dir: &Path) -> io::Result<ClaudeConfig> {
    std::fs::create_dir_all(config_dir)?;
    if !config_dir.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the config path is not a folder",
        ));
    }
    restrict_dir(config_dir)?;
    let config = ClaudeConfig::in_dir(config_dir);
    create_once(&config.settings, DEFAULT_SETTINGS)?;
    create_once(&config.mcp, DEFAULT_MCP)?;
    create_once(&config.allowed_tools, DEFAULT_ALLOWED_TOOLS)?;
    Ok(config)
}

/// Writes `text` to a new owner-only file. `AlreadyExists` keeps the owner's file as it is.
fn create_once(path: &Path, text: &str) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(path) {
        Ok(mut file) => file.write_all(text.as_bytes()),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(unix)]
fn restrict_dir(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn restrict_dir(_path: &Path) -> io::Result<()> {
    Ok(())
}

/// Why `allowed-tools.json` could not be used.
#[derive(Debug, PartialEq, Eq)]
pub enum ConfigError {
    /// The file could not be read.
    Unreadable,
    /// The file is not a JSON object of feature names to tool lists.
    Invalid,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigError::Unreadable => write!(f, "allowed-tools.json could not be read"),
            ConfigError::Invalid => write!(f, "allowed-tools.json is not valid"),
        }
    }
}

impl std::error::Error for ConfigError {}

/// The tools each feature may use. The file is never repaired: a bad file is an error.
#[allow(dead_code)] // The features that use the list land in AI-03 and later.
pub fn load_allowed_tools(
    config: &ClaudeConfig,
) -> Result<BTreeMap<String, Vec<String>>, ConfigError> {
    let text = std::fs::read_to_string(config.allowed_tools_path())
        .map_err(|_| ConfigError::Unreadable)?;
    serde_json::from_str(&text).map_err(|_| ConfigError::Invalid)
}

/// A config in a new temp folder, for the tests of the run args.
#[cfg(test)]
pub(crate) fn test_config() -> ClaudeConfig {
    let dir = std::env::temp_dir().join(format!("mnemo-test-config-{}", uuid::Uuid::new_v4()));
    ensure_config(&dir).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("mnemo-config-{name}-{}", uuid::Uuid::new_v4()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn files(c: &ClaudeConfig) -> [&Path; 3] {
        [c.settings_path(), c.mcp_path(), c.allowed_tools_path()]
    }

    #[test]
    fn first_start_creates_the_three_files_with_the_defaults() {
        let dir = temp_dir("first").join("mnemo");
        let c = ensure_config(&dir).unwrap();
        assert!(c.is_ready());
        assert_eq!(
            std::fs::read_to_string(c.settings_path()).unwrap(),
            DEFAULT_SETTINGS
        );
        assert_eq!(std::fs::read_to_string(c.mcp_path()).unwrap(), DEFAULT_MCP);
        assert_eq!(
            std::fs::read_to_string(c.allowed_tools_path()).unwrap(),
            DEFAULT_ALLOWED_TOOLS
        );
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn the_default_mcp_file_is_exactly_an_empty_mcp_servers_object() {
        let dir = temp_dir("mcp");
        let c = ensure_config(&dir).unwrap();
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(c.mcp_path()).unwrap()).unwrap();
        assert_eq!(v, serde_json::json!({ "mcpServers": {} }));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn the_config_dir_is_mode_0700_and_each_file_is_mode_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("mode");
        // A folder that others could open is made owner-only.
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        let c = ensure_config(&dir).unwrap();
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&dir), 0o700);
        for f in files(&c) {
            assert_eq!(mode(f), 0o600, "{f:?}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_start_keeps_the_owner_edits_of_each_file() {
        let dir = temp_dir("edit");
        let c = ensure_config(&dir).unwrap();
        for (i, f) in files(&c).iter().enumerate() {
            std::fs::write(f, format!("{{\"edited\": {i}}}")).unwrap();
        }
        let again = ensure_config(&dir).unwrap();
        assert_eq!(again, c);
        for (i, f) in files(&again).iter().enumerate() {
            assert_eq!(
                std::fs::read_to_string(f).unwrap(),
                format!("{{\"edited\": {i}}}")
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_start_with_one_file_missing_creates_only_that_file() {
        let dir = temp_dir("missing");
        let c = ensure_config(&dir).unwrap();
        std::fs::write(c.settings_path(), "{\"edited\": true}").unwrap();
        std::fs::remove_file(c.mcp_path()).unwrap();
        assert!(!c.is_ready());
        ensure_config(&dir).unwrap();
        assert!(c.is_ready());
        assert_eq!(
            std::fs::read_to_string(c.settings_path()).unwrap(),
            "{\"edited\": true}"
        );
        assert_eq!(std::fs::read_to_string(c.mcp_path()).unwrap(), DEFAULT_MCP);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_config_dir_that_is_a_file_cannot_be_made() {
        let file = temp_dir("isfile");
        std::fs::write(&file, "not a folder").unwrap();
        assert!(ensure_config(&file).is_err());
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn a_file_that_cannot_be_created_is_an_error_and_not_ready() {
        let dir = temp_dir("blocked");
        std::fs::create_dir_all(dir.join(MCP_FILE)).unwrap();
        assert!(ensure_config(&dir).is_err() || !ClaudeConfig::in_dir(&dir).is_ready());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_written_files_hold_no_token_secret_or_credential_word() {
        let dir = temp_dir("token");
        let c = ensure_config(&dir).unwrap();
        for f in files(&c) {
            let text = std::fs::read_to_string(f).unwrap().to_lowercase();
            for word in [
                "token",
                "api_key",
                "apikey",
                "sk-ant",
                "oauth",
                "anthropic_",
                "secret",
            ] {
                assert!(!text.contains(word), "{f:?} holds {word}");
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_loader_accepts_the_default_and_rejects_bad_json() {
        let dir = temp_dir("loader");
        let c = ensure_config(&dir).unwrap();
        let tools = load_allowed_tools(&c).unwrap();
        assert_eq!(tools.get("test_prompt"), Some(&Vec::new()));
        for bad in ["not json", "[1]", "{\"a\": \"Read\"}"] {
            std::fs::write(c.allowed_tools_path(), bad).unwrap();
            assert_eq!(load_allowed_tools(&c), Err(ConfigError::Invalid), "{bad}");
        }
        // The bad file is not repaired.
        assert_eq!(
            std::fs::read_to_string(c.allowed_tools_path()).unwrap(),
            "{\"a\": \"Read\"}"
        );
        std::fs::remove_file(c.allowed_tools_path()).unwrap();
        assert_eq!(load_allowed_tools(&c), Err(ConfigError::Unreadable));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
