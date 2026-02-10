mod db;

use std::sync::Arc;

use anyhow::anyhow;
use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::info;

#[derive(Clone)]
struct Config {
    database_url: String,
    sepolia_rpc_url: String,
    private_key: String,
    treasury_address: String,
    listen_addr: String,
}

impl Config {
    fn from_env() -> Self {
        Self {
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "sqlite://./target/test.db?mode=rwc".into()),
            sepolia_rpc_url: std::env::var("SEPOLIA_RPC_URL").expect("SEPOLIA_RPC_URL must be set"),
            private_key: std::env::var("PRIVATE_KEY").expect("PRIVATE_KEY must be set"),
            treasury_address: std::env::var("TREASURY_ADDRESS")
                .expect("TREASURY_ADDRESS must be set"),
            listen_addr: std::env::var("LISTEN_ADDR").unwrap_or_else(|_| "0.0.0.0:3001".into()),
        }
    }
}

struct AppState {
    db: SqlitePool,
    config: Config,
}

#[derive(Debug, Deserialize)]
struct CreateDeposit {
    user: String,
}

#[derive(Debug, Deserialize)]
struct QueryDeposits {
    user: Option<String>,
    salt: Option<String>,
    address: Option<String>,
    status: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Debug, Serialize)]
struct DepositResponse {
    id: i64,
    user: String,
    salt: String,
    address: String,
    status: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
struct InsertResult {
    id: i64,
}

async fn insert_deposit(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateDeposit>,
) -> Result<(StatusCode, Json<InsertResult>), AppError> {
    let user = validate_hex(&body.user, 20, "user")?;
    let salt = keccak256(&user).to_vec();
    let address = user.clone();

    let id = db::insert_deposit(&state.db, &user, &salt, &address).await?;

    Ok((StatusCode::CREATED, Json(InsertResult { id })))
}

async fn query_deposits(
    State(state): State<Arc<AppState>>,
    Query(params): Query<QueryDeposits>,
) -> Result<Json<Vec<DepositResponse>>, AppError> {
    let filters = db::DepositFilters {
        user: params
            .user
            .as_deref()
            .map(|u| validate_hex(u, 20, "user"))
            .transpose()?,
        salt: params
            .salt
            .as_deref()
            .map(|s| validate_hex(s, 32, "salt"))
            .transpose()?,
        address: params
            .address
            .as_deref()
            .map(|a| validate_hex(a, 20, "address"))
            .transpose()?,
        status: params.status,
        limit: params.limit.unwrap_or(10).min(100),
        offset: params.offset.unwrap_or(0).max(0),
    };

    let rows = db::query_deposits(&state.db, &filters).await?;

    let deposits = rows
        .into_iter()
        .map(|r| DepositResponse {
            id: r.id,
            user: encode_hex(&r.user),
            salt: encode_hex(&r.salt),
            address: encode_hex(&r.address),
            status: r.status,
            created_at: r.created_at,
            updated_at: r.updated_at,
        })
        .collect();

    Ok(Json(deposits))
}

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rust_backend=debug,tower_http=debug".parse().unwrap()),
        )
        .init();

    let config = Config::from_env();
    let pool = db::connect(&config.database_url).await;

    let state = Arc::new(AppState {
        db: pool,
        config: config.clone(),
    });

    let app = Router::new()
        .route("/deposits", get(query_deposits).post(insert_deposit))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state);

    info!(addr = %config.listen_addr, "listening");
    let listener = tokio::net::TcpListener::bind(&config.listen_addr)
        .await
        .unwrap();
    axum::serve(listener, app).await.unwrap();
}

struct AppError(StatusCode, anyhow::Error);

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        tracing::warn!(status = %self.0, err = %self.1, "request failed");
        (self.0, self.1.to_string()).into_response()
    }
}

impl<E: Into<anyhow::Error>> From<E> for AppError {
    fn from(e: E) -> Self {
        Self(StatusCode::INTERNAL_SERVER_ERROR, e.into())
    }
}

fn bad_request(msg: impl std::fmt::Display) -> AppError {
    AppError(StatusCode::BAD_REQUEST, anyhow!("{msg}"))
}

fn decode_hex(s: &str) -> anyhow::Result<Vec<u8>> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(Into::into))
        .collect()
}

fn encode_hex(bytes: &[u8]) -> String {
    format!(
        "0x{}",
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    )
}

fn validate_hex(s: &str, expected_len: usize, name: &str) -> Result<Vec<u8>, AppError> {
    let bytes = decode_hex(s).map_err(|e| bad_request(format!("bad {name} hex: {e}")))?;
    if bytes.len() != expected_len {
        return Err(bad_request(format!("{name} must be {expected_len} bytes")));
    }
    Ok(bytes)
}

fn keccak256(data: &[u8]) -> [u8; 32] {
    use tiny_keccak::{Hasher, Keccak};
    let mut hasher = Keccak::v256();
    let mut out = [0u8; 32];
    hasher.update(data);
    hasher.finalize(&mut out);
    out
}
