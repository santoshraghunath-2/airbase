-- Add customer-facing identity and service area configuration to tenants
-- These columns power the Company Settings → Customer Identity and Service Area sections

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sms_sender_name TEXT,
  ADD COLUMN IF NOT EXISTS reply_to_email TEXT,
  ADD COLUMN IF NOT EXISTS brand_color TEXT DEFAULT '#5B6B9E',
  ADD COLUMN IF NOT EXISTS service_area_radius_miles INTEGER DEFAULT 25,
  ADD COLUMN IF NOT EXISTS service_area_zips TEXT[],
  ADD COLUMN IF NOT EXISTS after_hours_mode TEXT NOT NULL DEFAULT 'message'
    CHECK (after_hours_mode IN ('message', 'emergency', 'anytime'));
