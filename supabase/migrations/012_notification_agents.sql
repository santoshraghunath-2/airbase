-- Migration 012: Notification agents — ETA, review requests, warranty detection
--
-- Adds review URL fields to tenants.
-- Creates pg_net triggers that fire Edge Functions on job status changes.
--
-- SETUP REQUIRED before triggers are active:
--   Run once in Supabase SQL editor after applying this migration:
--
--   ALTER DATABASE postgres SET "app.settings.supabase_url"        = 'https://<your-ref>.supabase.co';
--   ALTER DATABASE postgres SET "app.settings.service_role_key"    = '<your-service-role-key>';
--
--   Then restart Supabase (or wait for a connection refresh) for the settings to take effect.
--   Without these, the triggers will log a warning and do nothing.

-- ─── Tenant review URLs ───────────────────────────────────────────────────────

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS google_review_url TEXT,
  ADD COLUMN IF NOT EXISTS yelp_review_url TEXT;

COMMENT ON COLUMN tenants.google_review_url IS
  'Direct Google Maps review link — used by review-request agent after job completion.';

-- ─── pg_net extension ────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─── Helper: call an Edge Function from a trigger ────────────────────────────

CREATE OR REPLACE FUNCTION _call_edge_function(
  p_function_name TEXT,
  p_payload       JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_url  TEXT;
  v_key  TEXT;
BEGIN
  v_url := current_setting('app.settings.supabase_url', true);
  v_key := current_setting('app.settings.service_role_key', true);

  IF v_url IS NULL OR v_url = '' THEN
    RAISE WARNING '_call_edge_function: app.settings.supabase_url is not configured — skipping %', p_function_name;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/' || p_function_name,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := p_payload
  );
END;
$$;

-- ─── Trigger: ETA notification + review request (job UPDATE) ─────────────────

CREATE OR REPLACE FUNCTION trg_jobs_notification_agents()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- ETA notification: tech is now en_route
  IF NEW.status = 'en_route' AND OLD.status IS DISTINCT FROM 'en_route' THEN
    PERFORM _call_edge_function(
      'eta-notification',
      jsonb_build_object(
        'type',       'UPDATE',
        'table',      'jobs',
        'schema',     'public',
        'record',     row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )
    );
  END IF;

  -- Review request: job just completed
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    PERFORM _call_edge_function(
      'review-request',
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

CREATE TRIGGER jobs_notification_agents
  AFTER UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION trg_jobs_notification_agents();

-- ─── Trigger: warranty / callback detection (job INSERT) ─────────────────────

CREATE OR REPLACE FUNCTION trg_jobs_warranty_detector()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Skip if the job is already classified as a warranty or recall
  IF NEW.job_type IN ('warranty_call', 'recall') THEN
    RETURN NEW;
  END IF;

  PERFORM _call_edge_function(
    'warranty-detector',
    jsonb_build_object(
      'type',   'INSERT',
      'table',  'jobs',
      'schema', 'public',
      'record', row_to_json(NEW)
    )
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER jobs_warranty_detector
  AFTER INSERT ON jobs
  FOR EACH ROW EXECUTE FUNCTION trg_jobs_warranty_detector();
