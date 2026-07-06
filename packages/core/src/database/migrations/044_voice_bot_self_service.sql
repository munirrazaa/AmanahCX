-- G-F3: Voice Bot Self-Service (No-Ticket Path)
-- Adds resolution_type and self_service_response to voice_bot_calls
-- Adds self_service_intents array to voice_bot_configs

ALTER TABLE voice_bot_calls
  ADD COLUMN IF NOT EXISTS resolution_type       VARCHAR(30) NOT NULL DEFAULT 'ticket_created',
  ADD COLUMN IF NOT EXISTS self_service_response TEXT;

-- resolution_type values:
--   ticket_created  — bot could not self-serve; ticket raised (existing behaviour)
--   self_service    — bot resolved the query; no ticket created
--   agent_transfer  — caller asked for human; routed to queue
--   abandoned       — caller hung up before resolution

ALTER TABLE voice_bot_configs
  ADD COLUMN IF NOT EXISTS self_service_intents TEXT[] NOT NULL DEFAULT '{}';

-- Index for containment-rate queries
CREATE INDEX IF NOT EXISTS idx_vbc_resolution_type
  ON voice_bot_calls (tenant_id, resolution_type, created_at);
