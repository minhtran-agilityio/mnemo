//! Numbered migrations. Each runs once, in its own transaction, and sets
//! `PRAGMA user_version` in that same transaction, so a failure changes nothing.

use rusqlite::Connection;

use super::error::StorageError;

/// One numbered schema change.
pub struct Migration {
    pub number: u32,
    pub sql: &'static str,
}

/// Every shipped migration, in order. Never edit one that has shipped; add a new one.
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        number: 1,
        sql: include_str!("../../migrations/0001_init.sql"),
    },
    Migration {
        number: 2,
        sql: include_str!("../../migrations/0002_settings.sql"),
    },
    Migration {
        number: 3,
        sql: include_str!("../../migrations/0003_items.sql"),
    },
    Migration {
        number: 4,
        sql: include_str!("../../migrations/0004_item_links.sql"),
    },
    Migration {
        number: 5,
        sql: include_str!("../../migrations/0005_labels.sql"),
    },
];

/// Reads the schema version stored in the database (0 for a new file).
pub fn current_version(conn: &Connection) -> Result<u32, StorageError> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

/// Fails when the stored version is newer than the newest shipped migration.
pub fn check_supported(found: u32, migrations: &[Migration]) -> Result<(), StorageError> {
    let supported = migrations.iter().map(|m| m.number).max().unwrap_or(0);
    if found > supported {
        return Err(StorageError::SchemaTooNew { found, supported });
    }
    Ok(())
}

/// Applies every migration newer than the stored version.
pub fn run(conn: &mut Connection, migrations: &[Migration]) -> Result<(), StorageError> {
    let found = current_version(conn)?;
    check_supported(found, migrations)?;
    for m in migrations.iter().filter(|m| m.number > found) {
        apply(conn, m).map_err(|e| StorageError::MigrationFailed {
            number: m.number,
            reason: e.to_string(),
        })?;
    }
    Ok(())
}

fn apply(conn: &mut Connection, m: &Migration) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute_batch(m.sql)?;
    tx.execute_batch(&format!("PRAGMA user_version = {}", m.number))?;
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        Connection::open_in_memory().unwrap()
    }

    fn table_exists(conn: &Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [name],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            > 0
    }

    #[test]
    fn real_migrations_set_the_version() {
        let mut c = mem();
        run(&mut c, MIGRATIONS).unwrap();
        assert_eq!(current_version(&c).unwrap(), 5);
    }

    #[test]
    fn migration_2_adds_settings_to_a_database_built_by_migration_1() {
        let mut c = mem();
        run(&mut c, &MIGRATIONS[..1]).unwrap();
        assert_eq!(current_version(&c).unwrap(), 1);
        assert!(!table_exists(&c, "settings"));
        run(&mut c, &MIGRATIONS[..2]).unwrap();
        assert_eq!(current_version(&c).unwrap(), 2);
        assert!(table_exists(&c, "settings"));
        run(&mut c, &MIGRATIONS[..2]).unwrap();
        assert_eq!(current_version(&c).unwrap(), 2);
    }

    #[test]
    fn a_new_migration_runs_once_and_not_again() {
        let mut c = mem();
        let one = Migration {
            number: 1,
            sql: "CREATE TABLE t (n INTEGER);",
        };
        run(&mut c, std::slice::from_ref(&one)).unwrap();
        let both = [
            one,
            Migration {
                number: 2,
                sql: "INSERT INTO t VALUES (1);",
            },
        ];
        run(&mut c, &both).unwrap();
        run(&mut c, &both).unwrap();
        let rows: i64 = c
            .query_row("SELECT count(*) FROM t", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1);
        assert_eq!(current_version(&c).unwrap(), 2);
    }

    #[test]
    fn a_failing_migration_rolls_back_and_names_the_number() {
        let mut c = mem();
        let ok = Migration {
            number: 1,
            sql: "CREATE TABLE t (n INTEGER);",
        };
        run(&mut c, std::slice::from_ref(&ok)).unwrap();
        let bad = Migration {
            number: 2,
            sql: "CREATE TABLE half (n INTEGER); INSERT INTO missing VALUES (1);",
        };
        let err = run(&mut c, &[ok, bad]).unwrap_err();
        assert!(matches!(
            err,
            StorageError::MigrationFailed { number: 2, .. }
        ));
        assert_eq!(current_version(&c).unwrap(), 1);
        assert!(!table_exists(&c, "half"));
        assert!(table_exists(&c, "t"));
    }

    #[test]
    fn a_database_from_a_newer_app_is_refused() {
        let mut c = mem();
        c.execute_batch("PRAGMA user_version = 99").unwrap();
        let err = run(&mut c, MIGRATIONS).unwrap_err();
        assert_eq!(
            err,
            StorageError::SchemaTooNew {
                found: 99,
                supported: 5
            }
        );
    }

    const KINDS: [&str; 8] = [
        "bookmark", "note", "idea", "project", "task", "event", "run", "memory",
    ];
    const T: &str = "2026-01-01T00:00:00Z";

    fn columns(c: &Connection, table: &str) -> Vec<String> {
        let mut st = c
            .prepare("SELECT name FROM pragma_table_info(?1) ORDER BY cid")
            .unwrap();
        st.query_map([table], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    }

    #[test]
    fn migration_3_adds_item_tables_to_a_database_built_by_migration_2() {
        let mut c = mem();
        run(&mut c, &MIGRATIONS[..2]).unwrap();
        c.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES ('theme', 'dark', ?1)",
            [T],
        )
        .unwrap();
        run(&mut c, &MIGRATIONS[..3]).unwrap();
        assert_eq!(current_version(&c).unwrap(), 3);
        for k in KINDS {
            assert!(table_exists(&c, k), "table {k} missing");
            let cols = columns(&c, k);
            for base in ["id", "created_at", "updated_at", "deleted_at"] {
                assert!(cols.iter().any(|n| n == base), "{k} lacks {base}");
            }
        }
        assert!(!table_exists(&c, "item_link"));
        let theme: String = c
            .query_row("SELECT value FROM settings WHERE key = 'theme'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(theme, "dark");
    }

    #[test]
    fn migration_4_adds_item_link_to_a_database_built_by_migration_3() {
        let mut c = mem();
        run(&mut c, &MIGRATIONS[..3]).unwrap();
        c.execute(
            "INSERT INTO note (id, created_at, updated_at, body) VALUES ('n1', ?1, ?1, 'kept')",
            [T],
        )
        .unwrap();
        run(&mut c, &MIGRATIONS[..4]).unwrap();
        assert_eq!(current_version(&c).unwrap(), 4);
        assert!(table_exists(&c, "item_link"));
        let body: String = c
            .query_row("SELECT body FROM note WHERE id = 'n1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(body, "kept");
    }

    fn index_exists(conn: &Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='index' AND name=?1",
            [name],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            > 0
    }

    #[test]
    fn migration_5_adds_labels_to_a_database_built_by_migration_4() {
        let mut c = mem();
        run(&mut c, &MIGRATIONS[..4]).unwrap();
        c.execute(
            "INSERT INTO note (id, created_at, updated_at, body) VALUES ('n1', ?1, ?1, 'kept')",
            [T],
        )
        .unwrap();
        assert!(!table_exists(&c, "label"));
        run(&mut c, &MIGRATIONS[..5]).unwrap();
        assert_eq!(current_version(&c).unwrap(), 5);
        let body: String = c
            .query_row(
                "SELECT body FROM note WHERE id = 'n1' AND deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(body, "kept");
        assert!(table_exists(&c, "label"));
        assert!(table_exists(&c, "note_label"));
        assert_eq!(
            columns(&c, "label"),
            [
                "id",
                "created_at",
                "updated_at",
                "deleted_at",
                "name",
                "parent_id"
            ]
        );
        for i in [
            "uq_label_child",
            "uq_label_top",
            "idx_label_parent",
            "idx_note_label_label",
            "idx_note_label_note",
            "idx_note_changed",
        ] {
            assert!(index_exists(&c, i), "index {i} missing");
        }
    }

    #[test]
    fn migration_5_label_names_are_unique_per_parent_ignoring_case() {
        let mut c = mem();
        run(&mut c, MIGRATIONS).unwrap();
        let add = |id: &str, name: &str, parent: Option<&str>, deleted: Option<&str>| {
            c.execute(
                "INSERT INTO label (id, created_at, updated_at, deleted_at, name, parent_id)
                 VALUES (?1, ?2, ?2, ?3, ?4, ?5)",
                rusqlite::params![id, T, deleted, name, parent],
            )
        };
        add("t1", "Work", None, None).unwrap();
        assert!(add("t2", "work", None, None).is_err());
        add("t3", "Home", None, None).unwrap();
        add("c1", "Plans", Some("t1"), None).unwrap();
        assert!(add("c2", "PLANS", Some("t1"), None).is_err());
        add("c3", "Plans", Some("t3"), None).unwrap();
        // A deleted label frees its name.
        add("t4", "Old", None, Some(T)).unwrap();
        add("t5", "Old", None, None).unwrap();
    }

    #[test]
    fn all_migrations_on_a_version_2_database_keep_settings_and_add_9_tables() {
        let mut c = mem();
        run(&mut c, &MIGRATIONS[..2]).unwrap();
        c.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES ('theme', 'dark', ?1)",
            [T],
        )
        .unwrap();
        run(&mut c, MIGRATIONS).unwrap();
        assert_eq!(current_version(&c).unwrap(), 5);
        for t in KINDS.iter().chain(["item_link", "settings"].iter()) {
            assert!(table_exists(&c, t), "table {t} missing");
        }
        let n: i64 = c
            .query_row("SELECT count(*) FROM settings", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn memory_table_has_only_the_base_fields_and_a_body() {
        let mut c = mem();
        run(&mut c, MIGRATIONS).unwrap();
        assert_eq!(
            columns(&c, "memory"),
            ["id", "created_at", "updated_at", "deleted_at", "body"]
        );
    }

    #[test]
    fn item_table_checks_refuse_bad_rows() {
        let mut c = mem();
        run(&mut c, MIGRATIONS).unwrap();
        let bad = [
            "INSERT INTO idea (id, created_at, updated_at, title, stage) VALUES ('i', ?1, ?1, 't', 'nonsense')",
            "INSERT INTO run (id, created_at, updated_at, task_type, started_at, outcome) VALUES ('r', ?1, ?1, 'x', ?1, 'weird')",
            "INSERT INTO run (id, created_at, updated_at, task_type, started_at, duration_ms) VALUES ('r', ?1, ?1, 'x', ?1, -1)",
            "INSERT INTO bookmark (id, created_at, updated_at, url, reason_is_guess) VALUES ('b', ?1, ?1, 'https://a.b', 2)",
            "INSERT INTO item_link (id, a_kind, a_id, b_kind, b_id, created_at, updated_at) VALUES ('l', 'folder', 'f', 'note', 'n', ?1, ?1)",
            "INSERT INTO item_link (id, a_kind, a_id, b_kind, b_id, created_at, updated_at) VALUES ('l', 'note', 'n', 'note', 'n', ?1, ?1)",
        ];
        for sql in bad {
            assert!(c.execute(sql, [T]).is_err(), "accepted: {sql}");
        }
        // The same rows with good values are accepted.
        let good = [
            "INSERT INTO idea (id, created_at, updated_at, title, stage) VALUES ('i', ?1, ?1, 't', 'ready')",
            "INSERT INTO run (id, created_at, updated_at, task_type, started_at, duration_ms, outcome) VALUES ('r', ?1, ?1, 'x', ?1, 0, 'ok')",
            "INSERT INTO bookmark (id, created_at, updated_at, url, reason_is_guess) VALUES ('b', ?1, ?1, 'https://a.b', 1)",
            "INSERT INTO item_link (id, a_kind, a_id, b_kind, b_id, created_at, updated_at) VALUES ('l', 'note', 'n', 'task', 'n', ?1, ?1)",
        ];
        for sql in good {
            c.execute(sql, [T]).unwrap();
        }
    }
}
