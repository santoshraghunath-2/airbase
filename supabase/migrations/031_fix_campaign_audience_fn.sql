-- 031_fix_campaign_audience_fn.sql
-- Replaces the LANGUAGE sql version of resolve_campaign_audience with
-- LANGUAGE plpgsql. PL/pgSQL uses lazy plan binding so table references
-- are resolved at call time, not at CREATE FUNCTION time. The member_upsell
-- branch additionally uses EXECUTE (dynamic SQL) to guard against the
-- memberships table not yet existing in older installs.

CREATE OR REPLACE FUNCTION resolve_campaign_audience(
  p_tenant_id  UUID,
  p_segment    TEXT,
  p_params     JSONB DEFAULT '{}'
)
RETURNS TABLE (customer_id UUID, customer_name TEXT, phone TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

  -- ── Win-back: had a job before but none in the last N months ──────────────
  IF p_segment = 'reactivation' THEN
    RETURN QUERY
      SELECT c.id, c.name, c.phone
      FROM   customers c
      WHERE  c.tenant_id   = p_tenant_id
        AND  c.sms_opt_out = false
        AND  c.phone       IS NOT NULL
        AND  c.deleted_at  IS NULL
        AND  NOT EXISTS (
               SELECT 1 FROM jobs j
               WHERE  j.customer_id = c.id
                 AND  j.tenant_id   = p_tenant_id
                 AND  j.created_at  > NOW() - (COALESCE((p_params->>'inactive_months')::INT, 6) || ' months')::INTERVAL
                 AND  j.deleted_at IS NULL
             )
        AND  EXISTS (
               SELECT 1 FROM jobs j2
               WHERE  j2.customer_id = c.id
                 AND  j2.tenant_id   = p_tenant_id
                 AND  j2.deleted_at IS NULL
             );

  -- ── Membership upsell: active customers with no active membership ─────────
  -- EXECUTE defers the memberships table reference to call time, so this
  -- function can be created even before 021_memberships.sql is run.
  ELSIF p_segment = 'member_upsell' THEN
    RETURN QUERY EXECUTE
      $q$
      SELECT c.id, c.name, c.phone
      FROM   customers c
      WHERE  c.tenant_id   = $1
        AND  c.sms_opt_out = false
        AND  c.phone       IS NOT NULL
        AND  c.deleted_at  IS NULL
        AND  NOT EXISTS (
               SELECT 1 FROM memberships m
               WHERE  m.customer_id = c.id
                 AND  m.tenant_id   = $1
                 AND  m.status      = 'active'
             )
      $q$
    USING p_tenant_id;

  -- ── Seasonal blast: every customer with a phone ───────────────────────────
  ELSIF p_segment = 'seasonal_blast' THEN
    RETURN QUERY
      SELECT c.id, c.name, c.phone
      FROM   customers c
      WHERE  c.tenant_id   = p_tenant_id
        AND  c.sms_opt_out = false
        AND  c.phone       IS NOT NULL
        AND  c.deleted_at  IS NULL;

  -- ── Job-type follow-up ────────────────────────────────────────────────────
  ELSIF p_segment = 'job_type_followup' THEN
    RETURN QUERY
      SELECT c.id, c.name, c.phone
      FROM   customers c
      WHERE  c.tenant_id   = p_tenant_id
        AND  c.sms_opt_out = false
        AND  c.phone       IS NOT NULL
        AND  c.deleted_at  IS NULL
        AND  EXISTS (
               SELECT 1 FROM jobs j
               WHERE  j.customer_id  = c.id
                 AND  j.tenant_id    = p_tenant_id
                 AND  j.job_type::TEXT = COALESCE(p_params->>'job_type', 'plumbing_service')
                 AND  j.created_at   > NOW() - (COALESCE((p_params->>'days')::INT, 90) || ' days')::INTERVAL
                 AND  j.deleted_at   IS NULL
                 AND  j.status::TEXT <> 'cancelled'
             );

  -- ── Equipment aging ───────────────────────────────────────────────────────
  ELSIF p_segment = 'equipment_aging' THEN
    RETURN QUERY
      SELECT c.id, c.name, c.phone
      FROM   customers c
      WHERE  c.tenant_id   = p_tenant_id
        AND  c.sms_opt_out = false
        AND  c.phone       IS NOT NULL
        AND  c.deleted_at  IS NULL
        AND  EXISTS (
               SELECT 1 FROM equipment eq
               JOIN  service_locations sl ON sl.id = eq.location_id
               WHERE  sl.customer_id = c.id
                 AND  eq.tenant_id   = p_tenant_id
                 AND  eq.install_date < NOW() - (COALESCE((p_params->>'years')::INT, 10) || ' years')::INTERVAL
             );

  END IF;
END;
$$;
