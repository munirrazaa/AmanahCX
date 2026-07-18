-- 072_voice_bot_agent_templates.sql
-- Voice Bot Agent Builder, Phase 1: reusable agent templates that a Super
-- Admin (or a delegated "Voice Bot Configurator" role, added in a later
-- phase) creates ONCE and assigns to one or more workspaces — instead of
-- configuring each tenant's voice bot from scratch every time.
--
-- Not tenant-scoped (RLS not needed) — same reasoning as voice_bot_voices:
-- this is platform-level reference data managed centrally, read by every
-- tenant's assignment but owned by none of them.

CREATE TABLE IF NOT EXISTS voice_bot_agent_templates (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL,
  sector          TEXT,                          -- e.g. banking, electronics_retail, ecommerce, fmcg
  description     TEXT,
  company_name    TEXT,                          -- spoken/greeting company name, tenant can override after assignment
  department      TEXT,                          -- optional, per user: "not necessary to state"
  bot_engine      TEXT        NOT NULL DEFAULT 'nadia',  -- dropdown for when more bots than Nadia exist
  voice_id        TEXT,                           -- references voice_bot_voices.voice_id
  tone            TEXT        NOT NULL DEFAULT 'professional',
  character       TEXT        NOT NULL DEFAULT 'professional', -- professional | chirpy | funny | cordial | empathetic | formal
  language        TEXT        NOT NULL DEFAULT 'ur-PK',
  call_direction  TEXT        NOT NULL DEFAULT 'inbound', -- inbound | outbound | both
  guardrails      TEXT,
  system_prompt   TEXT,
  greeting_message TEXT,
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tracks which template a tenant's live voice_bot_configs row was last
-- populated from — NOT a live binding (assignment is a one-time copy, per
-- user: "if a change is required it can be [made]" after assignment), just
-- provenance so it's visible in the UI which tenants came from which template.
ALTER TABLE voice_bot_configs
  ADD COLUMN IF NOT EXISTS source_template_id UUID REFERENCES voice_bot_agent_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_voice_bot_configs_source_template ON voice_bot_configs(source_template_id);
