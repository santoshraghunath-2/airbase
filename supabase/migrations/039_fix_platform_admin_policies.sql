-- Migration 039: Fix recursive platform_admin RLS policies.
--
-- Migration 038 created a "platform_admin_select_users" policy that queried
-- the `users` table from within an RLS policy ON the `users` table.
-- Postgres detects this as infinite recursion and errors on every SELECT
-- from `users`, which breaks loadUserProfile → tenant = null → app unusable.
--
-- The same pattern as `get_my_tenant_id()`: use a SECURITY DEFINER function
-- to read `users` outside the RLS evaluation stack, then reference it in
-- all platform_admin policies instead of inline EXISTS subqueries.

-- ── Helper function (SECURITY DEFINER — bypasses RLS on users) ───────────────

CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE auth_id = auth.uid() AND role = 'platform_admin'
  );
$$;

GRANT EXECUTE ON FUNCTION is_platform_admin() TO authenticated;

-- ── Users table — drop the broken recursive policy, recreate via helper ───────

DROP POLICY IF EXISTS "platform_admin_select_users" ON users;

CREATE POLICY "platform_admin_select_users" ON users
  FOR SELECT USING (is_platform_admin());

-- ── Tenants — rebuild using helper (was using inline EXISTS on users) ─────────

DROP POLICY IF EXISTS "platform_admin_select_tenants" ON tenants;
DROP POLICY IF EXISTS "platform_admin_update_tenants" ON tenants;

CREATE POLICY "platform_admin_select_tenants" ON tenants
  FOR SELECT USING (is_platform_admin());

CREATE POLICY "platform_admin_update_tenants" ON tenants
  FOR UPDATE USING (is_platform_admin());

-- ── Agent config — rebuild using helper ──────────────────────────────────────

DROP POLICY IF EXISTS "platform_admin_select_agent_config" ON agent_config;
DROP POLICY IF EXISTS "platform_admin_update_agent_config" ON agent_config;
DROP POLICY IF EXISTS "platform_admin_insert_agent_config" ON agent_config;

CREATE POLICY "platform_admin_select_agent_config" ON agent_config
  FOR SELECT USING (is_platform_admin());

CREATE POLICY "platform_admin_update_agent_config" ON agent_config
  FOR UPDATE USING (is_platform_admin());

CREATE POLICY "platform_admin_insert_agent_config" ON agent_config
  FOR INSERT WITH CHECK (is_platform_admin());
