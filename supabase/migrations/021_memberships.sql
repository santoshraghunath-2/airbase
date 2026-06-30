-- ─── Membership Plans ────────────────────────────────────────────────────────
-- Tenant-defined tiers (e.g., "Basic", "Premium", "VIP")

CREATE TABLE membership_plans (
  id                      UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id               UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                    TEXT         NOT NULL,
  description             TEXT,
  billing_cycle           TEXT         NOT NULL DEFAULT 'annual'
                            CHECK (billing_cycle IN ('monthly', 'annual')),
  price_cents             INTEGER      NOT NULL DEFAULT 0,   -- price in cents for the billing cycle
  discount_percent        SMALLINT     NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  priority_dispatch       BOOLEAN      NOT NULL DEFAULT false,
  free_service_call       BOOLEAN      NOT NULL DEFAULT false, -- waive diagnostic fee on each visit
  benefits                JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- [{text: "Annual tune-up"}]
  stripe_price_id         TEXT,        -- Stripe Price ID for recurring billing
  is_active               BOOLEAN      NOT NULL DEFAULT true,
  sort_order              SMALLINT     NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ  DEFAULT now(),
  updated_at              TIMESTAMPTZ  DEFAULT now()
);

ALTER TABLE membership_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select_plans" ON membership_plans
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY "tenant_insert_plans" ON membership_plans
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "tenant_update_plans" ON membership_plans
  FOR UPDATE USING (tenant_id = get_my_tenant_id());
CREATE POLICY "tenant_delete_plans" ON membership_plans
  FOR DELETE USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER set_membership_plans_updated_at
  BEFORE UPDATE ON membership_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Customer Memberships ─────────────────────────────────────────────────────
-- One active membership per customer (enforced by unique partial index)

CREATE TYPE membership_status AS ENUM (
  'pending',    -- enrolled, payment not yet confirmed
  'active',     -- paid and in-force
  'lapsed',     -- expired, eligible for win-back
  'cancelled'   -- intentionally cancelled
);

CREATE TABLE memberships (
  id                      UUID              DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id               UUID              NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id             UUID              NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  plan_id                 UUID              NOT NULL REFERENCES membership_plans(id),
  status                  membership_status NOT NULL DEFAULT 'pending',
  billing_cycle           TEXT              NOT NULL DEFAULT 'annual'
                            CHECK (billing_cycle IN ('monthly', 'annual')),
  started_at              DATE              NOT NULL DEFAULT CURRENT_DATE,
  expires_at              DATE              NOT NULL,
  auto_renew              BOOLEAN           NOT NULL DEFAULT true,
  stripe_subscription_id  TEXT,
  stripe_customer_id      TEXT,
  cancellation_reason     TEXT,
  cancelled_at            TIMESTAMPTZ,
  last_renewed_at         TIMESTAMPTZ,
  -- outreach tracking (bitmask via day-offsets: 60, 30, 7)
  outreach_sent_at_60     TIMESTAMPTZ,
  outreach_sent_at_30     TIMESTAMPTZ,
  outreach_sent_at_7      TIMESTAMPTZ,
  win_back_sent_at_7      TIMESTAMPTZ,
  win_back_sent_at_30     TIMESTAMPTZ,
  win_back_sent_at_90     TIMESTAMPTZ,
  deleted_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ       DEFAULT now(),
  updated_at              TIMESTAMPTZ       DEFAULT now()
);

-- Only one active membership per customer per tenant
CREATE UNIQUE INDEX memberships_one_active_per_customer
  ON memberships (tenant_id, customer_id)
  WHERE status = 'active';

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select_memberships" ON memberships
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY "tenant_insert_memberships" ON memberships
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "tenant_update_memberships" ON memberships
  FOR UPDATE USING (tenant_id = get_my_tenant_id());
CREATE POLICY "tenant_delete_memberships" ON memberships
  FOR DELETE USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER set_memberships_updated_at
  BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Seed default plans for new tenants ──────────────────────────────────────
-- Run after tenant provisioning; the provision-tenant Edge Function
-- should INSERT these rows when creating a new tenant.
-- (Not seeded here since we don't know the tenant_id at migration time.)
