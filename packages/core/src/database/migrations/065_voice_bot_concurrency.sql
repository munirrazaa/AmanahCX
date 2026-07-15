-- ============================================================
-- MIGRATION 065: Voice bot concurrency controls
-- ============================================================
-- Per-tenant concurrent-call cap (fairness when multiple tenants share
-- one VPS) + a live registry of in-progress calls used to enforce both
-- the per-tenant cap and the VPS-wide global cap.

ALTER TABLE voice_bot_configs
  ADD COLUMN IF NOT EXISTS max_concurrent_calls INTEGER;

CREATE TABLE IF NOT EXISTS active_voice_calls (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  call_id    TEXT NOT NULL UNIQUE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_active_voice_calls_tenant ON active_voice_calls(tenant_id);
CREATE INDEX IF NOT EXISTS idx_active_voice_calls_started ON active_voice_calls(started_at);

-- Not tenant-RLS-scoped: the global concurrency check needs to count
-- active calls across ALL tenants sharing the same worker/VPS, and
-- Super Admin's own capacity dashboard needs the same cross-tenant view.
