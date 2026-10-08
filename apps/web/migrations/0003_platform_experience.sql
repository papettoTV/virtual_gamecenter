CREATE TABLE IF NOT EXISTS player_sessions (
  token_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_player_sessions_player
  ON player_sessions (player_id, expires_at);

CREATE TABLE IF NOT EXISTS consent_records (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  policy_type TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id),
  UNIQUE (player_id, policy_type, policy_version)
);

CREATE INDEX IF NOT EXISTS idx_consent_records_player
  ON consent_records (player_id, policy_type, accepted_at DESC);

CREATE TABLE IF NOT EXISTS credit_wallets (
  player_id TEXT PRIMARY KEY,
  free_balance INTEGER NOT NULL DEFAULT 0 CHECK (free_balance >= 0),
  purchased_balance INTEGER NOT NULL DEFAULT 0 CHECK (purchased_balance >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS credit_ledger_entries (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  balance_type TEXT NOT NULL CHECK (balance_type IN ('free', 'purchased')),
  entry_type TEXT NOT NULL CHECK (
    entry_type IN ('free_granted', 'purchased', 'consumed', 'refunded', 'expired', 'adjusted')
  ),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  play_session_id TEXT,
  reference_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (play_session_id) REFERENCES play_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_player
  ON credit_ledger_entries (player_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_credit_ledger_apply_free
AFTER INSERT ON credit_ledger_entries
WHEN NEW.balance_type = 'free'
BEGIN
  UPDATE credit_wallets
  SET free_balance = free_balance + NEW.amount,
      updated_at = CURRENT_TIMESTAMP
  WHERE player_id = NEW.player_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_credit_ledger_apply_purchased
AFTER INSERT ON credit_ledger_entries
WHEN NEW.balance_type = 'purchased'
BEGIN
  UPDATE credit_wallets
  SET purchased_balance = purchased_balance + NEW.amount,
      updated_at = CURRENT_TIMESTAMP
  WHERE player_id = NEW.player_id;
END;

CREATE TABLE IF NOT EXISTS credit_reservations (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  play_session_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  balance_type TEXT NOT NULL CHECK (balance_type IN ('free', 'purchased')),
  status TEXT NOT NULL CHECK (status IN ('active', 'captured', 'released', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (play_session_id) REFERENCES play_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_credit_reservations_player
  ON credit_reservations (player_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_credit_reservations_play_session
  ON credit_reservations (play_session_id, status);

CREATE TRIGGER IF NOT EXISTS trg_credit_reservation_validate_free
BEFORE INSERT ON credit_reservations
WHEN NEW.balance_type = 'free' AND (
  SELECT free_balance - COALESCE((
    SELECT SUM(amount)
    FROM credit_reservations
    WHERE player_id = NEW.player_id
      AND balance_type = 'free'
      AND status = 'active'
      AND expires_at > CURRENT_TIMESTAMP
  ), 0)
  FROM credit_wallets
  WHERE player_id = NEW.player_id
) < NEW.amount
BEGIN
  SELECT RAISE(ABORT, 'insufficient_credit');
END;

CREATE TRIGGER IF NOT EXISTS trg_credit_reservation_validate_purchased
BEFORE INSERT ON credit_reservations
WHEN NEW.balance_type = 'purchased' AND (
  SELECT purchased_balance - COALESCE((
    SELECT SUM(amount)
    FROM credit_reservations
    WHERE player_id = NEW.player_id
      AND balance_type = 'purchased'
      AND status = 'active'
      AND expires_at > CURRENT_TIMESTAMP
  ), 0)
  FROM credit_wallets
  WHERE player_id = NEW.player_id
) < NEW.amount
BEGIN
  SELECT RAISE(ABORT, 'insufficient_credit');
END;
