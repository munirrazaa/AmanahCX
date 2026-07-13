-- 049_livekit_agent_config.sql
--
-- Two things:
--
-- 1. BUG FIX: packages/api/src/routes/voice-bot.ts PUT /config has always
--    inserted into `sip_uri` and `ivr_menu` columns that were never created
--    by any migration — every save of those fields would fail with
--    "column does not exist". Adding them now (idempotent).
--
-- 2. New columns for the self-hosted LiveKit agent ("Nadia") — the
--    Urdu/Minglish voice bot for the Pakistani market. Vapi/Retell/Bland
--    are hosted platforms with their own dashboards for tone/speed/voice;
--    LiveKit has none, so the CRM's own config screen becomes that dashboard.

ALTER TABLE voice_bot_configs
  ADD COLUMN IF NOT EXISTS sip_uri  TEXT,
  ADD COLUMN IF NOT EXISTS ivr_menu JSONB NOT NULL DEFAULT '[]';

ALTER TABLE voice_bot_configs
  ADD COLUMN IF NOT EXISTS tone                    TEXT NOT NULL DEFAULT 'professional',
  -- professional | friendly | empathetic | formal
  ADD COLUMN IF NOT EXISTS speaking_rate            NUMERIC(3,2) NOT NULL DEFAULT 0.9,
  -- 0.5 (slow) .. 2.0 (fast); 1.0 = natural pace
  ADD COLUMN IF NOT EXISTS stt_provider             TEXT NOT NULL DEFAULT 'whisper',
  ADD COLUMN IF NOT EXISTS stt_language_hint        TEXT NOT NULL DEFAULT 'ur-en',
  -- 'ur-en' = code-switched Urdu/Roman-Urdu/English ("Minglish"), 'ur' = Urdu only, 'en' = English only
  ADD COLUMN IF NOT EXISTS tts_provider             TEXT NOT NULL DEFAULT 'uplift',
  ADD COLUMN IF NOT EXISTS llm_model                TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  ADD COLUMN IF NOT EXISTS interruption_sensitivity NUMERIC(3,2) NOT NULL DEFAULT 0.5,
  -- 0 = let the caller talk over the bot freely, 1 = bot stops the instant it hears any sound
  ADD COLUMN IF NOT EXISTS max_call_duration_sec    INTEGER NOT NULL DEFAULT 600,
  ADD COLUMN IF NOT EXISTS end_call_phrases         TEXT[] NOT NULL DEFAULT ARRAY['اللہ حافظ','خدا حافظ','شکریہ، اللہ حافظ'],
  -- Urdu script, not Roman Urdu — mixing scripts measurably degrades Uplift TTS naturalness
  -- (confirmed 2026-07-12: same voice_id sounds notably more robotic on romanized text).
  ADD COLUMN IF NOT EXISTS sip_trunk_provider       TEXT,
  ADD COLUMN IF NOT EXISTS sip_trunk_number         TEXT;

-- Allow 'livekit' alongside vapi/retell/bland/twilio_ai wherever the provider
-- column is checked elsewhere in application code (no DB-level CHECK existed,
-- so nothing to alter here — application Zod schema is updated separately).

COMMENT ON COLUMN voice_bot_configs.tone IS 'Retell-style tone knob for the LiveKit agent''s TTS delivery';
COMMENT ON COLUMN voice_bot_configs.speaking_rate IS 'Retell-style speed knob, passed to the TTS provider as a rate multiplier';
