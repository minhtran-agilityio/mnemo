//! Only the `storage` module may use the SQLite library. This test scans the Rust
//! sources and fails when any file outside `src/storage/` mentions `rusqlite`.

use std::fs;
use std::path::{Path, PathBuf};

const FORBIDDEN: &str = "rusqlite";

/// Returns every `.rs` file under `src_root` outside `<src_root>/storage` that mentions the SQLite crate.
fn violations(src_root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    scan(src_root, &src_root.join("storage"), &mut found);
    found
}

fn scan(dir: &Path, skip: &Path, found: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).expect("read source folder") {
        let path = entry.expect("read entry").path();
        if path == skip {
            continue;
        }
        if path.is_dir() {
            scan(&path, skip, found);
        } else if path.extension().is_some_and(|e| e == "rs")
            && fs::read_to_string(&path)
                .expect("read source file")
                .contains(FORBIDDEN)
        {
            found.push(path);
        }
    }
}

fn temp_tree() -> PathBuf {
    let root = std::env::temp_dir().join(format!("mnemo-boundary-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("storage")).unwrap();
    fs::create_dir_all(root.join("ai")).unwrap();
    root
}

#[test]
fn real_sources_keep_sqlite_inside_storage() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    assert!(src.join("storage").is_dir(), "storage folder must exist");
    assert_eq!(violations(&src), Vec::<PathBuf>::new());
}

#[test]
fn use_inside_storage_is_allowed() {
    let root = temp_tree();
    fs::write(root.join("storage/mod.rs"), "use rusqlite::Connection;").unwrap();
    assert!(violations(&root).is_empty());
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn planted_violation_outside_storage_is_caught() {
    let root = temp_tree();
    let bad = root.join("ai/mod.rs");
    fs::write(
        &bad,
        "fn f() { let _ = rusqlite::Connection::open_in_memory(); }",
    )
    .unwrap();
    assert_eq!(violations(&root), vec![bad]);
    fs::remove_dir_all(&root).unwrap();
}
