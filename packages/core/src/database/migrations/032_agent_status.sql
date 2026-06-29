-- Agent presence/status: online, away, busy, offline
-- Agents set this manually; routing skips offline agents on auto-assign.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS agent_status TEXT NOT NULL DEFAULT 'offline'
    CHECK (agent_status IN ('online','away','busy','offline')),
  ADD COLUMN IF NOT EXISTS agent_status_updated_at TIMESTAMPTZ DEFAULT NOW();
