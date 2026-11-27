-- Migration 059: permits and jurisdiction rules
-- Permits gate the project start. Jurisdiction rules tell the system
-- whether a permit is required for a given work type in a city.

CREATE TYPE permit_status AS ENUM (
  'not_required',
  'needs_review',   -- jurisdiction rule is 'unknown' — office must decide
  'pending',        -- required, not yet submitted
  'submitted',
  'issued',
  'failed'
);

CREATE TYPE permit_required AS ENUM ('yes', 'no', 'unknown');

CREATE TABLE permits (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  jurisdiction    TEXT NOT NULL,       -- city name, e.g. 'San Francisco'
  permit_type     TEXT NOT NULL,       -- e.g. 'building', 'plumbing', 'electrical'
  status          permit_status NOT NULL DEFAULT 'pending',

  submitted_at    TIMESTAMPTZ,
  issued_at       TIMESTAMPTZ,
  permit_number   TEXT,
  fee_cents       INTEGER,
  notes           TEXT,

  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE permits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_all_permits" ON permits
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE INDEX idx_permits_project ON permits(project_id);

-- ─── Jurisdiction rules ───────────────────────────────────────────────────────
-- Starts empty. Office adds rows as they learn each city's requirements.

CREATE TABLE jurisdiction_rules (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  jurisdiction      TEXT NOT NULL,
  work_type         TEXT NOT NULL,     -- matches pricebook_items.category or a tag
  permit_required   permit_required NOT NULL DEFAULT 'unknown',
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, jurisdiction, work_type)
);

ALTER TABLE jurisdiction_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_all_jurisdiction_rules" ON jurisdiction_rules
  FOR ALL USING (tenant_id = get_my_tenant_id());
