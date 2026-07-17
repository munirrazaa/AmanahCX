-- 070_voice_bot_cost_tracking.sql
--
-- Voice bot minutes have been tracked since migration 059, but there was no
-- concept of cost — Super Admin could see minutes consumed but not what that
-- cost AmanahCX (or what to bill the tenant). Adds a per-tenant cost-per-minute
-- rate; the monthly cost report (GET /super-admin/voice-bot/cost-report)
-- computes cost live from voice_bot_calls.duration_seconds * this rate, the
-- same "always computed live, never stored as a running total" pattern
-- migration 059 already established for minutes.

ALTER TABLE voice_bot_quotas ADD COLUMN IF NOT EXISTS cost_per_minute NUMERIC(10,4) NOT NULL DEFAULT 0;
