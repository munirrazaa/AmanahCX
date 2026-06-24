-- Add NIC (National Identity Card) number to contacts for banking-sector identity lookup
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS nic_number TEXT;
CREATE INDEX IF NOT EXISTS idx_contacts_nic ON contacts (tenant_id, nic_number) WHERE nic_number IS NOT NULL;
