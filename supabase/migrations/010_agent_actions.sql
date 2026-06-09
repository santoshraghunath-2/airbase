-- Migration 010: Agent actions audit log
-- Empty structure now; AI agents populate this in Phase 2.
-- Every AI decision is recorded here for auditability and operator review.

CREATE TABLE agent_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  agent_type TEXT NOT NULL, -- 'dispatch' | 'booking' | 'invoice' | 'membership' | 'operator' | 'tech'
  trigger_event TEXT NOT NULL, -- what caused this action
  context_snapshot JSONB NOT NULL DEFAULT '{}', -- state at time of action
  reasoning TEXT NOT NULL DEFAULT '', -- agent's explanation
  proposed_action JSONB NOT NULL DEFAULT '{}', -- what the agent wants to do
  confidence FLOAT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'proposed',
  -- 'proposed' | 'auto_executed' | 'operator_approved' | 'operator_rejected' | 'reversed'
  executed_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  reversed_by UUID REFERENCES users(id),
  operator_approved_by UUID REFERENCES users(id),
  -- Cost tracking
  model_used TEXT,
  provider_used TEXT,
  input_tokens INT,
  output_tokens INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_actions_tenant_isolation" ON agent_actions
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE INDEX idx_agent_actions_tenant_id ON agent_actions(tenant_id);
CREATE INDEX idx_agent_actions_agent_type ON agent_actions(tenant_id, agent_type);
CREATE INDEX idx_agent_actions_status ON agent_actions(tenant_id, status);
CREATE INDEX idx_agent_actions_created_at ON agent_actions(tenant_id, created_at DESC);
