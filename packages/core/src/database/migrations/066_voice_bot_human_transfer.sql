-- ============================================================
-- MIGRATION 066: Voice bot human transfer destination
-- ============================================================
-- The SIP address/number Nadia hands a call to when she can't take it
-- herself (minutes exhausted or over capacity). Left NULL until the
-- client confirms the one number their call center software actually
-- answers on — until then, overflow keeps working exactly as before
-- (ticket + graceful decline, no live transfer attempted).

ALTER TABLE voice_bot_configs
  ADD COLUMN IF NOT EXISTS human_transfer_destination TEXT;
