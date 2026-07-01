-- ── Migration 040: Human Agent Call Recordings ───────────────────────────────
-- Stores call recordings and transcripts for human agent calls.
-- Voice bot calls are already stored in voice_bot_calls (migration 005).
-- Together these two tables power the unified Call Recordings module.

CREATE TABLE IF NOT EXISTS human_agent_calls (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id        UUID        REFERENCES tickets(id) ON DELETE SET NULL,
  agent_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  queue_id         UUID        REFERENCES ticket_queues(id) ON DELETE SET NULL,
  recording_url    TEXT,
  transcript       TEXT,
  duration_s       INTEGER,
  direction        TEXT        NOT NULL DEFAULT 'inbound'
                               CHECK (direction IN ('inbound','outbound')),
  channel          TEXT        NOT NULL DEFAULT 'phone'
                               CHECK (channel IN ('phone','whatsapp','web')),
  tags             TEXT[]      NOT NULL DEFAULT '{}',
  legal_hold       BOOLEAN     NOT NULL DEFAULT FALSE,
  legal_hold_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  legal_hold_at    TIMESTAMPTZ,
  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE human_agent_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON human_agent_calls
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

-- legal_hold on voice_bot_calls too (for policy_admin legal hold feature)
ALTER TABLE voice_bot_calls
  ADD COLUMN IF NOT EXISTS legal_hold    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS legal_hold_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS legal_hold_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tags          TEXT[]      NOT NULL DEFAULT '{}';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hac_tenant   ON human_agent_calls (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hac_agent    ON human_agent_calls (tenant_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_hac_ticket   ON human_agent_calls (ticket_id);
CREATE INDEX IF NOT EXISTS idx_hac_tags     ON human_agent_calls USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_hac_hold     ON human_agent_calls (tenant_id) WHERE legal_hold = TRUE;
CREATE INDEX IF NOT EXISTS idx_vbc_tags     ON voice_bot_calls USING GIN (tags);
