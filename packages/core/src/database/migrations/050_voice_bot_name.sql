-- 050_voice_bot_name.sql
-- Display name for the self-hosted voice bot (LiveKit provider), editable
-- from the Voice Bot admin screen. Used in the bot's greeting and persona
-- ("I am <name> speaking...").
--
-- NOTE FOR DEPLOY: like 049, this must be applied manually with the admin
-- (postgres) connection and recorded in _migrations BEFORE pushing — the
-- app's own restricted role (crm_app) cannot ALTER tables it doesn't own,
-- so Railway's auto-migration would fail the deploy otherwise.

ALTER TABLE voice_bot_configs
  ADD COLUMN IF NOT EXISTS bot_name TEXT NOT NULL DEFAULT 'Nadia';

COMMENT ON COLUMN voice_bot_configs.bot_name IS 'Bot display name spoken in greetings; editable per tenant from the Voice Bot admin screen';
