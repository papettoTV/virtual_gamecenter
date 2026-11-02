CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('good', 'concern', 'bug')),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  game_id TEXT,
  activity TEXT NOT NULL CHECK (activity IN ('player', 'spectator', 'site')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS feedback_created ON feedback(created_at);
CREATE TABLE IF NOT EXISTS feedback_rate_buckets (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  last_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
