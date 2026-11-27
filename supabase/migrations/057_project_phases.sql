-- Migration 057: project phase templates and project phases
-- Phase templates define the standard work breakdown per package.
-- Project phases are the per-project expansion of that template.

CREATE TYPE phase_status AS ENUM (
  'not_started',
  'in_progress',
  'complete',
  'skipped'
);

-- ─── Phase templates (per tenant, per package) ────────────────────────────────

CREATE TABLE phase_templates (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pricebook_item_id     UUID NOT NULL REFERENCES pricebook_items(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,  -- e.g. "Standard Tub-to-Shower"
  total_commitment_days SMALLINT NOT NULL DEFAULT 10,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, pricebook_item_id, name)
);

ALTER TABLE phase_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_all_phase_templates" ON phase_templates
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE TABLE phase_template_items (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id       UUID NOT NULL REFERENCES phase_templates(id) ON DELETE CASCADE,

  -- Ordering and schedule
  sort_order        SMALLINT NOT NULL DEFAULT 0,
  name              TEXT NOT NULL,         -- e.g. "Demo & Protection"
  day_offset        SMALLINT NOT NULL,     -- business day from project start (1-based)
  duration_days     SMALLINT NOT NULL DEFAULT 1,

  -- Crew
  crew_size         SMALLINT NOT NULL DEFAULT 0,  -- 0 = no crew (inspection day)
  job_type          TEXT NOT NULL DEFAULT 'remodel_install',  -- remodel_install | remodel_inspection | remodel_punch_list

  -- Evidence gate (what crew must upload before closing)
  required_evidence TEXT[],  -- e.g. ARRAY['before_photo','after_photo']
  evidence_notes    TEXT,

  created_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE phase_template_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_all_phase_template_items" ON phase_template_items
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE INDEX idx_pti_template ON phase_template_items(template_id, sort_order);

-- ─── Project phases (expanded from template at project-create time) ───────────

CREATE TABLE project_phases (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_item_id    UUID REFERENCES phase_template_items(id),

  sort_order          SMALLINT NOT NULL,
  name                TEXT NOT NULL,
  planned_start       DATE,
  planned_end         DATE,
  actual_start        DATE,
  actual_end          DATE,
  status              phase_status NOT NULL DEFAULT 'not_started',
  crew_size           SMALLINT NOT NULL DEFAULT 0,
  job_type            TEXT NOT NULL DEFAULT 'remodel_install',
  required_evidence   TEXT[],

  -- Closeout
  closed_by           UUID REFERENCES users(id),
  closed_at           TIMESTAMPTZ,
  notes               TEXT,

  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE project_phases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_all_project_phases" ON project_phases
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE INDEX idx_project_phases_project ON project_phases(project_id, sort_order);
