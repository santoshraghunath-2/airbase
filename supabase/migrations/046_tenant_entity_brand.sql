-- Migration 046: Tenant entity, brand, and trade columns
--
-- Adds legal entity details and trade type to the tenants table.
-- Required for the remodel tenant track (Good Guy Builders / RECAST California).
--
-- NOTE: The prompt specified this as 045_tenant_entity_brand.sql, but
-- 045_job_media.sql already exists. This migration is therefore numbered 046.
-- Apply after 045_job_media.sql.

-- Add trade ENUM type
-- 'field_service' covers plumbing, HVAC, and electrical (the original Steward track).
-- 'remodel' covers bathroom and home improvement remodel contractors.
CREATE TYPE tenant_trade AS ENUM ('field_service', 'remodel');

-- Add columns to tenants
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS legal_entity_name  TEXT,
  ADD COLUMN IF NOT EXISTS license_number     TEXT,
  ADD COLUMN IF NOT EXISTS license_state      TEXT,
  ADD COLUMN IF NOT EXISTS brand_name         TEXT,
  ADD COLUMN IF NOT EXISTS trade              tenant_trade NOT NULL DEFAULT 'field_service',
  ADD COLUMN IF NOT EXISTS retell_phone_number TEXT;

-- Backfill brand_name from name for all existing tenants that don't have one yet
UPDATE tenants
SET brand_name = name
WHERE brand_name IS NULL;
