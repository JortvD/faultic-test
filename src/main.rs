mod auth;
mod shipments;
mod store;

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
    limits: Arc<Mutex<auth::Limits>>,
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
    app.store.lock()?.query_row(
        "SELECT count(*) FROM sqlite_schema WHERE name = 'shipments'",
        [],
        |row| row.get::<_, u32>(0),
    )?;
    Ok(Json(
        json!({"status": "ready", "version": env!("CARGO_PKG_VERSION")}),
    ))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let address = env::var("FIELDLINE_LISTEN").unwrap_or_else(|_| "127.0.0.1:18084".into());
    let database =
        PathBuf::from(env::var("FIELDLINE_DB").unwrap_or_else(|_| "data/fieldline.sqlite".into()));
    if let Some(parent) = database
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)?;
    }
    let dist = PathBuf::from(env::var("FIELDLINE_DIST").unwrap_or_else(|_| "web/dist".into()));
    let public_origin = env::var("FIELDLINE_ORIGIN")
        .ok()
        .filter(|origin| !origin.is_empty());
    let app = App {
        store: Store::open(&database)?,
        limits: Arc::default(),
        secure_cookies: env::var("FIELDLINE_SECURE_COOKIES").is_ok_and(|value| value == "1")
            || public_origin
                .as_deref()
                .is_some_and(|origin| origin.starts_with("https://")),
        public_origin,
    };
    let api = Router::new()
        .route("/auth/register", post(auth::register))
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
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await?;
    Ok(())
}
