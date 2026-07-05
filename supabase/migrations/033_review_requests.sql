-- 033_review_requests.sql
-- Tracks outbound review solicitation SMS messages per job.
-- One row per job (unique constraint) — prevents duplicate sends.

CREATE TABLE review_requests (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id),
  job_id      UUID        NOT NULL REFERENCES jobs(id),
  customer_id UUID        NOT NULL REFERENCES customers(id),
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_by     UUID        REFERENCES users(id), -- NULL = auto-sent on job completion
  channel     TEXT        NOT NULL DEFAULT 'sms',
  review_url  TEXT,                              -- URL included in the message
  status      TEXT        NOT NULL DEFAULT 'sent', -- sent | failed
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent duplicate review requests for the same job
CREATE UNIQUE INDEX idx_review_requests_job_id ON review_requests (job_id);

CREATE INDEX idx_review_requests_tenant ON review_requests (tenant_id, sent_at DESC);

-- RLS
ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON review_requests
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY "tenant_insert" ON review_requests
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
