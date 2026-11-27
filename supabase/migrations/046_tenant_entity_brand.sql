-- Migration 046: Tenant entity, brand, and trade
-- NOTE: This migration was applied to the production database on 2026-11-21 outside of git.
-- All column additions are guarded with IF NOT EXISTS; re-running on a database that already
-- has these columns is safe.

CREATE TYPE IF NOT EXISTS tenant_trade AS ENUM ('field_service', 'remodel');

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS legal_entity_name  TEXT,
  ADD COLUMN IF NOT EXISTS license_number     TEXT,
  ADD COLUMN IF NOT EXISTS license_state      TEXT,
  ADD COLUMN IF NOT EXISTS brand_name         TEXT,
  ADD COLUMN IF NOT EXISTS trade              tenant_trade NOT NULL DEFAULT 'field_service',
  ADD COLUMN IF NOT EXISTS retell_phone_number TEXT;

-- Backfill brand_name from name for existing tenants
UPDATE tenants SET brand_name = name WHERE brand_name IS NULL;
