-- ── Migration 030: SLA enhancements ────────────────────────────────────────
-- 1. Holiday calendar (tenant-level, shared across all SLA policies)
-- 2. First reply time tracking on tickets
-- 3. Smart SLA matching conditions on sla_policies

-- 1. Holiday calendar table
CREATE TABLE IF NOT EXISTS sla_holidays (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  date        date NOT NULL,
  recurring   boolean NOT NULL DEFAULT true,  -- true = repeats every year on same month/day
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, date)
);

ALTER TABLE sla_holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sla_holidays
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );

CREATE INDEX IF NOT EXISTS idx_sla_holidays_tenant ON sla_holidays(tenant_id);

-- 2. First reply time on tickets (separate from SLA first_response_at)
--    first_replied_at = when agent posted first public reply/note
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_replied_at timestamptz;

-- 3. Smart matching conditions on sla_policies
--    jsonb: { channels: ['email','phone'], departments: ['Support'], tags: ['vip'] }
--    All specified conditions must match (AND logic). Empty array = match any.
ALTER TABLE sla_policies ADD COLUMN IF NOT EXISTS match_conditions jsonb NOT NULL DEFAULT '{}';
