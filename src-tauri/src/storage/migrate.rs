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
pub const MIGRATIONS: &[Migration] = &[Migration {
    number: 1,
    sql: include_str!("../../migrations/0001_init.sql"),
}];

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
        assert_eq!(current_version(&c).unwrap(), 1);
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
                supported: 1
            }
        );
    }
}
