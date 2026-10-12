CREATE TRIGGER credit_purchases_active_owner
BEFORE INSERT ON credit_purchases
WHEN NOT EXISTS (SELECT 1 FROM players WHERE id = NEW.player_id AND deletion_requested_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'player_not_active');
END;
