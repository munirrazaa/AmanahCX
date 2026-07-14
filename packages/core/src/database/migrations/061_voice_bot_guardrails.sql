-- 061_voice_bot_guardrails.sql
-- Voice Bot admin portal: configurable behavior boundaries ("must never do/say")
-- for the self-hosted LiveKit agent, separate from the general system_prompt so
-- the agent's own instructions treat it as a hard limit, not general guidance.

ALTER TABLE voice_bot_configs
  ADD COLUMN IF NOT EXISTS guardrails TEXT;
