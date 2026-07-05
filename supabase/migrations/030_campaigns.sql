-- 030_campaigns.sql
-- Marketing campaigns: customer opt-out, campaign tables, audience resolver

-- ─── 1. Customer SMS opt-out ──────────────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS sms_opt_out    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_opt_out_at TIMESTAMPTZ;

-- ─── 2. Status enum ───────────────────────────────────────────────────────────

CREATE TYPE campaign_status AS ENUM (
  'draft', 'scheduled', 'sending', 'sent', 'cancelled'
);

-- ─── 3. Campaigns ─────────────────────────────────────────────────────────────

CREATE TABLE campaigns (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        UUID          NOT NULL REFERENCES tenants(id),
  name             TEXT          NOT NULL,
  segment          TEXT          NOT NULL,   -- reactivation | member_upsell | seasonal_blast | job_type_followup | equipment_aging
  segment_params   JSONB         DEFAULT '{}',
  channel          TEXT          DEFAULT 'sms',
  message_text     TEXT          NOT NULL,
  status           campaign_status DEFAULT 'draft',
  scheduled_at     TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  recipient_count  INT           DEFAULT 0,
  sent_count       INT           DEFAULT 0,
  failed_count     INT           DEFAULT 0,
  created_by       UUID          REFERENCES users(id),
  created_at       TIMESTAMPTZ   DEFAULT now(),
  updated_at       TIMESTAMPTZ   DEFAULT now()
);

CREATE INDEX campaigns_tenant_id_idx ON campaigns(tenant_id);
CREATE INDEX campaigns_status_idx    ON campaigns(status);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON campaigns
  USING  (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- ─── 4. Campaign recipients ───────────────────────────────────────────────────

CREATE TABLE campaign_recipients (
  id           UUID  DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id  UUID  NOT NULL REFERENCES campaigns(id),
  customer_id  UUID  NOT NULL REFERENCES customers(id),
  status       TEXT  DEFAULT 'queued',   -- queued | sent | failed | opted_out
  sent_at      TIMESTAMPTZ,
  error        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (campaign_id, customer_id)
);

CREATE INDEX campaign_recipients_campaign_id_idx ON campaign_recipients(campaign_id);
CREATE INDEX campaign_recipients_customer_id_idx ON campaign_recipients(customer_id);

ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON campaign_recipients
  USING (
    EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = campaign_recipients.campaign_id
        AND c.tenant_id = get_my_tenant_id()
    )
  );

-- ─── 5. Audience resolver ─────────────────────────────────────────────────────
-- Called by edge functions (service role) — SECURITY DEFINER is safe because
-- p_tenant_id is always passed explicitly from the validated JWT.

CREATE OR REPLACE FUNCTION resolve_campaign_audience(
  p_tenant_id  UUID,
  p_segment    TEXT,
  p_params     JSONB DEFAULT '{}'
)
RETURNS TABLE (customer_id UUID, customer_name TEXT, phone TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id    AS customer_id,
    c.name  AS customer_name,
    c.phone AS phone
  FROM customers c
  WHERE c.tenant_id    = p_tenant_id
    AND c.sms_opt_out  = false
    AND c.phone        IS NOT NULL
    AND c.deleted_at   IS NULL
    AND CASE p_segment

      WHEN 'reactivation' THEN
        NOT EXISTS (
          SELECT 1 FROM jobs j
          WHERE j.customer_id = c.id
            AND j.tenant_id   = p_tenant_id
            AND j.created_at  > NOW() - (COALESCE((p_params->>'inactive_months')::INT, 6) || ' months')::INTERVAL
            AND j.deleted_at IS NULL
        )
        AND EXISTS (
          SELECT 1 FROM jobs j2
          WHERE j2.customer_id = c.id
            AND j2.tenant_id   = p_tenant_id
            AND j2.deleted_at IS NULL
        )

      WHEN 'member_upsell' THEN
        NOT EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.customer_id = c.id
            AND m.tenant_id   = p_tenant_id
            AND m.status      = 'active'
        )

      WHEN 'seasonal_blast' THEN true

      WHEN 'job_type_followup' THEN
        EXISTS (
          SELECT 1 FROM jobs j
          WHERE j.customer_id  = c.id
            AND j.tenant_id    = p_tenant_id
            AND j.job_type::TEXT = COALESCE(p_params->>'job_type', 'plumbing_service')
            AND j.created_at   > NOW() - (COALESCE((p_params->>'days')::INT, 90) || ' days')::INTERVAL
            AND j.deleted_at   IS NULL
            AND j.status::TEXT <> 'cancelled'
        )

      WHEN 'equipment_aging' THEN
        EXISTS (
          SELECT 1 FROM equipment eq
          JOIN service_locations sl ON sl.id = eq.location_id
          WHERE sl.customer_id = c.id
            AND eq.tenant_id   = p_tenant_id
            AND eq.install_date < NOW() - (COALESCE((p_params->>'years')::INT, 10) || ' years')::INTERVAL
        )

      ELSE false
    END;
$$;
