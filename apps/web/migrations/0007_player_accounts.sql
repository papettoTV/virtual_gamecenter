CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS account_identities (
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  account_id TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, provider_subject),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

ALTER TABLE players ADD COLUMN account_id TEXT REFERENCES accounts(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_players_account
  ON players (account_id)
  WHERE account_id IS NOT NULL;
