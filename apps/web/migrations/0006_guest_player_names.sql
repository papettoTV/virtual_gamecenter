ALTER TABLE players ADD COLUMN guest_name TEXT;

UPDATE players
SET guest_name = 'PLAYER-' || UPPER(SUBSTR(REPLACE(id, '-', ''), 1, 8))
WHERE guest_name IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_players_guest_name
  ON players (guest_name);
