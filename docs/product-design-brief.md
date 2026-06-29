# Airbase — Product Design Brief

> For: World-class product designer engagement
> Author: Airbase product team
> Status: Living document — reflects Phase 2 complete build state

---

## 1. What We're Building and Why

### The Problem

A plumbing company with 8 technicians runs its entire operation on a patchwork of three tools: ServiceTitan (the industry standard field service management platform), a separate SMS tool, and Google Sheets for things ServiceTitan makes too complicated. The owner pays $3,200/month for ServiceTitan. She still spends three hours a day doing things the software should handle automatically: assigning techs to jobs, following up on unpaid invoices, responding to new inbound calls, figuring out who should go to the next job.

ServiceTitan is a 2012-era enterprise product with a 2012 UX philosophy — comprehensive menus, dense data tables, click-depth of 5+ to do anything, requires a full-time office manager just to operate it. It costs $300–500 per technician per month and locks customers in with annual contracts.

The trades industry has zero products designed around the assumption that AI should be doing most of the cognitive work. Everyone assumes the dispatcher dispatches, the CSR books, the office manager chases invoices. We disagree.

### What Airbase Is

**Airbase is an AI-first operating system for trades companies** — plumbing, HVAC, electrical — that replaces manually-operated workflows with autonomous AI agents.

The mission: a 10-tech plumbing company should run as smoothly as a 50-tech company, with half the office staff, at a fraction of the software cost.

Pricing: **$499/location/month flat**. No per-tech fees. No annual contract. Full data export always available.

### The Differentiation

| What Airbase does | What ServiceTitan requires |
|---|---|
| AI assigns the right tech automatically | Dispatcher manually reviews and assigns |
| Inbound calls and texts handled by AI booking agent | CSR answers, manually creates job |
| Invoice generated and sent automatically on job close | Office manager reviews, manually sends |
| Natural language operator interface ("show me unpaid invoices") | Navigate 6 menus to find the report |
| $499/location flat | $300–500/tech/month ($3,000–5,000 for a 10-tech shop) |

---

## 2. Production Context

**Steward Home Services** is our production pilot — a real plumbing and home services company in the Bay Area running live jobs on Airbase today. Every design decision must pass the Steward test:

> "Can the Steward dispatcher use this to book, dispatch, and close a real plumbing job right now?"

Steward's daily operation:
- 4–8 field technicians
- 20–40 inbound service calls per week
- Mix of emergency service (drain clogs, water heater failures) and scheduled maintenance
- Dispatcher is also the owner's spouse — not a tech-native user
- Previously used ServiceTitan; switched to Airbase during Phase 1

---

## 3. User Personas

### Persona 1 — The Dispatcher / Office Manager
**Who:** Maria, 42. Has run the office for 8 years. Knows every tech's strengths, every repeat customer, every neighborhood where parking is hell. Not technical, doesn't want to be. Runs the office from a desk with two monitors.

**Daily life:**
- 7am: arrives, checks which jobs are on for today, confirms tech availability
- 8am–5pm: answers phones, texts customers, routes techs to jobs, handles "Carlos is stuck on a job, who covers the 1pm?"
- Continuous: watches the dispatch board like an air traffic controller

**Goals:**
- Know what's happening across all techs at all times
- Handle exceptions fast without clicking around
- Stop being the human bridge between AI-available data and action

**Frustrations with existing tools:**
- ServiceTitan requires too many clicks to do simple things
- Can't see at a glance what's going on — too much data, not enough signal
- Inbound phone calls interrupt everything — she has to stop and manually type in a new job

**What she wants from Airbase:**
- One screen that tells her everything she needs to know
- AI to handle inbound calls and SMS so she can focus on exceptions
- Dispatch board that AI keeps mostly sorted; she just reviews and approves

---

### Persona 2 — The Owner
**Who:** David, 48. Owns and operates Steward. Has two crews and wants to grow to four. Checks the business from his phone when he's not on a job himself.

**Daily life:**
- Checks revenue and job count on his phone at 6am
- Deals with escalated customer issues
- Reviews invoices and payments weekly
- Makes decisions about hiring, pricing, and which job types to focus on

**Goals:**
- Visibility into the business without being in the office
- Know if something is wrong before it becomes a problem
- Grow revenue without proportionally growing headcount

**What he wants from Airbase:**
- Mobile-friendly dashboard: today's revenue, open jobs, unpaid invoices
- Natural language queries: "How much did we make last month from water heater jobs?"
- Alerts when something's off: unusually long jobs, high callback rate, invoice anomalies

---

### Persona 3 — The Field Technician
**Who:** Alex, 31. Plumber, 6 years experience. Works from his phone exclusively. Not interested in apps that require logging in, navigating menus, or typing. His hands are often wet or dirty.

**Daily life:**
- 7am: opens app, sees his jobs for the day
- Between jobs: drives to next location, needs address to tap-to-navigate
- On site: clocks in, records what he found, what parts he used, any follow-up needed
- End of job: marks complete, moves on

**Goals:**
- See his jobs without friction
- Navigate to customer address in one tap
- Log job notes quickly — voice or minimal text
- Get diagnostic help when he's stuck on an HVAC issue he hasn't seen before

**What he wants from Airbase:**
- Job card with everything he needs: customer name, address, problem description, equipment history
- One-tap navigation
- Simple stage buttons: On My Way → Arrived → Working → Done
- AI assistant that can answer "why is the Carrier AC unit throwing error code E4?"

---

### Persona 4 — The CSR (Customer Service Rep)
**Who:** Sofia, 26. Handles inbound calls and texts that the AI can't fully resolve. Also does admin: confirmations, rescheduling, membership renewals. In smaller companies, this role is the same person as the dispatcher.

**Daily life:**
- Monitors the Booking Inbox: live AI conversations in progress
- Steps in when a customer is confused, frustrated, or has a complex request the AI escalated
- Makes outbound calls for rescheduling
- Processes membership renewals

**Goals:**
- Seamless handoff from AI — she should have the full context of what the AI already discussed
- Respond to customers fast without re-asking information the AI already collected
- See the AI's confidence level so she knows when to step in proactively

---

## 4. The Full Job Lifecycle

Understanding this lifecycle is essential for the entire product. Everything in Airbase touches one of these steps.

```
1. INBOUND CONTACT
   Customer calls or texts → AI booking agent answers 24/7
   Collects: problem, address, availability preference, name
   Creates: new job (status: unassigned) + confirmation SMS to customer

2. DISPATCH
   Dispatch agent runs on job creation
   Scores: all available techs by skill match + drive time + current workload
   Proposes: best tech assignment with plain-English rationale
   If confidence ≥ threshold → auto-assigns
   If below → shows proposal to dispatcher for approval
   
3. TECHNICIAN EN ROUTE
   Tech marks "On My Way" in PWA
   ETA notification sent automatically to customer ("Carlos is 23 min away")
   
4. ON SITE
   Tech clocks in → status: arrived → in_progress
   Tech logs: what they found, parts used, notes
   AI tech assistant available for troubleshooting help

5. JOB CLOSE
   Tech marks complete
   Invoice agent triggers immediately:
   — Reads job notes and parts used
   — Drafts invoice from pricebook
   — If amounts are within normal range → auto-sends to customer
   — If anomaly detected → holds for office review
   Review request SMS sent 30 min after close

6. PAYMENT
   Customer receives invoice via SMS/email with payment link
   Pays via Stripe
   QuickBooks synced automatically

7. FOLLOW-UP (AI)
   Warranty detector: if same customer had a related job in the last 30 days → 
     waives service call fee, routes to same tech
   Review request: personalized SMS with Google/Yelp link 30 min after close
   Membership renewal: if customer on a plan → AI handles renewal outreach
```

---

## 5. Product Surface — What's Built Today

### 5.1 Navigation Structure

The operator-facing web app has a persistent left sidebar with these sections:

| Section | Route | Purpose |
|---|---|---|
| Dashboard | `/[slug]/dashboard` | Command center: today's KPIs, live activity feed |
| Customers | `/[slug]/customers` | Customer list + search |
| Customer Detail | `/[slug]/customers/:id` | Profile, locations, equipment, job history |
| Jobs | `/[slug]/jobs` | All jobs list with status filters |
| Book Job | `/[slug]/jobs/new` | Manual job creation form |
| Dispatch | `/[slug]/dispatch` | Visual dispatch board + AI assignment panel |
| Booking | `/[slug]/booking` | AI booking agent inbox (active SMS conversations) |
| Pricebook | `/[slug]/pricebook` | Flat-rate items: services, labor, fees, parts, materials |
| Invoices | `/[slug]/invoices` | Invoice list + invoice builder |
| Settings | `/[slug]/settings` | Company info, integrations, AI config (owner only) |

---

### 5.2 Dashboard

**What it does:** High-level overview of today's business + shortcuts to the most common actions.

**Current state:**
- KPI cards: Today's revenue, Open jobs, Unassigned jobs, Invoices pending payment
- Jobs timeline: Today's scheduled jobs with status indicators
- Quick actions: New Job, View Dispatch Board

**Design gap:** The dashboard is functional but generic — it looks like any field service SaaS. It doesn't feel like an AI-native product. The "intelligence" is invisible. We want the dashboard to feel like a morning briefing from a smart operations co-pilot, not a report.

---

### 5.3 Customers

**What it does:** CRM for the customer base.

**Customer list:**
- Searchable by name, phone
- Shows: name, phone, total jobs, last service date

**Customer detail page:**
- Profile: name, phone, email, notes
- Service Locations: all addresses (one customer may have 2–3 properties)
  - Each location shows: address, location notes (gate codes, dog on site, parking), equipment installed
- Equipment tab: per-location equipment inventory (HVAC units, water heaters, etc.) with make/model/serial/install date
- Job History tab: all past jobs, with status, type, tech, invoice amount
- Invoices tab: all invoices for this customer

**Key insight for design:** The customer detail page is where a dispatcher goes before they call a customer back. The most important information isn't contact details — it's: "What did we do for them last time? What equipment do they have? Are they a member? Do they have any open invoices?" That context should be immediately visible, not buried in tabs.

---

### 5.4 Job List

**What it does:** Master list of all jobs.

**Current state:**
- Filterable by status (scheduled, in_progress, completed, invoiced, etc.)
- Shows: job #, customer, type, status, assigned tech, scheduled time, priority
- Click → job detail with ability to update status, add notes, link to invoice

**Job types supported:**
- Plumbing: drain cleaning, plumbing service, water heater repair/install
- HVAC: service, repair, install, maintenance
- Electrical: service, repair, install
- General: maintenance, estimate only, warranty call, recall

**Priorities:** Emergency, High, Normal, Low — visually distinct on the board

---

### 5.5 New Job (Booking Form)

**What it does:** Manual job creation when dispatcher books a job themselves (as opposed to AI booking agent).

**Flow:**
1. Customer lookup by name or phone — shows existing customer or option to create new
2. Select service location (or add new)
3. Job type + priority
4. Date/time preference
5. Description field
6. Submit → job created, tech assignment triggered

**Design gap:** This form is functional but plain. It doesn't surface AI help at creation time. For example: "This customer had a water heater repair 8 months ago — warranty may still apply." Or "3 techs are available in that zip code tomorrow morning." The form should feel like filling it out with a knowledgeable assistant looking over your shoulder.

---

### 5.6 Dispatch Board

**What it does:** The operational heart of the product. This is the screen Maria lives on.

**Current state:**
- Visual board: columns = each active technician, rows = time slots
- Job cards drag-and-drop assignable between techs
- Status indicators on each card: unassigned (orange), scheduled (blue), en route (purple), in progress (green), complete (grey)
- Map view of tech locations (GPS from PWA)

**AI Panel (Phase 2 addition):**
- Appears alongside the board when unassigned jobs exist
- Shows: proposed assignment, reasoning ("Carlos is 12 min away, has drain_cleaning skill, has an opening at 2pm"), confidence score
- Accept / Reject buttons per proposal
- When rejected: AI logs feedback, re-scores

**Design gap:** The AI panel feels bolted on rather than integrated. The ideal dispatch board design question is: what does it look like when AI is handling 70% of assignments and the dispatcher is only seeing the 30% that need human judgment? The board needs to be designed around that steady state, not around an "AI is a feature" model.

---

### 5.7 Booking Inbox

**What it does:** Shows all active AI booking agent conversations — inbound customer SMS/calls being handled by AI.

**Current state:**
- List of active conversations with customer name, phone, current status
- Message thread view showing the back-and-forth
- Status: Active / Completed / Escalated / Abandoned
- When escalated: CSR sees conversation history + reason for escalation, can take over

**Key workflows:**
- Monitor: see all conversations in flight without intervening
- Intervene: take over a conversation from the AI (click → opens a reply box)
- Review outcomes: how many conversations resulted in a booked job? Escalated?

---

### 5.8 Pricebook

**What it does:** The flat-rate price catalog. Used by the invoice agent and by humans when building invoices manually.

**Structure (5 tabs):**
- **Services** — billable services (drain cleaning: $175, water heater diagnostic: $95)
- **Labor** — labor codes with estimated hours
- **Fees** — travel/trip charge, service call fee, emergency surcharge
- **Parts** — physical components sold (water heater anode rod, p-trap, etc.)
- **Materials** — consumables (pipe dope, Teflon tape, refrigerant)

Each item: name, description, unit price, cost (for margin), SKU, taxable flag, active/inactive.

Service/Labor items also have: estimated hours.
Part/Material items also have: unit of measure, vendor, cost.

**AI pricebook import:** Upload a PDF or CSV (ServiceTitan export, custom spreadsheet) → Claude extracts line items → review table → confirm import. This is how most new tenants onboard their existing pricebook.

---

### 5.9 Invoices

**What it does:** Invoice lifecycle management.

**Invoice list:**
- Filterable by status: draft, review required, sent, viewed, paid, overdue
- Shows: invoice #, customer, job type, total, status, age
- AI-flagged invoices appear in a "Review Required" filter with a reason

**Invoice builder:**
- Add line items from pricebook or custom
- Adjust quantities and prices
- Apply discounts
- Tax calculation
- Preview customer-facing invoice
- Send via SMS/email payment link (Stripe)

**Invoice statuses:**
- `draft` — created, not sent
- `review_required` — AI flagged an anomaly (amount too high, unusual line items)
- `sent` — payment link sent to customer
- `viewed` — customer opened the link
- `partial` — partial payment received
- `paid` — paid in full
- `overdue` — past due date, unpaid
- `void` — cancelled

**QuickBooks sync:** On payment, invoice is pushed to QBO automatically.

---

### 5.10 Settings

**What it does:** Company configuration. Owner-only access.

**Tabs:**
- **Company** — name, phone, address, timezone, logo
- **Integrations** — Twilio phone number, Stripe setup, QBO OAuth, SendGrid, Google Maps API key, review URLs (Google, Yelp)
- **Notifications** — configure which events trigger customer SMS/email
- **AI Config** — per-agent model selection, confidence thresholds, auto-execute toggles
- **Team** — user management (invite, roles, deactivate)
- **Billing** — subscription plan, payment method (Airbase's own billing)

---

### 5.11 Technician PWA

**What it does:** Mobile-first app for field technicians. Separate layout from the operator app, optimized for one-handed phone use.

**Screens:**
- **Today's Jobs** — list of assigned jobs for today, ordered chronologically
- **Job Detail** — customer name, address (tap to navigate), problem description, equipment on site, prior service notes
- **Job Stage Controls** — large buttons: On My Way → Arrived → Working → Done
- **Notes** — text field for job notes (will auto-draft into invoice)
- **Photo capture** — attach photos to job (stored to Supabase Storage)
- **AI Assistant tab** — chat interface to ask troubleshooting questions ("this Carrier HVAC is showing E4 error, what does that mean and what should I check?")

---

## 6. AI Agents — The Core Product

This section is critical for any designer working on Airbase. The AI agents aren't features — they're the product. The UI is a surface for the AI to operate through and for humans to supervise.

### 6.1 The Agent Philosophy

Every AI action in Airbase follows the same pattern:

1. Agent observes an event (new job, job closed, inbound call)
2. Agent gathers context from the database
3. Agent decides what to do
4. Agent proposes the action (always logged with full reasoning)
5. If confidence is high enough → auto-executes
6. If below threshold → surfaces to a human for approval
7. Human approves or rejects → feedback logged for improvement

The key UX implication: **the human is always in the loop, but the default is to trust the AI.** The UI should make it trivially easy to approve, easy to reject, and informative enough about the AI's reasoning that the human feels confident in their decision.

### 6.2 Dispatch Agent

**Trigger:** New job created, or tech cancels / goes unavailable.

**What it does:**
- Scores all available technicians across multiple factors:
  - Skill match (does this tech have the right certification/experience for this job type?)
  - Current location and drive time (Google Maps Distance Matrix)
  - Current workload (jobs already assigned today)
  - Job priority (emergencies override normal load balancing)
  - Customer history (has this tech serviced this customer before?)
  - Zone efficiency (clustering nearby jobs)

**Output:** Ranked list of assignments with plain-English rationale.
- "Carlos is the best match: 12 min drive, certified for drain cleaning, has a 2pm opening. Next best: David at 28 min."

**Auto-execute threshold:** When confidence ≥ 85% (configurable per tenant), assigns without human approval.

**UX surface:** The Dispatch Board AI Panel.

### 6.3 Booking Agent (SMS)

**Trigger:** Inbound text to the company's Twilio number.

**What it does:**
- Customer lookup by phone number
- Understand what they need (job type classification from natural language)
- Check availability
- Create the job
- Send confirmation SMS

**Conversation style:** 2–3 sentence responses, warm but efficient, never robotic. Escalates when confused or when customer requests a human.

**UX surface:** Booking Inbox page. The CSR monitors conversations and can intervene.

### 6.4 Booking Agent (Voice)

**Trigger:** Inbound phone call to the company's Twilio number.

**What it does:** Same as SMS agent but via voice. Uses:
- Deepgram for speech-to-text (real-time streaming, <300ms latency)
- Claude for conversation reasoning
- Cartesia for text-to-speech (low-latency streaming voice output)

**Persona:** "Jordan" — warm, efficient receptionist persona. Announces call recording at start.

**Handoff:** If caller wants a human or situation is complex → transfers call to dispatcher's direct line.

**Post-call:** Full transcript saved and attached to the job notes if a booking was made.

### 6.5 Invoice Agent

**Trigger:** Tech marks job complete.

**What it does:**
- Reads job notes and parts used
- Looks up pricebook prices for everything
- Drafts invoice with line items
- Cross-checks against historical invoices for this job type:
  - Is the total in the expected range for a drain cleaning?
  - Are there any unusual line items?
  - Did the tech mark unusual parts used?
- If clean → auto-sends invoice to customer via SMS/email
- If anomalous → holds in "Review Required" queue with explanation

**UX surface:** Invoice list with `review_required` filter. The flagged invoice shows the AI's reasoning: "Flagged: total ($875) is 2.4x the average for drain_cleaning jobs ($365). Please review before sending."

### 6.6 Operator Agent

**Trigger:** Operator opens the floating command panel on any screen.

**What it does:**
- Answers any natural language question about live business data
- Can execute safe operations (reassign a job, update a status)
- Cannot execute financial operations without explicit confirmation
- On first open each session: auto-runs an anomaly check ("Here's what I noticed this morning: 3 invoices overdue >30 days, Carlos has 2 unfinished jobs from last week")

**UX surface:** Floating chat panel, accessible from any operator screen via keyboard shortcut or button. Designed to feel like a smart co-worker you can ask anything, not a search box.

### 6.7 ETA Notification Agent

**Trigger:** Job status changes to `en_route`.

**What it does:** Sends personalized SMS to customer: "Hi Sarah! Carlos from Steward Home Services is on his way to your place — estimated arrival by 2:15 PM. Questions? Reply to this message."

No UI surface needed — fully automated, logged in `agent_actions`.

### 6.8 Review Request Agent

**Trigger:** 30 minutes after job status changes to `completed`.

**What it does:** Sends personalized review request SMS: "Hi Sarah, it was great helping you today! If you have a minute, Carlos and the team would love a review: [Google link]"

- Skips warranty calls, recalls, and estimate-only jobs
- Routes to Yelp if no Google link configured
- Never sends if no review URL configured (logged as skipped)

### 6.9 Warranty / Callback Detector

**Trigger:** New job created.

**What it does:** Checks if same customer had a related job (same trade category) within the last 30 days. If yes:
- Waives the service call fee automatically
- Routes to the same tech who did the original job (if available)
- Flags for dispatcher review

This prevents the worst customer experience in the trades industry: paying a service call fee again because something broke soon after the original visit.

---

## 7. Data Model — Conceptual Overview (for designer)

The designer doesn't need to know SQL, but understanding the relationships is essential for information architecture decisions.

```
TENANT (the company)
  └── USERS (owner, dispatcher, office manager, technician)
  └── CUSTOMERS
        └── SERVICE LOCATIONS (one customer, many addresses)
              └── EQUIPMENT (what's installed at that location)
  └── TECHNICIANS
        └── SKILLS (drain_cleaning, hvac_install, etc.)
        └── SCHEDULE (jobs assigned to this tech)
  └── JOBS
        ├── linked to: CUSTOMER + LOCATION + TECHNICIAN
        ├── type: drain_cleaning | hvac_repair | etc.
        ├── status: unassigned → dispatched → en_route → arrived → in_progress → completed → invoiced
        ├── priority: emergency | high | normal | low
        └── source: manual | booking_agent_sms | booking_agent_voice | web
  └── INVOICES
        ├── linked to: JOB + CUSTOMER
        ├── LINE ITEMS → linked to PRICEBOOK ITEMS
        └── PAYMENTS → linked to Stripe
  └── PRICEBOOK ITEMS
        ├── type: service | labor | fee | part | material
        └── used to: draft invoices + auto-price jobs
  └── AGENT ACTIONS (every AI decision ever made, with reasoning)
  └── CONVERSATIONS (booking agent SMS/voice threads)
```

---

## 8. Phase 3 — What We're Building Next

These are confirmed Phase 3 features. The designer should understand them to make informed Phase 2 design decisions that don't create dead ends.

### Memberships & Recurring Billing

The single highest-margin product for a trades company. A membership is a maintenance agreement: customer pays $19.99/month, gets priority scheduling, waived service call fees, 15% parts discount, and 2 free tune-up visits per year.

**New surfaces:**
- **Membership Plans** (`/settings/memberships`) — CRUD for plan tiers (Silver, Gold, Platinum)
- **Enrollment flow** — on Customer Detail page, "Enroll in Membership" → select plan, collect card via Stripe
- **Memberships list** (`/memberships`) — all active members, MRR widget, renewal calendar
- **Member badge** — visible on customer lookup and dispatch board (member customers get visual distinction and priority treatment)

**AI agent:** Nightly cron → finds memberships expiring in 60/30/7 days → sends personalized renewal SMS → handles objections → auto-renews with card on file.

### Collections Agent

Most painful manual task in any trades company: following up on overdue invoices. Collections agent handles graduated outreach (gentle reminder → firmer reminder → final notice) via SMS, escalates to human on dispute.

### Estimate Builder

Good/better/best estimates with AI-suggested upsells. "Your 14-year-old water heater is likely to fail in the next 2 years. Would you like to see the cost of replacing it proactively vs. waiting for an emergency?"

### Customer Portal

Self-service: view history, pay invoices, request appointments, view their equipment. Reduces inbound call volume.

---

## 9. The Operator's Mental Model

This is the most important frame for any designer to internalize.

**Today's model (ServiceTitan):** The software is a database with a UI. The human is the brain. Every decision flows through a human who uses the software as a data store and communication tool.

**The Airbase model we're building toward:** The AI is the brain. The human is the supervisor. The software is a control room where you watch AI decisions happen in real time, approve the ones that need a second set of eyes, and handle the exceptions that are genuinely human in nature (a customer who's upset, a job that requires a judgment call the AI isn't equipped for).

The UX implication: **most screens are monitoring interfaces, not action interfaces.** The operator should be able to look at the dispatch board and know everything is running smoothly without doing anything. The action should be the exception, not the norm.

This is a fundamentally different design paradigm from ServiceTitan (where the screen is a to-do list of things you need to manually do) and from most SaaS (where the software enables human decisions rather than making them).

---

## 10. Known UX Gaps and Design Opportunities

These are areas where the current build is functional but the UX is not yet at the standard we want.

### Gap 1 — The Dashboard is a report, not a briefing

Currently: KPI numbers + a job list. It looks like any FSM SaaS.
Goal: feels like opening a daily briefing from a smart assistant. The most important thing this morning is visible immediately. AI-surfaced anomalies appear front and center. "You have 2 unassigned emergency jobs and Carlos called in sick — here are 3 options."

### Gap 2 — AI reasoning is invisible

Currently: AI makes proposals, but the rationale appears only when you click into the dispatch AI panel. The user has to seek out why the AI did what it did.
Goal: AI reasoning should be ambient — visible in the right context without clicking. A job card on the dispatch board should show "AI assigned to Carlos (94% confidence)" as a subtle indicator. Rejected AI actions should be visible and learnable from.

### Gap 3 — The Booking Inbox doesn't feel like a live command center

Currently: it's a list of conversations. It needs to feel like a SOC (security operations center) or an air traffic control room — you're watching things happen in real time and ready to intervene.

### Gap 4 — Mobile experience for dispatchers

The operator app is desktop-first. Owners and dispatchers do check things on mobile. Key views (dashboard, dispatch board status, job detail) need to degrade gracefully to mobile.

### Gap 5 — Onboarding is undefined

Phase 1 tenants were onboarded manually. Phase 2 onboarding needs to be self-serve: sign up, connect Twilio, import pricebook, add techs. This entire flow is undesigned.

### Gap 6 — The AI config page needs to be non-technical

Currently: settings page has model names (claude-sonnet-4-6, deepseek-chat) and confidence thresholds (0.85). This is meaningless to a trades business owner.
Goal: translate into plain language. "Auto-approve dispatch assignments when AI is very confident. Require human approval for all others." + a slider for confidence threshold shown as words, not numbers.

### Gap 7 — No visual language for AI confidence

When AI does something, the user currently has no consistent visual system to understand: how confident was the AI? What would it have done differently? Is this decision reversible?

We need a design system for AI status that is consistent across the whole product: proposed → approved → executing → complete → reversed.

### Gap 8 — The tech PWA is too minimal

Works, but doesn't delight. The tech's experience before and during a job should feel as premium as the operator's experience. This is the face of the product to the person who uses it the most (every job, every day).

---

## 11. Technology Constraints Relevant to Design

- **No page refreshes:** Built on React with Supabase Realtime subscriptions — data updates live without refresh. The design should leverage this (status changes on dispatch board animate live).
- **Tailwind CSS + shadcn/ui:** Component library is shadcn — all primitives (buttons, cards, tables, modals, tabs, drawers) come from there. Custom components should stay consistent with the system.
- **Multi-tenant:** Every tenant sees only their data. The URL is always `/[company-slug]/[route]`. Design must account for the tenant name/logo in the chrome.
- **Two distinct apps:** The operator web app (desktop-first, accessed via browser) and the technician PWA (mobile-first, installable to home screen). These share a design language but have separate layouts.
- **AI calls are async:** Every AI action has loading states. The UI can never block waiting for an AI response — it should show a skeleton/indicator and update when the result arrives.
- **Offline capability (tech PWA):** Techs may have poor signal on job sites. The PWA should handle offline gracefully — queue actions locally, sync when connection returns.

---

## 12. Competitive Reference Points

**ServiceTitan** — the market leader. Dense, powerful, overwhelming. Has everything, but requires training to use. The thing to learn from: they got the data model right. The thing to avoid: every other design decision they made.

**HouseCall Pro** — simpler, SMB-focused, more modern visually. Better mobile. Lacks the AI ambition. Gets tonally closer to what we want (friendly, not enterprise) but is still fundamentally a manual tool.

**Jobber** — similar market position to HouseCall Pro. Clean, simple, missing depth for complex operations.

**Notion** — not a competitor, but aspirational for the operator command interface. The floating operator agent chat should feel like asking a very knowledgeable colleague, not like a chatbot.

**Linear** — aspirational for the overall product aesthetic. Dense information presented with real elegance. Fast. Keyboard-navigable. Respects the user's intelligence.

---

## 13. Design System Starting Points

Current state: using shadcn/ui defaults with Tailwind. Dark sidebar (`bg-slate-950`), light main content area. Blue as the primary accent (`blue-600`). No custom typography system, no custom illustration or iconography beyond Lucide React.

Priority design system decisions needed:
1. **Color language for AI confidence and status** (proposed, approved, auto-executed, flagged, reversed)
2. **Typography hierarchy** that works for dense data tables AND for natural language AI output in the same view
3. **Card anatomy** for job cards (used across dispatch board, job list, booking inbox — needs consistent structure)
4. **Mobile breakpoints** for the operator app
5. **Animation principles** for live-updating data (job status changes, new conversations arriving)
6. **AI output visual treatment** — how does AI-generated text look different from human-entered text? How does reasoning text appear?

---

## 14. Success Metrics (for design evaluation)

A design is successful if:

1. **The Steward dispatcher can manage a full day of 8 techs without leaving the dispatch board.** She should be able to see everything she needs and act on everything she needs from one screen.

2. **The owner can answer "how are we doing today?" in under 10 seconds** from the dashboard, on mobile, without clicking.

3. **A new CSR can understand an escalated booking conversation and reply within 60 seconds** of seeing it in the Booking Inbox — without needing to ask anyone what happened.

4. **A technician can close a job and be driving to the next one within 2 minutes** of finishing the work.

5. **An operator can change which AI model handles dispatch** without understanding what a language model is.

6. **A new customer can call at 10pm, get a booking confirmed, and receive a confirmation text** without any human involved.

If the design makes all six of these feel effortless, it's working.
