CREATE TABLE IF NOT EXISTS rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_name TEXT NOT NULL,
  clear_time_ms INTEGER NOT NULL,
  score INTEGER NOT NULL,
  max_level INTEGER NOT NULL,
  client_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rankings_time ON rankings (clear_time_ms ASC, score DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_score ON rankings (score DESC, clear_time_ms ASC);
