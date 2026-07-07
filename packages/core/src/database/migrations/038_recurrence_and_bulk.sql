-- 038: Repeat-caller recurrence flag + ticket merge support
-- G-F1: recurrence_flag marks tickets from customers with 3+ tickets in 30 days
-- G-P2: merged_into_id tracks which ticket a duplicate was merged into

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS recurrence_flag    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS recurrence_count   SMALLINT    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS merged_into_id     UUID        REFERENCES tickets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_recurrence ON tickets (tenant_id, contact_id, created_at)
  WHERE recurrence_flag = TRUE;

CREATE INDEX IF NOT EXISTS idx_tickets_merged ON tickets (merged_into_id)
  WHERE merged_into_id IS NOT NULL;
