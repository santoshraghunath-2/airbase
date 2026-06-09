-- Migration 003: Customers and service locations

CREATE TABLE customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT NOT NULL,
  phone_alt TEXT,
  notes TEXT,
  source TEXT DEFAULT 'manual', -- 'inbound_call' | 'web' | 'referral' | 'booking_agent' | 'manual'
  qbo_customer_id TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_tenant_isolation" ON customers
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_customers_tenant_id ON customers(tenant_id);
CREATE INDEX idx_customers_phone ON customers(tenant_id, phone);
CREATE INDEX idx_customers_name ON customers(tenant_id, name);
-- Soft-delete filter
CREATE INDEX idx_customers_active ON customers(tenant_id) WHERE deleted_at IS NULL;


CREATE TABLE service_locations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  address TEXT NOT NULL,
  city TEXT,
  state TEXT,
  zip TEXT,
  latitude FLOAT,
  longitude FLOAT,
  location_notes TEXT,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE service_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_locations_tenant_isolation" ON service_locations
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE INDEX idx_service_locations_customer_id ON service_locations(customer_id);
CREATE INDEX idx_service_locations_tenant_id ON service_locations(tenant_id);
