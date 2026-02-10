CREATE TABLE IF NOT EXISTS deposits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user       BLOB    NOT NULL CHECK(length(user) = 20),
    salt       BLOB    UNIQUE NOT NULL CHECK(length(salt) = 32),
    address    BLOB    UNIQUE NOT NULL CHECK(length(address) = 20),
    status     TEXT    NOT NULL DEFAULT 'pending',
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
