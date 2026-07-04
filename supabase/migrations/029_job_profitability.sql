-- 029_job_profitability.sql
-- Adds tech cost rate + job profitability view + analytics RPCs

-- ─── 1. Tech burden rate ──────────────────────────────────────────────────────

ALTER TABLE technicians
  ADD COLUMN IF NOT EXISTS cost_rate NUMERIC(10,2) DEFAULT 0;

COMMENT ON COLUMN technicians.cost_rate IS
  'Hourly burden rate (wages + payroll taxes + benefits) in USD';

-- ─── 2. Profitability view ────────────────────────────────────────────────────
-- SECURITY INVOKER (default in PG 15+) so RLS on underlying tables is respected.

CREATE OR REPLACE VIEW job_profitability AS
SELECT
  j.id                                                        AS job_id,
  j.tenant_id,
  j.tech_id,
  t.name                                                      AS tech_name,
  j.job_type::text                                            AS job_type,
  j.actual_duration_minutes,
  j.scheduled_start,
  j.created_at,
  j.customer_id,
  c.name                                                      AS customer_name,
  COALESCE(sl.city, 'Unknown zone')                           AS zone,

  -- Revenue from paid/partial invoices
  COALESCE(inv.revenue,    0)                                 AS revenue,

  -- Parts cost snapshotted via current pricebook_items.cost
  COALESCE(inv.parts_cost, 0)                                 AS parts_cost,

  -- Labor cost: actual hours × tech burden rate
  ROUND(
    COALESCE((j.actual_duration_minutes / 60.0) * COALESCE(t.cost_rate, 0), 0)
  ::NUMERIC, 2)                                               AS labor_cost,

  -- Gross profit
  ROUND((
    COALESCE(inv.revenue, 0)
    - COALESCE(inv.parts_cost, 0)
    - COALESCE((j.actual_duration_minutes / 60.0) * COALESCE(t.cost_rate, 0), 0)
  )::NUMERIC, 2)                                              AS gross_profit,

  -- Margin %
  CASE
    WHEN COALESCE(inv.revenue, 0) > 0 THEN
      ROUND((
        (COALESCE(inv.revenue, 0)
          - COALESCE(inv.parts_cost, 0)
          - COALESCE((j.actual_duration_minutes / 60.0) * COALESCE(t.cost_rate, 0), 0)
        ) / COALESCE(inv.revenue, 0) * 100
      )::NUMERIC, 1)
    ELSE NULL
  END                                                         AS margin_pct

FROM jobs j
LEFT JOIN technicians t
       ON t.id = j.tech_id
LEFT JOIN customers c
       ON c.id = j.customer_id
LEFT JOIN service_locations sl
       ON sl.customer_id = j.customer_id AND sl.is_primary = true
LEFT JOIN (
  SELECT
    i.job_id,
    i.tenant_id,
    SUM(ili.total)                                 AS revenue,
    SUM(COALESCE(pi.cost, 0) * ili.quantity)       AS parts_cost
  FROM   invoices            i
  JOIN   invoice_line_items  ili ON ili.invoice_id      = i.id
  LEFT JOIN pricebook_items  pi  ON pi.id               = ili.pricebook_item_id
  WHERE  i.status IN ('paid', 'partial')
  GROUP  BY i.job_id, i.tenant_id
) inv ON inv.job_id = j.id AND inv.tenant_id = j.tenant_id

WHERE j.deleted_at IS NULL;

-- ─── 3. KPI summary RPC ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_profitability_kpis(
  p_start DATE,
  p_end   DATE
)
RETURNS TABLE (
  total_jobs     BIGINT,
  total_revenue  NUMERIC,
  total_cost     NUMERIC,
  gross_profit   NUMERIC,
  avg_margin_pct NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    COUNT(*)::BIGINT                                          AS total_jobs,
    ROUND(SUM(revenue)::NUMERIC, 2)                          AS total_revenue,
    ROUND(SUM(parts_cost + labor_cost)::NUMERIC, 2)          AS total_cost,
    ROUND(SUM(gross_profit)::NUMERIC, 2)                     AS gross_profit,
    CASE WHEN SUM(revenue) > 0 THEN
      ROUND((SUM(gross_profit) / NULLIF(SUM(revenue), 0) * 100)::NUMERIC, 1)
    ELSE NULL END                                            AS avg_margin_pct
  FROM job_profitability
  WHERE (
    COALESCE(scheduled_start, created_at)::DATE BETWEEN p_start AND p_end
  );
$$;

-- ─── 4. Grouped breakdown RPC ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_profitability_report(
  p_start    DATE,
  p_end      DATE,
  p_group_by TEXT   -- 'tech' | 'zone' | 'job_type' | 'customer'
)
RETURNS TABLE (
  group_key    TEXT,
  job_count    BIGINT,
  revenue      NUMERIC,
  parts_cost   NUMERIC,
  labor_cost   NUMERIC,
  gross_profit NUMERIC,
  margin_pct   NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    CASE p_group_by
      WHEN 'tech'     THEN COALESCE(tech_name, 'Unassigned')
      WHEN 'zone'     THEN zone
      WHEN 'job_type' THEN REPLACE(INITCAP(REPLACE(job_type, '_', ' ')), '_', ' ')
      WHEN 'customer' THEN customer_name
    END                                                      AS group_key,
    COUNT(*)::BIGINT                                         AS job_count,
    ROUND(SUM(revenue)::NUMERIC, 2)                          AS revenue,
    ROUND(SUM(parts_cost)::NUMERIC, 2)                       AS parts_cost,
    ROUND(SUM(labor_cost)::NUMERIC, 2)                       AS labor_cost,
    ROUND(SUM(gross_profit)::NUMERIC, 2)                     AS gross_profit,
    CASE WHEN SUM(revenue) > 0 THEN
      ROUND((SUM(gross_profit) / NULLIF(SUM(revenue), 0) * 100)::NUMERIC, 1)
    ELSE NULL END                                            AS margin_pct
  FROM job_profitability
  WHERE (
    COALESCE(scheduled_start, created_at)::DATE BETWEEN p_start AND p_end
  )
  GROUP BY 1
  ORDER BY revenue DESC NULLS LAST;
$$;
