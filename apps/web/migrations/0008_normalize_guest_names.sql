UPDATE players
SET guest_name = 'Player-' || SUBSTR(REPLACE(id, '-', ''), 1, 8)
WHERE account_id IS NULL;
