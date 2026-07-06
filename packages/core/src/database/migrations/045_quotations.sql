-- Migration 045: Quotations module
-- Quotations are pre-invoice documents. They do NOT appear in sales figures
-- until converted to an invoice via the convert endpoint.

CREATE TABLE IF NOT EXISTS quotations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL,
  quotation_number     VARCHAR(50) NOT NULL,
  billing_contact_id   UUID REFERENCES billing_contacts(id) ON DELETE SET NULL,
  issue_date           DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until          DATE,
  currency             VARCHAR(3) NOT NULL DEFAULT 'USD',
  po_reference         VARCHAR(100),
  template_id          VARCHAR(100) NOT NULL DEFAULT 'tpl-classic',
  subtotal             NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax                  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total                NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes                TEXT,
  terms                TEXT,
  status               VARCHAR(20) NOT NULL DEFAULT 'draft',
  converted_to_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotation_line_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id  UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  description   TEXT NOT NULL DEFAULT '',
  quantity      NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_price    NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_rate      NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  total         NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

-- RLS
ALTER TABLE quotations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_line_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='quotations' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON quotations
      USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='quotation_line_items' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON quotation_line_items
      USING (quotation_id IN (SELECT id FROM quotations WHERE tenant_id = current_setting('app.current_tenant_id')::uuid));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_quotations_tenant     ON quotations(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotations_contact    ON quotations(billing_contact_id) WHERE billing_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qli_quotation         ON quotation_line_items(quotation_id);
