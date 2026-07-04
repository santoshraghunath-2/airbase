-- Migration 024: Tech type and selling-tech capability

ALTER TABLE technicians
  ADD COLUMN tech_type TEXT NOT NULL DEFAULT 'service'
    CHECK (tech_type IN ('service', 'install', 'install_lead', 'comfort_advisor')),
  ADD COLUMN can_sell BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN technicians.tech_type IS
  'service = repair/maintenance tech, install = crew member, install_lead = crew captain, comfort_advisor = sales-only (no wrenches)';
COMMENT ON COLUMN technicians.can_sell IS
  'Selling tech flag: service tech who can carry their own estimate without flipping to a CA';

CREATE INDEX idx_technicians_tech_type ON technicians(tenant_id, tech_type) WHERE is_active = true;
