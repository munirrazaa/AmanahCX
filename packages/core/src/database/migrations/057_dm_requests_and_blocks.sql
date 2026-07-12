-- 052_dm_requests_and_blocks.sql
-- Adds the message-request / accept-decline-block workflow for internal DMs
-- that had been configured as a product requirement but was never actually
-- built (team_messages had no gating at all — any user could message any
-- other user in the tenant with no request/accept step).
--
-- dm_requests: one row per unordered pair of users in a tenant, tracking
-- whether their DM thread is still a pending request or has been accepted.
-- user_low/user_high are the pair sorted so (A,B) and (B,A) always map to
-- the same row.
--
-- dm_blocks: directional block list. Blocking is one-way — if A blocks B,
-- B cannot message A, but A can still message B (until A unblocks).

CREATE TABLE IF NOT EXISTS dm_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_low     UUID        NOT NULL,
  user_high    UUID        NOT NULL,
  requested_by UUID        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_low, user_high)
);

CREATE INDEX IF NOT EXISTS idx_dm_requests_tenant ON dm_requests(tenant_id, user_low, user_high);

CREATE TABLE IF NOT EXISTS dm_blocks (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  blocker_id UUID        NOT NULL,
  blocked_id UUID        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_blocks_blocker ON dm_blocks(tenant_id, blocker_id);
CREATE INDEX IF NOT EXISTS idx_dm_blocks_blocked ON dm_blocks(tenant_id, blocked_id);

ALTER TABLE dm_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dm_requests;
CREATE POLICY tenant_isolation ON dm_requests
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

ALTER TABLE dm_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dm_blocks;
CREATE POLICY tenant_isolation ON dm_blocks
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );
