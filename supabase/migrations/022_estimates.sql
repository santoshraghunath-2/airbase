-- ─── Estimates ───────────────────────────────────────────────────────────────

CREATE TYPE estimate_status AS ENUM (
  'draft',
  'sent',
  'accepted',
  'declined',
  'expired',
  'converted'   -- accepted and turned into a job
);

CREATE TABLE estimates (
  id                      UUID            DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id               UUID            NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id             UUID            NOT NULL REFERENCES customers(id),
  location_id             UUID            REFERENCES service_locations(id),
  job_id                  UUID            REFERENCES jobs(id),          -- pre-existing job this estimate is for
  tech_id                 UUID            REFERENCES technicians(id),
  title                   TEXT            NOT NULL DEFAULT 'Estimate',
  status                  estimate_status NOT NULL DEFAULT 'draft',
  presentation_mode       TEXT            NOT NULL DEFAULT 'good_better_best'
                            CHECK (presentation_mode IN ('single', 'good_better_best')),
  selected_option         TEXT            CHECK (selected_option IN ('good', 'better', 'best', 'base')),
  notes                   TEXT,
  internal_notes          TEXT,
  valid_until             DATE,
  -- tracking
  sent_at                 TIMESTAMPTZ,
  accepted_at             TIMESTAMPTZ,
  declined_at             TIMESTAMPTZ,
  converted_job_id        UUID            REFERENCES jobs(id),          -- job created on acceptance
  -- AI
  ai_generated            BOOLEAN         NOT NULL DEFAULT false,
  ai_upsell_suggestions   JSONB           DEFAULT '[]'::jsonb,          -- [{description, reason, price_cents}]
  -- financing
  wisetack_application_id TEXT,
  wisetack_offer_url      TEXT,
  -- soft delete
  deleted_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ     DEFAULT now(),
  updated_at              TIMESTAMPTZ     DEFAULT now()
);

ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select_estimates" ON estimates
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY "tenant_insert_estimates" ON estimates
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "tenant_update_estimates" ON estimates
  FOR UPDATE USING (tenant_id = get_my_tenant_id());
CREATE POLICY "tenant_delete_estimates" ON estimates
  FOR DELETE USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER set_estimates_updated_at
  BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Estimate Line Items ──────────────────────────────────────────────────────

CREATE TABLE estimate_line_items (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  estimate_id       UUID        NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  option            TEXT        NOT NULL DEFAULT 'base'
                      CHECK (option IN ('good', 'better', 'best', 'base')),
  pricebook_item_id UUID        REFERENCES pricebook_items(id),
  description       TEXT        NOT NULL,
  quantity          NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price_cents  INTEGER     NOT NULL DEFAULT 0,
  total_cents       INTEGER     GENERATED ALWAYS AS (ROUND(quantity * unit_price_cents)::INTEGER) STORED,
  is_upsell         BOOLEAN     NOT NULL DEFAULT false,  -- AI-suggested add-on
  sort_order        SMALLINT    NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- No RLS needed — access controlled via parent estimates table + cascade delete
-- But enable it for safety
ALTER TABLE estimate_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select_estimate_items" ON estimate_line_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM estimates e
      WHERE e.id = estimate_id AND e.tenant_id = get_my_tenant_id()
    )
  );
CREATE POLICY "tenant_insert_estimate_items" ON estimate_line_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM estimates e
      WHERE e.id = estimate_id AND e.tenant_id = get_my_tenant_id()
    )
  );
CREATE POLICY "tenant_update_estimate_items" ON estimate_line_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM estimates e
      WHERE e.id = estimate_id AND e.tenant_id = get_my_tenant_id()
    )
  );
CREATE POLICY "tenant_delete_estimate_items" ON estimate_line_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM estimates e
      WHERE e.id = estimate_id AND e.tenant_id = get_my_tenant_id()
    )
  );

-- Index for fast line-item lookups by estimate
CREATE INDEX idx_estimate_line_items_estimate_id ON estimate_line_items(estimate_id);
CREATE INDEX idx_estimates_tenant_customer ON estimates(tenant_id, customer_id);
CREATE INDEX idx_estimates_status ON estimates(tenant_id, status) WHERE deleted_at IS NULL;
