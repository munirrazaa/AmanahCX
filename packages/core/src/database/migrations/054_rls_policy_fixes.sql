-- 049_rls_policy_fixes.sql
-- Fixes two classes of Row-Level Security bugs found 2026-07-10/11 while testing
-- push-routing and re-verifying the app after moving off the superuser database
-- login (048_restricted_app_role.sql):
--
-- 1. Several tables' tenant-isolation policies never included the same
--    bypass_rls escape hatch used everywhere else (e.g. tickets, contacts).
--    Any internal privileged query via DatabaseClient.withSuperAdmin() only
--    sets app.bypass_rls — it never sets app.tenant_id. Without the escape
--    hatch, current_setting('app.tenant_id', true) evaluates to an empty
--    string, which then fails to cast to ::uuid, breaking every such query.
--    This was invisible for months because the app was, until today,
--    connecting as a Postgres superuser (BYPASSRLS), which ignores RLS
--    entirely regardless of what any policy says.
--
-- 2. quotations / quotation_line_items check a completely different,
--    never-actually-set session variable (app.current_tenant_id) instead of
--    the one the app code actually sets (app.tenant_id) — confirmed the
--    Quotations module throws "unrecognized configuration parameter" on
--    every single query once real RLS enforcement is in effect. Also masked
--    by the same superuser-bypass issue until today.
--
-- This migration is idempotent (DROP + CREATE) and safe to re-run.

-- queue_members — found while testing offline-agent push-routing exclusion
DROP POLICY IF EXISTS queue_member_isolation ON queue_members;
CREATE POLICY queue_member_isolation ON queue_members
  USING (
    queue_id IN (
      SELECT id FROM ticket_queues
      WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
    )
    OR current_setting('app.bypass_rls', true) = 'on'
  );

-- quotations / quotation_line_items — wrong variable name entirely
DROP POLICY IF EXISTS tenant_isolation ON quotations;
CREATE POLICY tenant_isolation ON quotations
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

DROP POLICY IF EXISTS tenant_isolation ON quotation_line_items;
CREATE POLICY tenant_isolation ON quotation_line_items
  USING (
    quotation_id IN (
      SELECT id FROM quotations
      WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
    )
    OR current_setting('app.bypass_rls', true) = 'on'
  );

-- billing_contacts, invoice_payments, invoices — same missing-bypass gap
DROP POLICY IF EXISTS billing_contacts_tenant ON billing_contacts;
CREATE POLICY billing_contacts_tenant ON billing_contacts
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

DROP POLICY IF EXISTS invoice_payments_tenant ON invoice_payments;
CREATE POLICY invoice_payments_tenant ON invoice_payments
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

DROP POLICY IF EXISTS invoices_tenant ON invoices;
CREATE POLICY invoices_tenant ON invoices
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

-- contact_erasures, ticket_tags, user_ticket_views — same missing-bypass gap
DROP POLICY IF EXISTS tenant_isolation ON contact_erasures;
CREATE POLICY tenant_isolation ON contact_erasures
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

DROP POLICY IF EXISTS tenant_isolation ON ticket_tags;
CREATE POLICY tenant_isolation ON ticket_tags
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

DROP POLICY IF EXISTS tenant_isolation ON user_ticket_views;
CREATE POLICY tenant_isolation ON user_ticket_views
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

-- NOTE: test_sessions (anon_all_sessions) and test_results (anon_all_results)
-- were also found with `USING (true)` — no tenant filtering at all. Left
-- untouched in this migration: the policy names suggest intentional
-- anonymous/public access (likely a public quiz or test-taking feature), and
-- changing this without confirming intent could break a real feature.
-- Flagged in BACKLOG.md for a product-owner decision, not fixed here.
