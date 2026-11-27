-- Seed: RECAST California (remodel tenant)
-- Run in the Supabase SQL editor on the target environment.
-- All PLACEHOLDER values must be replaced before the tenant goes live.

-- ─── Tenant ───────────────────────────────────────────────────────────────────

INSERT INTO tenants (
  id,
  name,
  legal_entity_name,
  brand_name,
  license_number,
  license_state,
  trade,
  timezone,
  retell_phone_number,
  contact_email,
  contact_phone,
  website,
  service_area_zips,
  sms_sender_name
)
VALUES (
  '00000000-0000-0000-0000-000000000002',  -- PLACEHOLDER: replace with actual UUID or use gen_random_uuid()
  'RECAST California',
  'Good Guy Builders',                     -- legal contracting entity
  'RECAST California',
  'PLACEHOLDER_CSLB_LICENSE',             -- e.g. '1012345'
  'CA',
  'remodel',
  'America/Los_Angeles',
  'PLACEHOLDER_E164_RETELL_NUMBER',       -- e.g. '+14155550100' — Retell-purchased number
  'PLACEHOLDER_CONTACT_EMAIL',            -- e.g. 'hello@recastcalifornia.com'
  'PLACEHOLDER_CONTACT_PHONE',            -- e.g. '+14155550101'
  'PLACEHOLDER_WEBSITE',                  -- e.g. 'https://recastcalifornia.com'
  ARRAY[
    -- PLACEHOLDER: Bay Area ZIPs for service area check
    -- Replace with actual service area ZIPs
    '94102','94103','94104','94105','94107','94108','94109','94110',
    '94111','94112','94114','94115','94116','94117','94118','94121',
    '94122','94123','94124','94127','94131','94132','94133','94134',
    '94158','94025','94027','94028','94030','94044','94061','94062',
    '94063','94065','94070','94401','94402','94403','94404','94501',
    '94502','94541','94544','94545','94546','94550','94551','94552',
    '94555','94566','94568','94578','94580','94587','94588','94601',
    '94602','94603','94605','94606','94608','94609','94610','94611',
    '94612','94618','94619','94621','94702','94703','94704','94705',
    '94706','94707','94708','94709','94710','94801','94803','94804',
    '94805','94806','94901','94903','94904','94920','94925','94930',
    '94941','94945','94947','94949','94952','94954','94960','94965'
  ],
  'RECAST CA'
)
ON CONFLICT (id) DO UPDATE SET
  legal_entity_name  = EXCLUDED.legal_entity_name,
  brand_name         = EXCLUDED.brand_name,
  trade              = EXCLUDED.trade,
  retell_phone_number = EXCLUDED.retell_phone_number;

-- ─── Business hours ───────────────────────────────────────────────────────────
-- Monday–Saturday 8am–6pm PT; closed Sundays

INSERT INTO tenant_hours (tenant_id, day_of_week, is_open, open_time, close_time)
VALUES
  ('00000000-0000-0000-0000-000000000002', 0, true,  '08:00', '18:00'),  -- Mon
  ('00000000-0000-0000-0000-000000000002', 1, true,  '08:00', '18:00'),  -- Tue
  ('00000000-0000-0000-0000-000000000002', 2, true,  '08:00', '18:00'),  -- Wed
  ('00000000-0000-0000-0000-000000000002', 3, true,  '08:00', '18:00'),  -- Thu
  ('00000000-0000-0000-0000-000000000002', 4, true,  '08:00', '18:00'),  -- Fri
  ('00000000-0000-0000-0000-000000000002', 5, true,  '09:00', '15:00'),  -- Sat
  ('00000000-0000-0000-0000-000000000002', 6, false, NULL,    NULL)       -- Sun
ON CONFLICT (tenant_id, day_of_week) DO UPDATE SET
  is_open    = EXCLUDED.is_open,
  open_time  = EXCLUDED.open_time,
  close_time = EXCLUDED.close_time;

-- ─── Design consultants (comfort_advisor type for remodel) ───────────────────

INSERT INTO technicians (id, tenant_id, name, phone, email, tech_type, is_active)
VALUES
  (
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'PLACEHOLDER_CONSULTANT_1_NAME',  -- e.g. 'Alex Rivera'
    'PLACEHOLDER_CONSULTANT_1_PHONE', -- e.g. '+14155550201'
    'PLACEHOLDER_CONSULTANT_1_EMAIL', -- e.g. 'alex@recastcalifornia.com'
    'comfort_advisor',
    true
  ),
  (
    '00000000-0000-0000-0001-000000000002',
    '00000000-0000-0000-0000-000000000002',
    'PLACEHOLDER_CONSULTANT_2_NAME',
    'PLACEHOLDER_CONSULTANT_2_PHONE',
    'PLACEHOLDER_CONSULTANT_2_EMAIL',
    'comfort_advisor',
    true
  )
ON CONFLICT (id) DO UPDATE SET
  name       = EXCLUDED.name,
  tech_type  = EXCLUDED.tech_type,
  is_active  = EXCLUDED.is_active;

-- ─── Agent config ─────────────────────────────────────────────────────────────
-- retell_voice: Retell voice agent for inbound calls (platform capability, any tenant)
-- retell_sms:   Retell SMS/chat agent for inbound and outbound texts

INSERT INTO agent_config (tenant_id, agent_type, model_id, enabled, auto_execute, confidence_threshold, settings)
VALUES
  (
    '00000000-0000-0000-0000-000000000002',
    'retell_voice',
    'claude-sonnet-4-6',
    true,
    true,
    0.85,
    jsonb_build_object(
      'retell_agent_id', 'PLACEHOLDER_RETELL_VOICE_AGENT_ID',
      -- Get from Retell dashboard → Agents → your voice agent → Agent ID
      'qualifying', jsonb_build_object(
        'budget_disqualify_values', ARRAY['under_8k']::text[],
        'service_area_zips', ARRAY[
          '94102','94103','94104','94105','94107','94108','94109','94110',
          '94111','94112','94114','94115','94116','94117','94118','94121',
          '94122','94123','94124','94127','94131','94132','94133','94134',
          '94158','94025','94027','94028','94030','94044','94061','94062',
          '94063','94065','94070','94401','94402','94403','94404','94501',
          '94502','94541','94544','94545','94546','94550','94551','94552',
          '94555','94566','94568','94578','94580','94587','94588','94601',
          '94602','94603','94605','94606','94608','94609','94610','94611',
          '94612','94618','94619','94621','94702','94703','94704','94705',
          '94706','94707','94708','94709','94710','94801','94803','94804',
          '94805','94806','94901','94903','94904','94920','94925','94930',
          '94941','94945','94947','94949','94952','94954','94960','94965'
        ]::text[]
      ),
      'booking', jsonb_build_object(
        'job_type', 'remodel_consult',
        'max_per_day', 4,
        'morning_time', '09:00:00',
        'afternoon_time', '13:00:00'
      ),
      'contact_window', jsonb_build_object(
        'timezone', 'America/Los_Angeles',
        'start_hour', 8,
        'end_hour', 20,
        'days', ARRAY[1,2,3,4,5,6]::int[]
      )
    )
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'retell_sms',
    'claude-sonnet-4-6',
    true,
    true,
    0.85,
    jsonb_build_object(
      'retell_agent_id', 'PLACEHOLDER_RETELL_SMS_AGENT_ID',
      -- Get from Retell dashboard → Agents → your SMS/chat agent → Agent ID
      'qualifying', jsonb_build_object(
        'budget_disqualify_values', ARRAY['under_8k']::text[],
        'service_area_zips', ARRAY[
          '94102','94103','94104','94105','94107','94108','94109','94110',
          '94111','94112','94114','94115','94116','94117','94118','94121',
          '94122','94123','94124','94127','94131','94132','94133','94134',
          '94158','94025','94027','94028','94030','94044','94061','94062',
          '94063','94065','94070','94401','94402','94403','94404','94501',
          '94502','94541','94544','94545','94546','94550','94551','94552',
          '94555','94566','94568','94578','94580','94587','94588','94601',
          '94602','94603','94605','94606','94608','94609','94610','94611',
          '94612','94618','94619','94621','94702','94703','94704','94705',
          '94706','94707','94708','94709','94710','94801','94803','94804',
          '94805','94806','94901','94903','94904','94920','94925','94930',
          '94941','94945','94947','94949','94952','94954','94960','94965'
        ]::text[]
      ),
      'booking', jsonb_build_object(
        'job_type', 'remodel_consult',
        'max_per_day', 4,
        'morning_time', '09:00:00',
        'afternoon_time', '13:00:00'
      ),
      'contact_window', jsonb_build_object(
        'timezone', 'America/Los_Angeles',
        'start_hour', 8,
        'end_hour', 20,
        'days', ARRAY[1,2,3,4,5,6]::int[]
      )
    )
  )
ON CONFLICT (tenant_id, agent_type) DO UPDATE SET
  model_id             = EXCLUDED.model_id,
  enabled              = EXCLUDED.enabled,
  settings             = EXCLUDED.settings;

-- ─── Lead intake source ───────────────────────────────────────────────────────

INSERT INTO lead_intake_sources (id, tenant_id, name, slug, hmac_secret, is_active)
VALUES (
  '00000000-0000-0000-0002-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'Website – Main',
  'web-main',
  'PLACEHOLDER_HMAC_SECRET_32_CHARS_MIN',  -- generate with: openssl rand -hex 32
  true
)
ON CONFLICT (id) DO UPDATE SET
  hmac_secret = EXCLUDED.hmac_secret,
  is_active   = EXCLUDED.is_active;

-- ─── Post-seed checklist ──────────────────────────────────────────────────────
-- After running this seed:
--
-- 1. Replace every PLACEHOLDER_ value with real data
-- 2. Create Retell agents in the Retell dashboard:
--    a. Voice agent (agent_type=retell_voice) → system prompt from prompts/remodel-voice-agent.md
--       Functions: lookup_customer, qualify_lead, check_consult_availability,
--                  book_consultation, save_lead, escalate_to_human
--       Webhook: https://<project>.supabase.co/functions/v1/retell-voice-webhook
--    b. SMS/chat agent (agent_type=retell_sms) → system prompt from prompts/remodel-sms-agent.md
--       Same functions as voice
--       Chat webhook: https://<project>.supabase.co/functions/v1/retell-chat-webhook
-- 3. Set Supabase secrets:
--    supabase secrets set RETELL_API_KEY=<key from Retell dashboard>
-- 4. Register the Retell phone number in the Retell dashboard and link it to the SMS agent
-- 5. Enable pg_cron for lead-follow-up (see migration 051 for the schedule SQL)
-- 6. Update lead_intake_sources.hmac_secret with the value you generated
-- 7. Configure your website form to POST to:
--    https://<project>.supabase.co/functions/v1/lead-intake?source=web-main
--    with header: x-intake-signature: v={unix_ms},d={hex}
