-- 043_fix_rrp_rls.sql
-- Fix recording_retention_policies RLS to support both tenant-scoped and
-- super-admin (bypass_rls) access without throwing on missing app.tenant_id.

DROP POLICY IF EXISTS tenant_isolation ON recording_retention_policies;
CREATE POLICY tenant_isolation ON recording_retention_policies
  USING (
    current_setting('app.bypass_rls', TRUE) = 'on'
    OR tenant_id = current_setting('app.tenant_id', TRUE)::uuid
  );
