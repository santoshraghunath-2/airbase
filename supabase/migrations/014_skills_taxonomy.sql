-- Migration 014: Structured skills taxonomy
--
-- Replaces the free-text tech_skills.skill column with a typed enum.
-- Aligns skill names with job_type values where possible so the dispatch
-- agent can directly match job_type → required skill without a mapping table.

CREATE TYPE technician_skill AS ENUM (
  -- Plumbing
  'plumbing_service',
  'plumbing_drain',
  'drain_cleaning',
  'water_heater_repair',
  'water_heater_install',
  'leak_detection',
  'gas_line',
  'backflow_prevention',
  'water_treatment',
  'sewer_repair',
  -- HVAC
  'hvac_service',
  'hvac_repair',
  'hvac_install',
  'hvac_maintenance',
  -- Electrical
  'electrical_service',
  'electrical_repair',
  'electrical_install',
  -- General
  'general_maintenance'
);

CREATE TYPE skill_level AS ENUM ('learning', 'proficient', 'expert');

-- Drop the existing TEXT default before type conversion.
-- Postgres cannot auto-cast a TEXT default expression to an enum type.
ALTER TABLE tech_skills ALTER COLUMN level DROP DEFAULT;

-- Migrate existing free-text rows.
-- Any unrecognised skill values will cause this to fail — clean them first.
ALTER TABLE tech_skills
  ALTER COLUMN skill TYPE technician_skill USING skill::technician_skill,
  ALTER COLUMN level TYPE skill_level      USING level::skill_level;

-- Restore the default, now with the correct enum type.
ALTER TABLE tech_skills
  ALTER COLUMN level SET DEFAULT 'proficient'::skill_level;

-- Index for dispatch agent skill matching
CREATE INDEX idx_tech_skills_skill ON tech_skills(skill);
