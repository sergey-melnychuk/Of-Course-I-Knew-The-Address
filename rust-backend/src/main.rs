mod db;
mod eth;

use std::sync::Arc;

use alloy::{
    primitives::{Address, FixedBytes, map::HashMap},
    signers::local::PrivateKeySigner,
};
use anyhow::anyhow;
use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::info;

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub sepolia_rpc_url: String,
    pub private_key: String,
    pub treasury_address: String,
    pub deployer_address: String,
    pub listen_addr: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "sqlite://./target/test.db?mode=rwc".into()),
            sepolia_rpc_url: std::env::var("SEPOLIA_RPC_URL").expect("SEPOLIA_RPC_URL must be set"),
            private_key: std::env::var("PRIVATE_KEY").expect("PRIVATE_KEY must be set"),
            treasury_address: std::env::var("TREASURY_ADDRESS")
                .expect("TREASURY_ADDRESS must be set"),
            deployer_address: std::env::var("DEPLOYER_ADDRESS")
                .expect("DEPLOYER_ADDRESS must be set"),
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

#[derive(Debug, Default, Serialize)]
struct RouteResults {
    counts: HashMap<String, i64>,
    routed: usize,
    txs: Vec<String>,
}

async fn execute_routing(
    State(state): State<Arc<AppState>>,
) -> Result<(StatusCode, Json<RouteResults>), AppError> {
    let filters = db::DepositFilters {
        status: Some("pending".to_string()),
        ..Default::default()
    };
    let deposits = db::query_deposits(&state.db, &filters).await?;
    if deposits.is_empty() {
        return Ok((StatusCode::OK, Json(RouteResults::default())));
    }

    tracing::info!(deposits = deposits.len(), "routing funds");

    let counts = sqlx::query("SELECT status, COUNT(*) AS count FROM deposits GROUP BY status")
        .fetch_all(&state.db)
        .await?
        .into_iter()
        .map(|row| (row.get("status"), row.get("count")))
        .collect::<HashMap<_, _>>();

    // This potentially can be done more future-proof when number of deposits is large.
    // But for now for the scope of a take-home task I believe it's good enough.
    let salts = deposits
        .iter()
        .map(|d| FixedBytes::try_from(d.salt.as_slice()))
        .collect::<Result<_, _>>()?;
    eth::deploy_proxies(
        &state.config.sepolia_rpc_url,
        state.config.deployer_address.parse()?,
        &state.config.private_key,
        salts,
    )
    .await?;
    tracing::info!("proxies deployed");

    let mut tx = state.db.begin().await?;
    for deposit in &deposits {
        sqlx::query("UPDATE deposits SET status = 'proxied' WHERE id = ?")
            .bind(deposit.id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    tracing::info!("deposits updated");

    let pending = deposits
        .into_iter()
        .map(|deposit| {
            let state = state.clone();
            async move {
                let tx = eth::route_funds(
                    &state.config.sepolia_rpc_url,
                    &state.config.private_key,
                    Address::from_slice(&deposit.address),
                    state.config.treasury_address.parse()?,
                )
                .await?;

                sqlx::query("UPDATE deposits SET status = 'routed' WHERE id = ?")
                    .bind(deposit.id)
                    .execute(&state.db)
                    .await?;
                Ok::<_, anyhow::Error>(tx)
            }
        })
        .collect::<Vec<_>>();
    tracing::info!(pending = pending.len(), "transfering funds");

    let txs = futures::future::try_join_all(pending)
        .await?
        .into_iter()
        .filter(|tx| !tx.is_zero())
        .map(|tx| tx.to_string())
        .collect::<Vec<_>>();
    tracing::info!(txs = txs.len(), "funds transferred");

    Ok((
        StatusCode::OK,
        Json(RouteResults {
            counts,
            routed: txs.len(),
            txs,
        }),
    ))
}

async fn insert_deposit(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateDeposit>,
) -> Result<(StatusCode, Json<InsertResult>), AppError> {
    let user = validate_hex(&body.user, 20, "user")?;
    let salt = keccak256(&[&user]);

    // DRY: no need for error-prone sync of implementations of CREATE2 addresses,
    // when only a single implementation exists and is already deployed!
    let signer: PrivateKeySigner = state.config.private_key.parse()?;
    let caller = signer.address();
    let proxies = eth::predict_proxy_addresses(
        &state.config.sepolia_rpc_url,
        state.config.deployer_address.parse()?,
        caller,
        vec![salt.into()],
    )
    .await?;
    let address = proxies.first().ok_or(AppError(
        StatusCode::INTERNAL_SERVER_ERROR,
        anyhow!("predicting proxy addresses failed"),
    ))?;

    let id = db::insert_deposit(&state.db, &user, &salt, address.as_slice()).await?;

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
        .route("/deposits", get(query_deposits))
        .route("/deposits", post(insert_deposit))
        .route("/route", post(execute_routing))
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

fn keccak256(input: &[&[u8]]) -> [u8; 32] {
    use tiny_keccak::{Hasher, Keccak};
    let mut hasher = Keccak::v256();
    for i in input {
        hasher.update(i);
    }
    let mut out = [0u8; 32];
    hasher.finalize(&mut out);
    out
}
