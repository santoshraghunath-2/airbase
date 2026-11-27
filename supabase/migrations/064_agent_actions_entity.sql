-- Migration 064: Extend agent_actions with entity linkage, authority tier, and reversal

ALTER TABLE agent_actions
  ADD COLUMN IF NOT EXISTS entity_type   TEXT,
  ADD COLUMN IF NOT EXISTS entity_id     UUID,
  ADD COLUMN IF NOT EXISTS amount_cents  INTEGER,
  ADD COLUMN IF NOT EXISTS authority_tier authority_tier,
  ADD COLUMN IF NOT EXISTS actor_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reversal      JSONB;

COMMENT ON COLUMN agent_actions.entity_type   IS 'e.g. job, project, change_order, invoice';
COMMENT ON COLUMN agent_actions.entity_id     IS 'PK of the affected entity row';
COMMENT ON COLUMN agent_actions.amount_cents  IS 'Dollar amount for financial actions (NULL for non-financial)';
COMMENT ON COLUMN agent_actions.authority_tier IS 'Tier resolved at action time; NULL for legacy rows';
COMMENT ON COLUMN agent_actions.actor_user_id IS 'User who approved or triggered (NULL for autonomous)';
COMMENT ON COLUMN agent_actions.reversal      IS 'JSON instructions for undoing this action, if reversible';

CREATE INDEX IF NOT EXISTS idx_agent_actions_entity
  ON agent_actions (tenant_id, entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_actions_authority_tier
  ON agent_actions (tenant_id, authority_tier, created_at);
