-- Migration 051: Lead intake infrastructure
-- Adds: lead_intake_sources table, tenant contact columns,
--       install-crew and CA-dispatch trigger guards for remodel tenants.

-- ─── Tenant contact info ──────────────────────────────────────────────────────

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,   -- E.164, used for outbound Retell calls
  ADD COLUMN IF NOT EXISTS website       TEXT;

-- ─── Lead intake sources ──────────────────────────────────────────────────────
-- Each row represents a channel that can submit leads (web form, landing page, etc.)
-- The hmac_secret is used to verify HMAC-SHA256 signatures from that source.

CREATE TABLE IF NOT EXISTS lead_intake_sources (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,          -- e.g. 'Website – Main'
  slug        TEXT NOT NULL,          -- e.g. 'web-main' (URL-safe)
  hmac_secret TEXT NOT NULL,          -- set via Supabase secrets or stored encrypted
  is_active   BOOLEAN NOT NULL DEFAULT true,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

ALTER TABLE lead_intake_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_intake_sources_tenant_isolation" ON lead_intake_sources
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER lead_intake_sources_updated_at
  BEFORE UPDATE ON lead_intake_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_lead_intake_tenant ON lead_intake_sources(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_intake_tenant_slug
  ON lead_intake_sources(tenant_id, slug)
  WHERE deleted_at IS NULL;

-- FK back from opportunities (added after lead_intake_sources exists)
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS intake_source_id UUID REFERENCES lead_intake_sources(id);

-- ─── Trigger guards for remodel tenants ──────────────────────────────────────
-- The CA-dispatch and install-crew agents are field-service concepts.
-- Remodel tenants use the Retell chat + booking path instead.

CREATE OR REPLACE FUNCTION trg_opportunities_ca_dispatch()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'new' AND NEW.assigned_to IS NULL AND
     (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'new') THEN
    -- Remodel tenants handle lead routing via retell-chat-webhook + remodel tools
    IF (SELECT trade FROM tenants WHERE id = NEW.tenant_id) = 'remodel' THEN
      RETURN NEW;
    END IF;
    PERFORM _call_edge_function(
      'ca-dispatch-agent',
      jsonb_build_object(
        'type',       TG_OP,
        'table',      'opportunities',
        'schema',     'public',
        'record',     row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_opportunities_install_crew()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'won' AND NEW.install_job_id IS NULL AND
     (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'won') THEN
    -- Remodel installs are scheduled via a separate Phase 2 workflow, not install-crew-agent
    IF (SELECT trade FROM tenants WHERE id = NEW.tenant_id) = 'remodel' THEN
      RETURN NEW;
    END IF;
    PERFORM _call_edge_function(
      'install-crew-agent',
      jsonb_build_object(
        'type',       TG_OP,
        'table',      'opportunities',
        'schema',     'public',
        'record',     row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ─── pg_cron: lead follow-up cadence ─────────────────────────────────────────
-- Run the lead-follow-up edge function every 2 hours to send cadence SMS touches.
-- Execute in the Supabase SQL editor after deploying lead-follow-up:
--
-- SELECT cron.schedule(
--   'lead-follow-up-cadence',
--   '0 */2 * * *',
--   $$
--   SELECT net.http_post(
--     url := current_setting('app.supabase_url') || '/functions/v1/lead-follow-up',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || current_setting('app.service_role_key')
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
