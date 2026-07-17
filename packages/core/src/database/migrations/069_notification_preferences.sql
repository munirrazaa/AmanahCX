-- 069_notification_preferences.sql
--
-- The Notifications settings page (Settings > Notifications, and My Settings >
-- Notifications) let a user flip every toggle and click "Save Preferences",
-- but the page never talked to the backend — no table existed to hold the
-- values and the Save button had no click handler. Found during the
-- 2026-07-17 exhaustive toggle audit. This adds real per-user storage.

ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL DEFAULT '{}';
