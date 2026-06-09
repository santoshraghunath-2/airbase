-- Migration 004: Equipment per service location

CREATE TABLE equipment (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  location_id UUID NOT NULL REFERENCES service_locations(id),
  category TEXT NOT NULL, -- 'hvac' | 'plumbing' | 'electrical' | 'water_heater' | etc
  make TEXT,
  model TEXT,
  serial_number TEXT,
  install_date DATE,
  warranty_expiry DATE,
  last_service_date DATE,
  notes TEXT,
  nameplate_photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "equipment_tenant_isolation" ON equipment
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER equipment_updated_at
  BEFORE UPDATE ON equipment
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_equipment_location_id ON equipment(location_id);
CREATE INDEX idx_equipment_tenant_id ON equipment(tenant_id);
