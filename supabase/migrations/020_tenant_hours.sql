-- Per-day operating hours for each tenant
-- day_of_week: 0=Monday, 6=Sunday (matches JavaScript Date.getDay() - 1 offset)
-- open_time / close_time stored as TIME so Postgres handles timezone conversions

CREATE TABLE tenant_hours (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_open BOOLEAN NOT NULL DEFAULT true,
  open_time TIME NOT NULL DEFAULT '08:00',
  close_time TIME NOT NULL DEFAULT '17:00',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, day_of_week)
);

ALTER TABLE tenant_hours ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_hours_select" ON tenant_hours
  FOR SELECT USING (tenant_id = get_my_tenant_id());

CREATE POLICY "tenant_hours_insert" ON tenant_hours
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "tenant_hours_update" ON tenant_hours
  FOR UPDATE USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "tenant_hours_delete" ON tenant_hours
  FOR DELETE USING (tenant_id = get_my_tenant_id());

CREATE OR REPLACE FUNCTION update_tenant_hours_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER tenant_hours_updated_at
  BEFORE UPDATE ON tenant_hours
  FOR EACH ROW EXECUTE FUNCTION update_tenant_hours_updated_at();
