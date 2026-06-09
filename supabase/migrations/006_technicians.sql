-- Migration 006: Technicians and skill tags

CREATE TABLE technicians (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  license_number TEXT,
  license_expiry DATE,
  is_active BOOLEAN DEFAULT true,
  current_latitude FLOAT,
  current_longitude FLOAT,
  last_location_update TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE technicians ENABLE ROW LEVEL SECURITY;

CREATE POLICY "technicians_tenant_isolation" ON technicians
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE INDEX idx_technicians_tenant_id ON technicians(tenant_id);
CREATE INDEX idx_technicians_user_id ON technicians(user_id);

-- Add the FK from jobs.tech_id now that technicians table exists
ALTER TABLE jobs
  ADD CONSTRAINT fk_jobs_tech_id
  FOREIGN KEY (tech_id) REFERENCES technicians(id);


-- Phase 1: simple skill tags; Phase 2 adds structured skills taxonomy
CREATE TABLE tech_skills (
  tech_id UUID NOT NULL REFERENCES technicians(id),
  skill TEXT NOT NULL,
  level TEXT DEFAULT 'proficient', -- 'learning' | 'proficient' | 'expert'
  ai_inferred BOOLEAN DEFAULT false,
  ai_confidence FLOAT,
  manually_overridden BOOLEAN DEFAULT false,
  overridden_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (tech_id, skill)
);

ALTER TABLE tech_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tech_skills_tenant_isolation" ON tech_skills
  FOR ALL USING (
    tech_id IN (
      SELECT id FROM technicians WHERE tenant_id = get_my_tenant_id()
    )
  );
