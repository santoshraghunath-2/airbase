-- Migration 055: Rename Wisetack-specific financing columns to lender-neutral names.
-- Wisetack was the original lender; Phase 2 makes the design lender-agnostic.

ALTER TABLE estimates
  RENAME COLUMN wisetack_application_id TO financing_application_id;

ALTER TABLE estimates
  RENAME COLUMN wisetack_offer_url TO financing_offer_url;

ALTER TABLE estimates
  ADD COLUMN financing_provider TEXT;      -- e.g. 'wisetack', 'greensky', 'approved_partner'
