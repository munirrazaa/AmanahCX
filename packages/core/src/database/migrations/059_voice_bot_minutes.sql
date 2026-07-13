-- 059_voice_bot_minutes.sql
-- Voice bot admin portal, phase 2: minutes tracking.
--
-- Consumed minutes are NOT stored separately — they're always computed live
-- from voice_bot_calls.duration_seconds (the single source of truth already
-- populated per call), so there's no risk of a running total drifting out of
-- sync with the actual call log. Only the ALLOCATION side needs storage:
--   voice_bot_quotas          — one row per tenant, the current total minutes allocated
--   voice_bot_minute_topups   — audit history of every top-up (who, how much, when, why)

CREATE TABLE IF NOT EXISTS voice_bot_quotas (
  tenant_id         UUID        PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  minutes_allocated NUMERIC(10,2) NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voice_bot_minute_topups (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  minutes_added NUMERIC(10,2) NOT NULL,
  note         TEXT,
  created_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_bot_minute_topups_tenant ON voice_bot_minute_topups(tenant_id, created_at DESC);

ALTER TABLE voice_bot_quotas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON voice_bot_quotas;
CREATE POLICY tenant_isolation ON voice_bot_quotas
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

ALTER TABLE voice_bot_minute_topups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON voice_bot_minute_topups;
CREATE POLICY tenant_isolation ON voice_bot_minute_topups
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );
