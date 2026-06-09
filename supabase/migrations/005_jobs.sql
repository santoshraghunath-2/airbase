-- Migration 005: Jobs

CREATE TYPE job_status AS ENUM (
  'scheduled', 'unassigned', 'dispatched', 'en_route',
  'arrived', 'in_progress', 'completed', 'invoiced',
  'cancelled', 'no_show'
);
CREATE TYPE job_priority AS ENUM ('emergency', 'high', 'normal', 'low');
CREATE TYPE job_type AS ENUM (
  'plumbing_service', 'drain_cleaning', 'water_heater_repair', 'water_heater_install',
  'hvac_service', 'hvac_repair', 'hvac_install', 'hvac_maintenance',
  'electrical_service', 'electrical_repair', 'electrical_install',
  'general_maintenance', 'estimate_only', 'warranty_call', 'recall'
);

-- Forward reference: memberships table added in Phase 3.
-- The FK is added via ALTER TABLE in a later migration; for now we store the UUID only.
CREATE TABLE jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  location_id UUID NOT NULL REFERENCES service_locations(id),
  tech_id UUID, -- FK to technicians(id) added in 006_technicians.sql via ALTER TABLE
  dispatched_by UUID REFERENCES users(id),
  job_type job_type NOT NULL,
  status job_status DEFAULT 'unassigned',
  priority job_priority DEFAULT 'normal',
  description TEXT,
  internal_notes TEXT,
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  actual_start TIMESTAMPTZ,
  actual_end TIMESTAMPTZ,
  source TEXT DEFAULT 'manual',
  membership_id UUID,
  requires_skill TEXT,
  estimated_duration_minutes INT,
  actual_duration_minutes INT,
  travel_time_minutes INT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jobs_tenant_isolation" ON jobs
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_jobs_tenant_id ON jobs(tenant_id);
CREATE INDEX idx_jobs_tech_id ON jobs(tech_id);
CREATE INDEX idx_jobs_customer_id ON jobs(customer_id);
CREATE INDEX idx_jobs_status ON jobs(tenant_id, status);
CREATE INDEX idx_jobs_scheduled_start ON jobs(tenant_id, scheduled_start);
CREATE INDEX idx_jobs_active ON jobs(tenant_id) WHERE deleted_at IS NULL;
