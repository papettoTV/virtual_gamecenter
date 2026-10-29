ALTER TABLE feedback ADD COLUMN player_name TEXT CHECK (player_name IS NULL OR length(player_name) <= 100);
ALTER TABLE feedback ADD COLUMN device_type TEXT CHECK (device_type IS NULL OR device_type IN ('PC', 'スマホ', 'タブレット', '不明'));
ALTER TABLE feedback ADD COLUMN browser_type TEXT CHECK (browser_type IS NULL OR browser_type IN ('Edge', 'Opera', 'Samsung Internet', 'Firefox', 'Chrome', 'Safari', '不明'));
