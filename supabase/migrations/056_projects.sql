-- Migration 056: projects
-- A remodel project ties together the contract, all crew days, phases,
-- permits, material orders and change orders for one job site.

CREATE TYPE project_status AS ENUM (
  'pending_start',
  'scheduled',
  'in_progress',
  'punch_list',
  'complete',
  'on_hold',
  'cancelled'
);

CREATE TABLE projects (
  id                        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id                 UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id               UUID NOT NULL REFERENCES customers(id),
  service_location_id       UUID REFERENCES service_locations(id),
  opportunity_id            UUID REFERENCES opportunities(id),
  estimate_id               UUID REFERENCES estimates(id),
  contract_id               UUID REFERENCES contracts(id),

  -- Identity
  name                      TEXT NOT NULL,  -- e.g. "Smith – Tub to Shower"
  package_pricebook_item_id UUID REFERENCES pricebook_items(id),

  -- Status & timeline
  status                    project_status NOT NULL DEFAULT 'pending_start',
  target_start              DATE,
  target_completion         DATE,
  actual_start              DATE,
  actual_completion         DATE,

  -- Commitment tracking (B&P §7159 and customer-facing promise)
  commitment_days           SMALLINT,          -- business days promised to customer
  commitment_clock_start    DATE,              -- permit issued date, or effective date if no permit

  -- Soft delete
  deleted_at                TIMESTAMPTZ,
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_all_projects" ON projects
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE INDEX idx_projects_tenant_status ON projects(tenant_id, status);
CREATE INDEX idx_projects_contract      ON projects(contract_id);
CREATE INDEX idx_projects_customer      ON projects(tenant_id, customer_id);
