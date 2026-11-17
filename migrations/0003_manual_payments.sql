CREATE TABLE IF NOT EXISTS manual_payment_submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK(amount = 49),
  currency TEXT NOT NULL DEFAULT 'PHP',
  payment_reference TEXT NOT NULL UNIQUE,
  paid_at TEXT,
  receipt_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  submitted_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by TEXT,
  rejection_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_manual_payments_user ON manual_payment_submissions(user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_payments_status ON manual_payment_submissions(status, submitted_at DESC);
