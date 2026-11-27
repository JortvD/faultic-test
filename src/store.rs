use std::{
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
};

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug)]
pub struct Error(StatusCode, &'static str);

impl Error {
    pub fn invalid(message: &'static str) -> Self {
        Self(StatusCode::UNPROCESSABLE_ENTITY, message)
    }
    pub fn conflict(message: &'static str) -> Self {
        Self(StatusCode::CONFLICT, message)
    }
    pub fn unauthorized(message: &'static str) -> Self {
        Self(StatusCode::UNAUTHORIZED, message)
    }
    pub fn missing() -> Self {
        Self(StatusCode::NOT_FOUND, "Record not found.")
    }
    pub fn limited() -> Self {
        Self(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many attempts. Please try again later.",
        )
    }
    pub fn internal(error: impl std::fmt::Display) -> Self {
        eprintln!("application error: {error}");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "An unexpected error occurred.",
        )
    }
}

impl From<rusqlite::Error> for Error {
    fn from(error: rusqlite::Error) -> Self {
        Self::internal(error)
    }
}
impl From<serde_json::Error> for Error {
    fn from(error: serde_json::Error) -> Self {
        Self::internal(error)
    }
}
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"message": self.1}))).into_response()
    }
}

#[derive(Clone)]
pub struct Store(Arc<Mutex<Connection>>);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: i64,
    pub name: String,
    pub email: String,
    pub company: String,
    pub demo: bool,
}

impl Store {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let connection = Connection::open(path)?;
        connection.execute_batch(include_str!("schema.sql"))?;
        Ok(Self(Arc::new(Mutex::new(connection))))
    }
    pub fn lock(&self) -> Result<MutexGuard<'_, Connection>> {
        self.0.lock().map_err(Error::internal)
    }
    pub fn session(&self, token_hash: &str) -> Result<Option<Account>> {
        Ok(self.lock()?.query_row(
            "SELECT a.id, a.name, a.email, a.company, a.demo FROM accounts a
             JOIN sessions s ON s.account_id = a.id WHERE s.token_hash = ?1 AND s.expires > unixepoch()
             AND (a.demo = 0 OR a.created_at + 86400 > unixepoch())",
            [token_hash], |row| Ok(Account {
                id: row.get(0)?, name: row.get(1)?, email: row.get(2)?,
                company: row.get(3)?, demo: row.get(4)?,
            })
        ).optional()?)
    }
}

pub fn random(bytes: &mut [u8]) -> Result<()> {
    getrandom::fill(bytes).map_err(Error::internal)
}

pub fn required(value: &str, limit: usize, message: &'static str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > limit || value.chars().any(char::is_control) {
        return Err(Error::invalid(message));
    }
    Ok(value.to_owned())
}
