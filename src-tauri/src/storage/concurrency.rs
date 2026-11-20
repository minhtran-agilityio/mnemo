//! Two-writer safety. Each writer (the window, a background job) opens its own
//! `Storage`, so it has its own connection. The tests prove that parallel writers
//! lose nothing and never get a "database is locked" error.

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::{Arc, Barrier};
use std::thread;

use super::items::{Idea, IdeaInput, IdeaStage, Item, Note, NoteInput};
use super::record::PageRequest;
use super::testing::TempDir;
use super::{Storage, StorageError};

const SAVES: usize = 100;

fn note(body: String) -> NoteInput {
    NoteInput { body }
}

/// Every live item of one type, read page by page.
fn all<T: Item>(s: &Storage) -> Vec<T> {
    let mut out = Vec::new();
    let mut page = PageRequest::first(100);
    loop {
        let p = s.list::<T>(&page, false).unwrap();
        out.extend(p.items);
        match p.next {
            Some(c) => page.after = Some(c),
            None => return out,
        }
    }
}

/// Runs each job on its own thread with its own connection, all starting together.
/// Returns the jobs' results; a panic in a job fails the test.
fn run_writers<R: Send + 'static>(
    path: &Path,
    jobs: Vec<Box<dyn FnOnce(Storage) -> R + Send>>,
) -> Vec<R> {
    let barrier = Arc::new(Barrier::new(jobs.len()));
    let handles: Vec<_> = jobs
        .into_iter()
        .map(|job| {
            let path = path.to_path_buf();
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                let s = Storage::open(&path).unwrap();
                // Test only: no fsync per commit. On a busy disk an fsync can hold the
                // write lock for longer than the 5 s busy timeout, which would make this
                // test depend on the machine. The locking under test is unchanged.
                s.conn.execute_batch("PRAGMA synchronous = OFF").unwrap();
                barrier.wait();
                job(s)
            })
        })
        .collect();
    handles.into_iter().map(|h| h.join().unwrap()).collect()
}

fn save_notes(prefix: &'static str) -> Box<dyn FnOnce(Storage) -> Vec<StorageError> + Send> {
    Box::new(move |s| {
        (0..SAVES)
            .filter_map(|i| s.add::<Note>(&note(format!("{prefix}-{i}"))).err())
            .collect()
    })
}

fn save_ideas(prefix: &'static str) -> Box<dyn FnOnce(Storage) -> Vec<StorageError> + Send> {
    Box::new(move |s| {
        (0..SAVES)
            .filter_map(|i| {
                s.add::<Idea>(&IdeaInput {
                    title: format!("{prefix}-{i}"),
                    stage: IdeaStage::Spark,
                })
                .err()
            })
            .collect()
    })
}

fn expected(prefixes: &[&str]) -> BTreeSet<String> {
    prefixes
        .iter()
        .flat_map(|p| (0..SAVES).map(move |i| format!("{p}-{i}")))
        .collect()
}

#[test]
fn two_writers_saving_to_the_same_table_lose_nothing() {
    let dir = TempDir::new();
    let path = dir.path().join("mnemo.db");
    drop(Storage::open(&path).unwrap());

    let errors = run_writers(&path, vec![save_notes("window"), save_notes("job")]);
    assert!(errors.iter().all(Vec::is_empty), "save errors: {errors:?}");

    let check = Storage::open(&path).unwrap();
    let bodies: Vec<String> = all::<Note>(&check).into_iter().map(|n| n.body).collect();
    assert_eq!(bodies.len(), 2 * SAVES);
    assert_eq!(
        bodies.into_iter().collect::<BTreeSet<_>>(),
        expected(&["window", "job"])
    );
}

#[test]
fn two_writers_saving_to_different_tables_lose_nothing() {
    let dir = TempDir::new();
    let path = dir.path().join("mnemo.db");
    drop(Storage::open(&path).unwrap());

    let errors = run_writers(&path, vec![save_notes("window"), save_ideas("job")]);
    assert!(errors.iter().all(Vec::is_empty), "save errors: {errors:?}");

    let check = Storage::open(&path).unwrap();
    let notes: BTreeSet<String> = all::<Note>(&check).into_iter().map(|n| n.body).collect();
    let ideas: BTreeSet<String> = all::<Idea>(&check).into_iter().map(|i| i.title).collect();
    assert_eq!(notes, expected(&["window"]));
    assert_eq!(ideas, expected(&["job"]));
}

#[test]
fn deleting_while_another_writer_saves_loses_nothing() {
    let dir = TempDir::new();
    let path = dir.path().join("mnemo.db");
    let setup = Storage::open(&path).unwrap();
    let doomed: Vec<String> = (0..SAVES)
        .map(|i| {
            setup
                .add::<Note>(&note(format!("old-{i}")))
                .unwrap()
                .base
                .id
        })
        .collect();
    drop(setup);

    let deleter: Box<dyn FnOnce(Storage) -> Vec<StorageError> + Send> = Box::new(move |mut s| {
        doomed
            .iter()
            .filter_map(|id| s.delete::<Note>(id).err())
            .collect()
    });
    let errors = run_writers(&path, vec![deleter, save_notes("new")]);
    assert!(errors.iter().all(Vec::is_empty), "errors: {errors:?}");

    let check = Storage::open(&path).unwrap();
    let live: BTreeSet<String> = all::<Note>(&check).into_iter().map(|n| n.body).collect();
    assert_eq!(live, expected(&["new"]));
}

#[test]
fn a_reader_sees_whole_records_while_another_writer_updates_one() {
    let dir = TempDir::new();
    let path = dir.path().join("mnemo.db");
    let setup = Storage::open(&path).unwrap();
    for i in 0..20 {
        setup.add::<Note>(&note(format!("seed-{i}"))).unwrap();
    }
    let target = setup
        .add::<Note>(&note("version-0".into()))
        .unwrap()
        .base
        .id;
    drop(setup);

    let id = target.clone();
    let updater: Box<dyn FnOnce(Storage) -> usize + Send> = Box::new(move |s| {
        for v in 1..=SAVES {
            s.update::<Note>(&id, &note(format!("version-{v}")))
                .unwrap();
        }
        0
    });
    let id = target.clone();
    let reader: Box<dyn FnOnce(Storage) -> usize + Send> = Box::new(move |s| {
        let mut seen = 0;
        for _ in 0..SAVES {
            let notes = all::<Note>(&s);
            assert_eq!(notes.len(), 21, "a read must see every record");
            let mine = notes.iter().find(|n| n.base.id == id).unwrap();
            assert!(
                mine.body.starts_with("version-"),
                "half-written: {}",
                mine.body
            );
            seen += 1;
        }
        seen
    });
    let results = run_writers(&path, vec![updater, reader]);
    assert_eq!(results[1], SAVES);

    let check = Storage::open(&path).unwrap();
    assert_eq!(
        check.get::<Note>(&target).unwrap().body,
        format!("version-{SAVES}")
    );
}
