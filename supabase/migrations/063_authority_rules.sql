-- Migration 063: Authority rules — per-tenant per-action tier configuration
--
-- resolveTier(tenantId, actionType, amountCents) looks here to decide:
--   act            → execute immediately and log
--   act_and_report → execute, log, add to daily digest
--   ask_first      → write proposed action, notify approver
--   never          → refuse (action not exposed as a tool)
--
-- A tenant with no rows keeps confidence-threshold behavior (backward-compat).

CREATE TYPE authority_tier AS ENUM ('act', 'act_and_report', 'ask_first', 'never');

CREATE TABLE authority_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  action_type     TEXT NOT NULL,
  tier            authority_tier NOT NULL,
  limit_cents     INTEGER,       -- NULL = applies regardless of amount
  condition       JSONB,         -- reserved for future complex conditions
  approver_role   TEXT,          -- role to notify when tier = ask_first
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One action can have two rows (below / above a dollar limit), but not two
  -- rows with identical (tenant, action_type, limit_cents).
  UNIQUE (tenant_id, action_type, limit_cents)
);

ALTER TABLE authority_rules ENABLE ROW LEVEL SECURITY;

-- Operators can read; owners can read+write.
CREATE POLICY "tenant_read_authority_rules"
  ON authority_rules FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE auth_id = auth.uid()
    )
  );

CREATE POLICY "owner_write_authority_rules"
  ON authority_rules FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE auth_id = auth.uid() AND role = 'owner'
    )
  );

CREATE INDEX idx_authority_rules_tenant_action
  ON authority_rules (tenant_id, action_type);

CREATE INDEX idx_authority_rules_updated ON authority_rules (updated_at);
