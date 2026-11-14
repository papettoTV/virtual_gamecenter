INSERT INTO games (id, slug, name, status, created_at, updated_at)
SELECT 'buzz-barrier', 'buzz-barrier', name, status, created_at, updated_at
FROM games WHERE id = 'graze-duel';

UPDATE play_sessions SET game_id = 'buzz-barrier' WHERE game_id = 'graze-duel';
UPDATE game_results SET game_id = 'buzz-barrier' WHERE game_id = 'graze-duel';
UPDATE rankings SET game_id = 'buzz-barrier' WHERE game_id = 'graze-duel';
UPDATE cabinet_directory SET game_id = 'buzz-barrier' WHERE game_id = 'graze-duel';
UPDATE live_engagement_events SET game_id = 'buzz-barrier' WHERE game_id = 'graze-duel';
UPDATE sharing_events SET game_id = 'buzz-barrier' WHERE game_id = 'graze-duel';
UPDATE game_retirements SET game_id = 'buzz-barrier' WHERE game_id = 'graze-duel';
UPDATE feedback SET game_id = 'buzz-barrier' WHERE game_id = 'graze-duel';

DROP TRIGGER shared_results_immutable;
UPDATE shared_results SET game_id = 'buzz-barrier' WHERE game_id = 'graze-duel';
CREATE TRIGGER shared_results_immutable
BEFORE UPDATE ON shared_results
BEGIN
  SELECT RAISE(ABORT, 'shared_results are immutable');
END;

DELETE FROM games WHERE id = 'graze-duel';
