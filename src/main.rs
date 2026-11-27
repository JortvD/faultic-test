mod auth;
mod contacts;
mod db_permissions;
mod mailer;
mod shipments;
mod store;
mod traffic;

use std::{
    env,
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Request},
    http::{HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::json;
use tower_http::{
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
};

use crate::store::Store;

#[derive(Clone)]
struct App {
    store: Store,
    limits: Arc<Mutex<traffic::Limits>>,
    trusted_proxies: Arc<traffic::TrustedProxies>,
    mailer: Option<Arc<mailer::Mailer>>,
    secure_cookies: bool,
    public_origin: Option<String>,
}

async fn api_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn check_origin(
    axum::extract::State(app): axum::extract::State<App>,
    request: Request,
    next: Next,
) -> Response {
    if !matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    ) && let Some(origin) = request.headers().get(header::ORIGIN)
    {
        let origin = origin.to_str().unwrap_or_default();
        let same_origin = match app.public_origin.as_deref() {
            Some(expected) => origin == expected,
            None => request
                .headers()
                .get(header::HOST)
                .and_then(|host| host.to_str().ok())
                .is_some_and(|host| {
                    origin.strip_prefix("http://") == Some(host)
                        || origin.strip_prefix("https://") == Some(host)
                }),
        };
        if !same_origin {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({"message": "Cross-origin changes are not allowed."})),
            )
                .into_response();
        }
    }
    next.run(request).await
}

async fn ready(
    axum::extract::State(app): axum::extract::State<App>,
) -> store::Result<Json<serde_json::Value>> {
    let tables = app.store.lock()?.query_row(
        "SELECT count(*) FROM sqlite_schema
         WHERE type = 'table' AND name IN ('accounts', 'sessions', 'shipments', 'contacts', 'manifests', 'registration_codes')",
        [], |row| row.get::<_, u32>(0),
    )?;
    if tables != 6 {
        return Err(store::Error::internal("incomplete database schema"));
    }
    Ok(Json(
        json!({"status": "ready", "version": env!("CARGO_PKG_VERSION")}),
    ))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let address = env::var("FIELDLINE_LISTEN").unwrap_or_else(|_| "127.0.0.1:18084".into());
    let database =
        PathBuf::from(env::var("FIELDLINE_DB").unwrap_or_else(|_| "data/fieldline.sqlite".into()));
    db_permissions::prepare(&database)?;
    let dist = PathBuf::from(env::var("FIELDLINE_DIST").unwrap_or_else(|_| "web/dist".into()));
    let public_origin = env::var("FIELDLINE_ORIGIN")
        .ok()
        .filter(|origin| !origin.is_empty());
    let app = App {
        store: Store::open(&database)?,
        limits: Arc::default(),
        trusted_proxies: Arc::new(traffic::TrustedProxies::parse(
            &env::var("FIELDLINE_TRUSTED_PROXIES").unwrap_or_default(),
        )?),
        mailer: mailer::Mailer::from_env()?.map(Arc::new),
        secure_cookies: env::var("FIELDLINE_SECURE_COOKIES").is_ok_and(|value| value == "1")
            || public_origin
                .as_deref()
                .is_some_and(|origin| origin.starts_with("https://")),
        public_origin,
    };
    let api = Router::new()
        .route("/auth/register", post(auth::request_registration))
        .route("/auth/register/verify", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/auth/demo", post(auth::demo))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/password", post(auth::change_password))
        .route("/me", get(auth::me).patch(auth::profile))
        .route("/shipments", get(shipments::list).post(shipments::create))
        .route(
            "/shipments/{tracking}",
            get(shipments::detail).put(shipments::edit),
        )
        .route(
            "/shipments/{tracking}/events",
            post(shipments::update_status),
        )
        .route("/carriers", get(shipments::carriers))
        .route("/contacts", get(contacts::list).post(contacts::create))
        .route(
            "/contacts/{id}",
            axum::routing::put(contacts::edit).delete(contacts::remove),
        )
        .route(
            "/manifests",
            get(shipments::list_manifests).post(shipments::dispatch_manifest),
        )
        .route("/manifests/{id}", get(shipments::manifest_detail))
        .route("/quotes", post(shipments::quotes))
        .route("/tracking/{tracking}", get(shipments::public_tracking))
        .fallback(|| async { store::Error::missing() })
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(middleware::from_fn_with_state(app.clone(), check_origin))
        .layer(middleware::from_fn(api_headers));
    let router = Router::new()
        .route("/readyz", get(ready))
        .nest("/api", api)
        .fallback_service(ServeDir::new(&dist).fallback(ServeFile::new(dist.join("index.html"))))
        .layer(SetResponseHeaderLayer::if_not_present(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")))
        .layer(SetResponseHeaderLayer::if_not_present(header::REFERRER_POLICY, HeaderValue::from_static("same-origin")))
        .layer(SetResponseHeaderLayer::if_not_present(header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static("default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")))
        .with_state(app);
    let listener = tokio::net::TcpListener::bind(&address).await?;
    eprintln!(
        "Fieldline {} listening on http://{}",
        env!("CARGO_PKG_VERSION"),
        listener.local_addr()?
    );
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown())
    .await?;
    Ok(())
}

async fn shutdown() {
    #[cfg(unix)]
    if let Ok(mut terminate) =
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
    {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = terminate.recv() => {},
        }
        return;
    }
    let _ = tokio::signal::ctrl_c().await;
}
