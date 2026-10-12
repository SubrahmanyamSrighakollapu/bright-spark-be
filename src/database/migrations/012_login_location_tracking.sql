-- ============================================================
-- 012 — Login Location & IP Tracking Extension
-- ============================================================
-- Prerequisites: migration 011 applied (login_history table
-- exists). Target: MariaDB 10.5+ / MySQL 8.
--
-- Additive-only: adds nullable columns to login_history to
-- capture geolocation coordinates, accuracy, and the location
-- permission status for every authentication event. No existing
-- columns or data are modified.

ALTER TABLE login_history
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,7) NULL
    COMMENT 'Geolocation latitude (WGS84) captured from the browser Geolocation API',
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(10,7) NULL
    COMMENT 'Geolocation longitude (WGS84) captured from the browser Geolocation API',
  ADD COLUMN IF NOT EXISTS location_accuracy DECIMAL(10,2) NULL
    COMMENT 'Location accuracy in meters as reported by the Geolocation API',
  ADD COLUMN IF NOT EXISTS location_status VARCHAR(30) NOT NULL DEFAULT 'UNAVAILABLE'
    COMMENT 'GRANTED / DENIED / TIMEOUT / UNSUPPORTED / ERROR / PENDING / UNAVAILABLE',
  ADD COLUMN IF NOT EXISTS location_captured_at TIMESTAMP(6) NULL
    COMMENT 'Timestamp when the browser captured the geolocation reading';

-- Optional index for filtering login events by location status over time.
ALTER TABLE login_history
  ADD INDEX IF NOT EXISTS idx_login_history_location_created (location_status, created_at DESC);
