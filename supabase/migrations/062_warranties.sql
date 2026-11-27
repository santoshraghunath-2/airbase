-- Migration 062: warranties
-- Created at project closeout. Terms text is PLACEHOLDER until attorney-approved.

CREATE TABLE warranties (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id),

  start_date  DATE NOT NULL,
  term_months SMALLINT NOT NULL DEFAULT 12,
  terms_text  TEXT NOT NULL DEFAULT 'PLACEHOLDER PENDING ATTORNEY APPROVAL',

  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE warranties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_all_warranties" ON warranties
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE INDEX idx_warranties_project  ON warranties(project_id);
CREATE INDEX idx_warranties_customer ON warranties(tenant_id, customer_id);
