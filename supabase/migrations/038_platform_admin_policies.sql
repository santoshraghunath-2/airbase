-- Migration 038: Cross-tenant RLS policies for platform_admin role.
--
-- Runs in its own transaction AFTER 037 commits the 'platform_admin' enum value.
-- Uses a SECURITY DEFINER helper function (is_platform_admin) to avoid the
-- infinite-recursion trap: any policy ON users that SELECT-queries users
-- will recurse into itself during RLS evaluation.  The helper bypasses RLS
-- the same way get_my_tenant_id() does.

-- ── Helper ────────────────────────────────────────────────────────────────────

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

-- ── Tenants ──────────────────────────────────────────────────────────────────

CREATE POLICY "platform_admin_select_tenants" ON tenants
  FOR SELECT USING (is_platform_admin());

CREATE POLICY "platform_admin_update_tenants" ON tenants
  FOR UPDATE USING (is_platform_admin());

-- ── Agent config ─────────────────────────────────────────────────────────────

CREATE POLICY "platform_admin_select_agent_config" ON agent_config
  FOR SELECT USING (is_platform_admin());

CREATE POLICY "platform_admin_update_agent_config" ON agent_config
  FOR UPDATE USING (is_platform_admin());

CREATE POLICY "platform_admin_insert_agent_config" ON agent_config
  FOR INSERT WITH CHECK (is_platform_admin());

-- ── Users ─────────────────────────────────────────────────────────────────────

CREATE POLICY "platform_admin_select_users" ON users
  FOR SELECT USING (is_platform_admin());
