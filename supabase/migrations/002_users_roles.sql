-- Migration 002: Users and roles

CREATE TYPE user_role AS ENUM ('owner', 'office_manager', 'dispatcher', 'technician');

CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  auth_id UUID UNIQUE REFERENCES auth.users(id),
  email TEXT,
  name TEXT NOT NULL,
  phone TEXT,
  role user_role NOT NULL,
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER helper: fetches the calling user's tenant_id without
-- triggering RLS on the users table itself (avoids infinite recursion).
-- Called by all tenant-isolation policies across every table.
CREATE OR REPLACE FUNCTION get_my_tenant_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER  -- runs as table owner, bypasses RLS on users
STABLE            -- same result for the same transaction
SET search_path = public
AS $$
  SELECT tenant_id FROM users WHERE auth_id = auth.uid() LIMIT 1;
$$;

-- Users can read all users within their tenant (uses helper to avoid recursion)
CREATE POLICY "users_tenant_read" ON users
  FOR SELECT USING (tenant_id = get_my_tenant_id());

-- Users can update their own profile
CREATE POLICY "users_self_update" ON users
  FOR UPDATE USING (auth_id = auth.uid());

-- Tenants policy deferred here so the users table already exists
CREATE POLICY "tenants_self_read" ON tenants
  FOR SELECT USING (id = get_my_tenant_id());

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Index for auth lookup (hot path on every request)
CREATE INDEX idx_users_auth_id ON users(auth_id);
CREATE INDEX idx_users_tenant_id ON users(tenant_id);
