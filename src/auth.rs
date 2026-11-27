use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    num::NonZeroU32,
    time::{Duration, Instant},
};

use axum::{
    Json,
    extract::{ConnectInfo, FromRequestParts, State},
    http::{HeaderMap, HeaderValue, header, request::Parts},
    response::{IntoResponse, Response},
};
use ring::{digest, pbkdf2};
use rusqlite::{OptionalExtension, params};
use serde::Deserialize;

use crate::{
    App, shipments,
    store::{Account, Error, Result, random, required},
};

const COOKIE: &str = "fieldline_session";
const LIFETIME: u64 = 7 * 24 * 60 * 60;
const DEMO_LIFETIME: u64 = 24 * 60 * 60;
const ITERATIONS: NonZeroU32 = NonZeroU32::new(600_000).unwrap();

#[derive(Default)]
pub struct Limits(HashMap<IpAddr, (Instant, u8)>);

impl Limits {
    fn take(&mut self, ip: IpAddr) -> Result<()> {
        let now = Instant::now();
        self.0
            .retain(|_, (start, _)| now.duration_since(*start) < Duration::from_secs(300));
        if self.0.len() >= 4096 && !self.0.contains_key(&ip) {
            return Err(Error::limited());
        }
        let (_, attempts) = self.0.entry(ip).or_insert((now, 0));
        if *attempts >= 20 {
            return Err(Error::limited());
        }
        *attempts += 1;
        Ok(())
    }
}

fn hash_password(password: &str) -> Result<String> {
    let mut salt = [0; 16];
    random(&mut salt)?;
    let mut output = [0; 32];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        ITERATIONS,
        &salt,
        password.as_bytes(),
        &mut output,
    );
    Ok(format!("{}:{}", hex::encode(salt), hex::encode(output)))
}

fn verify_password(password: &str, stored: Option<&str>) -> bool {
    let (salt, hash) = stored
        .and_then(|stored| stored.split_once(':'))
        .and_then(|(salt, hash)| Some((hex::decode(salt).ok()?, hex::decode(hash).ok()?)))
        .unwrap_or_else(|| (vec![0; 16], vec![0; 32]));
    let valid = pbkdf2::verify(
        pbkdf2::PBKDF2_HMAC_SHA256,
        ITERATIONS,
        &salt,
        password.as_bytes(),
        &hash,
    )
    .is_ok();
    valid && stored.is_some()
}

fn token(headers: &HeaderMap) -> Option<String> {
    let value = headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|part| part.trim().split_once('='))
        .find_map(|(name, value)| (name == COOKIE).then_some(value))?;
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some(token_hash(value))
}

fn token_hash(value: &str) -> String {
    hex::encode(digest::digest(&digest::SHA256, value.as_bytes()))
}

fn cookie(value: &str, age: u64, secure: bool) -> Result<HeaderValue> {
    let secure = if secure { "; Secure" } else { "" };
    HeaderValue::from_str(&format!(
        "{COOKIE}={value}; Path=/; HttpOnly; SameSite=Strict; Max-Age={age}{secure}"
    ))
    .map_err(Error::internal)
}

fn start_session(
    app: &App,
    headers: &HeaderMap,
    account: Account,
    expected_password: Option<&str>,
) -> Result<Response> {
    let mut bytes = [0; 32];
    random(&mut bytes)?;
    let value = hex::encode(bytes);
    let age = if account.demo {
        DEMO_LIFETIME
    } else {
        LIFETIME
    };
    let response_cookie = cookie(&value, age, app.secure_cookies)?;
    let mut db = app.store.lock()?;
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(expected) = expected_password {
        let stored: String = tx.query_row(
            "SELECT password FROM accounts WHERE id = ?1",
            [account.id],
            |row| row.get(0),
        )?;
        if stored != expected {
            return Err(Error::unauthorized("The email or password is incorrect."));
        }
    }
    if let Some(old_session) = token(headers) {
        tx.execute("DELETE FROM sessions WHERE token_hash = ?1", [old_session])?;
    }
    tx.execute("DELETE FROM sessions WHERE expires <= unixepoch()", [])?;
    tx.execute(
        "INSERT INTO sessions VALUES (?1, ?2, unixepoch() + ?3)",
        params![token_hash(&value), account.id, age],
    )?;
    tx.commit()?;
    Ok(([(header::SET_COOKIE, response_cookie)], Json(account)).into_response())
}

pub struct SignedIn(pub Account);

impl FromRequestParts<App> for SignedIn {
    type Rejection = Error;
    async fn from_request_parts(parts: &mut Parts, app: &App) -> Result<Self> {
        if let Some(hash) = token(&parts.headers)
            && let Some(account) = app.store.session(&hash)?
        {
            return Ok(Self(account));
        }
        Err(Error::unauthorized("Sign in to continue."))
    }
}

#[derive(Deserialize)]
pub struct Credentials {
    email: String,
    password: String,
}

#[derive(Deserialize)]
pub struct Registration {
    name: String,
    company: String,
    sample: bool,
    #[serde(flatten)]
    credentials: Credentials,
}

#[derive(Deserialize)]
pub struct Profile {
    name: String,
    company: String,
}

fn email(value: &str) -> Result<String> {
    let value = required(value, 254, "Enter a valid email address.")?.to_ascii_lowercase();
    let (local, domain) = value.split_once('@').unwrap_or_default();
    if local.is_empty()
        || !domain.contains('.')
        || domain.starts_with('.')
        || domain.ends_with('.')
        || domain.contains('@')
        || value.chars().any(char::is_whitespace)
        || domain == "demo.invalid"
    {
        return Err(Error::invalid("Enter a valid email address."));
    }
    Ok(value)
}

pub async fn login(
    State(app): State<App>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<Credentials>,
) -> Result<Response> {
    app.limits
        .lock()
        .map_err(Error::internal)?
        .take(peer.ip())?;
    let email = email(&input.email)?;
    if input.password.len() > 512 {
        return Err(Error::invalid("Password is too long."));
    }
    let found = app
        .store
        .lock()?
        .query_row(
            "SELECT id, password FROM accounts WHERE email = ?1 AND demo = 0",
            [email],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let valid = tokio::task::spawn_blocking(move || {
        verify_password(
            &input.password,
            found.as_ref().map(|(_, password)| password.as_str()),
        )
        .then_some(found)
        .flatten()
    })
    .await
    .map_err(Error::internal)?;
    let (id, stored) =
        valid.ok_or_else(|| Error::unauthorized("The email or password is incorrect."))?;
    let account = app.store.lock()?.query_row(
        "SELECT id, name, email, company, demo FROM accounts WHERE id = ?1",
        [id],
        |row| {
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                email: row.get(2)?,
                company: row.get(3)?,
                demo: row.get(4)?,
            })
        },
    )?;
    start_session(&app, &headers, account, Some(&stored))
}

pub async fn register(
    State(app): State<App>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<Registration>,
) -> Result<Response> {
    app.limits
        .lock()
        .map_err(Error::internal)?
        .take(peer.ip())?;
    let name = required(&input.name, 80, "Enter a name of up to 80 characters.")?;
    let company = required(
        &input.company,
        100,
        "Enter a workspace name of up to 100 characters.",
    )?;
    let email = email(&input.credentials.email)?;
    let password = input.credentials.password;
    validate_password(&password)?;
    let hash = tokio::task::spawn_blocking(move || hash_password(&password))
        .await
        .map_err(Error::internal)??;
    let account = create_account(&app, name, company, email, Some(hash), input.sample)?;
    start_session(&app, &headers, account, None)
}

pub async fn demo(
    State(app): State<App>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Response> {
    app.limits
        .lock()
        .map_err(Error::internal)?
        .take(peer.ip())?;
    let mut bytes = [0; 16];
    random(&mut bytes)?;
    let account = create_account(
        &app,
        "Alex Morgan".into(),
        "Fieldline Demo".into(),
        format!("{}@demo.invalid", hex::encode(bytes)),
        None,
        true,
    )?;
    start_session(&app, &headers, account, None)
}

fn create_account(
    app: &App,
    name: String,
    company: String,
    email: String,
    password: Option<String>,
    sample: bool,
) -> Result<Account> {
    let demo = password.is_none();
    let mut db = app.store.lock()?;
    let tx = db.transaction()?;
    tx.execute(
        "DELETE FROM accounts WHERE demo = 1 AND created_at <= unixepoch() - ?1",
        [DEMO_LIFETIME],
    )?;
    let inserted = tx.execute(
        "INSERT INTO accounts(email, name, company, password, demo) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(email) DO NOTHING",
        params![email, name, company, password, demo],
    )?;
    if inserted == 0 {
        return Err(Error::conflict("An account already uses this email."));
    }
    let id = tx.last_insert_rowid();
    if sample {
        shipments::seed(&tx, id)?;
    }
    tx.commit()?;
    Ok(Account {
        id,
        name,
        email,
        company,
        demo,
    })
}

pub async fn logout(State(app): State<App>, headers: HeaderMap) -> Result<Response> {
    if let Some(hash) = token(&headers) {
        app.store
            .lock()?
            .execute("DELETE FROM sessions WHERE token_hash = ?1", [hash])?;
    }
    Ok((
        [(header::SET_COOKIE, cookie("", 0, app.secure_cookies)?)],
        axum::http::StatusCode::NO_CONTENT,
    )
        .into_response())
}

pub async fn me(SignedIn(account): SignedIn) -> Json<Account> {
    Json(account)
}

pub async fn profile(
    State(app): State<App>,
    SignedIn(mut account): SignedIn,
    Json(input): Json<Profile>,
) -> Result<Json<Account>> {
    account.name = required(&input.name, 80, "Enter a name of up to 80 characters.")?;
    account.company = required(
        &input.company,
        100,
        "Enter a workspace name of up to 100 characters.",
    )?;
    app.store.lock()?.execute(
        "UPDATE accounts SET name = ?1, company = ?2 WHERE id = ?3",
        params![account.name, account.company, account.id],
    )?;
    Ok(Json(account))
}

fn validate_password(password: &str) -> Result<()> {
    if !(12..=128).contains(&password.chars().count()) {
        return Err(Error::invalid(
            "Use a password between 12 and 128 characters.",
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordChange {
    current_password: String,
    new_password: String,
}

pub async fn change_password(
    State(app): State<App>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    SignedIn(account): SignedIn,
    Json(input): Json<PasswordChange>,
) -> Result<Response> {
    if account.demo {
        return Err(Error::invalid("Create an account to set a password."));
    }
    app.limits
        .lock()
        .map_err(Error::internal)?
        .take(peer.ip())?;
    if input.current_password.len() > 512 {
        return Err(Error::invalid("Current password is too long."));
    }
    validate_password(&input.new_password)?;
    if input.current_password == input.new_password {
        return Err(Error::invalid(
            "Choose a password different from your current one.",
        ));
    }
    let stored: String = app.store.lock()?.query_row(
        "SELECT password FROM accounts WHERE id = ?1",
        [account.id],
        |row| row.get(0),
    )?;
    let (stored, replacement) = tokio::task::spawn_blocking(move || {
        if !verify_password(&input.current_password, Some(&stored)) {
            return Err(Error::invalid("The current password is incorrect."));
        }
        Ok((stored, hash_password(&input.new_password)?))
    })
    .await
    .map_err(Error::internal)??;
    let mut db = app.store.lock()?;
    let tx = db.transaction()?;
    let updated = tx.execute(
        "UPDATE accounts SET password = ?1 WHERE id = ?2 AND password = ?3",
        params![replacement, account.id, stored],
    )?;
    if updated == 0 {
        return Err(Error::conflict(
            "The password changed. Sign in again to continue.",
        ));
    }
    tx.execute("DELETE FROM sessions WHERE account_id = ?1", [account.id])?;
    tx.commit()?;
    Ok((
        [(header::SET_COOKIE, cookie("", 0, app.secure_cookies)?)],
        axum::http::StatusCode::NO_CONTENT,
    )
        .into_response())
}
