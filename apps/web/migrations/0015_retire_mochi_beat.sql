-- Keep historical play/credit records, but retire the old game.
UPDATE games SET status = 'retired' WHERE id = 'mochi-beat';
