-- Migration 027: AI agent triggers for opportunities
-- Fires ca-dispatch-agent on new unassigned leads.
-- Fires install-crew-agent when an opportunity is marked won.

CREATE OR REPLACE FUNCTION trg_opportunities_ca_dispatch()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'new' AND NEW.assigned_to IS NULL AND
     (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'new') THEN
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

CREATE TRIGGER opportunities_ca_dispatch
  AFTER INSERT OR UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION trg_opportunities_ca_dispatch();

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_opportunities_install_crew()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'won' AND NEW.install_job_id IS NULL AND
     (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'won') THEN
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

CREATE TRIGGER opportunities_install_crew
  AFTER INSERT OR UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION trg_opportunities_install_crew();
