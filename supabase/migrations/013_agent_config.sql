-- Migration 013: Agent configuration
--
-- Per-tenant, per-agent-type thresholds and auto-execute flags.
-- Every AI agent checks this table before acting.
-- Rows are created on demand by agent-base.ts when an agent first runs.

CREATE TABLE agent_config (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id            UUID NOT NULL REFERENCES tenants(id),
  agent_type           TEXT NOT NULL,
  -- 'dispatch' | 'booking_sms' | 'booking_voice' | 'invoice'
  -- 'operator' | 'tech_assistant' | 'membership'
  -- 'eta_notification' | 'review_request' | 'warranty_detector'

  -- Model override: tenant can pick a different model per agent.
  -- NULL → fall back to tenants.default_model_id → platform default.
  model_id             TEXT,

  -- Confidence gate: agent auto-executes when confidence >= this value.
  -- Below it, action is written with status='proposed' for operator review.
  confidence_threshold FLOAT NOT NULL DEFAULT 0.85,

  -- Master kill-switch per agent type. Disabled agents still log to
  -- agent_actions but take no real-world action.
  enabled              BOOLEAN NOT NULL DEFAULT true,

  -- Auto-execute flag. When false, ALL actions go to 'proposed' regardless
  -- of confidence (useful during rollout / burn-in period).
  auto_execute         BOOLEAN NOT NULL DEFAULT false,

  -- Agent-specific knobs stored as open-ended JSON.
  -- Examples:
  --   dispatch:           { "max_drive_minutes": 45 }
  --   warranty_detector:  { "window_days": 30 }
  --   review_request:     { "delay_minutes": 0 }
  settings             JSONB NOT NULL DEFAULT '{}',

  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now(),

  UNIQUE (tenant_id, agent_type)
);

ALTER TABLE agent_config ENABLE ROW LEVEL SECURITY;

-- Operators can read their own tenant's config; only owners can write it.
-- (Write restriction is enforced at the API layer via useFeatureGate / role check.)
CREATE POLICY "agent_config_tenant_isolation" ON agent_config
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER agent_config_updated_at
  BEFORE UPDATE ON agent_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_agent_config_tenant_id ON agent_config(tenant_id);
CREATE INDEX idx_agent_config_agent_type ON agent_config(tenant_id, agent_type);
