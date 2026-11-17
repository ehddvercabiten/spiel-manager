-- Separate short-lived PIN-verified challenges from authenticated admin sessions.
-- Revoke legacy sessions once so any old browser cookie must complete MFA again.
DELETE FROM admin_sessions;

CREATE TABLE IF NOT EXISTS admin_pending_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_pending_sessions_expiry
  ON admin_pending_sessions(expires_at);
