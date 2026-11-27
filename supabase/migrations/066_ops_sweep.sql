-- Migration 066: Ops sweep findings table
--
-- sweep_findings: de-duplicated findings from the hourly ops sweep.
-- Upserting on (tenant_id, check_name, entity_id) prevents duplicates across runs.
--
-- SETUP REQUIRED after applying this migration (run in Supabase SQL editor):
--
--   -- Hourly 7am–8pm tenant time (PST = UTC-8, so 15:00–04:00 UTC)
--   SELECT cron.schedule(
--     'ops-sweep-hourly',
--     '0 15-23,0-4 * * *',
--     $$ SELECT net.http_post(
--          url     := current_setting('app.settings.supabase_url') || '/functions/v1/ops-sweep',
--          headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')),
--          body    := '{}'::jsonb
--        ) $$
--   );
--
--   -- Every 4 hours overnight (PST midnight–7am = UTC 08,12 roughly)
--   SELECT cron.schedule(
--     'ops-sweep-overnight',
--     '0 5,9 * * *',
--     $$ SELECT net.http_post(
--          url     := current_setting('app.settings.supabase_url') || '/functions/v1/ops-sweep',
--          headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')),
--          body    := '{}'::jsonb
--        ) $$
--   );

CREATE TABLE sweep_findings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  check_name   TEXT NOT NULL,                  -- e.g. 'lead_no_response', 'phase_overdue'
  entity_type  TEXT,                           -- e.g. 'opportunity', 'project_phase'
  entity_id    UUID,
  severity     TEXT NOT NULL DEFAULT 'warning', -- 'critical' | 'warning' | 'info'
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  action_id    UUID REFERENCES agent_actions(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, check_name, entity_id)
);

ALTER TABLE sweep_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_read_sweep_findings"
  ON sweep_findings FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE auth_id = auth.uid()
    )
  );

CREATE INDEX idx_sweep_findings_tenant_active
  ON sweep_findings (tenant_id, severity, last_seen)
  WHERE resolved_at IS NULL;

CREATE INDEX idx_sweep_findings_entity
  ON sweep_findings (entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

-- Also add a pause switch to agent_config: when paused = true the authority
-- engine treats all tiers as 'ask_first' (but never drops a 'never' to something else).
ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN agent_config.paused IS 'Owner switch: pauses ALL autonomous actions for this agent type. ask_first still notifies.';
