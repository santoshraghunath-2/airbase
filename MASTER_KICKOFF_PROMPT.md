# Airbase — Master Kickoff Prompt for Claude Code

> **How to use this file:**
> Open a new Claude Code session in the `airbase/` project directory.
> Paste Phase 1 or Phase 2 section below as your first message.
> CLAUDE.md and docs/ will load automatically and ground every session.

---

## ━━━ PHASE 1 KICKOFF PROMPT ━━━

Paste this to start Phase 1 from scratch:

---

We're building Airbase, an AI-native field service management platform for plumbing, HVAC, and electrical companies. Read CLAUDE.md and docs/phases.md before writing any code.

**Context:**
- Stack: React 19 + Vite + Tailwind + shadcn/ui on frontend, Supabase (Postgres + Edge Functions) as backend, Netlify for deployment
- Primary user: Steward Home Services (our own plumbing company) — they go live on this before we sell it to anyone
- We are prioritizing getting to Phase 2 (AI agents) as fast as possible, so Phase 1 should be lean and functional — not over-engineered

**Start with this sequence:**

1. **Project scaffold** — set up the Vite + React + Tailwind + shadcn/ui project with the directory structure defined in CLAUDE.md. Include Supabase client setup, auth context, and multi-tenant routing.

2. **Database migrations** — write migrations 001 through 010 per docs/schema.md. Each is a separate numbered file in `/supabase/migrations/`. Include RLS policies. No migration modifies a previous file.

3. **Auth + tenant routing** — login screen, Supabase Auth session, route guard, `/[tenant]/dashboard` base routing. Roles: owner, dispatcher, technician.

4. **Dashboard** — today's jobs (count by status), revenue today, open invoices count, unassigned jobs alert banner. Real Supabase data. Skeleton loaders while fetching. Use shadcn/ui Card components.

5. **Customer module** — customer list with search, customer detail page with service locations + equipment list + job history. CRUD for customers and locations.

6. **Job booking** — new job form: customer lookup/create, select location, job type (use the enum from schema.md), priority, description, time window picker. Creates job in DB with status `unassigned`.

7. **Dispatch board** — visual day/week view with technician columns. Jobs as draggable cards. Drag-to-assign updates `job.tech_id` and status to `dispatched`. Color-coded by status and priority. Real-time updates via Supabase Realtime.

8. **Technician PWA** — separate mobile-optimized route at `/tech`. Job list for today. Job detail with customer info and address. Status progression buttons (dispatched → en_route → arrived → in_progress → completed). Clock in/out. Photo upload. Notes field.

9. **Pricebook** — CRUD interface for services and parts. CSV import. Category filtering.

10. **Invoice builder** — manual invoice creation from pricebook items. Send via SMS (Twilio) and email (SendGrid). Stripe payment link generation.

11. **Edge Functions** — `create-job`, `dispatch-job`, `close-job`, `process-payment`, `send-sms`, `qbo-sync` per docs/api-patterns.md.

12. **Automated SMS sequences** — 24h confirmation, 1h reminder, on-dispatch tech notification, on-way customer notification, post-job thank you.

For each feature: write the Supabase migration first (if needed), then the Edge Function (if needed), then the React component. TypeScript strict mode throughout. Every table gets RLS. Test with seed data from the Steward test dataset (3 techs, 20 customers, 50 jobs).

Start with #1 (project scaffold). Ask me before moving to the next item only if there's an architectural decision to make. Otherwise proceed.

---

## ━━━ PHASE 2 KICKOFF PROMPT ━━━

Paste this when Phase 1 is complete and Steward is live:

---

Phase 1 is complete. Steward Home Services is running live jobs on Airbase. Now we build the AI operations layer — this is the core value prop and the main reason we're building this instead of using ServiceTitan.

Read CLAUDE.md, docs/agents.md, and docs/current-phase.md before proceeding. The agent architecture, tool schemas, and Claude API patterns are all defined there. Follow them exactly.

**The goal of Phase 2:** Replace manual dispatch, inbound booking, and invoice processing with autonomous AI agents. Every agent follows the pattern in CLAUDE.md. Every action is logged to `agent_actions`. Every agent is reversible. No financial action auto-executes without a confidence check.

**Build in this exact order:**

### Step 1 — Agent Infrastructure (build this first, everything else depends on it)

1a. Migrations 011 (`skills`), 012 (`agent_config` — now includes `model_id` column), 013 (`conversations`), 014 (`operator_chat`) per docs/schema.md. Also run the `tenants` table update adding `default_model_id`, `subscription_tier`, `subscription_status`, `trial_ends_at` columns.

1b. **LLM router at `/supabase/functions/_shared/llm-router.ts`** — the full multi-provider router from docs/api-patterns.md. This is the single entry point for ALL AI calls. Build it first. Every agent imports `callAgent` and `runAgentLoop` from here. Supports Anthropic, OpenAI, DeepSeek, and Kimi. Tools are always declared in Anthropic format; the router translates to each provider's native format.

1c. Agent action logger at `/supabase/functions/_shared/agent-logger.ts`. Add `model_used TEXT` and `provider_used TEXT` columns to `agent_actions` — log which model was used for every decision.

1d. Feature gates at `/supabase/functions/_shared/feature-gates.ts` — checks `tenants.subscription_tier` before allowing agent calls. AI agents are Growth+ only.

1e. Skills taxonomy — replace freeform `tech_skills` tags with the structured enum from docs/agents.md.

### Step 2 — Dispatch Agent

Full spec in docs/agents.md. Build in this sub-order:
- Edge Function at `/supabase/functions/dispatch-agent/index.ts`
- Google Maps Distance Matrix integration (drive-time scoring for tech ranking)
- System prompt at `/prompts/dispatch-agent.md` — write this carefully. It should instruct Claude to: score techs by skill match + proximity + customer familiarity + load, always provide a rationale a dispatcher can understand, express confidence as a 0–1 float, and propose alternatives.
- Supabase Realtime trigger: new job → dispatch agent fires
- Dispatch board UI upgrade: AI proposal panel shows top tech recommendation with rationale + confidence bar + accept/reject buttons
- Auto-execute path: if `confidence >= agent_config.confidence_threshold` AND job value < threshold AND not first-time customer → auto-assign
- Feedback loop: accept/reject gets logged to `agent_actions` and fed back

**The dispatch board AI panel should look like this:**
```
┌─────────────────────────────────────────────────┐
│ 🤖 AI Recommendation                             │
│                                                   │
│ Marco Reyes  ██████████░░  87% match             │
│ "Closest tech with drain cert. Customer          │
│  previously requested Marco in March."           │
│                                                   │
│ [✓ Accept]  [✗ Reassign]  [See alternatives]    │
└─────────────────────────────────────────────────┘
```

### Step 3 — Booking Agent (SMS first, voice in Step 6)

Full spec in docs/agents.md. Build in this sub-order:
- Twilio inbound SMS webhook handler (see api-patterns.md for the pattern)
- Booking agent Edge Function with the 5 tools from docs/agents.md
- System prompt at `/prompts/booking-agent.md` — instruct Claude to: always start by looking up the customer, classify job type and urgency from natural language, offer exactly 2 time windows (never more, never less), confirm before creating job, escalate gracefully
- Conversation state management in `conversations` table
- Escalation flow: flag for human CSR with full context summary
- Booking agent dashboard panel: show active conversations, outcome metrics (booked / escalated / abandoned)

The booking agent SMS prompt should feel natural and human. Example:

> Customer texts: "Hi, my water heater isn't working"
> Agent: "Hi! This is Steward Home Services. Sorry to hear that — a broken water heater is no fun. Is this for your home at [address on file]? And would you say it's completely out or just not heating well?"

### Step 4 — Invoice Agent

Full spec in docs/agents.md. Build in this sub-order:
- Edge Function triggered on `jobs.status = 'completed'`
- System prompt at `/prompts/invoice-agent.md`
- Anomaly detection: compare against 90-day baseline for job type
- Auto-send path for clean invoices (within normal range, no flags)
- Invoice review queue: list of flagged invoices with flag reason and edit-before-send UI
- Agent action logged for every invoice decision

### Step 5 — Operator Command Panel

- Floating chat panel embedded in the operator dashboard (not a separate page)
- Edge Function at `/supabase/functions/operator-agent/index.ts`
- System prompt at `/prompts/operator-agent.md` — instruct Claude to: answer any business question from live DB data, execute safe write operations with confirmation, proactively surface issues, always cite what data it used
- Full DB read tools for the operator agent
- Write tools with confirmation step (show proposed action → operator types "yes" → execute)
- Proactive nightly sweep: cron Edge Function at 7am → check for anomalies → push alert if found

### Step 6 — Tech Assistant + Voice Booking (parallel)

**Tech Assistant:**
- Chat tab in technician PWA ("Ask AI" button)
- Equipment manual ingestion pipeline: PDF upload → chunk → pgvector store
- Edge Function with search_equipment_manuals + previous job notes tools
- System prompt: knowledgeable trade assistant, not a general chatbot

**Voice Booking Agent:**
- Twilio Voice webhook → streaming Claude → Twilio TTS
- Same booking agent logic as SMS, adapted for voice (shorter turns, explicit confirmations)
- Call recording + transcript → stored in `conversations` table

### Step 7 — AI Pricebook Import

- File upload UI (PDF or CSV)
- Claude extracts line items with category, price, description
- Review table: operator can edit before confirming import
- Bulk insert to `pricebook_items`

---

**For every agent:** write the system prompt file first, then the Edge Function, then any DB changes, then the UI. The system prompt is the spec — if it's wrong, the agent will be wrong.

**Testing each agent:**
- Dispatch: create a job manually, verify AI proposes a tech within 5 seconds, verify accept/reject logs correctly
- Booking SMS: text your Twilio number "I need a plumber", verify full booking flow completes
- Invoice: close a test job, verify invoice drafts and either auto-sends or enters review queue within 60 seconds
- Operator: ask "what's my revenue this week?", verify it returns correct data from DB

Go step by step. Ask before any architectural deviation from docs/. When in doubt, check CLAUDE.md.

---

## ━━━ PER-SESSION PROMPT (use at start of any session) ━━━

For day-to-day development sessions after kickoff:

---

We're continuing to build Airbase. Read CLAUDE.md and docs/current-phase.md to get oriented.

Current task: [DESCRIBE WHAT YOU'RE WORKING ON]

Before writing any code:
1. Confirm this task is in the current phase (docs/current-phase.md)
2. Check if there's an existing pattern in docs/ that applies
3. If touching the DB, show me the migration SQL before writing app code

[PASTE ANY RELEVANT CONTEXT OR PRIOR CODE HERE]

---

## ━━━ AGENT PROMPT TEMPLATES ━━━

Starter system prompts for each agent. Refine these during development.

### /prompts/dispatch-agent.md

```
You are the dispatch agent for [COMPANY_NAME], a field service company.
Your job is to recommend the best technician for each incoming job.

You have access to:
- All available technicians, their current locations, and skills
- Drive times from each tech to the job address
- Customer history including which techs have served them before
- Each tech's current job load

When recommending a tech, score them on:
1. Skill match (40%): Does this tech have the required skill? Expert > Proficient > Learning
2. Proximity (35%): Minimize drive time, maximize jobs-per-day
3. Customer familiarity (15%): Previous positive interactions with this customer increase score
4. Current load (10%): Prefer techs with lighter schedules

Always:
- Call get_available_technicians first
- Call get_drive_times with all available tech IDs
- Call get_customer_history
- Call propose_assignment with a confidence score (0.0–1.0) and plain-English rationale
- Express rationale in 1–2 sentences a dispatcher will understand immediately
- Provide an alternative_tech_id when confidence < 0.90

Set confidence to 0.95+ only when: skill is exact match, drive time < 20 min, customer has worked with this tech before.
Set confidence < 0.80 when: skill is partial match, tech is far, or first-time customer.
Never assign a tech to a job type outside their certified skills.
```

### /prompts/booking-agent.md

```
You are the booking assistant for [COMPANY_NAME].
You handle inbound text messages from customers wanting to schedule service.

Your goal: Book a job efficiently and warmly, or escalate to a human when needed.

Always:
1. Start by calling lookup_customer with the customer's phone number
2. If customer found, greet them by name and confirm their address
3. If not found, collect name and address naturally
4. Classify the job type from what they describe — ask one clarifying question if unclear
5. Ask about urgency: is this an emergency, or flexible timing?
6. Call get_availability and offer exactly TWO time options (never one, never three)
7. Confirm the selected time, then call create_job
8. End with a confirmation message including the tech's estimated arrival window

Tone: Warm, efficient, human. Like a friendly office manager, not a robot.
Keep messages short — 2–3 sentences max per turn.
Do not ask more than one question per message.

Escalate immediately if:
- Customer seems upset or frustrated
- Job type involves potential safety hazard (gas leak, no power, flooding)
- You've asked for clarification twice and still can't classify the job
- Customer explicitly asks to speak to a person
```

### /prompts/invoice-agent.md

```
You are the invoice agent for [COMPANY_NAME].
When a job is marked complete, you review the job data and create an accurate invoice.

Process:
1. Call get_job_details to see all parts used, labor time, and job type
2. Call get_pricebook_items to get current prices for all items used
3. Call get_job_type_baseline to understand what's normal for this job type
4. Draft the invoice with correct line items and pricing
5. Check if the total is within normal range (40%–150% of baseline)
6. Apply membership discount if customer has active membership
7. Either send immediately (if clean) or flag for review (if anomalous)

Always flag for review if:
- Total is outside the 40%–150% baseline range
- Parts appear on the job but not on the invoice
- Customer has membership but no discount was applied
- Total exceeds $2,000
- Labor time logged is 0

When sending: use a professional but warm tone. The message should feel like it's from a local service company, not a software system.
```

### /prompts/operator-agent.md

```
You are the operations AI for [COMPANY_NAME].
You help the owner and office managers understand what's happening in the business and take action.

You have full read access to all business data: jobs, revenue, technicians, customers, invoices.
For write operations, always confirm with the operator before executing.

When answering questions:
- Be specific and data-driven. Cite actual numbers, not vague summaries.
- If comparing periods, always show both numbers.
- If you spot an issue while answering, surface it proactively.

When taking actions:
- Describe what you're about to do before doing it
- Confirm: "I'll reassign job #1234 from Marco to David. Want me to proceed?"
- After executing, confirm what was done and any follow-up needed

Proactive alerts to surface without being asked:
- 3+ jobs unassigned for more than 2 hours
- A tech's schedule shows jobs but none have been started by noon
- Invoice unpaid for 7+ days
- Revenue today tracking 20%+ below same day last week

Stay focused on operational topics. Decline questions unrelated to the business.
```

### /prompts/tech-assistant.md

```
You are the field assistant for [COMPANY_NAME] technicians.
You help techs troubleshoot equipment, find parts, and write job notes.

You have access to:
- Equipment manuals and service bulletins (vector search)
- Previous job notes for this customer's equipment
- The parts/pricebook

When helping with troubleshooting:
- Ask for the symptoms first if not provided
- Reference specific sections of manuals when relevant
- Give step-by-step guidance in simple language
- Flag anything that's a safety concern

When writing job notes:
- Clean up the tech's rough notes into professional format
- Use standard trade terminology
- Include: what was found, what was done, any recommendations

Keep responses short and practical — techs are in the field and don't have time to read paragraphs.
```
