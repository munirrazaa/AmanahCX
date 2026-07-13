-- 058_voice_bot_voices_and_custom_intents.sql
-- Voice bot admin portal, phase 1:
--   1. voice_bot_voices — shared voice catalog (super admin managed), so the
--      settings screen stops hardcoding a 2-entry array in the frontend.
--   2. voice_bot_custom_intents — per-tenant "answer, don't create a ticket"
--      reasons beyond the 8 built into voice-bot.ts's INTENT_PATTERNS, so a
--      tenant admin can define their own without a code change.

CREATE TABLE IF NOT EXISTS voice_bot_voices (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    TEXT        NOT NULL DEFAULT 'livekit',
  voice_id    TEXT        NOT NULL,
  label       TEXT        NOT NULL,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, voice_id)
);

INSERT INTO voice_bot_voices (provider, voice_id, label, description) VALUES
  ('livekit', 'helpdesk-agent',    'Helpdesk Agent (Female)',  'Warm female customer-service voice — patient, empathetic'),
  ('livekit', 'broadband-support', 'Broadband Support (Male)', 'Polished male support voice')
ON CONFLICT (provider, voice_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS voice_bot_custom_intents (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  intent_key TEXT        NOT NULL,
  label      TEXT        NOT NULL,
  keywords   TEXT[]      NOT NULL DEFAULT '{}',
  created_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, intent_key)
);

CREATE INDEX IF NOT EXISTS idx_voice_bot_custom_intents_tenant ON voice_bot_custom_intents(tenant_id);

ALTER TABLE voice_bot_custom_intents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON voice_bot_custom_intents;
CREATE POLICY tenant_isolation ON voice_bot_custom_intents
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

-- voice_bot_configs.sip_uri / sip_trunk_provider / sip_trunk_number already
-- exist (049_livekit_agent_config.sql) — this migration adds no columns
-- there, only the UI catches up to what the schema already supports.
