-- Migration 052: Package components
-- Stores material + labor breakdown per pricebook package item, per option tier.
-- option = 'base' rows apply to all tiers; 'good'/'better'/'best' rows are
-- additive overrides for that tier (extra materials or different crew config).
-- Used for: contract scope generation, Phase 3 scheduling, Phase 5 job costing.

CREATE TABLE package_components (
  id                    UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pricebook_item_id     UUID          NOT NULL REFERENCES pricebook_items(id) ON DELETE CASCADE,

  -- Which option tier these components apply to.
  -- 'base' = shared baseline for all tiers that include this package item.
  -- 'good'/'better'/'best' = additive components specific to that tier.
  option                TEXT          NOT NULL DEFAULT 'base'
                          CHECK (option IN ('base', 'good', 'better', 'best')),

  -- Material line
  material_description  TEXT          NOT NULL,
  quantity              NUMERIC(8,2)  NOT NULL DEFAULT 1,
  unit                  TEXT          NOT NULL DEFAULT 'each',   -- e.g. 'sqft', 'each', 'linear_ft'
  expected_cost_cents   INTEGER       NOT NULL DEFAULT 0,

  -- Labor (populated on the row that represents the main package scope, NULL on add-on lines)
  labor_phase_name      TEXT,          -- e.g. 'Demo & Prep', 'Install', 'Trim & Finish'
  labor_hours           NUMERIC(5,1),
  crew_size             SMALLINT,
  crew_days             SMALLINT,      -- days crew is on site (excludes inspection days)
  commitment_days       SMALLINT,      -- customer-facing total days (crew_days + buffers)

  -- Margin target for this component set (set on the aggregate row, not per material line)
  target_margin_percent NUMERIC(5,2),

  sort_order            SMALLINT      NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ   DEFAULT now(),
  updated_at            TIMESTAMPTZ   DEFAULT now()
);

ALTER TABLE package_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_all_package_components" ON package_components
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER set_package_components_updated_at
  BEFORE UPDATE ON package_components
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_pkg_components_item ON package_components(tenant_id, pricebook_item_id, option);
