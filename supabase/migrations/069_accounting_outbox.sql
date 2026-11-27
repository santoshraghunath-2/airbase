-- 069_accounting_outbox.sql
-- Phase 5 (Remodel — Billing & Books): durable accounting event outbox.
--
-- accounting_outbox stores events (invoice_created, payment_received, etc.)
-- that need to be posted to an external accounting system.
-- The unique constraint (tenant_id, entity_id, event_type, target_system) provides
-- exactly-once delivery: re-inserting an already-posted event is a no-op.
--
-- accounting-post (Edge Function) drains pending rows and dispatches to adapters.
-- Adapters: quickbooks (wraps qbo-sync), buildersbooks (PLACEHOLDER — awaiting
--           posting contract from operator before implementing).

CREATE TYPE accounting_outbox_status AS ENUM (
  'pending',    -- not yet attempted
  'posting',    -- claimed by accounting-post, in-flight
  'posted',     -- successfully delivered to target system
  'failed'      -- max retries exceeded; needs manual intervention
);

CREATE TYPE accounting_target_system AS ENUM (
  'quickbooks',
  'buildersbooks'
);

-- ─── tenants.accounting_target ────────────────────────────────────────────────
-- Which accounting system this tenant has connected. NULL = no accounting sync.
-- PLACEHOLDER: set via settings UI or migration when tenant confirms target system.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS accounting_target accounting_target_system;

COMMENT ON COLUMN tenants.accounting_target IS
  'Target accounting system for outbox sync. NULL = disabled. PLACEHOLDER: set per tenant.';

-- ─── accounting_outbox table ──────────────────────────────────────────────────

CREATE TABLE accounting_outbox (
  id            UUID                       DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID                       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- What happened
  event_type    TEXT                       NOT NULL,
  -- 'invoice_created' | 'payment_received' | 'cost_logged' | 'refund_issued'

  -- What entity it happened to
  entity_type   TEXT                       NOT NULL,
  -- 'invoice' | 'payment' | 'project_cost'
  entity_id     UUID                       NOT NULL,

  payload       JSONB                      NOT NULL DEFAULT '{}',
  target_system accounting_target_system   NOT NULL,

  status        accounting_outbox_status   NOT NULL DEFAULT 'pending',
  attempts      SMALLINT                   NOT NULL DEFAULT 0,
  last_error    TEXT,
  posted_at     TIMESTAMPTZ,

  created_at    TIMESTAMPTZ                DEFAULT now(),
  updated_at    TIMESTAMPTZ                DEFAULT now(),

  -- Idempotency guard: each entity+event combination posts to each target exactly once.
  CONSTRAINT accounting_outbox_entity_unique
    UNIQUE (tenant_id, entity_id, event_type, target_system)
);

ALTER TABLE accounting_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_all_accounting_outbox" ON accounting_outbox
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER accounting_outbox_updated_at
  BEFORE UPDATE ON accounting_outbox
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Index for the drainer: quickly find pending rows per tenant
CREATE INDEX idx_accounting_outbox_pending
  ON accounting_outbox(tenant_id, created_at)
  WHERE status IN ('pending', 'failed');
