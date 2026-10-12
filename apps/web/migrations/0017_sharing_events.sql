CREATE TABLE sharing_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('share_opened', 'share_link_copied', 'share_target_opened', 'share_native_handoff', 'share_image_saved', 'result_viewed', 'play_started_from_result')),
  kind TEXT NOT NULL CHECK (kind IN ('live', 'result')),
  game_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  share_id TEXT,
  channel TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sharing_events_target ON sharing_events (kind, target_id, created_at);
CREATE INDEX idx_sharing_events_share ON sharing_events (share_id, event_type);
