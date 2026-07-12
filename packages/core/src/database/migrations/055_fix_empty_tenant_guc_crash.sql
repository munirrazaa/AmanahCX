-- 050_fix_empty_tenant_guc_crash.sql
-- Root-causes and fixes the "invalid input syntax for type uuid: ''" crash
-- that was blocking push-routing (and any other admin query hitting these
-- tables after a tenant-scoped query ran on the same pooled connection).
--
-- Root cause (confirmed live, 2026-07-11): Postgres resets a custom session
-- GUC to an EMPTY STRING, not NULL, once it has ever been SET LOCAL in that
-- backend connection and the surrounding transaction commits. Our connection
-- pool (pg.Pool, potentially proxied through Supabase's Supavisor) reuses
-- physical connections across requests, so any policy written as
--   current_setting('app.tenant_id', true)::uuid
-- will crash on the SECOND and later queries on a given pooled connection,
-- even when app.bypass_rls = 'on', because Postgres evaluates both sides of
-- an OR expression and the ::uuid cast throws before bypass_rls is checked.
--
-- Fix: wrap every such cast with NULLIF(..., '') so an empty string is
-- treated the same as "not set" (NULL), matching the intended behavior.
-- This migration is idempotent (DROP + CREATE) and safe to re-run.

DROP POLICY IF EXISTS tenant_isolation ON recording_retention_policies;
CREATE POLICY tenant_isolation ON recording_retention_policies
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

DROP POLICY IF EXISTS queue_member_isolation ON queue_members;
CREATE POLICY queue_member_isolation ON queue_members
  USING (
    queue_id IN (
      SELECT id FROM ticket_queues
      WHERE tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
    OR current_setting('app.bypass_rls', true) = 'on'
  );

DROP POLICY IF EXISTS tenant_isolation ON quotations;
CREATE POLICY tenant_isolation ON quotations
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

DROP POLICY IF EXISTS tenant_isolation ON quotation_line_items;
CREATE POLICY tenant_isolation ON quotation_line_items
  USING (
    quotation_id IN (
      SELECT id FROM quotations
      WHERE tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
    OR current_setting('app.bypass_rls', true) = 'on'
  );

DROP POLICY IF EXISTS billing_contacts_tenant ON billing_contacts;
CREATE POLICY billing_contacts_tenant ON billing_contacts
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

DROP POLICY IF EXISTS invoice_payments_tenant ON invoice_payments;
CREATE POLICY invoice_payments_tenant ON invoice_payments
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

DROP POLICY IF EXISTS invoices_tenant ON invoices;
CREATE POLICY invoices_tenant ON invoices
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

DROP POLICY IF EXISTS tenant_isolation ON contact_erasures;
CREATE POLICY tenant_isolation ON contact_erasures
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

DROP POLICY IF EXISTS tenant_isolation ON ticket_tags;
CREATE POLICY tenant_isolation ON ticket_tags
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

DROP POLICY IF EXISTS tenant_isolation ON user_ticket_views;
CREATE POLICY tenant_isolation ON user_ticket_views
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );
