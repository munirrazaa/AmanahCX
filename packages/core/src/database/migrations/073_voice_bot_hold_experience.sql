-- 073_voice_bot_hold_experience.sql
-- Configurable "hold experience" while Nadia does back-office work mid-call
-- (ticket creation etc.):
--   1. hold_message — editable spoken line ("please wait while I create your
--      ticket"), previously hardcoded in agent.py, so wording changes needed
--      a code deploy.
--   2. Branded hold AUDIO — an uploaded clip (e.g. a bank's product jingle)
--      played to the caller while Nadia works; stopped the instant she is
--      ready to speak again. Bytes live in the DB (clips are small, and this
--      avoids giving the CRM API its own object-storage credentials); Nadia
--      fetches once per call via the shared-secret /livekit/hold-audio route
--      and caches locally.

ALTER TABLE voice_bot_configs
  ADD COLUMN IF NOT EXISTS hold_message TEXT,
  ADD COLUMN IF NOT EXISTS hold_audio_filename TEXT;

ALTER TABLE voice_bot_agent_templates
  ADD COLUMN IF NOT EXISTS hold_message TEXT;

CREATE TABLE IF NOT EXISTS voice_bot_hold_audio (
  tenant_id  UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  filename   TEXT NOT NULL,
  mimetype   TEXT NOT NULL,
  data       BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Not tenant-RLS-scoped: written by Super Admin (no tenant context) and read
-- by Nadia via the shared-secret public route, same as platform_notifications.
