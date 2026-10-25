-- Migration 040: Database triggers for dispatch-agent and invoice-agent
--
-- These were previously only documented as comments in the Edge Function source files
-- and required manual setup in the Supabase SQL editor. This migration makes them
-- part of the standard schema so they apply on every fresh deployment.
--
-- Depends on: _call_edge_function() from migration 012_notification_agents.sql
-- SETUP REQUIRED: app.settings.supabase_url and app.settings.service_role_key must be
-- configured in the DB (see migration 012 header) for these to actually fire.

-- ─── Dispatch agent trigger ───────────────────────────────────────────────────
-- Fires whenever a job enters 'unassigned' status (on INSERT or status change).

CREATE OR REPLACE FUNCTION trg_jobs_dispatch_agent()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (NEW.status = 'unassigned') AND
     (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'unassigned') THEN
    PERFORM _call_edge_function(
      'dispatch-agent',
      jsonb_build_object(
        'type',       TG_OP,
        'table',      'jobs',
        'schema',     'public',
        'record',     row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_dispatch_agent ON jobs;

CREATE TRIGGER jobs_dispatch_agent
  AFTER INSERT OR UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION trg_jobs_dispatch_agent();

-- ─── Invoice agent trigger ────────────────────────────────────────────────────
-- Fires when a job transitions to 'completed'. Does NOT double-fire with
-- close-job's direct call because close-job sends an incompatible payload
-- format that is silently skipped by invoice-agent's payload guard.

CREATE OR REPLACE FUNCTION trg_jobs_invoice_agent()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    PERFORM _call_edge_function(
      'invoice-agent',
      jsonb_build_object(
        'type',       'UPDATE',
        'table',      'jobs',
        'schema',     'public',
        'record',     row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_invoice_agent ON jobs;

CREATE TRIGGER jobs_invoice_agent
  AFTER UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION trg_jobs_invoice_agent();
