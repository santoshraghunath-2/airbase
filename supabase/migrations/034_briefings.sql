-- 034_briefings.sql
-- Stores AI-generated weekly business briefings per tenant.
-- One row per generation; the latest row for a tenant is the active briefing.

CREATE TABLE briefings (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        UUID        NOT NULL REFERENCES tenants(id),
  period_start     DATE        NOT NULL,
  period_end       DATE        NOT NULL,
  headline         TEXT        NOT NULL DEFAULT '',
  highlights       TEXT[]      NOT NULL DEFAULT '{}',
  watch_items      TEXT[]      NOT NULL DEFAULT '{}',
  recommendation   TEXT        NOT NULL DEFAULT '',
  metrics_snapshot JSONB       NOT NULL DEFAULT '{}',
  model_used       TEXT,
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_briefings_tenant ON briefings (tenant_id, generated_at DESC);

ALTER TABLE briefings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON briefings
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY "tenant_insert" ON briefings
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
