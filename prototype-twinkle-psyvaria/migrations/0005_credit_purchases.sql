CREATE TABLE IF NOT EXISTS credit_purchases (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  stripe_checkout_session_id TEXT UNIQUE,
  unit_count INTEGER NOT NULL CHECK (unit_count IN (1, 3, 5, 10)),
  credit_amount INTEGER NOT NULL CHECK (credit_amount > 0),
  currency TEXT NOT NULL CHECK (currency IN ('jpy', 'usd')),
  amount_total INTEGER NOT NULL CHECK (amount_total > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'cancelled', 'failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_credit_purchases_player
  ON credit_purchases (player_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_purchases_status
  ON credit_purchases (status, created_at DESC);
