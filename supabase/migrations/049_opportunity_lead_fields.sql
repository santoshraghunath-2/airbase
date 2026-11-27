-- Migration 049: Opportunity lead qualification fields
-- Adds fields captured during remodel lead intake before a customer record exists,
-- and disqualification tracking for leads that don't meet criteria.

ALTER TABLE opportunities
  -- Retell session IDs: set when opportunity originates from a Retell voice or chat session
  ADD COLUMN IF NOT EXISTS retell_call_id    TEXT,
  ADD COLUMN IF NOT EXISTS retell_chat_id    TEXT,

  -- Lead contact before a customer record is confirmed/created
  ADD COLUMN IF NOT EXISTS lead_name         TEXT,
  ADD COLUMN IF NOT EXISTS lead_phone        TEXT,
  ADD COLUMN IF NOT EXISTS lead_email        TEXT,

  -- Qualification data collected by the AI agent
  ADD COLUMN IF NOT EXISTS project_summary   TEXT,
  ADD COLUMN IF NOT EXISTS budget_range      TEXT,  -- e.g. '$8K–$12K', '$12K–$20K', '$20K+'
  ADD COLUMN IF NOT EXISTS timeline          TEXT,  -- e.g. '1–3 months', '3–6 months', 'flexible'
  ADD COLUMN IF NOT EXISTS service_area_zip  TEXT,

  -- Disqualification (kept for analysis, never hard-deleted)
  ADD COLUMN IF NOT EXISTS disqualify_reason TEXT;

-- Index on retell IDs for quick lookup when webhook events arrive
CREATE INDEX IF NOT EXISTS idx_opportunities_retell_call ON opportunities(retell_call_id) WHERE retell_call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunities_retell_chat ON opportunities(retell_chat_id) WHERE retell_chat_id IS NOT NULL;
