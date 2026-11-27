-- 068_project_costs.sql
-- Phase 5 (Remodel — Billing & Books): project cost tracking + profitability view.
--
-- project_costs: manually-logged labor and other costs against a project.
--   Materials are tracked separately via material_orders (migration 060).
-- project_profitability view: combines contract total, material_orders, and
--   project_costs to show true gross margin per project.

-- ─── 1. project_costs table ───────────────────────────────────────────────────

CREATE TYPE project_cost_type AS ENUM ('labor', 'material', 'other');

CREATE TABLE project_costs (
  id           UUID               DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    UUID               NOT NULL REFERENCES tenants(id)      ON DELETE CASCADE,
  project_id   UUID               NOT NULL REFERENCES projects(id)     ON DELETE CASCADE,

  cost_type    project_cost_type  NOT NULL DEFAULT 'other',
  description  TEXT               NOT NULL,
  amount_cents INTEGER            NOT NULL CHECK (amount_cents >= 0),

  tech_id      UUID               REFERENCES technicians(id),   -- set when cost_type = 'labor'
  logged_by    UUID               REFERENCES users(id),
  occurred_at  DATE               NOT NULL DEFAULT CURRENT_DATE,
  notes        TEXT,

  created_at   TIMESTAMPTZ        DEFAULT now(),
  updated_at   TIMESTAMPTZ        DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

ALTER TABLE project_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_all_project_costs" ON project_costs
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER project_costs_updated_at
  BEFORE UPDATE ON project_costs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_project_costs_project
  ON project_costs(project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_project_costs_tenant
  ON project_costs(tenant_id, occurred_at DESC) WHERE deleted_at IS NULL;

-- ─── 2. project_profitability view ───────────────────────────────────────────
-- Revenue = contract total_cents (what was sold).
-- Costs:
--   Labor   = project_costs WHERE cost_type = 'labor'
--   Material = received material_orders (actual invoice total_cost_cents)
--             + project_costs WHERE cost_type = 'material' (miscellaneous material spend)
--   Other   = project_costs WHERE cost_type = 'other'
-- Collected = milestone invoices that reached 'paid' status.

CREATE OR REPLACE VIEW project_profitability AS
SELECT
  p.id                                                            AS project_id,
  p.tenant_id,
  p.name                                                          AS project_name,
  p.status                                                        AS project_status,
  p.customer_id,
  p.contract_id,
  p.actual_start,
  p.actual_completion,

  -- Contracted revenue (the number to measure margin against)
  COALESCE(c.total_cents, 0)                                      AS contract_total_cents,

  -- Cash actually collected (paid milestones)
  COALESCE(paid.collected_cents, 0)                               AS collected_cents,

  -- Labor cost (manually logged via project_costs)
  COALESCE(pc_labor.amount_cents, 0)                              AS labor_cost_cents,

  -- Material cost: received orders + direct project_cost entries
  (
    COALESCE(mo_mat.total_cost_cents, 0)
    + COALESCE(pc_material.amount_cents, 0)
  )                                                               AS material_cost_cents,

  -- Other costs
  COALESCE(pc_other.amount_cents, 0)                              AS other_cost_cents,

  -- Total cost
  (
    COALESCE(pc_labor.amount_cents, 0)
    + COALESCE(mo_mat.total_cost_cents, 0)
    + COALESCE(pc_material.amount_cents, 0)
    + COALESCE(pc_other.amount_cents, 0)
  )                                                               AS total_cost_cents,

  -- Gross profit (contract vs. actual costs)
  (
    COALESCE(c.total_cents, 0)
    - COALESCE(pc_labor.amount_cents, 0)
    - COALESCE(mo_mat.total_cost_cents, 0)
    - COALESCE(pc_material.amount_cents, 0)
    - COALESCE(pc_other.amount_cents, 0)
  )                                                               AS gross_profit_cents,

  -- Gross margin % (NULL if no contract value)
  CASE WHEN COALESCE(c.total_cents, 0) > 0 THEN
    ROUND((
      (COALESCE(c.total_cents, 0)
        - COALESCE(pc_labor.amount_cents, 0)
        - COALESCE(mo_mat.total_cost_cents, 0)
        - COALESCE(pc_material.amount_cents, 0)
        - COALESCE(pc_other.amount_cents, 0)
      )::NUMERIC / c.total_cents * 100
    ), 1)
  ELSE NULL END                                                   AS margin_pct

FROM projects p

LEFT JOIN contracts c
       ON c.id = p.contract_id

-- Paid milestones (amount collected so far)
LEFT JOIN (
  SELECT psi.contract_id, SUM(psi.amount_cents) AS collected_cents
  FROM   payment_schedule_items psi
  WHERE  psi.status = 'paid'
  GROUP  BY psi.contract_id
) paid ON paid.contract_id = p.contract_id

-- Labor costs
LEFT JOIN (
  SELECT project_id, SUM(amount_cents) AS amount_cents
  FROM   project_costs
  WHERE  cost_type = 'labor' AND deleted_at IS NULL
  GROUP  BY project_id
) pc_labor ON pc_labor.project_id = p.id

-- Material orders (received)
LEFT JOIN (
  SELECT project_id, SUM(total_cost_cents) AS total_cost_cents
  FROM   material_orders
  WHERE  status = 'received'
  GROUP  BY project_id
) mo_mat ON mo_mat.project_id = p.id

-- Direct material entries via project_costs
LEFT JOIN (
  SELECT project_id, SUM(amount_cents) AS amount_cents
  FROM   project_costs
  WHERE  cost_type = 'material' AND deleted_at IS NULL
  GROUP  BY project_id
) pc_material ON pc_material.project_id = p.id

-- Other costs
LEFT JOIN (
  SELECT project_id, SUM(amount_cents) AS amount_cents
  FROM   project_costs
  WHERE  cost_type = 'other' AND deleted_at IS NULL
  GROUP  BY project_id
) pc_other ON pc_other.project_id = p.id

WHERE p.deleted_at IS NULL;
