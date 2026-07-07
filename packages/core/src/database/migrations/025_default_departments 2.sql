-- Migration 025: Default departments
-- Adds is_system flag so Sales / Support / Complaints cannot be deleted,
-- and seeds those three departments into every existing tenant that lacks them.

ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

-- Seed the three standard departments for every existing tenant (idempotent)
INSERT INTO departments (tenant_id, name, department_type, description, color, is_system)
SELECT
  t.id,
  d.name,
  d.department_type,
  d.description,
  d.color,
  true
FROM tenants t
CROSS JOIN (VALUES
  ('Sales',      'sales',            'Handles leads, deals and revenue generation',           '#29ABE2'),
  ('Support',    'support',          'Customer service, tickets and issue resolution',         '#57A93C'),
  ('Complaints', 'compliance_audit', 'Complaint handling, escalations and regulatory matters', '#f59e0b')
) AS d(name, department_type, description, color)
ON CONFLICT (tenant_id, name) DO UPDATE
  SET is_system = true;
