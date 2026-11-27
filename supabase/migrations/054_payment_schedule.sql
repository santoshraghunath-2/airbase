-- Migration 054: Payment schedule items
-- Each row is one milestone payment on a contract.
-- Rules enforced by _shared/contract-rules.ts:
--   - Items must sum to contracts.total_cents
--   - No item may be invoiced before its trigger event is recorded

CREATE TYPE payment_trigger_type AS ENUM (
  'contract_signed',       -- deposit: due immediately after signing
  'materials_delivered',   -- mid-point: due when material order is marked received
  'phase_closed',          -- progress: due when a named project phase is closed
  'completion'             -- final: due at customer walkthrough sign-off
);

CREATE TYPE payment_schedule_status AS ENUM (
  'pending',    -- not yet triggered
  'invoiced',   -- invoice created and sent
  'paid'        -- invoice paid
);

CREATE TABLE payment_schedule_items (
  id                UUID                    DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         UUID                    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id       UUID                    NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,

  sort_order        SMALLINT                NOT NULL DEFAULT 0,
  milestone_name    TEXT                    NOT NULL,  -- e.g. 'Deposit', 'Materials Delivered', 'Balance'
  trigger_type      payment_trigger_type    NOT NULL,
  trigger_reference UUID,                              -- e.g. phase_id when trigger_type = phase_closed

  amount_cents      INTEGER                 NOT NULL CHECK (amount_cents > 0),
  invoice_id        UUID                    REFERENCES invoices(id),
  status            payment_schedule_status NOT NULL DEFAULT 'pending',

  created_at        TIMESTAMPTZ             DEFAULT now(),
  updated_at        TIMESTAMPTZ             DEFAULT now()
);

ALTER TABLE payment_schedule_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_all_payment_schedule" ON payment_schedule_items
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER set_payment_schedule_updated_at
  BEFORE UPDATE ON payment_schedule_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_payment_schedule_contract ON payment_schedule_items(tenant_id, contract_id);
CREATE INDEX idx_payment_schedule_status   ON payment_schedule_items(tenant_id, status);
