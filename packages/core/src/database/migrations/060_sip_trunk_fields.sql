-- 060_sip_trunk_fields.sql
-- Voice Bot admin portal, SIP config catch-up: matches the field set shown by
-- Retell/other SIP-trunk-connect dialogs (Phone Number, Termination URI,
-- SIP Trunk Username/Password, Nickname, Outbound Transport). `sip_uri`
-- (049_livekit_agent_config.sql) already covers "Termination URI" — no new
-- column needed for that, only the UI label changes. These four are new.

ALTER TABLE voice_bot_configs
  ADD COLUMN IF NOT EXISTS sip_trunk_username TEXT,
  ADD COLUMN IF NOT EXISTS sip_trunk_password TEXT,
  ADD COLUMN IF NOT EXISTS sip_trunk_nickname TEXT,
  ADD COLUMN IF NOT EXISTS outbound_transport TEXT NOT NULL DEFAULT 'TCP';
