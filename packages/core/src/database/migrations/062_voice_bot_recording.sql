-- 062_voice_bot_recording.sql
-- Per-tenant audio call-recording toggle for the self-hosted voice bot.
-- When on, the agent (a) speaks an audible consent line before greeting and
-- (b) records the call audio to object storage; the URL lands in
-- voice_bot_calls.recording_url (that column already exists, migration 005).
ALTER TABLE voice_bot_configs
  ADD COLUMN IF NOT EXISTS recording_enabled BOOLEAN NOT NULL DEFAULT false;
