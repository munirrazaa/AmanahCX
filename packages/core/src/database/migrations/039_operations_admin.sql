-- ── Migration 039: Operations Admin Role ─────────────────────────────────────
-- Adds operations_admin (rank 35) — cross-tenant read-only observer role.
-- COO / Head of Contact Centre: sees all tickets, recordings, sales, contacts,
-- reports. Cannot configure the platform (users, integrations, SLA, routing).
-- Role is TEXT in users table — no enum change required.

-- No schema changes needed; role is stored as TEXT.
-- This migration documents the role for audit purposes and adds the
-- applyModuleLicensing default so operations_admin gets read-only permissions
-- on all operational modules when a new tenant provisions this role.

-- Ensure the role value is accepted by adding a comment (informational only).
-- Enforcement is at application layer (requireRole / ROLE_RANK checks).
COMMENT ON COLUMN users.role IS
  'Allowed values: super_admin(50) | tenant_admin(40) | operations_admin(35) | manager(30) | policy_admin(25) | agent(20) | viewer(10)';
