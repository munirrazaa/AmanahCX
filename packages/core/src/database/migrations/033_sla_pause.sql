-- ── Migration 033: SLA pause-on-pending ────────────────────────────────────
-- Adds two columns to tickets to support pausing the SLA clock when a ticket
-- enters "pending" status (waiting on customer) and resuming when it leaves.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS sla_paused_at        timestamptz,   -- when clock was last paused
  ADD COLUMN IF NOT EXISTS sla_pause_elapsed_s  integer NOT NULL DEFAULT 0; -- total seconds paused so far
