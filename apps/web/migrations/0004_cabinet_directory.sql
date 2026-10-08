CREATE TABLE IF NOT EXISTS cabinet_directory (
  cabinet_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  status TEXT NOT NULL,
  player_count INTEGER NOT NULL DEFAULT 0,
  spectator_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cabinet_directory_active
  ON cabinet_directory (game_id, player_count DESC, spectator_count DESC, updated_at DESC);
