CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS play_sessions (
  id TEXT PRIMARY KEY,
  cabinet_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  host_player_id TEXT,
  guest_player_id TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(id),
  FOREIGN KEY (host_player_id) REFERENCES players(id),
  FOREIGN KEY (guest_player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_play_sessions_cabinet ON play_sessions (cabinet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_play_sessions_game ON play_sessions (game_id, created_at DESC);

CREATE TABLE IF NOT EXISTS game_results (
  id TEXT PRIMARY KEY,
  play_session_id TEXT,
  game_id TEXT NOT NULL,
  game_version TEXT NOT NULL,
  mode TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT NOT NULL,
  cleared INTEGER NOT NULL DEFAULT 0,
  clear_time_ms INTEGER,
  score INTEGER NOT NULL DEFAULT 0,
  max_level INTEGER NOT NULL DEFAULT 1,
  defeated_boss_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (play_session_id) REFERENCES play_sessions(id),
  FOREIGN KEY (game_id) REFERENCES games(id),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_game_results_clear_time
  ON game_results (game_id, cleared DESC, clear_time_ms ASC, score DESC);
CREATE INDEX IF NOT EXISTS idx_game_results_score
  ON game_results (game_id, score DESC, clear_time_ms ASC);

CREATE TABLE IF NOT EXISTS credit_accounts (
  player_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  play_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (play_session_id) REFERENCES play_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_player
  ON credit_transactions (player_id, created_at DESC);

INSERT OR IGNORE INTO games (id, slug, name)
VALUES ('graze-duel', 'graze-duel', 'Graze Duel');
