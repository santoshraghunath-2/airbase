# Airbase — Phase Definitions

All five phases. Build in order. Do not skip ahead.
Current active phase is always in `current-phase.md`.

---

## Phase 1 — Core Loop (Months 1–4)
**Milestone: Steward Home Services running live on Airbase**

### Goal
Establish the foundational operational loop: customer → job → dispatch board → technician app → invoice → payment. Replace the clipboard. Nothing AI yet — just a clean, fast, mobile-first ops tool that Steward can run real jobs on.

### Deliverables

**Database (Supabase migrations)**
- `001_tenants.sql` — multi-tenant foundation
- `002_users_roles.sql` — owner, dispatcher, technician, office_manager roles
- `003_customers.sql` — customer profiles, service locations (one customer → many locations)
- `004_equipment.sql` — equipment per location, make/model/serial/install_date
- `005_jobs.sql` — job lifecycle: scheduled → dispatched → in_progress → completed → invoiced
- `006_technicians.sql` — tech profiles, skills tags (manual), availability
- `007_pricebook.sql` — flat-rate items: services + parts, categorized
- `008_invoices.sql` — invoice header + line items, status, payment link
- `009_payments.sql` — Stripe payment records, linked to invoice
- `010_agent_actions.sql` — audit log for all future AI actions (empty for now, structure only)

**Backend (Supabase Edge Functions)**
- `create-job` — validate, create job, trigger customer confirmation SMS
- `dispatch-job` — manually assign tech, update job status, send tech SMS
- `close-job` — mark complete, trigger invoice generation (manual in Phase 1)
- `process-payment` — Stripe payment intent creation + webhook handler
- `qbo-sync` — push completed invoices to QuickBooks Online
- `send-sms` — Twilio wrapper (confirmation, reminder, on-way notifications)

**Frontend (React)**
- Auth: login, multi-tenant routing (`/[tenant]/dashboard`)
- Dashboard: today's jobs, revenue, open invoices, unassigned jobs count
- Customer list + detail: profile, locations, equipment, job history
- New job booking form: customer lookup/create, location, job type, priority, time window
- Dispatch board: visual calendar/kanban with tech columns, drag-drop assignment
- Technician detail: profile, skill tags, today's schedule
- Invoice list + detail: line items, totals, payment status
- Invoice builder: manual line-item entry from pricebook
- Pricebook management: CRUD for services and parts

**Technician PWA**
- Login → today's job list
- Job detail: customer info, location (tap for maps), notes
- Clock in / clock out with GPS
- Mark job stages: driving → arrived → working → done
- Photo capture (stored to Supabase Storage)
- Simple notes field → saved to job

**Automations (no AI yet, just logic)**
- 24h before job: confirmation SMS to customer
- 1h before job: reminder SMS to customer
- When tech dispatched: SMS to tech with job details
- When tech marks "on way": SMS to customer with ETA
- When job closed: SMS to customer "thank you, invoice to follow"

**Integrations**
- Stripe: payment link generation, webhook → payment status update
- QuickBooks Online: OAuth flow, invoice push after payment
- Google Maps: geocode addresses, embed map on job detail
- Twilio SMS: all customer + tech notifications

### Done When
- Steward dispatcher can book a plumbing job, assign a tech, tech sees it on PWA, job gets closed, invoice sent, payment collected — all without touching paper or a separate tool.

---

## Phase 2 — AI Operations Layer (Months 5–9)
**Milestone: 3+ beta accounts (non-Steward) live**

### Goal
Wire Claude API into every high-friction workflow. This is the phase that makes Airbase categorically different. Dispatch becomes autonomous. Inbound booking becomes AI-handled. Invoicing goes zero-touch. The operator gets a natural language command interface.

### Deliverables

**New Database Migrations**
- `011_skills.sql` — structured skills taxonomy (not just tags): `plumbing_drain`, `hvac_install`, `electrical_panel`, etc.
- `012_agent_config.sql` — per-tenant agent settings (confidence thresholds, auto-execute flags)
- `013_conversations.sql` — inbound call/SMS conversation logs for booking agent
- `014_operator_chat.sql` — operator command chat history

**AI Agents (Supabase Edge Functions)**

**dispatch-agent/**
- Trigger: new job created OR tech cancellation OR emergency
- Context: all open jobs, all available techs, GPS locations, skills, drive-time matrix
- Tools: `assign_job(job_id, tech_id, rationale)`, `propose_assignments(ranked_list)`
- Output: ranked assignment proposals → auto-execute if confidence ≥ threshold, else push to dispatcher
- System prompt: `prompts/dispatch-agent.md`

**booking-agent/**
- Trigger: inbound Twilio call or SMS to company number
- Flow (call): Twilio → webhook → Edge Function → Claude streaming → Twilio TTS response
- Flow (SMS): Twilio → webhook → Edge Function → Claude → Twilio SMS reply
- Tools: `lookup_customer(phone)`, `create_customer(...)`, `check_availability(job_type, urgency)`, `create_job(...)`, `send_confirmation(job_id)`
- Escalation: if customer angry, confused, or job type unknown → transfer/flag to human CSR
- System prompt: `prompts/booking-agent.md`

**invoice-agent/**
- Trigger: tech marks job `completed` in PWA
- Context: job details, parts used, labor hours, pricebook, customer membership status
- Tools: `draft_invoice(job_id)`, `flag_anomaly(reason)`, `send_invoice(invoice_id)`
- Logic: if line items within normal range for job type → auto-send; else → flag for review
- System prompt: `prompts/invoice-agent.md`

**operator-agent/**
- Interface: chat UI in operator dashboard (not a separate app, embedded panel)
- Can execute: job reassignment, status queries, bulk operations, config changes
- Can answer: any business question from live Supabase data (revenue, tech performance, open jobs)
- Can alert: proactively surface anomalies without being asked
- Tools: full Supabase read access + write tools for safe operations (no financial writes without confirm)
- System prompt: `prompts/operator-agent.md`

**tech-assistant/**
- Interface: chat tab in technician PWA
- Knowledge base: equipment manuals (PDFs in Supabase Storage → chunked into pgvector)
- Can answer: troubleshooting, part lookups, code lookups, previous job notes for this equipment
- Can generate: job notes draft from voice/text input
- Can suggest: upsell opportunities based on equipment age and findings
- System prompt: `prompts/tech-assistant.md`

**Frontend**
- Dispatch board upgrade: AI suggestion panel (show proposed assignment with rationale, accept/reject button)
- Operator command panel: floating chat widget on all operator screens
- Invoice review queue: AI-drafted invoices awaiting human review
- Agent action log: timeline view of all agent actions this week
- Booking agent status: live indicator showing active inbound conversations
- Tech PWA: "Ask AI" tab for troubleshooting assistant

**AI Pricebook Import**
- Upload PDF or CSV → Claude extracts line items → review table → confirm import
- Works for standard pricebook formats (ServiceTitan export, custom spreadsheet)

### Done When
- Dispatch agent auto-assigns >70% of jobs without dispatcher intervention
- Booking agent handles >60% of inbound SMS bookings end-to-end
- Invoices auto-sent within 5 minutes of job close for standard jobs
- Operator can ask "show me all unpaid invoices over $500" and get the answer in the chat

---

## Phase 3 — Revenue Intelligence (Months 10–15)
**Milestone: $10K MRR from external accounts**

### Goal
Add the modules that directly grow customer revenue: full membership lifecycle, multi-option estimates with AI upsells, marketing automation, customer financing, and the customer portal. These are what ServiceTitan sells as expensive "Pro" add-ons. In Airbase they're core.

### Deliverables
- Membership tiers CRUD: configure benefits, pricing, billing cycle
- Membership billing: recurring Stripe subscriptions, failed payment retry logic
- Membership agent (Edge Function): nightly sweep → 60/30/7 day pre-expiry outreach sequences
- Auto-renewal with card on file
- Win-back sequences: 7/30/90 days post-lapse
- Multi-option estimate builder: good / better / best presentation
- AI upsell engine: suggest add-ons at estimate time based on equipment age + job type
- Customer financing: Wisetack API integration
- Email/SMS marketing campaigns: AI-drafted, operator-reviewed, scheduled sends
- Google/Yelp review solicitation: triggered post-job, routed by satisfaction score
- Customer portal: view history, pay invoice, request appointment, view equipment
- Job profitability analytics: margin by tech, zone, job type, customer
- Weekly AI business briefing: auto-generated Monday morning summary email to owner
- Estimate → job conversion tracking + reporting

---

## Phase 4 — Enterprise & Scale (Months 16–20)
**Milestone: $50K MRR, 20+ accounts**

### Goal
Win mid-market accounts (15–100 tech companies) and multi-shop operators. The features in this phase are table-stakes for operators with complex operations or multiple locations.

### Deliverables
- Multi-location / MSO account hierarchy (parent org → child locations)
- Cross-location dispatch optimization
- Commercial multi-site billing (one invoice for many service addresses)
- Inventory module: truck stock, warehouse, purchase orders
- AI inventory reorder (usage-based forecasting)
- Fleet tracking: GPS, maintenance schedules, fuel logging (Samsara or Verizon Connect API)
- Advanced payroll engine: flat, tiered commission, spiffs, overtime rules
- Payroll export: Gusto API + QuickBooks Payroll
- React Native technician apps (iOS + Android) replacing PWA
- Full accounting module: P&L by job, WIP tracking, job costing
- Open API (REST + webhooks) for third-party integrations
- Zapier native integration
- White-label / franchise deployment mode

---

## Phase 5 — Platform & Network (Months 21–24)
**Milestone: $150K+ MRR, fundraise-ready**

### Goal
Turn Airbase from a SaaS product into a platform with network effects. Introduce supplier marketplace, cross-account benchmarking, and the agent marketplace.

### Deliverables
- Supplier marketplace: Ferguson, Grainger, local distributor catalog + ordering
- Anonymous benchmarking: your AOV / close rate vs. aggregated industry (opt-in)
- Agent marketplace: publish/install third-party AI agents (permit research, equipment warranty lookup, etc.)
- Predictive maintenance revenue engine: AI identifies at-risk equipment → proactive outreach
- AI demand forecasting + seasonal capacity planning
- Automated permit research assistant (local jurisdiction integrations)
- Custom AI agent builder (no-code) for operators
- Industry-specific fine-tuned model (trained on anonymized Airbase job data)
