-- ── Migration 034: Policy Governance Role ────────────────────────────────────
-- Adds policy_admin role with governed_departments scope.
-- SLA policies get a ticket_type/department tag so governance is scoped.
-- policy_admin is the ONLY role that can write SLA policies.
-- tenant_admin can only create the user; super_admin has no SLA access.

-- governed_departments: which departments this policy_admin governs
-- e.g. '{sales,complaint,support}' or any subset
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS governed_departments TEXT[] NOT NULL DEFAULT '{}';

-- sla_policies get a ticket_type field so policy_admin can filter by scope
ALTER TABLE sla_policies
  ADD COLUMN IF NOT EXISTS ticket_type TEXT; -- 'sales' | 'complaint' | 'support' | NULL = all

-- Index for fast department-scoped queries
CREATE INDEX IF NOT EXISTS idx_sla_policies_ticket_type
  ON sla_policies (tenant_id, ticket_type);

CREATE INDEX IF NOT EXISTS idx_users_governed_depts
  ON users USING GIN (governed_departments);
