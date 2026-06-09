-- Migration 001: Tenants (multi-tenant foundation)

CREATE TYPE subscription_tier AS ENUM ('starter', 'growth', 'enterprise');
CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'past_due', 'cancelled', 'paused');

CREATE TABLE tenants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  phone TEXT,
  address TEXT,
  timezone TEXT DEFAULT 'America/Los_Angeles',

  -- Subscription
  subscription_tier subscription_tier DEFAULT 'starter',
  subscription_status subscription_status DEFAULT 'trialing',
  trial_ends_at TIMESTAMPTZ,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_account_id TEXT,
  billing_email TEXT,

  -- AI model selection (tenant-wide default)
  default_model_id TEXT DEFAULT 'claude-sonnet-4-6',

  -- Integrations
  twilio_phone_number TEXT,
  qbo_realm_id TEXT,
  qbo_access_token TEXT,
  qbo_refresh_token TEXT,

  -- MSO / franchise linkage (Phase 4)
  parent_tenant_id UUID REFERENCES tenants(id),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- NOTE: tenants_self_read policy is created in 002_users_roles.sql
-- after the users table exists (avoids forward-reference error).

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
