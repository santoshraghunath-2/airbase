-- Migration 025: Sales pipeline — opportunities table

CREATE TYPE lead_source AS ENUM (
  'service_call',
  'inbound_call',
  'marketing',
  'referral',
  'portal',
  'manual'
);

CREATE TYPE opportunity_status AS ENUM (
  'new',
  'assigned',
  'contacted',
  'visit_scheduled',
  'visit_complete',
  'won',
  'lost',
  'no_decision'
);

CREATE TABLE opportunities (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  customer_id         UUID NOT NULL REFERENCES customers(id),
  service_location_id UUID REFERENCES service_locations(id),

  -- Lead origin
  source          lead_source NOT NULL DEFAULT 'manual',
  source_job_id   UUID REFERENCES jobs(id),
  source_tech_id  UUID REFERENCES technicians(id),

  -- Assignment (CA or selling tech)
  assigned_to UUID REFERENCES technicians(id),

  -- Pipeline status
  status opportunity_status NOT NULL DEFAULT 'new',

  -- Equipment context
  equipment_id    UUID REFERENCES equipment(id),
  equipment_notes TEXT,

  -- Linked documents
  visit_job_id UUID REFERENCES jobs(id),
  estimate_id  UUID REFERENCES estimates(id),

  -- Outcome
  won_at      TIMESTAMPTZ,
  lost_at     TIMESTAMPTZ,
  lost_reason TEXT,
  close_value NUMERIC(10,2),

  -- Install scheduling result
  install_job_id UUID REFERENCES jobs(id),

  -- AI signals
  ai_score NUMERIC(3,2),
  ai_notes TEXT,

  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opportunities_tenant_isolation" ON opportunities
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER opportunities_updated_at
  BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_opportunities_tenant   ON opportunities(tenant_id);
CREATE INDEX idx_opportunities_customer ON opportunities(tenant_id, customer_id);
CREATE INDEX idx_opportunities_status   ON opportunities(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_opportunities_assigned ON opportunities(tenant_id, assigned_to) WHERE deleted_at IS NULL;

-- Estimates can be linked back to the opportunity that generated them
ALTER TABLE estimates ADD COLUMN opportunity_id UUID REFERENCES opportunities(id);

-- ─── Database triggers for AI agents ─────────────────────────────────────────
-- Run these once in the Supabase SQL editor after deploying the edge functions.

-- Trigger: CA dispatch agent fires when a new unassigned opportunity is created
--
-- CREATE OR REPLACE FUNCTION trg_opportunities_ca_dispatch()
-- RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
-- BEGIN
--   IF NEW.status = 'new' AND NEW.assigned_to IS NULL AND
--      (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'new') THEN
--     PERFORM _call_edge_function(
--       'ca-dispatch-agent',
--       jsonb_build_object('type', TG_OP, 'table', 'opportunities', 'schema', 'public',
--                          'record', row_to_json(NEW), 'old_record', row_to_json(OLD))
--     );
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
--
-- CREATE TRIGGER opportunities_ca_dispatch
--   AFTER INSERT OR UPDATE ON opportunities
--   FOR EACH ROW EXECUTE FUNCTION trg_opportunities_ca_dispatch();

-- Trigger: install crew agent fires when opportunity is marked won
--
-- CREATE OR REPLACE FUNCTION trg_opportunities_install_crew()
-- RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
-- BEGIN
--   IF NEW.status = 'won' AND NEW.install_job_id IS NULL AND
--      (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'won') THEN
--     PERFORM _call_edge_function(
--       'install-crew-agent',
--       jsonb_build_object('type', TG_OP, 'table', 'opportunities', 'schema', 'public',
--                          'record', row_to_json(NEW), 'old_record', row_to_json(OLD))
--     );
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
--
-- CREATE TRIGGER opportunities_install_crew
--   AFTER INSERT OR UPDATE ON opportunities
--   FOR EACH ROW EXECUTE FUNCTION trg_opportunities_install_crew();
