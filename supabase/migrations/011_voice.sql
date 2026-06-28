-- Migration 011: Voice module (voice_* tables)
--
-- AI voice calling module — inbound calls + outbound form-fill callbacks.
-- See src/modules/voice/CLAUDE.md for the module spec.
--
-- Brands (GGB Express, Recast Texas, Steward) are rows in voice_agent_config
-- within a tenant — one tenant can run several brands. Inbound routing maps the
-- dialed Twilio number -> config. Depends on get_my_tenant_id() (002) and
-- update_updated_at() (001).

CREATE TYPE voice_call_direction AS ENUM ('inbound', 'outbound');

CREATE TYPE voice_call_status AS ENUM (
  'queued', 'ringing', 'in_progress', 'completed',
  'busy', 'failed', 'no_answer', 'canceled'
);

CREATE TYPE voice_call_outcome AS ENUM (
  'in_progress',
  'booked',
  'qualified_not_booked',
  'not_qualified',
  'escalated_human',
  'no_answer',
  'voicemail',
  'abandoned',
  'failed'
);

CREATE TYPE voice_project_type AS ENUM (
  'full_bathroom', 'shower_only', 'tub_only', 'kitchen', 'other'
);

CREATE TYPE voice_timeline AS ENUM (
  'asap', '1-3months', '3-6months', 'just_browsing'
);


-- Per-brand agent settings (created first; referenced by voice_calls FK).
CREATE TABLE voice_agent_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),

  brand_id TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  persona_name TEXT,

  system_prompt TEXT NOT NULL,
  model_id TEXT DEFAULT 'claude-sonnet-4-6',
  voice_id TEXT,

  phone_number TEXT,
  outbound_enabled BOOLEAN DEFAULT false,

  booking_destination TEXT,
  sms_sender TEXT,

  active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ,

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
CREATE INDEX idx_voice_agent_config_phone_number
  ON voice_agent_config(phone_number) WHERE active AND deleted_at IS NULL;


-- Full call log + transcripts.
CREATE TABLE voice_calls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  agent_config_id UUID REFERENCES voice_agent_config(id),

  twilio_call_sid TEXT UNIQUE,
  direction voice_call_direction NOT NULL,
  brand_id TEXT,
  from_number TEXT,
  to_number TEXT,

  status voice_call_status DEFAULT 'queued',
  outcome voice_call_outcome DEFAULT 'in_progress',
  conversation_state TEXT,
  duration_seconds INT,

  transcript JSONB DEFAULT '[]'::jsonb,
  summary TEXT,
  recording_url TEXT,
  error TEXT,

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


-- Qualified lead data extracted from calls.
CREATE TABLE voice_leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  call_id UUID REFERENCES voice_calls(id),

  name TEXT,
  phone TEXT,
  email TEXT,
  zip TEXT,

  project_type voice_project_type,
  budget_range TEXT,
  timeline voice_timeline,
  notes TEXT,
  qualified BOOLEAN DEFAULT false,

  booked_at TIMESTAMPTZ,

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
