-- Migration 043: Stripe auto-renewal additions
--
-- migration 021 already created:
--   memberships.stripe_subscription_id TEXT
--   memberships.stripe_customer_id TEXT  (on memberships row, not customers)
--   membership_plans.stripe_price_id TEXT
--   membership_status enum: pending | active | lapsed | cancelled
--
-- This migration adds only what is genuinely new:
--   customers.stripe_customer_id     — global Stripe customer ID on the customer record
--   memberships.stripe_checkout_session_id — pending checkout tracking
--   membership_status: payment_failed — new enum value for failed renewal
--   membership_plans.stripe_price_id_annual — separate annual price (monthly uses stripe_price_id)

-- ─── customers.stripe_customer_id ────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'stripe_customer_id'
  ) THEN
    ALTER TABLE customers ADD COLUMN stripe_customer_id TEXT;
    CREATE UNIQUE INDEX idx_customers_stripe_id ON customers (stripe_customer_id)
      WHERE stripe_customer_id IS NOT NULL;
    COMMENT ON COLUMN customers.stripe_customer_id IS
      'Stripe Customer ID (cus_...). Shared across all memberships for this customer.';
  END IF;
END;
$$;

-- ─── memberships.stripe_checkout_session_id ──────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memberships' AND column_name = 'stripe_checkout_session_id'
  ) THEN
    ALTER TABLE memberships ADD COLUMN stripe_checkout_session_id TEXT;
    COMMENT ON COLUMN memberships.stripe_checkout_session_id IS
      'Pending Stripe Checkout Session (cs_...). Cleared once subscription is created.';
  END IF;
END;
$$;

-- ─── membership_plans.stripe_price_id_annual ─────────────────────────────────
-- stripe_price_id already exists for monthly; add annual separately.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'membership_plans' AND column_name = 'stripe_price_id_annual'
  ) THEN
    ALTER TABLE membership_plans ADD COLUMN stripe_price_id_annual TEXT;
    COMMENT ON COLUMN membership_plans.stripe_price_id_annual IS
      'Stripe Price ID for annual billing (price_...). stripe_price_id holds the monthly price.';
  END IF;
END;
$$;

-- ─── membership_status: payment_failed ───────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'membership_status' AND e.enumlabel = 'payment_failed'
  ) THEN
    ALTER TYPE membership_status ADD VALUE 'payment_failed';
  END IF;
END;
$$;
