use sqlx::{Row, SqlitePool, sqlite::SqlitePoolOptions};
use tracing::info;

pub async fn connect(url: &str) -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(url)
        .await
        .expect("failed to connect to database");

    info!("connected to database");

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("failed to run migrations");

    info!("migrations applied");

    pool
}

#[derive(Default)]
pub struct DepositFilters {
    pub user: Option<Vec<u8>>,
    pub salt: Option<Vec<u8>>,
    pub address: Option<Vec<u8>>,
    pub status: Option<String>,
    pub limit: i64,
    pub offset: i64,
}

pub struct DepositRow {
    pub id: i64,
    pub user: Vec<u8>,
    pub salt: Vec<u8>,
    pub address: Vec<u8>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

pub async fn insert_deposit(
    pool: &SqlitePool,
    user: &[u8],
    salt: &[u8],
    address: &[u8],
) -> anyhow::Result<i64> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO deposits (user, salt, address, status)
         VALUES (?, ?, ?, ?)
         RETURNING id",
    )
    .bind(user)
    .bind(salt)
    .bind(address)
    .bind("pending")
    .fetch_one(pool)
    .await?;

    Ok(id)
}

pub async fn query_deposits(
    pool: &SqlitePool,
    filters: &DepositFilters,
) -> anyhow::Result<Vec<DepositRow>> {
    let mut sql = String::from(
        "SELECT id, user, salt, address, status, created_at, updated_at \
         FROM deposits WHERE 1=1",
    );
    if filters.user.is_some() {
        sql.push_str(" AND user = ?");
    }
    if filters.salt.is_some() {
        sql.push_str(" AND salt = ?");
    }
    if filters.address.is_some() {
        sql.push_str(" AND address = ?");
    }
    if filters.status.is_some() {
        sql.push_str(" AND status = ?");
    }
    sql.push_str(" ORDER BY created_at DESC");
    if filters.limit > 0 {
        sql.push_str(" LIMIT ?");
    }
    if filters.offset > 0 {
        sql.push_str(" OFFSET ?");
    }

    let mut query = sqlx::query(&sql);
    if let Some(ref user) = filters.user {
        query = query.bind(user.as_slice());
    }
    if let Some(ref salt) = filters.salt {
        query = query.bind(salt.as_slice());
    }
    if let Some(ref addr) = filters.address {
        query = query.bind(addr.as_slice());
    }
    if let Some(ref status) = filters.status {
        query = query.bind(status.as_str());
    }
    if filters.limit > 0 {
        query = query.bind(filters.limit);
    }
    if filters.offset > 0 {
        query = query.bind(filters.offset);
    }

    let rows = query.fetch_all(pool).await?;

    Ok(rows
        .iter()
        .map(|row| DepositRow {
            id: row.get("id"),
            user: row.get("user"),
            salt: row.get("salt"),
            address: row.get("address"),
            status: row.get("status"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
        .collect())
}
