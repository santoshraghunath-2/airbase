-- Migration 053: Home improvement contracts
-- Links an accepted estimate to a legal document, e-sign envelope, and payment schedule.
-- CA-specific deposit/cancellation rules are enforced in _shared/contract-rules.ts.

CREATE TYPE contract_status AS ENUM (
  'draft',      -- generated, not yet sent to customer
  'sent',       -- sent for signature (or awaiting manual sign)
  'signed',     -- customer has signed; cancel-by window in progress
  'effective',  -- signed + cancel-by passed + deposit paid (or financing approved)
  'cancelled',  -- customer cancelled within notice window
  'void'        -- voided by office (error, duplicate, etc.)
);

CREATE TYPE cancellation_notice_type AS ENUM (
  'three_day',   -- standard CA home improvement contract
  'five_day'     -- customer is 65 or older (CA Civil Code 1689.7)
);

CREATE TABLE contracts (
  id                        UUID                      DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id                 UUID                      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  estimate_id               UUID                      NOT NULL REFERENCES estimates(id),
  customer_id               UUID                      NOT NULL REFERENCES customers(id),
  opportunity_id            UUID                      REFERENCES opportunities(id),

  project_description       TEXT,                     -- scope summary for the contract header
  total_cents               INTEGER                   NOT NULL CHECK (total_cents > 0),

  status                    contract_status           NOT NULL DEFAULT 'draft',

  -- PDF storage (Supabase Storage bucket: contracts)
  pdf_path                  TEXT,                     -- path to unsigned PDF
  signed_pdf_path           TEXT,                     -- path to signed PDF (manual upload or e-sign fetch)

  -- E-signature
  esign_provider            TEXT,                     -- 'manual' | 'signudoc' (future)
  esign_envelope_id         TEXT,                     -- provider's envelope/document ID
  signed_at                 TIMESTAMPTZ,
  signer_name               TEXT,                     -- recorded by manual adapter

  -- CA cancellation rights
  cancellation_notice_type  cancellation_notice_type,
  cancel_by_date            DATE,                     -- computed by contract-rules.ts, attorney-reviewed
  customer_65_or_older      BOOLEAN                   NOT NULL DEFAULT false,

  -- Template version for auditing (bump when attorney approves a new version)
  template_version          TEXT                      NOT NULL DEFAULT '0.1-DRAFT',

  -- Timestamps
  sent_at                   TIMESTAMPTZ,
  effective_at              TIMESTAMPTZ,
  cancelled_at              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ               DEFAULT now(),
  updated_at                TIMESTAMPTZ               DEFAULT now(),
  deleted_at                TIMESTAMPTZ
);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_all_contracts" ON contracts
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER set_contracts_updated_at
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_contracts_tenant          ON contracts(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_contracts_estimate        ON contracts(tenant_id, estimate_id);
CREATE INDEX idx_contracts_customer        ON contracts(tenant_id, customer_id);
CREATE INDEX idx_contracts_status          ON contracts(tenant_id, status) WHERE deleted_at IS NULL;

-- Link contracts back from estimates
ALTER TABLE estimates ADD COLUMN contract_id UUID REFERENCES contracts(id);

-- Gate: while false, contracts can be generated and previewed but not sent to customers.
ALTER TABLE tenants ADD COLUMN contract_template_approved BOOLEAN NOT NULL DEFAULT false;
