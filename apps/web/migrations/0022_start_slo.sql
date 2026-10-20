CREATE TABLE start_slo_config (id INTEGER PRIMARY KEY CHECK (id = 1), coverage_started_ms INTEGER);
INSERT INTO start_slo_config (id) VALUES (1);
CREATE TABLE start_slo_coverage (slot_ms INTEGER PRIMARY KEY);
CREATE TABLE start_slo_attempts (
  reservation_id TEXT PRIMARY KEY REFERENCES credit_reservations(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  deadline_ms INTEGER NOT NULL,
  receipt_token TEXT NOT NULL,
  expected INTEGER NOT NULL CHECK (expected IN (1, 2)),
  allowed_ms INTEGER,
  receipt_one INTEGER NOT NULL DEFAULT 0,
  receipt_two INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'success', 'missing_response', 'rejected'))
);
CREATE INDEX idx_start_slo_pending ON start_slo_attempts(outcome, deadline_ms);
CREATE TABLE start_slo_daily (
  day TEXT PRIMARY KEY,
  requested INTEGER NOT NULL DEFAULT 0,
  allowed INTEGER NOT NULL DEFAULT 0,
  succeeded INTEGER NOT NULL DEFAULT 0,
  missing_response INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER start_slo_requested AFTER INSERT ON start_slo_attempts BEGIN
  INSERT INTO start_slo_daily(day, requested) VALUES (NEW.day, 1) ON CONFLICT(day) DO UPDATE SET requested = requested + 1;
END;
CREATE TRIGGER start_slo_allowed AFTER UPDATE OF allowed_ms ON start_slo_attempts WHEN OLD.allowed_ms IS NULL AND NEW.allowed_ms IS NOT NULL BEGIN
  UPDATE start_slo_daily SET allowed = allowed + 1 WHERE day = NEW.day;
END;
CREATE TRIGGER start_slo_resolved AFTER UPDATE OF outcome ON start_slo_attempts WHEN OLD.outcome = 'pending' AND NEW.outcome <> 'pending' BEGIN
  UPDATE start_slo_daily SET succeeded = succeeded + (NEW.outcome = 'success'), missing_response = missing_response + (NEW.outcome = 'missing_response'), rejected = rejected + (NEW.outcome = 'rejected') WHERE day = NEW.day;
END;
CREATE TRIGGER start_slo_deleted BEFORE DELETE ON start_slo_attempts WHEN OLD.outcome = 'pending' BEGIN
  UPDATE start_slo_daily SET missing_response = missing_response + 1 WHERE day = OLD.day;
END;
