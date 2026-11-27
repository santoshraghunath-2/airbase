-- Migration 065: On-call roster and paging
--
-- on_call: who is on call for a role during a time window, in priority order.
-- pages:   individual pages sent to on-call staff, with rollover tracking.

CREATE TABLE on_call (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  role        TEXT NOT NULL,          -- e.g. 'owner', 'project_manager'
  user_id     UUID NOT NULL REFERENCES users(id),
  start_at    TIMESTAMPTZ NOT NULL,
  end_at      TIMESTAMPTZ NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE on_call ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_manage_on_call"
  ON on_call FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE auth_id = auth.uid()
    )
  );

CREATE INDEX idx_on_call_tenant_role_time
  ON on_call (tenant_id, role, start_at, end_at, sort_order);


CREATE TABLE pages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  reason          TEXT NOT NULL,
  urgency         TEXT NOT NULL DEFAULT 'normal',   -- 'normal' | 'urgent'
  summary         TEXT NOT NULL,
  target_user_id  UUID REFERENCES users(id),
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  rolled_to_id    UUID REFERENCES pages(id),        -- next page when this one rolled over
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_read_pages"
  ON pages FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE auth_id = auth.uid()
    )
  );

CREATE INDEX idx_pages_tenant_unack
  ON pages (tenant_id, sent_at)
  WHERE acknowledged_at IS NULL;
