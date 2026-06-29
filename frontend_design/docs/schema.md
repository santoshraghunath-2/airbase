# Airbase — Database Schema Reference

Supabase (Postgres). All tables have RLS enabled. All use `snake_case`.
Run migrations in numbered order. Never modify a deployed migration — always add a new one.

---

## Core Tables (Phase 1)

### tenants
```sql
CREATE TYPE subscription_tier AS ENUM ('starter', 'growth', 'enterprise');
CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'past_due', 'cancelled', 'paused');

CREATE TABLE tenants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL, -- used in URL routing: /[slug]/dashboard
  phone TEXT,
  address TEXT,
  timezone TEXT DEFAULT 'America/Los_Angeles',

  -- Subscription
  subscription_tier subscription_tier DEFAULT 'starter',
  subscription_status subscription_status DEFAULT 'trialing',
  trial_ends_at TIMESTAMPTZ,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_account_id TEXT, -- for Stripe Connect if tenants collect payments through Airbase
  billing_email TEXT,

  -- AI model selection (tenant-wide default; overridden per-agent in agent_config)
  -- Must be a key in the MODEL_REGISTRY in llm-router.ts
  default_model_id TEXT DEFAULT 'claude-sonnet-4-6',

  -- Integrations
  twilio_phone_number TEXT,
  qbo_realm_id TEXT,         -- QuickBooks company ID
  qbo_access_token TEXT,     -- encrypted at rest via Supabase vault
  qbo_refresh_token TEXT,    -- encrypted at rest via Supabase vault

  -- MSO / franchise linkage (Phase 4)
  parent_tenant_id UUID REFERENCES tenants(id), -- NULL = root tenant

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### users
```sql
CREATE TYPE user_role AS ENUM ('owner', 'office_manager', 'dispatcher', 'technician');

CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  auth_id UUID UNIQUE REFERENCES auth.users(id), -- Supabase Auth
  email TEXT,
  name TEXT NOT NULL,
  phone TEXT,
  role user_role NOT NULL,
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### customers
```sql
CREATE TABLE customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT NOT NULL,
  phone_alt TEXT,
  notes TEXT,
  source TEXT, -- 'inbound_call' | 'web' | 'referral' | 'booking_agent' | 'manual'
  qbo_customer_id TEXT, -- QuickBooks customer ID
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE service_locations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  address TEXT NOT NULL,
  city TEXT,
  state TEXT,
  zip TEXT,
  latitude FLOAT,
  longitude FLOAT,
  location_notes TEXT, -- gate codes, dogs, parking notes
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### equipment
```sql
CREATE TABLE equipment (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  location_id UUID NOT NULL REFERENCES service_locations(id),
  category TEXT NOT NULL, -- 'hvac' | 'plumbing' | 'electrical' | 'water_heater' | etc
  make TEXT,
  model TEXT,
  serial_number TEXT,
  install_date DATE,
  warranty_expiry DATE,
  last_service_date DATE,
  notes TEXT,
  nameplate_photo_url TEXT, -- from OCR scan
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### technicians
```sql
CREATE TABLE technicians (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  license_number TEXT,
  license_expiry DATE,
  is_active BOOLEAN DEFAULT true,
  current_latitude FLOAT, -- updated by PWA
  current_longitude FLOAT,
  last_location_update TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Phase 1: simple skill tags. Phase 2: replace with structured skills table
CREATE TABLE tech_skills (
  tech_id UUID NOT NULL REFERENCES technicians(id),
  skill TEXT NOT NULL, -- 'plumbing_drain' | 'hvac_install' | 'electrical_panel' etc
  level TEXT DEFAULT 'proficient', -- 'learning' | 'proficient' | 'expert'
  ai_inferred BOOLEAN DEFAULT false, -- set to true when AI sets this
  ai_confidence FLOAT,
  manually_overridden BOOLEAN DEFAULT false,
  overridden_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (tech_id, skill)
);
```

### jobs
```sql
CREATE TYPE job_status AS ENUM (
  'scheduled', 'unassigned', 'dispatched', 'en_route',
  'arrived', 'in_progress', 'completed', 'invoiced',
  'cancelled', 'no_show'
);
CREATE TYPE job_priority AS ENUM ('emergency', 'high', 'normal', 'low');
CREATE TYPE job_type AS ENUM (
  'plumbing_service', 'drain_cleaning', 'water_heater_repair', 'water_heater_install',
  'hvac_service', 'hvac_repair', 'hvac_install', 'hvac_maintenance',
  'electrical_service', 'electrical_repair', 'electrical_install',
  'general_maintenance', 'estimate_only', 'warranty_call', 'recall'
);

CREATE TABLE jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  location_id UUID NOT NULL REFERENCES service_locations(id),
  tech_id UUID REFERENCES technicians(id),
  dispatched_by UUID REFERENCES users(id), -- null = AI dispatch
  job_type job_type NOT NULL,
  status job_status DEFAULT 'unassigned',
  priority job_priority DEFAULT 'normal',
  description TEXT,
  internal_notes TEXT,
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  actual_start TIMESTAMPTZ,
  actual_end TIMESTAMPTZ,
  source TEXT DEFAULT 'manual', -- 'manual' | 'booking_agent_sms' | 'booking_agent_voice' | 'web' | 'portal'
  membership_id UUID REFERENCES memberships(id), -- if covered by membership
  requires_skill TEXT,
  estimated_duration_minutes INT,
  actual_duration_minutes INT,
  travel_time_minutes INT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### pricebook
```sql
CREATE TYPE pricebook_item_type AS ENUM ('service', 'part', 'material', 'labor', 'fee');

CREATE TABLE pricebook_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  item_type pricebook_item_type NOT NULL,
  category TEXT, -- 'plumbing' | 'hvac' | 'electrical' etc
  unit_price NUMERIC(10,2) NOT NULL,
  cost NUMERIC(10,2), -- for margin tracking
  sku TEXT,
  taxable BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### invoices
```sql
CREATE TYPE invoice_status AS ENUM (
  'draft', 'review_required', 'sent', 'viewed',
  'partial', 'paid', 'overdue', 'void'
);

CREATE TABLE invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  invoice_number TEXT, -- auto-generated: INV-YYYY-NNNNN
  status invoice_status DEFAULT 'draft',
  subtotal NUMERIC(10,2),
  tax_amount NUMERIC(10,2) DEFAULT 0,
  discount_amount NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(10,2),
  amount_paid NUMERIC(10,2) DEFAULT 0,
  balance_due NUMERIC(10,2),
  ai_generated BOOLEAN DEFAULT false,
  ai_flagged BOOLEAN DEFAULT false,
  ai_flag_reason TEXT,
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  due_date DATE,
  paid_at TIMESTAMPTZ,
  notes TEXT, -- customer-visible note
  qbo_invoice_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE invoice_line_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  pricebook_item_id UUID REFERENCES pricebook_items(id),
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(10,2) NOT NULL,
  total NUMERIC(10,2) NOT NULL,
  taxable BOOLEAN DEFAULT true,
  sort_order INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### payments
```sql
CREATE TABLE payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  stripe_payment_intent_id TEXT UNIQUE,
  amount NUMERIC(10,2) NOT NULL,
  method TEXT, -- 'card' | 'ach' | 'cash' | 'check' | 'financing'
  status TEXT DEFAULT 'pending', -- 'pending' | 'succeeded' | 'failed' | 'refunded'
  last_four TEXT,
  card_brand TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Phase 2 Additions

### agent_config
```sql
CREATE TABLE agent_config (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  agent_type TEXT NOT NULL, -- 'dispatch' | 'booking' | 'invoice' | 'membership' | 'operator' | 'tech'
  auto_execute_enabled BOOLEAN DEFAULT false,
  confidence_threshold FLOAT DEFAULT 0.85,
  max_auto_invoice_amount NUMERIC(10,2) DEFAULT 500,

  -- Per-agent model selection.
  -- NULL = inherit from tenants.default_model_id.
  -- Must be a key in MODEL_REGISTRY when set.
  -- Allows routing cheap/fast models to high-volume agents (invoice, booking SMS)
  -- and premium models to high-stakes agents (dispatch, operator).
  model_id TEXT DEFAULT NULL,

  settings JSONB DEFAULT '{}', -- agent-specific config (e.g. escalation thresholds)
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (tenant_id, agent_type)
);

-- Example: A tenant using DeepSeek for invoice drafting but Claude for dispatch
-- INSERT INTO agent_config (tenant_id, agent_type, model_id) VALUES
--   ('...', 'invoice',   'deepseek-chat'),
--   ('...', 'booking',   'deepseek-chat'),
--   ('...', 'dispatch',  'claude-sonnet-4-6'),  -- explicit, or just leave NULL to use tenant default
--   ('...', 'operator',  'claude-opus-4-6');    -- upgrade operator to Opus for complex queries
```

### conversations (booking agent state)
```sql
CREATE TABLE conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  channel TEXT NOT NULL, -- 'sms' | 'voice' | 'chat'
  customer_phone TEXT,
  customer_id UUID REFERENCES customers(id),
  messages JSONB DEFAULT '[]', -- array of {role, content, timestamp}
  status TEXT DEFAULT 'active', -- 'active' | 'completed' | 'escalated' | 'abandoned'
  job_id UUID REFERENCES jobs(id), -- set when job is created
  escalation_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### operator_chat
```sql
CREATE TABLE operator_chat (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  messages JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## RLS Policies (apply to all tables)

```sql
-- Example for jobs table (repeat for all tenant-scoped tables)
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON jobs
  FOR ALL USING (
    tenant_id = (
      SELECT tenant_id FROM users WHERE auth_id = auth.uid()
    )
  );
```
