CREATE TABLE IF NOT EXISTS device_benefits (
  device_hash TEXT NOT NULL,
  benefit_type TEXT NOT NULL,
  player_id TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (device_hash, benefit_type),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_device_benefits_player
  ON device_benefits (player_id, benefit_type);
