-- Migration 060: material orders
-- A project has one or more material orders placed with vendors.
-- Gate: all required lines must be received (or promised before day 1) before
-- the scheduling agent proposes a start date.

CREATE TYPE material_order_status AS ENUM (
  'draft',
  'ordered',
  'partial',
  'received',
  'cancelled'
);

CREATE TYPE material_line_status AS ENUM (
  'pending',
  'ordered',
  'received',
  'substituted',
  'cancelled'
);

CREATE TABLE material_orders (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  vendor          TEXT NOT NULL,
  status          material_order_status NOT NULL DEFAULT 'draft',
  ordered_at      TIMESTAMPTZ,
  promised_date   DATE,     -- vendor-promised delivery date
  received_at     TIMESTAMPTZ,
  total_cost_cents INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,

  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE material_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_all_material_orders" ON material_orders
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE INDEX idx_material_orders_project ON material_orders(project_id);

CREATE TABLE material_order_lines (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  material_order_id     UUID NOT NULL REFERENCES material_orders(id) ON DELETE CASCADE,
  package_component_id  UUID REFERENCES package_components(id),

  description           TEXT NOT NULL,
  quantity              NUMERIC(8,2) NOT NULL DEFAULT 1,
  unit                  TEXT NOT NULL DEFAULT 'each',
  unit_cost_cents       INTEGER NOT NULL DEFAULT 0,
  total_cost_cents      INTEGER NOT NULL DEFAULT 0,
  status                material_line_status NOT NULL DEFAULT 'pending',
  promised_date         DATE,
  received_at           TIMESTAMPTZ,
  notes                 TEXT,

  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE material_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_all_material_order_lines" ON material_order_lines
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE INDEX idx_mol_order ON material_order_lines(material_order_id);
