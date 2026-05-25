CREATE TABLE IF NOT EXISTS app_state (
  id         TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
