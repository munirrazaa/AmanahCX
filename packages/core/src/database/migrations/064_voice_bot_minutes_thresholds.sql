-- Tracks whether a tenant has already been notified at each usage
-- threshold for the current allocation cycle, so we notify exactly once
-- per threshold rather than on every single call.
ALTER TABLE voice_bot_quotas ADD COLUMN IF NOT EXISTS notified_70 BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE voice_bot_quotas ADD COLUMN IF NOT EXISTS notified_90 BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE voice_bot_quotas ADD COLUMN IF NOT EXISTS notified_100 BOOLEAN NOT NULL DEFAULT false;

-- Platform-level notifications for Super Admin — not tenant-scoped, so it
-- deliberately does NOT use the tenant-scoped `notifications` table/RLS
-- policy. Super Admin has no tenant context of its own (see
-- tenant.middleware.ts, which blocks super_admin from all /api/v1/* tenant
-- routes entirely).
CREATE TABLE IF NOT EXISTS platform_notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT,
  entity_id   UUID,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_notifications_created ON platform_notifications (created_at DESC);
