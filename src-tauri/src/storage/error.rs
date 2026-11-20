//! Typed errors for the storage module. Messages are plain and carry no file paths.

use std::fmt;

#[derive(Debug, PartialEq, Eq)]
pub enum StorageError {
    /// The file or folder could not be opened as a Mnemo database. Nothing was changed.
    Open(String),
    /// A migration failed and was rolled back.
    MigrationFailed { number: u32, reason: String },
    /// The database was written by a newer Mnemo than this one.
    SchemaTooNew { found: u32, supported: u32 },
    /// Any other database error.
    Database(String),
    /// The record does not exist or was deleted. `kind` names its type, for example "note".
    NotFound { kind: &'static str },
    /// The input was refused before anything was written. The text says why and is
    /// safe to show: it never names a file path or SQL.
    Invalid(String),
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StorageError::Open(why) => write!(
                f,
                "Mnemo could not open its data file. The file was left as it is. Reason: {why}"
            ),
            StorageError::MigrationFailed { number, reason } => write!(
                f,
                "Database update {number} failed and was undone. Your data is unchanged. Reason: {reason}"
            ),
            StorageError::SchemaTooNew { found, supported } => write!(
                f,
                "The data file is from a newer Mnemo (version {found}; this app supports up to {supported}). Update Mnemo."
            ),
            StorageError::Database(why) => write!(f, "Database error: {why}"),
            StorageError::NotFound { kind } => {
                write!(f, "There is no such {kind}. It may have been deleted.")
            }
            StorageError::Invalid(why) => write!(f, "{why}"),
        }
    }
}

impl std::error::Error for StorageError {}

impl From<rusqlite::Error> for StorageError {
    fn from(e: rusqlite::Error) -> Self {
        StorageError::Database(e.to_string())
    }
}
