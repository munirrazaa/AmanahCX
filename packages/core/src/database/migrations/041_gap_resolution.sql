-- ══════════════════════════════════════════════════════════════════════════════
-- 041_gap_resolution.sql
-- Resolves all remaining open gaps and deviations from the compliance audit:
--   G-P3: Agent escalation flag + escalated_by_agent column
--   G-F4: pending_closure ticket status + closure_deadline
--   G-P4: contact_erasures audit table
--   D-D1: user_preferences table (saved ticket views)
--   G-P5: sla_policies.status (draft / published)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── G-P3: Agent escalation ────────────────────────────────────────────────────
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS agent_escalated       BOOLEAN   NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS agent_escalated_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_escalated_reason TEXT;

-- ── G-F4: pending_closure status + auto-close deadline ───────────────────────
-- Extend the status check to include pending_closure
-- (Postgres ALTER TABLE … ALTER COLUMN type does not support ADD to CHECK inline
--  so we drop+re-add the constraint)
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN (
    'open','assigned','accepted','in_progress','pending',
    'resolved','closed','cancelled','cancel_requested','pending_closure'
  ));

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS closure_deadline TIMESTAMPTZ;

-- ── G-P4: GDPR contact erasures log ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_erasures (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id    BIGINT,                          -- null after erasure (contact deleted)
  contact_ref   TEXT        NOT NULL,            -- human-readable ref preserved for audit
  erased_by     BIGINT      NOT NULL,            -- user who triggered erasure
  erased_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fields_erased JSONB       NOT NULL DEFAULT '[]',
  note          TEXT
);
ALTER TABLE contact_erasures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON contact_erasures;
CREATE POLICY tenant_isolation ON contact_erasures
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- ── D-D1: User saved ticket views ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_ticket_views (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     BIGINT      NOT NULL,
  name        TEXT        NOT NULL,
  filters     JSONB       NOT NULL DEFAULT '{}',
  is_shared   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE user_ticket_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_ticket_views;
CREATE POLICY tenant_isolation ON user_ticket_views
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE INDEX IF NOT EXISTS idx_ticket_views_user ON user_ticket_views(tenant_id, user_id);

-- ── G-P5: SLA policy draft/published gate ────────────────────────────────────
ALTER TABLE sla_policies
  ADD COLUMN IF NOT EXISTS policy_status TEXT NOT NULL DEFAULT 'published'
  CHECK (policy_status IN ('draft','published'));

-- Existing policies are already live so default them as published
UPDATE sla_policies SET policy_status = 'published' WHERE policy_status IS NULL;
