-- 053_contact_channel_consent.sql
-- Per-channel consent/opt-in tracking for contacts (CB-04). Meta's WhatsApp
-- Business API requires explicit, provable opt-in before any business-initiated
-- message — a single blanket "opted in" flag on the contact isn't enough and
-- doesn't survive an audit. This tracks consent per channel with a timestamp,
-- source, and full history (old rows are never overwritten, only superseded).

CREATE TABLE IF NOT EXISTS contact_channel_consent (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id   UUID        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel      TEXT        NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'email')),
  opted_in     BOOLEAN     NOT NULL,
  source       TEXT        NOT NULL CHECK (source IN ('manual', 'reply', 'form', 'import', 'api')),
  consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  notes        TEXT
);

CREATE INDEX IF NOT EXISTS idx_contact_channel_consent_contact ON contact_channel_consent(tenant_id, contact_id, channel, consented_at DESC);

-- Fast lookup of "what's the current consent state for this contact+channel"
-- (latest row per contact_id/channel pair).
CREATE INDEX IF NOT EXISTS idx_contact_channel_consent_latest ON contact_channel_consent(contact_id, channel, consented_at DESC);

ALTER TABLE contact_channel_consent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON contact_channel_consent;
CREATE POLICY tenant_isolation ON contact_channel_consent
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );
