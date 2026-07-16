-- 067_separate_sales_invoices.sql
--
-- Fixes a table-name collision that has made the entire Sales Invoicing
-- module non-functional since it was built (2026-07-06): migration
-- 002_billing.sql created "invoices" for PLATFORM billing (what AmanahCX
-- charges a tenant for using the software — subscription_id, provider,
-- provider_invoice_id, due_at). Migration 008_sales_invoicing.sql later
-- tried to create ITS OWN "invoices" table for tenant-facing sales
-- invoicing (what a tenant charges ITS OWN customers — billing_contact_id,
-- due_date, number, template_id) using CREATE TABLE IF NOT EXISTS — which
-- silently no-op'd because 002's table already existed. Every sales-invoice
-- INSERT/query since has been hitting the wrong table's columns and failing.
-- Confirmed zero rows in any of the affected tables in production — this is
-- a safe structural fix, no data migration needed.
--
-- Matches how top CRMs do this (Salesforce Billing vs Sales Cloud quotes/
-- invoices; Zoho Subscriptions vs Zoho Invoice/Books): platform billing and
-- tenant-facing customer invoicing are always separate systems, never a
-- shared table.

CREATE TABLE IF NOT EXISTS sales_invoices (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','sent','viewed','partial','paid','overdue','cancelled')),
  billing_contact_id  UUID REFERENCES billing_contacts(id),
  issue_date          DATE NOT NULL,
  due_date            DATE NOT NULL,
  po_reference        TEXT,
  currency            TEXT NOT NULL DEFAULT 'USD',
  template_id         TEXT NOT NULL DEFAULT 'tpl-classic',
  subtotal            NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_tax           NUMERIC(15,2) NOT NULL DEFAULT 0,
  total                NUMERIC(15,2) NOT NULL DEFAULT 0,
  amount_paid         NUMERIC(15,2) NOT NULL DEFAULT 0,
  amount_due          NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes               TEXT,
  terms               TEXT,
  logo_url            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_tenant    ON sales_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_status    ON sales_invoices(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_due_date  ON sales_invoices(tenant_id, due_date);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_contact   ON sales_invoices(billing_contact_id);
ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_invoices_tenant ON sales_invoices;
CREATE POLICY sales_invoices_tenant ON sales_invoices
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

-- Repoint the sales-side support tables at the correct table. These were
-- empty (0 rows) and referencing the wrong "invoices" all along.
ALTER TABLE invoice_line_items DROP CONSTRAINT IF EXISTS invoice_line_items_invoice_id_fkey;
ALTER TABLE invoice_line_items
  ADD CONSTRAINT invoice_line_items_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE;

ALTER TABLE invoice_payments DROP CONSTRAINT IF EXISTS invoice_payments_invoice_id_fkey;
ALTER TABLE invoice_payments
  ADD CONSTRAINT invoice_payments_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE;

-- Also fix the missing bypass_rls escape hatch on invoice_payments (same
-- class of bug as 054_rls_policy_fixes.sql — this table predates that fix).
DROP POLICY IF EXISTS invoice_payments_tenant ON invoice_payments;
CREATE POLICY invoice_payments_tenant ON invoice_payments
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

ALTER TABLE quotations DROP CONSTRAINT IF EXISTS quotations_converted_to_invoice_id_fkey;
ALTER TABLE quotations
  ADD CONSTRAINT quotations_converted_to_invoice_id_fkey
  FOREIGN KEY (converted_to_invoice_id) REFERENCES sales_invoices(id) ON DELETE SET NULL;
