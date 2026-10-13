CREATE TABLE IF NOT EXISTS credit_reservation_uses (
  reservation_id TEXT PRIMARY KEY REFERENCES credit_reservations(id) ON DELETE CASCADE,
  usage_id TEXT NOT NULL,
  used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
