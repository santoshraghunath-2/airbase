-- Migration 043: Membership auto-renewal via Stripe subscriptions
--
-- Adds Stripe identifiers needed for recurring billing.
-- Flow:
--   1. Operator sets membership auto_renew = true
--   2. membership-renew Edge Function creates a Stripe Checkout Session
--   3. Customer completes checkout → Stripe creates a Subscription
--   4. stripe-webhook updates memberships.expires_at on each renewal
--   5. On payment failure → status = 'payment_failed', outreach triggers

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_stripe_id ON customers (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

COMMENT ON COLUMN customers.stripe_customer_id IS 'Stripe Customer ID (cus_...). Created on first checkout or manual creation.';

ALTER TABLE membership_plans
  ADD COLUMN IF NOT EXISTS stripe_price_id_monthly TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_id_annual  TEXT;

COMMENT ON COLUMN membership_plans.stripe_price_id_monthly IS 'Stripe Price ID for monthly billing cycle (price_...).';
COMMENT ON COLUMN membership_plans.stripe_price_id_annual  IS 'Stripe Price ID for annual billing cycle (price_...).';

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_stripe_sub ON memberships (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

COMMENT ON COLUMN memberships.stripe_subscription_id       IS 'Stripe Subscription ID (sub_...). Set after customer completes checkout.';
COMMENT ON COLUMN memberships.stripe_checkout_session_id   IS 'Pending Stripe Checkout Session ID (cs_...). Cleared once subscription is created.';

-- Extend status enum for payment failure state
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'payment_failed'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'membership_status')
  ) THEN
    ALTER TYPE membership_status ADD VALUE 'payment_failed';
  END IF;
EXCEPTION WHEN undefined_object THEN
  -- membership_status may be a plain TEXT column — no-op if enum doesn't exist
  NULL;
END;
$$;
