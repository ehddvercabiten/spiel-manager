ALTER TABLE admin_sessions ADD COLUMN mfa_verified INTEGER NOT NULL DEFAULT 0 CHECK(mfa_verified IN (0,1));
CREATE TABLE IF NOT EXISTS admin_security (
  id INTEGER PRIMARY KEY CHECK(id=1),
  totp_secret TEXT,
  pending_secret TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO app_settings(key,value,updated_at) VALUES('free_copy_limit','300',unixepoch());
