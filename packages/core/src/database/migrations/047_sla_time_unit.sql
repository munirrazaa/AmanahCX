-- Migration 047: Add time_unit support to SLA policies
-- Allows policy administrators to specify whether timeframes are in minutes or hours

ALTER TABLE sla_policies ADD COLUMN IF NOT EXISTS time_unit TEXT NOT NULL DEFAULT 'hours';

-- Ensure time_unit is always one of the two allowed values
ALTER TABLE sla_policies ADD CONSTRAINT sla_time_unit_check
  CHECK (time_unit IN ('hours', 'minutes'));
