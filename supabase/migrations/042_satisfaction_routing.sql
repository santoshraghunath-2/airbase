-- Migration 042: Satisfaction-based review routing
--
-- Adds a satisfaction score flow to the post-job review sequence.
-- Instead of sending a Google link directly, the review-request agent sends
-- a "How did we do?" rating link. The rate-job Edge Function records the score
-- and routes positive experiences to Google/Yelp and negative ones internally.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS satisfaction_score      INT CHECK (satisfaction_score BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS satisfaction_rated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS satisfaction_token      UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS satisfaction_threshold INT NOT NULL DEFAULT 4;

COMMENT ON COLUMN jobs.satisfaction_token     IS 'Public token for the rate-job endpoint — no auth required, single-use.';
COMMENT ON COLUMN jobs.satisfaction_score     IS '1–5 customer satisfaction score. NULL until rated.';
COMMENT ON COLUMN tenants.satisfaction_threshold IS 'Scores >= threshold are routed to public review platforms; below goes to internal feedback.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_satisfaction_token ON jobs (satisfaction_token);
CREATE INDEX IF NOT EXISTS idx_jobs_satisfaction_score ON jobs (tenant_id, satisfaction_score) WHERE satisfaction_score IS NOT NULL;
