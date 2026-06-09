# Airbase — AI Agent Specifications

All agents follow the same pattern. Reference the base pattern in CLAUDE.md before building any agent.

---

## Agent 1: Dispatch Agent

**File:** `/supabase/functions/dispatch-agent/index.ts`
**System prompt:** `/prompts/dispatch-agent.md`
**Trigger:** Supabase Realtime on `jobs` table INSERT or `jobs.status = 'unassigned'`
**Also trigger on:** tech cancellation, emergency job creation, end-of-day re-optimization

### Tools (Claude tool_use schema)

```typescript
const dispatchTools = [
  {
    name: "get_available_technicians",
    description: "Returns all technicians available in the given time window with their current GPS location, skills, and current job load",
    input_schema: {
      type: "object",
      properties: {
        start_time: { type: "string", format: "datetime" },
        end_time: { type: "string", format: "datetime" },
        required_skills: { type: "array", items: { type: "string" } }
      },
      required: ["start_time", "end_time"]
    }
  },
  {
    name: "get_drive_times",
    description: "Returns drive time in minutes from each technician's current location to the job address using Google Maps Distance Matrix",
    input_schema: {
      type: "object",
      properties: {
        job_address: { type: "string" },
        tech_ids: { type: "array", items: { type: "string" } }
      },
      required: ["job_address", "tech_ids"]
    }
  },
  {
    name: "get_customer_history",
    description: "Returns the last 5 jobs at this customer location, including which tech served them and their satisfaction ratings",
    input_schema: {
      type: "object",
      properties: { customer_id: { type: "string" } },
      required: ["customer_id"]
    }
  },
  {
    name: "propose_assignment",
    description: "Writes the proposed assignment to the agent_actions table and optionally auto-executes if confidence is high",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        tech_id: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        rationale: { type: "string", description: "Plain English explanation shown to dispatcher" },
        alternative_tech_id: { type: "string", description: "Second choice if primary is rejected" }
      },
      required: ["job_id", "tech_id", "confidence", "rationale"]
    }
  }
]
```

### Logic Flow

1. Job created → agent triggered
2. Call `get_available_technicians` for the job time window + required skill
3. Call `get_drive_times` for all available techs
4. Call `get_customer_history` for customer preference data
5. Score techs: (skill match × 40%) + (proximity × 35%) + (customer familiarity × 15%) + (current load × 10%)
6. Call `propose_assignment` with top choice + rationale
7. If `confidence >= tenant.dispatch_auto_threshold` (default: 0.85) → auto-execute
8. Else → push to dispatcher UI as a proposal with accept/reject

### Auto-Execute Rules (never auto-execute if any of these are true)
- Job value estimated >$1,500
- Customer has flagged a preferred tech
- Tech hasn't worked this job type before (no matching completed jobs)
- It's a first-time customer

---

## Agent 2: Booking Agent (SMS)

**File:** `/supabase/functions/booking-agent/index.ts`
**System prompt:** `/prompts/booking-agent.md`
**Trigger:** Twilio webhook POST on inbound SMS to company number

### Tools

```typescript
const bookingTools = [
  {
    name: "lookup_customer",
    description: "Look up existing customer by phone number",
    input_schema: {
      type: "object",
      properties: { phone: { type: "string" } },
      required: ["phone"]
    }
  },
  {
    name: "create_customer",
    description: "Create a new customer record",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        address: { type: "string" },
        email: { type: "string" }
      },
      required: ["name", "phone"]
    }
  },
  {
    name: "get_availability",
    description: "Returns the next 3 available time windows for the given job type and urgency level",
    input_schema: {
      type: "object",
      properties: {
        job_type: { type: "string", enum: ["plumbing_service", "hvac_service", "electrical_service", "drain_cleaning", "water_heater", "hvac_install", "emergency"] },
        urgency: { type: "string", enum: ["emergency", "today", "this_week", "flexible"] }
      },
      required: ["job_type", "urgency"]
    }
  },
  {
    name: "create_job",
    description: "Creates the job and sends a confirmation SMS to the customer",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        job_type: { type: "string" },
        description: { type: "string" },
        scheduled_start: { type: "string", format: "datetime" },
        urgency: { type: "string" },
        address: { type: "string" }
      },
      required: ["customer_id", "job_type", "scheduled_start", "urgency"]
    }
  },
  {
    name: "escalate_to_human",
    description: "Flag conversation for human CSR takeover with a context summary",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", enum: ["customer_upset", "complex_job", "unknown_issue", "explicit_request", "safety_concern"] },
        summary: { type: "string", description: "Brief context for the CSR taking over" }
      },
      required: ["reason", "summary"]
    }
  }
]
```

### Conversation State
- Stored in `conversations` table keyed on `(tenant_id, customer_phone, conversation_id)`
- Messages stored as JSONB array
- Status: `active | completed | escalated | abandoned`
- Max turns before auto-escalation: 8 (configurable per tenant)

### Escalation Triggers (automatic, no agent decision needed)
- Customer sends "STOP", "HUMAN", "AGENT", "SPEAK TO SOMEONE"
- Confidence on job_type < 0.6 after 3 turns
- Emergency keyword detected without clear resolution path
- Customer expresses frustration (sentiment < -0.5)

---

## Agent 3: Invoice Agent

**File:** `/supabase/functions/invoice-agent/index.ts`
**System prompt:** `/prompts/invoice-agent.md`
**Trigger:** `jobs.status` changes to `completed`

### Tools

```typescript
const invoiceTools = [
  {
    name: "get_job_details",
    description: "Returns complete job data: parts used, labor time, tech, customer, membership status",
    input_schema: {
      type: "object",
      properties: { job_id: { type: "string" } },
      required: ["job_id"]
    }
  },
  {
    name: "get_pricebook_items",
    description: "Look up current prices for parts and services by item ID or keyword",
    input_schema: {
      type: "object",
      properties: { item_ids: { type: "array", items: { type: "string" } } },
      required: ["item_ids"]
    }
  },
  {
    name: "get_job_type_baseline",
    description: "Returns average invoice total and line item composition for this job type over the last 90 days",
    input_schema: {
      type: "object",
      properties: { job_type: { type: "string" } },
      required: ["job_type"]
    }
  },
  {
    name: "draft_invoice",
    description: "Creates invoice draft in DB with line items, discounts, totals",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        line_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              pricebook_item_id: { type: "string" },
              description: { type: "string" },
              quantity: { type: "number" },
              unit_price: { type: "number" }
            }
          }
        },
        membership_discount_applied: { type: "boolean" },
        notes: { type: "string" }
      },
      required: ["job_id", "line_items"]
    }
  },
  {
    name: "flag_for_review",
    description: "Mark invoice for human review before sending, with a reason",
    input_schema: {
      type: "object",
      properties: {
        invoice_id: { type: "string" },
        flag_reason: { type: "string" },
        flag_type: { type: "string", enum: ["anomaly_high", "anomaly_low", "missing_items", "membership_conflict", "manual_review_required"] }
      },
      required: ["invoice_id", "flag_reason", "flag_type"]
    }
  },
  {
    name: "send_invoice",
    description: "Send invoice to customer via SMS (payment link) and email",
    input_schema: {
      type: "object",
      properties: {
        invoice_id: { type: "string" },
        send_sms: { type: "boolean", default: true },
        send_email: { type: "boolean", default: true }
      },
      required: ["invoice_id"]
    }
  }
]
```

### Auto-Send Rules (flag for review if any are true)
- Invoice total > 150% of 90-day average for this job type
- Invoice total < 40% of 90-day average for this job type
- Parts used but no parts appear on invoice
- Customer has active membership but no membership discount applied
- Job marked complete but labor time logged = 0
- Invoice total > $2,000 (configurable threshold)

---

## Agent 4: Operator Agent

**File:** `/supabase/functions/operator-agent/index.ts`
**System prompt:** `/prompts/operator-agent.md`
**Trigger:** Operator sends message in command panel (HTTP POST from React)
**Also runs:** nightly proactive anomaly sweep (cron at 7am local time)

### Tool Categories

**Read tools (always safe, no approval needed):**
- `query_jobs(filters)` — any job query with date/status/tech/customer filters
- `query_revenue(period, group_by)` — revenue aggregation by any dimension
- `query_technicians(filters)` — tech performance metrics
- `query_customers(filters)` — customer queries
- `query_invoices(filters)` — invoice and payment status

**Write tools (require operator confirmation in chat before executing):**
- `reassign_job(job_id, new_tech_id, reason)`
- `reschedule_job(job_id, new_time)`
- `cancel_job(job_id, reason, notify_customer: bool)`
- `update_pricebook_item(item_id, new_price)`
- `update_agent_config(setting, value)` — change agent thresholds

**Proactive alerts (agent initiates, no user prompt):**
- 3+ jobs unassigned for >2 hours → alert with proposed assignments
- Tech has 0 completed jobs today when schedule shows 3+ → alert
- Invoice unpaid at 7 days → suggest follow-up sequence
- Membership renewal rate drops >10% week-over-week → alert
- Revenue today tracking >20% below same day last week → alert

---

## Agent 5: Tech Assistant

**File:** `/supabase/functions/tech-assistant/index.ts`
**System prompt:** `/prompts/tech-assistant.md`
**Trigger:** HTTP POST from technician PWA chat tab

### Tools

```typescript
const techTools = [
  {
    name: "search_equipment_manuals",
    description: "Semantic search through ingested equipment manuals and service bulletins stored in pgvector",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        equipment_make: { type: "string" },
        equipment_model: { type: "string" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_previous_job_notes",
    description: "Returns notes and photos from previous jobs at this customer's address for the same equipment",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        equipment_id: { type: "string" }
      },
      required: ["customer_id"]
    }
  },
  {
    name: "lookup_part",
    description: "Look up part by name, description, or part number in pricebook",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    }
  },
  {
    name: "add_job_note",
    description: "Add a note to the current job (tech dictates, AI cleans up)",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        note: { type: "string" },
        note_type: { type: "string", enum: ["finding", "repair_performed", "recommendation", "customer_declined", "follow_up_needed"] }
      },
      required: ["job_id", "note", "note_type"]
    }
  },
  {
    name: "flag_upsell_opportunity",
    description: "Flag an upsell opportunity discovered on site for dispatcher to follow up",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        opportunity: { type: "string" },
        estimated_value: { type: "number" },
        urgency: { type: "string", enum: ["immediate", "within_year", "recommend_at_next_visit"] }
      },
      required: ["job_id", "opportunity", "urgency"]
    }
  }
]
```

---

## Agent Action Log Schema

Every agent action writes to this table:

```sql
CREATE TABLE agent_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  agent_type TEXT NOT NULL, -- 'dispatch' | 'booking' | 'invoice' | 'operator' | 'tech'
  trigger_event TEXT,
  context_snapshot JSONB, -- what data the agent saw
  reasoning TEXT, -- Claude's reasoning chain (plain text)
  proposed_action JSONB, -- structured action object
  confidence FLOAT,
  status TEXT DEFAULT 'proposed', -- 'proposed' | 'auto_executed' | 'approved' | 'rejected' | 'reversed'
  executed_at TIMESTAMPTZ,
  executed_by UUID REFERENCES users(id), -- null = auto-executed
  approved_by UUID REFERENCES users(id),
  rejected_reason TEXT,
  reversed_at TIMESTAMPTZ,
  reversed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```
