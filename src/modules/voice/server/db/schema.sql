-- ============================================================================
-- Airbase Voice Module — Database Schema (voice_* prefix)
--
-- CANONICAL COPY FOR THE SHARED AIRBASE SUPABASE INSTANCE:
--   supabase/migrations/011_voice.sql
-- This file is the reference for standalone extraction.
-- Keep both files in sync when making schema changes.
-- ============================================================================
-- Defines the three voice_* tables specified in src/modules/voice/CLAUDE.md:
--   voice_agent_config — per-brand agent settings (created first; referenced by FKs)
--   voice_calls        — full call log + transcripts
--   voice_leads        — qualified lead data extracted from calls
--
-- Runs against the SHARED Airbase Supabase instance. It depends on two helpers
-- already defined by the core migrations:
--   get_my_tenant_id()  — supabase/migrations/002_users_roles.sql (RLS isolation)
--   update_updated_at() — supabase/migrations/001_tenants.sql     (updated_at trigger)
--
-- Per the Airbase constitution: every tenant-scoped table carries a NOT NULL
-- tenant_id, has RLS enabled, uses ENUM types for statuses, and soft-deletes
-- customer data via deleted_at. Brands (GGB Express, Recast Texas, Steward) are
-- modeled as rows in voice_agent_config within a tenant — one tenant can run
-- several brands. Inbound routing maps the dialed Twilio number -> config.
--
-- The standalone voice server (Fastify) connects with the Supabase service-role
-- key, which bypasses RLS. The RLS policies below scope the Airbase React
-- dashboard, which reads these tables under an authenticated user JWT.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------

-- Call direction.
CREATE TYPE voice_call_direction AS ENUM ('inbound', 'outbound');

-- Telephony lifecycle status (mirrors Twilio call statuses).
CREATE TYPE voice_call_status AS ENUM (
  'queued', 'ringing', 'in_progress', 'completed',
  'busy', 'failed', 'no_answer', 'canceled'
);

-- Business outcome of the conversation (BOOK_OR_CLOSE terminal states).
CREATE TYPE voice_call_outcome AS ENUM (
  'in_progress',          -- call still active / not yet resolved
  'booked',               -- appointment booked
  'qualified_not_booked', -- lead captured, no booking yet
  'not_qualified',        -- politely closed
  'escalated_human',      -- transferred to a live agent
  'no_answer',            -- outbound: lead did not pick up
  'voicemail',            -- reached voicemail
  'abandoned',            -- caller hung up mid-conversation
  'failed'                -- technical failure
);

-- Project type (matches book_appointment / save_lead tool schemas).
CREATE TYPE voice_project_type AS ENUM (
  'full_bathroom', 'shower_only', 'tub_only', 'kitchen', 'other'
);

-- Lead timeline / urgency (matches book_appointment tool schema).
CREATE TYPE voice_timeline AS ENUM (
  'asap', '1-3months', '3-6months', 'just_browsing'
);

-- ---------------------------------------------------------------------------
-- voice_agent_config — per-brand agent settings
-- ---------------------------------------------------------------------------
CREATE TABLE voice_agent_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),

  -- Brand identity
  brand_id TEXT NOT NULL,              -- slug, e.g. 'ggb_express', 'recast_texas'
  brand_name TEXT NOT NULL,            -- display name, e.g. 'GGB Express Bathrooms'
  persona_name TEXT,                   -- agent persona, e.g. 'Alex'

  -- Agent behavior
  system_prompt TEXT NOT NULL,
  model_id TEXT DEFAULT 'claude-sonnet-4-6',  -- resolves per Airbase model order
  voice_id TEXT,                       -- Cartesia voice ID

  -- Telephony / routing
  phone_number TEXT,                   -- Twilio inbound number (To-field routing key)
  outbound_enabled BOOLEAN DEFAULT false,  -- form-fill callbacks (TCPA: form leads only)

  -- Downstream destinations
  booking_destination TEXT,            -- e.g. Cal.com / Calendly URL or calendar id
  sms_sender TEXT,                     -- SMS sender label / number

  active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ,

  -- One config per brand per tenant; phone number must route unambiguously.
  UNIQUE (tenant_id, brand_id),
  UNIQUE (phone_number)
);

ALTER TABLE voice_agent_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_agent_config_tenant_isolation" ON voice_agent_config
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER voice_agent_config_updated_at
  BEFORE UPDATE ON voice_agent_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_voice_agent_config_tenant_id ON voice_agent_config(tenant_id);
-- Hot path: inbound webhook resolves the active agent by dialed number.
CREATE INDEX idx_voice_agent_config_phone_number
  ON voice_agent_config(phone_number) WHERE active AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- voice_calls — full call log + transcripts
-- ---------------------------------------------------------------------------
CREATE TABLE voice_calls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  agent_config_id UUID REFERENCES voice_agent_config(id),  -- which brand handled it

  -- Telephony identity
  twilio_call_sid TEXT UNIQUE,         -- Twilio Call SID ("sid")
  direction voice_call_direction NOT NULL,
  brand_id TEXT,                       -- denormalized for fast filtering/reporting
  from_number TEXT,                    -- caller (inbound) / our number (outbound)
  to_number TEXT,                      -- dialed number

  -- Status + result
  status voice_call_status DEFAULT 'queued',
  outcome voice_call_outcome DEFAULT 'in_progress',
  conversation_state TEXT,             -- final state machine node (e.g. 'BOOK_OR_CLOSE')
  duration_seconds INT,

  -- Content
  transcript JSONB DEFAULT '[]'::jsonb,  -- ordered conversation turns
  summary TEXT,                          -- AI-generated call summary
  recording_url TEXT,                    -- Twilio/Supabase storage recording
  error TEXT,                            -- failure detail when status='failed'

  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE voice_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_calls_tenant_isolation" ON voice_calls
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER voice_calls_updated_at
  BEFORE UPDATE ON voice_calls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_voice_calls_tenant_id ON voice_calls(tenant_id);
CREATE INDEX idx_voice_calls_agent_config_id ON voice_calls(agent_config_id);
CREATE INDEX idx_voice_calls_status ON voice_calls(tenant_id, status);
CREATE INDEX idx_voice_calls_outcome ON voice_calls(tenant_id, outcome);
CREATE INDEX idx_voice_calls_created_at ON voice_calls(tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- voice_leads — qualified lead data extracted from calls
-- ---------------------------------------------------------------------------
CREATE TABLE voice_leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  call_id UUID REFERENCES voice_calls(id),  -- the call that produced this lead

  -- Contact
  name TEXT,
  phone TEXT,
  email TEXT,
  zip TEXT,

  -- Qualification
  project_type voice_project_type,
  budget_range TEXT,                   -- e.g. '$20K-$35K' (free-form per brand)
  timeline voice_timeline,
  notes TEXT,
  qualified BOOLEAN DEFAULT false,

  booked_at TIMESTAMPTZ,               -- set when an appointment is booked

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE voice_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_leads_tenant_isolation" ON voice_leads
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER voice_leads_updated_at
  BEFORE UPDATE ON voice_leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_voice_leads_tenant_id ON voice_leads(tenant_id);
CREATE INDEX idx_voice_leads_call_id ON voice_leads(call_id);
CREATE INDEX idx_voice_leads_phone ON voice_leads(tenant_id, phone);
CREATE INDEX idx_voice_leads_booked_at ON voice_leads(tenant_id, booked_at);
