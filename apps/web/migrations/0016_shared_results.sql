CREATE TABLE shared_results (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  game_id TEXT NOT NULL,
  game_version TEXT NOT NULL,
  elapsed_time_ms INTEGER NOT NULL CHECK (elapsed_time_ms >= 0),
  cleared INTEGER NOT NULL CHECK (cleared IN (0, 1)),
  score REAL NOT NULL CHECK (score >= 0),
  metrics_json TEXT NOT NULL CHECK (json_valid(metrics_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TRIGGER shared_results_immutable
BEFORE UPDATE ON shared_results
BEGIN
  SELECT RAISE(ABORT, 'shared_results are immutable');
END;
