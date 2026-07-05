-- 032_visit_reason.sql
-- Separates "what work is done" (job_type) from "why this visit happened" (visit_reason).
-- Also adds parent_job_id so callbacks/warranties can be traced to the originating job.
--
-- visit_reason replaces the misuse of job_type = 'warranty_call' / 'recall'.
-- Those two ENUM values cannot be dropped in Postgres without recreating the type,
-- so they remain in the job_type ENUM but are excluded from all UI pickers going forward.

-- ── New ENUM ──────────────────────────────────────────────────────────────────
CREATE TYPE visit_reason AS ENUM (
  'new_request',    -- standard new service call (default)
  'callback',       -- company's prior work failed; rework at company expense
  'parts_warranty', -- manufacturer covers the part; customer pays labor
  'labor_warranty', -- company stands behind workmanship; $0 total
  'recall'          -- manufacturer safety/quality recall; $0, flag for claim
);

-- ── New columns on jobs ───────────────────────────────────────────────────────
ALTER TABLE jobs
  ADD COLUMN visit_reason  visit_reason NOT NULL DEFAULT 'new_request',
  ADD COLUMN parent_job_id UUID         REFERENCES jobs(id);

-- ── Backfill existing records ─────────────────────────────────────────────────
UPDATE jobs SET visit_reason = 'labor_warranty' WHERE job_type = 'warranty_call';
UPDATE jobs SET visit_reason = 'recall'         WHERE job_type = 'recall';

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX idx_jobs_visit_reason  ON jobs (tenant_id, visit_reason) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_parent_job_id ON jobs (parent_job_id)           WHERE parent_job_id IS NOT NULL;

-- ── RLS note ──────────────────────────────────────────────────────────────────
-- parent_job_id is a self-referential FK within jobs; existing RLS on jobs covers it.
-- No new tables, no new RLS policies required.
