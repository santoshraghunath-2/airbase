-- Add project_manager to tech_type for remodel tenants
ALTER TABLE technicians
  DROP CONSTRAINT IF EXISTS technicians_tech_type_check;

ALTER TABLE technicians
  ADD CONSTRAINT technicians_tech_type_check
    CHECK (tech_type IN ('service', 'install', 'install_lead', 'comfort_advisor', 'project_manager'));

COMMENT ON COLUMN technicians.tech_type IS
  'service = repair/maintenance tech, install = crew member, install_lead = crew captain, comfort_advisor = sales-only (no wrenches), project_manager = remodel project manager';
