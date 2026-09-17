-- Migration 014: Operator command panel chat sessions

CREATE TABLE operator_chat (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id),
  messages   JSONB NOT NULL DEFAULT '[]',
    -- array of { role: 'user'|'assistant', content: string, timestamp: string,
    --            tool_calls?: [...], data_sources?: string[] }
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE operator_chat ENABLE ROW LEVEL SECURITY;

-- Operators see only their own sessions
CREATE POLICY "operator_chat_owner" ON operator_chat
  FOR ALL USING (
    tenant_id = get_my_tenant_id()
    AND user_id = (SELECT id FROM users WHERE auth_id = auth.uid())
  );

CREATE INDEX idx_operator_chat_tenant_user ON operator_chat(tenant_id, user_id);
CREATE INDEX idx_operator_chat_updated_at  ON operator_chat(tenant_id, updated_at DESC);

CREATE TRIGGER operator_chat_updated_at
  BEFORE UPDATE ON operator_chat
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
