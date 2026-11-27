use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use crate::{
    App,
    auth::SignedIn,
    store::{Error, Result, required},
};

#[derive(Deserialize, Serialize)]
pub struct ContactInput {
    name: String,
    city: String,
    address: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    phone: String,
}

#[derive(Serialize)]
pub struct Contact {
    id: i64,
    version: u32,
    #[serde(flatten)]
    fields: ContactInput,
}

impl ContactInput {
    fn validate(&mut self) -> Result<()> {
        self.name = required(&self.name, 100, "Enter a name of up to 100 characters.")?;
        self.city = required(
            &self.city,
            100,
            "Enter a city and region of up to 100 characters.",
        )?;
        self.address = required(
            &self.address,
            240,
            "Enter a street address of up to 240 characters.",
        )?;
        self.email = optional(&self.email, 254, "Enter a valid email address.")?;
        self.phone = optional(
            &self.phone,
            48,
            "Enter a phone number of up to 48 characters.",
        )?;
        if !self.email.is_empty() {
            let (local, domain) = self.email.split_once('@').unwrap_or_default();
            if local.is_empty()
                || domain.is_empty()
                || domain.contains('@')
                || self.email.chars().any(char::is_whitespace)
            {
                return Err(Error::invalid("Enter a valid email address."));
            }
        }
        Ok(())
    }
}

fn optional(value: &str, limit: usize, message: &'static str) -> Result<String> {
    if value.trim().is_empty() {
        return Ok(String::new());
    }
    required(value, limit, message)
}

fn row_contact(row: &Row<'_>) -> rusqlite::Result<Contact> {
    Ok(Contact {
        id: row.get(0)?,
        version: row.get(1)?,
        fields: ContactInput {
            name: row.get(2)?,
            city: row.get(3)?,
            address: row.get(4)?,
            email: row.get(5)?,
            phone: row.get(6)?,
        },
    })
}

fn lookup(db: &Connection, account: i64, id: i64) -> Result<Contact> {
    db.query_row("SELECT id, version, name, city, address, email, phone FROM contacts WHERE account_id = ?1 AND id = ?2",
        params![account, id], row_contact).optional()?.ok_or_else(Error::missing)
}

pub async fn list(
    State(app): State<App>,
    SignedIn(account): SignedIn,
) -> Result<Json<Vec<Contact>>> {
    let db = app.store.lock()?;
    let mut stmt = db.prepare(
        "SELECT id, version, name, city, address, email, phone FROM contacts
                               WHERE account_id = ?1 ORDER BY name COLLATE NOCASE, id",
    )?;
    let contacts = stmt
        .query_map([account.id], row_contact)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Json(contacts))
}

pub async fn create(
    State(app): State<App>,
    SignedIn(account): SignedIn,
    Json(mut input): Json<ContactInput>,
) -> Result<(StatusCode, Json<Contact>)> {
    input.validate()?;
    let mut db = app.store.lock()?;
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let total: u32 = tx.query_row(
        "SELECT count(*) FROM contacts WHERE account_id = ?1",
        [account.id],
        |row| row.get(0),
    )?;
    if total >= 500 {
        return Err(Error::conflict(
            "This workspace has reached its 500 contact limit.",
        ));
    }
    tx.execute("INSERT INTO contacts(account_id, name, city, address, email, phone) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![account.id, input.name, input.city, input.address, input.email, input.phone])?;
    let contact = lookup(&tx, account.id, tx.last_insert_rowid())?;
    tx.commit()?;
    Ok((StatusCode::CREATED, Json(contact)))
}

#[derive(Deserialize)]
pub struct Edit {
    version: u32,
    #[serde(flatten)]
    fields: ContactInput,
}

#[derive(Deserialize)]
pub struct Version {
    version: u32,
}

pub async fn edit(
    State(app): State<App>,
    SignedIn(account): SignedIn,
    Path(id): Path<i64>,
    Json(mut input): Json<Edit>,
) -> Result<Json<Contact>> {
    input.fields.validate()?;
    let mut db = app.store.lock()?;
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    check_version(&tx, account.id, id, input.version)?;
    tx.execute("UPDATE contacts SET name = ?1, city = ?2, address = ?3, email = ?4, phone = ?5, version = version + 1
                WHERE account_id = ?6 AND id = ?7", params![input.fields.name, input.fields.city, input.fields.address,
                input.fields.email, input.fields.phone, account.id, id])?;
    let contact = lookup(&tx, account.id, id)?;
    tx.commit()?;
    Ok(Json(contact))
}

pub async fn remove(
    State(app): State<App>,
    SignedIn(account): SignedIn,
    Path(id): Path<i64>,
    Json(input): Json<Version>,
) -> Result<StatusCode> {
    let mut db = app.store.lock()?;
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    check_version(&tx, account.id, id, input.version)?;
    tx.execute(
        "DELETE FROM contacts WHERE account_id = ?1 AND id = ?2",
        params![account.id, id],
    )?;
    tx.commit()?;
    Ok(StatusCode::NO_CONTENT)
}

fn check_version(db: &Connection, account: i64, id: i64, expected: u32) -> Result<()> {
    let found = lookup(db, account, id)?;
    if found.version != expected {
        return Err(Error::conflict(
            "This contact changed. Reload it and try again.",
        ));
    }
    Ok(())
}

pub fn seed(db: &Connection, owner: i64, name: &str, city: &str, address: &str) -> Result<()> {
    db.execute("INSERT INTO contacts(account_id, name, city, address, email, phone) VALUES (?1, ?2, ?3, ?4, '', '')",
        params![owner, name, city, address])?;
    Ok(())
}
