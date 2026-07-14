CREATE TABLE IF NOT EXISTS voice_bot_knowledge_entries (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title         text NOT NULL,
  content       text NOT NULL,
  keywords      text[] NOT NULL DEFAULT '{}',
  source_type   text NOT NULL DEFAULT 'text' CHECK (source_type IN ('text', 'file', 'url')),
  source_url    text,
  source_filename text,
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_entries_tenant ON voice_bot_knowledge_entries (tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_entries_keywords ON voice_bot_knowledge_entries USING gin (keywords);

ALTER TABLE voice_bot_knowledge_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_bot_knowledge_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON voice_bot_knowledge_entries
  USING (
    (tenant_id::text = current_setting('app.tenant_id', true))
    OR (current_setting('app.bypass_rls', true) = 'on')
  );

CREATE TRIGGER trg_kb_entries_updated_at
  BEFORE UPDATE ON voice_bot_knowledge_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
