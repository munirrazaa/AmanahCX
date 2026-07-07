-- ══════════════════════════════════════════════════════════════════════════════
-- 042_governance_orders.sql
-- G-F5: GDPR voice-recording retention policies
-- New: tenant order / upgrade request system
-- ══════════════════════════════════════════════════════════════════════════════

-- ── G-F5: Voice recording retention policies ─────────────────────────────────
CREATE TABLE IF NOT EXISTS recording_retention_policies (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  policy_name     TEXT        NOT NULL DEFAULT 'Default Recording Retention Policy',
  retention_days  INT         NOT NULL DEFAULT 90
                  CHECK (retention_days BETWEEN 1 AND 3650),
  legal_basis     TEXT        NOT NULL DEFAULT 'legitimate_interest'
                  CHECK (legal_basis IN (
                    'consent','legitimate_interest','legal_obligation',
                    'vital_interests','public_task','contract'
                  )),
  processing_purpose TEXT     NOT NULL DEFAULT 'Customer service quality assurance and dispute resolution',
  data_categories    TEXT[]   NOT NULL DEFAULT ARRAY['voice_recordings','call_transcripts'],
  third_party_transfers BOOLEAN NOT NULL DEFAULT FALSE,
  third_parties      TEXT,
  policy_status   TEXT        NOT NULL DEFAULT 'draft'
                  CHECK (policy_status IN ('draft','published')),
  published_at    TIMESTAMPTZ,
  published_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ,          -- when the approved retention period ends
  last_warned_at  TIMESTAMPTZ,          -- last 30-day expiry warning sent
  created_by      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE recording_retention_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recording_retention_policies;
CREATE POLICY tenant_isolation ON recording_retention_policies
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_rrp_tenant ON recording_retention_policies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rrp_expires ON recording_retention_policies(expires_at)
  WHERE policy_status = 'published';

-- ── Order / upgrade request system ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_orders (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_type      TEXT        NOT NULL
                  CHECK (order_type IN (
                    'storage_extension',   -- extend recording retention period
                    'new_module',          -- purchase a new product module
                    'feature_request',     -- request a new feature
                    'plan_upgrade'         -- upgrade subscription plan
                  )),
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','under_review','approved','rejected','cancelled')),

  -- What they are requesting
  requested_module   TEXT,                -- module key from MODULE_CATALOG
  requested_features TEXT[],             -- specific feature keys
  requested_days     INT,                -- for storage_extension: additional days
  description        TEXT NOT NULL,      -- free-text details of the request

  -- Pricing / payment
  quoted_amount    NUMERIC(12,2),
  currency         TEXT DEFAULT 'USD',
  payment_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  payment_ref      TEXT,                -- invoice / transaction reference

  -- Admin response
  admin_note       TEXT,
  reviewed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,

  -- Requester
  requested_by     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_tenant  ON tenant_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_pending ON tenant_orders(status) WHERE status = 'pending';
