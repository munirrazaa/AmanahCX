-- 071_super_admin_no_tenant.sql
--
-- Super Admin has always been a platform-level role with zero workspace
-- access by design (tenant.middleware.ts blocks it from every non-
-- /super-admin/* route) — but the ONLY super_admin account in the database
-- was still a row inside the 'demo' tenant, requiring "demo" to be typed
-- into the login page's Workspace field as a workaround. This makes it a
-- real platform-level account with no tenant of its own.
--
-- Confirmed safe before writing this: exactly 1 super_admin user exists
-- (admin@demo.com); 'demo' tenant itself has 8 other real operational users
-- untouched by this — only the super_admin row's tenant_id moves to NULL.

ALTER TABLE users ALTER COLUMN tenant_id DROP NOT NULL;

-- UNIQUE(tenant_id, email) doesn't stop duplicate emails once tenant_id can be
-- NULL (standard SQL treats each NULL as distinct) — a separate partial index
-- enforces global email uniqueness specifically among tenantless (platform) users.
CREATE UNIQUE INDEX IF NOT EXISTS users_platform_email_uniq ON users(email) WHERE tenant_id IS NULL;

UPDATE users SET tenant_id = NULL WHERE role = 'super_admin';
