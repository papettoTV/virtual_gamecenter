CREATE TABLE IF NOT EXISTS live_engagement_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('watch_started', 'share_created', 'play_started_from_watch')),
  game_id TEXT NOT NULL,
  cabinet_id TEXT NOT NULL,
  source_cabinet_id TEXT,
  player_id TEXT,
  share_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_live_engagement_events_cabinet
  ON live_engagement_events (cabinet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_engagement_events_share
  ON live_engagement_events (share_id, created_at DESC);
