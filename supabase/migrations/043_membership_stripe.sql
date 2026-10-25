-- Migration 043: Stripe auto-renewal additions
--
-- Depends on migration 021 (memberships tables). All blocks are guarded with
-- table and column existence checks so this migration is safe to run on any
-- database state — it simply no-ops for tables that don't exist yet.
--
-- If memberships/membership_plans tables are missing, apply migration 021 first.

-- ─── customers.stripe_customer_id ────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'customers'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'stripe_customer_id'
    ) THEN
      ALTER TABLE customers ADD COLUMN stripe_customer_id TEXT;
      COMMENT ON COLUMN customers.stripe_customer_id IS
        'Stripe Customer ID (cus_...). Shared across all memberships for this customer.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'idx_customers_stripe_id'
    ) THEN
      CREATE UNIQUE INDEX idx_customers_stripe_id ON customers (stripe_customer_id)
        WHERE stripe_customer_id IS NOT NULL;
    END IF;
  END IF;
END;
$$;

-- ─── memberships.stripe_checkout_session_id ──────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'memberships'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'memberships' AND column_name = 'stripe_checkout_session_id'
    ) THEN
      ALTER TABLE memberships ADD COLUMN stripe_checkout_session_id TEXT;
      COMMENT ON COLUMN memberships.stripe_checkout_session_id IS
        'Pending Stripe Checkout Session (cs_...). Cleared once subscription is created.';
    END IF;
  END IF;
END;
$$;

-- ─── membership_plans.stripe_price_id_annual ─────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'membership_plans'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'membership_plans' AND column_name = 'stripe_price_id_annual'
    ) THEN
      ALTER TABLE membership_plans ADD COLUMN stripe_price_id_annual TEXT;
      COMMENT ON COLUMN membership_plans.stripe_price_id_annual IS
        'Stripe Price ID for annual billing (price_...). stripe_price_id holds the monthly price.';
    END IF;
  END IF;
END;
$$;

-- ─── membership_status: payment_failed ───────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'membership_status'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'membership_status' AND e.enumlabel = 'payment_failed'
  ) THEN
    ALTER TYPE membership_status ADD VALUE 'payment_failed';
  END IF;
END;
$$;
