-- Migration 061: change orders
-- Triggered by a crew member reporting a hidden condition.
-- A signed change order updates the contract total and adds a payment_schedule_items row.
-- Jobs for the extra work cannot be scheduled until the change order is signed.

CREATE TYPE change_order_status AS ENUM (
  'draft',
  'needs_pricing',  -- no matching pricebook item found, office must price
  'sent',
  'signed',
  'declined',
  'void'
);

CREATE TABLE change_orders (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contract_id       UUID NOT NULL REFERENCES contracts(id),

  -- Description
  title             TEXT NOT NULL,
  description       TEXT,
  reported_by       UUID REFERENCES users(id),
  photo_urls        TEXT[] NOT NULL DEFAULT '{}',

  -- Pricing
  amount_cents      INTEGER NOT NULL DEFAULT 0,
  status            change_order_status NOT NULL DEFAULT 'draft',

  -- E-sign (uses same EsignProvider interface from Phase 2)
  esign_provider    TEXT,
  esign_envelope_id TEXT,
  pdf_path          TEXT,
  signed_pdf_path   TEXT,
  signed_at         TIMESTAMPTZ,
  signer_name       TEXT,

  -- Soft delete
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE change_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_all_change_orders" ON change_orders
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE INDEX idx_change_orders_project  ON change_orders(project_id);
CREATE INDEX idx_change_orders_contract ON change_orders(contract_id);

CREATE TABLE change_order_lines (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  change_order_id       UUID NOT NULL REFERENCES change_orders(id) ON DELETE CASCADE,
  pricebook_item_id     UUID REFERENCES pricebook_items(id),

  description           TEXT NOT NULL,
  quantity              NUMERIC(8,2) NOT NULL DEFAULT 1,
  unit_price_cents      INTEGER NOT NULL DEFAULT 0,
  total_cents           INTEGER NOT NULL DEFAULT 0,

  created_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE change_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_all_change_order_lines" ON change_order_lines
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE INDEX idx_col_change_order ON change_order_lines(change_order_id);
