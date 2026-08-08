ALTER TABLE rankings ADD COLUMN game_id TEXT NOT NULL DEFAULT 'graze-duel';

CREATE INDEX IF NOT EXISTS idx_rankings_game_score
  ON rankings (game_id, score DESC, cleared DESC, clear_time_ms ASC);

CREATE INDEX IF NOT EXISTS idx_rankings_game_time
  ON rankings (game_id, cleared DESC, clear_time_ms ASC, score DESC);
