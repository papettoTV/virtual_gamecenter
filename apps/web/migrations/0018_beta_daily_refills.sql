CREATE TABLE beta_daily_refills (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  device_hash TEXT NOT NULL,
  refill_date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= 3),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (player_id, refill_date),
  UNIQUE (device_hash, refill_date)
);

CREATE TRIGGER trg_beta_daily_refill_ledger
AFTER INSERT ON beta_daily_refills
BEGIN
  INSERT INTO credit_ledger_entries
    (id, player_id, balance_type, entry_type, amount, reference_id)
  VALUES
    ('beta-refill:' || NEW.id, NEW.player_id, 'free', 'adjusted', NEW.amount, NEW.id);
END;
