-- 067_tech_cost_rate.sql
-- Phase 5 (Remodel — Billing & Books): loaded hourly cost rate for installers,
-- and schema changes to support remodel milestone invoices that are linked to
-- a contract/project rather than a field-service job.

-- ─── 1. Loaded hourly cost on technicians ─────────────────────────────────────
-- Separate from cost_rate (USD float) added in 029 for field-service profitability.
-- This column is in cents and covers the fully-loaded installer rate for remodel
-- job costing (wages + taxes + benefits + tools).
-- PLACEHOLDER: set actual values per installer before profitability numbers are real.

ALTER TABLE technicians
  ADD COLUMN IF NOT EXISTS loaded_hourly_cost_cents INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN technicians.loaded_hourly_cost_cents IS
  'Fully-loaded hourly cost in cents for remodel project costing. PLACEHOLDER: populate per installer.';

-- ─── 2. Make invoices.job_id nullable + add project/contract FKs ──────────────
-- Remodel milestone invoices are linked to a contract and project, not a job.
-- Field-service invoices still always have job_id set.

ALTER TABLE invoices
  ALTER COLUMN job_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS project_id  UUID REFERENCES projects(id),
  ADD COLUMN IF NOT EXISTS contract_id UUID REFERENCES contracts(id);

-- Ensure every invoice still has at least one anchor.
ALTER TABLE invoices
  ADD CONSTRAINT invoices_requires_job_or_contract
    CHECK (job_id IS NOT NULL OR contract_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_invoices_project
  ON invoices(project_id)  WHERE project_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_contract
  ON invoices(contract_id) WHERE contract_id IS NOT NULL;

-- ─── 3. Guard invoice-agent trigger: skip remodel crew-day jobs ───────────────
-- Remodel crew-day jobs have project_id set. Their invoicing goes through
-- milestone-invoice, not invoice-agent. Prevents double-invoicing.

CREATE OR REPLACE FUNCTION trg_jobs_invoice_agent()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Remodel crew-day jobs (project_id IS NOT NULL) are invoiced via
  -- milestone-invoice on payment schedule trigger events, not here.
  IF NEW.project_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    PERFORM _call_edge_function(
      'invoice-agent',
      jsonb_build_object('type', 'UPDATE', 'table', 'jobs', 'schema', 'public',
                         'record', row_to_json(NEW), 'old_record', row_to_json(OLD))
    );
  END IF;
  RETURN NEW;
END;
$$;
