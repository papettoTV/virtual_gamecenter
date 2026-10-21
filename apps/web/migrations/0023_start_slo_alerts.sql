CREATE TABLE start_slo_alert_buckets (
  bucket_ms INTEGER PRIMARY KEY,
  requested INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  missing_response INTEGER NOT NULL DEFAULT 0
);
INSERT INTO start_slo_alert_buckets(bucket_ms, requested, rejected, missing_response)
SELECT (deadline_ms / 60000) * 60000, COUNT(*), SUM(outcome = 'rejected'), SUM(outcome = 'missing_response')
FROM start_slo_attempts GROUP BY (deadline_ms / 60000) * 60000;
CREATE TABLE start_slo_alert_config (id INTEGER PRIMARY KEY CHECK (id = 1), started_ms INTEGER NOT NULL);
INSERT INTO start_slo_alert_config VALUES (1, unixepoch() * 1000);
CREATE TRIGGER start_slo_alert_requested AFTER INSERT ON start_slo_attempts BEGIN
  INSERT INTO start_slo_alert_buckets(bucket_ms, requested) VALUES ((NEW.deadline_ms / 60000) * 60000, 1)
  ON CONFLICT(bucket_ms) DO UPDATE SET requested = requested + 1;
END;
CREATE TRIGGER start_slo_alert_resolved AFTER UPDATE OF outcome ON start_slo_attempts WHEN OLD.outcome = 'pending' AND NEW.outcome <> 'pending' BEGIN
  UPDATE start_slo_alert_buckets SET rejected = rejected + (NEW.outcome = 'rejected'), missing_response = missing_response + (NEW.outcome = 'missing_response')
  WHERE bucket_ms = (NEW.deadline_ms / 60000) * 60000;
END;
CREATE TRIGGER start_slo_alert_deleted BEFORE DELETE ON start_slo_attempts WHEN OLD.outcome = 'pending' BEGIN
  UPDATE start_slo_alert_buckets SET missing_response = missing_response + 1 WHERE bucket_ms = (OLD.deadline_ms / 60000) * 60000;
END;
