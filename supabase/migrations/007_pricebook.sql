-- Migration 007: Pricebook items

CREATE TYPE pricebook_item_type AS ENUM ('service', 'part', 'material', 'labor', 'fee');

CREATE TABLE pricebook_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  item_type pricebook_item_type NOT NULL,
  category TEXT,
  unit_price NUMERIC(10,2) NOT NULL,
  cost NUMERIC(10,2),
  sku TEXT,
  taxable BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pricebook_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pricebook_tenant_isolation" ON pricebook_items
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER pricebook_items_updated_at
  BEFORE UPDATE ON pricebook_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_pricebook_tenant_id ON pricebook_items(tenant_id);
CREATE INDEX idx_pricebook_category ON pricebook_items(tenant_id, category);
CREATE INDEX idx_pricebook_active ON pricebook_items(tenant_id) WHERE is_active = true;
