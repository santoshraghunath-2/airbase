-- Migration 026: Crew-based scheduling for install jobs

CREATE TABLE job_crew (
  id        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id    UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tech_id   UUID NOT NULL REFERENCES technicians(id),
  role      TEXT NOT NULL DEFAULT 'crew'
              CHECK (role IN ('lead', 'crew', 'helper')),
  confirmed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(job_id, tech_id)
);

ALTER TABLE job_crew ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_crew_tenant_isolation" ON job_crew
  FOR ALL USING (
    job_id IN (SELECT id FROM jobs WHERE tenant_id = get_my_tenant_id())
  );

CREATE INDEX idx_job_crew_job_id  ON job_crew(job_id);
CREATE INDEX idx_job_crew_tech_id ON job_crew(tech_id);
