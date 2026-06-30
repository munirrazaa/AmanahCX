-- Migration 035: add unique constraint on voice_bot_calls (provider, provider_call_id)
-- Prevents duplicate tickets when a provider retries the same webhook delivery.
ALTER TABLE voice_bot_calls
  ADD CONSTRAINT uq_voice_bot_calls_provider_call_id
  UNIQUE (provider, provider_call_id);
