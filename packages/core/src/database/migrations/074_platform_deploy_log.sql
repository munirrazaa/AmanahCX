-- Records every "Push to Production" (redeploy) action triggered from the
-- Super Admin console, so there's an auditable record of who redeployed what,
-- when, and whether it succeeded. Redeploys re-run the LATEST code already on
-- `main` (via Vercel/Railway deploy hooks) — this table does not track code
-- changes themselves, only the redeploy trigger events.

CREATE TABLE IF NOT EXISTS platform_deploy_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_by   UUID REFERENCES users(id),
  targets        TEXT[] NOT NULL,          -- e.g. {'vercel','railway'}
  results        JSONB NOT NULL DEFAULT '{}',  -- per-target { ok: boolean, message: string }
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_deploy_log_created_at ON platform_deploy_log (created_at DESC);
