-- 068_platform_invoices.sql
--
-- Adds the "platform_invoices" and "platform_payments" tables backing the
-- Super Admin Billing tab (/super-admin/platform-invoices route in
-- super-admin.ts). The route code has existed since it was built, but the
-- migration to create its tables was never written — every request to the
-- tab has been failing with "relation platform_invoices does not exist"
-- (42P01). Found during the 2026-07-16 role-by-role QA sweep of Super
-- Admin's own screens.
--
-- This is what AmanahCX bills EACH TENANT for using the software — distinct
-- from sales_invoices (a tenant's invoices to ITS OWN customers, see
-- 067_separate_sales_invoices.sql).

CREATE TABLE IF NOT EXISTS platform_invoices (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','sent','paid','overdue','cancelled')),
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  due_date       DATE NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'GBP',
  amount         NUMERIC(15,2) NOT NULL DEFAULT 0,
  items          JSONB NOT NULL DEFAULT '[]',
  notes          TEXT,
  paid_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_tenant ON platform_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_status ON platform_invoices(status);

CREATE TABLE IF NOT EXISTS platform_payments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id   UUID NOT NULL REFERENCES platform_invoices(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount       NUMERIC(15,2) NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'GBP',
  payment_date DATE NOT NULL,
  method       TEXT CHECK (method IN ('bank_transfer','card','cheque','cash','other')),
  reference    TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_payments_invoice ON platform_payments(invoice_id);

-- Platform billing is super_admin-only (there is no tenant-scoped access
-- path to this data at all — see auth.middleware.ts's tenantMiddleware,
-- which blocks super_admin from every route except /super-admin/*, and no
-- tenant-facing route ever queries these tables). RLS still enabled as
-- defence in depth: only sessions that explicitly bypass RLS (the
-- super-admin routes' db.withSuperAdmin connection) can read/write.
ALTER TABLE platform_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_invoices_bypass_only ON platform_invoices;
CREATE POLICY platform_invoices_bypass_only ON platform_invoices
  USING (current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE platform_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_payments_bypass_only ON platform_payments;
CREATE POLICY platform_payments_bypass_only ON platform_payments
  USING (current_setting('app.bypass_rls', true) = 'on');
