// The folder one `claude -p` run starts in.
//
// `claude -p` runs with `--setting-sources project`, so it reads `.claude/settings.json` from
// the folder it starts in, and it reads CLAUDE.md files from that folder and the folders above
// it. A folder that another account can write to (such as `/tmp`) would let that account add
// hooks (shell commands run as the owner), widen the allowed tools, or add instructions to every
// prompt. So each run starts in a new, empty folder that only the owner can open, inside
// Mnemo's own data folder (never `/tmp`, never an owner project folder). The folder is removed
// when the run ends.

use std::io;
use std::path::{Path, PathBuf};

/// One new, empty, owner-only folder for one run. Dropping it removes the folder.
#[derive(Debug)]
pub struct RunDir {
    path: PathBuf,
}

impl RunDir {
    /// Makes `parent` (owner-only) if needed, then a new folder inside it. The new folder is
    /// made with `create_dir`, not `create_dir_all`, so a folder that is already there (made by
    /// someone else) is an error and is never used.
    pub fn create(parent: &Path) -> io::Result<RunDir> {
        std::fs::create_dir_all(parent)?;
        restrict_to_owner(parent)?;
        let path = parent.join(format!("run-{}", uuid::Uuid::new_v4()));
        make_private_dir(&path)?;
        Ok(RunDir { path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for RunDir {
    fn drop(&mut self) {
        // Best effort: a left-over empty folder in Mnemo's own data folder is harmless.
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[cfg(unix)]
fn make_private_dir(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    std::fs::DirBuilder::new().mode(0o700).create(path)?;
    // The mode given to mkdir is reduced by the umask; set it again to be sure.
    restrict_to_owner(path)
}

#[cfg(not(unix))]
fn make_private_dir(path: &Path) -> io::Result<()> {
    std::fs::create_dir(path)
}

#[cfg(unix)]
fn restrict_to_owner(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn restrict_to_owner(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn parent(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("mnemo-rundir-{name}-{}", uuid::Uuid::new_v4()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn mode(path: &Path) -> u32 {
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn a_run_dir_is_new_empty_owner_only_and_inside_the_parent() {
        let parent = parent("new");
        let dir = RunDir::create(&parent).unwrap();
        assert!(dir.path().starts_with(&parent));
        assert!(dir.path().is_dir());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        assert_eq!(mode(dir.path()), 0o700);
        assert_eq!(mode(&parent), 0o700);
        drop(dir);
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn a_run_dir_is_removed_when_the_run_ends() {
        let parent = parent("drop");
        let dir = RunDir::create(&parent).unwrap();
        let path = dir.path().to_path_buf();
        std::fs::write(path.join("left-over"), "x").unwrap();
        drop(dir);
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn two_runs_get_two_different_folders() {
        let parent = parent("two");
        let a = RunDir::create(&parent).unwrap();
        let b = RunDir::create(&parent).unwrap();
        assert_ne!(a.path(), b.path());
        drop((a, b));
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn a_parent_others_could_write_to_is_made_owner_only() {
        let parent = parent("open");
        std::fs::create_dir_all(&parent).unwrap();
        std::fs::set_permissions(&parent, std::fs::Permissions::from_mode(0o777)).unwrap();
        let dir = RunDir::create(&parent).unwrap();
        assert_eq!(mode(&parent), 0o700);
        drop(dir);
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn a_parent_that_cannot_be_made_is_an_error() {
        let file = parent("file");
        std::fs::write(&file, "not a folder").unwrap();
        assert!(RunDir::create(&file).is_err());
        let _ = std::fs::remove_file(&file);
    }
}
