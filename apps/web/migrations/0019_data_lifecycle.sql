ALTER TABLE players ADD COLUMN deletion_requested_at TEXT;
ALTER TABLE rankings ADD COLUMN owner_id TEXT REFERENCES players(id);
ALTER TABLE rankings ADD COLUMN result_id TEXT;
CREATE INDEX idx_rankings_owner ON rankings(owner_id);
ALTER TABLE sharing_events ADD COLUMN actor_id TEXT;

CREATE TABLE player_benefits (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  refill_eligible INTEGER NOT NULL DEFAULT 0,
  registration_hash TEXT
);
INSERT INTO player_benefits (player_id, refill_eligible)
SELECT id, 1 FROM players WHERE EXISTS (
  SELECT 1 FROM credit_ledger_entries WHERE player_id = players.id AND entry_type = 'free_granted'
) OR EXISTS (SELECT 1 FROM device_benefits WHERE player_id = players.id);

CREATE TABLE retained_benefits (
  claim_hash TEXT NOT NULL,
  benefit_type TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  grant_id TEXT,
  PRIMARY KEY (claim_hash, benefit_type)
);

CREATE TABLE retained_daily_refills (
  device_hash TEXT NOT NULL,
  registration_hash TEXT,
  refill_date TEXT NOT NULL,
  PRIMARY KEY (device_hash, refill_date)
);

CREATE TABLE verified_sessions (
  token_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE deletion_evidence (
  request_id TEXT NOT NULL,
  policy_type TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (request_id, policy_type, policy_version)
);

CREATE TABLE data_deletions (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  account_id TEXT,
  receipt_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  scope TEXT NOT NULL CHECK (scope IN ('all', 'public')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_data_deletions_pending ON data_deletions(status);

CREATE TABLE deletion_confirmations (
  token_hash TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL,
  player_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE player_cabinets (
  player_id TEXT NOT NULL,
  cabinet_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (player_id, cabinet_id)
);

CREATE TABLE game_retirements (
  game_id TEXT PRIMARY KEY,
  retired_at TEXT NOT NULL
);
INSERT INTO game_retirements (game_id, retired_at)
SELECT id, CURRENT_TIMESTAMP FROM games WHERE status <> 'active';

CREATE TABLE lifecycle_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO lifecycle_metadata VALUES ('ownership_migrated_at', CURRENT_TIMESTAMP);

CREATE TRIGGER shared_results_active_owner
BEFORE INSERT ON shared_results
WHEN NOT EXISTS (SELECT 1 FROM players WHERE id = NEW.owner_id AND deletion_requested_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'player_not_active');
END;

