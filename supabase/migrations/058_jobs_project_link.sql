-- Migration 058: add project_id and phase_id to jobs
-- Each crew day on a remodel project is an ordinary job row with these FKs set.
-- Field-service jobs leave both NULL. No other job behavior changes.

ALTER TABLE jobs
  ADD COLUMN project_id UUID REFERENCES projects(id),
  ADD COLUMN phase_id   UUID REFERENCES project_phases(id);

CREATE INDEX idx_jobs_project ON jobs(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_jobs_phase   ON jobs(phase_id)   WHERE phase_id IS NOT NULL;
