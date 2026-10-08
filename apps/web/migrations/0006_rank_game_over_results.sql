ALTER TABLE rankings ADD COLUMN cleared INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rankings ADD COLUMN defeated_boss_count INTEGER NOT NULL DEFAULT 3;

CREATE INDEX IF NOT EXISTS idx_rankings_score_result
  ON rankings (score DESC, cleared DESC, clear_time_ms ASC);
