# Claude Code prompts

One prompt per phase, each written to be pasted whole into a fresh Claude Code session on the Airbase repo.

## How to use

Run the phases in order, one Claude Code session per phase, and merge each pull request before starting the next.

**Before Phase 0**

1. Export the Spec tab of this doc as Markdown and commit it to the repo as `docs/remodel-tenant-spec.md`. Every prompt tells Claude Code to read it, and Claude Code cannot open this doc.
2. Make the repo private again.
3. Have the Retell API key with the webhook badge ready to add as a Supabase secret.

**How each prompt behaves**

- It asks Claude Code to present a plan and wait for your go-ahead before writing code.
- It works on a branch and opens a pull request. It never pushes to `main`, because a push to `main` that touches `supabase/functions` deploys every function automatically.
- It runs against a local Supabase only. Applying migrations to the live project and setting secrets stay with you.
- Where a business input is missing, it stops and asks. The inputs each phase needs are listed in the prompt and in the Spec tab's open items.

**Inputs to have ready**

| Phase | You supply |
| --- | --- |
| 1 | Service-area ZIPs, consultation hours, escalation phone number, Retell agent IDs once created |
| 2 | Full price book, e-signature provider, lending partner handoff, attorney-approved contract text, middle milestone amounts |
| 3 | Phase template confirmed by a crew lead, first cities for permit rules |
| 4 | Dollar limits in the authority matrix, on-call roster |
| 5 | Loaded hourly cost per installer role, BuildersBooks posting details |

Phases 2 to 5 can be built before those inputs arrive, since each prompt uses clearly marked placeholder data. Nothing with placeholders should go live.

## Phase 0 prompt: Hardening

```text
You are working in the Airbase repo. This is Phase 0 of the bathroom remodel tenant build. The full plan is in docs/remodel-tenant-spec.md. If that file does not exist, stop and tell me.

GOAL
Close the unauthenticated Retell webhook, update the project guide so remodel work is in scope, add the tenant brand and entity columns, and add a test harness. No remodel features yet.

STANDING RULES (where this prompt is more specific than the spec, the prompt wins; tell me about any conflict you find)
1. Read first: CLAUDE.md, docs/remodel-tenant-spec.md (all of it once, then the Phase 0 section), docs/api-patterns.md, docs/multi-tenancy.md, docs/schema.md.
2. Plan first: reply with your plan (files to add or change, migrations, tests, open questions) and wait for my go-ahead before writing code.
3. Work on branch remodel/phase-0-hardening cut from main. Never commit or push to main. A push to main that touches supabase/functions deploys every function. Open a pull request when done.
4. Local only. Use a local Supabase. Do not apply migrations to, deploy to, or set secrets on any remote project.
5. Do not modify src/modules/voice, supabase/functions/send-sms, supabase/functions/booking-agent or supabase/functions/csr-reply. Steward's behavior must not change.
6. Follow the repo conventions in CLAUDE.md: tenant_id and row-level security on every table, UUID keys, timestamps, soft delete, Postgres ENUM types, no tenant_id taken from a request body in a service-role function, all model calls through _shared/llm-router.ts.
7. Check external APIs against their current documentation before coding. Do not rely on memory for Retell payloads or signature formats. If you cannot reach the docs, say so and mark the assumption in code and in the PR.
8. If something needed is missing or ambiguous, stop and ask. Do not invent business values.

TASKS

A. Retell signature verification
- Create supabase/functions/_shared/retell-auth.ts exporting an async function that takes the raw request body, the x-retell-signature header value and the API key, and returns true or false.
- Confirm the scheme at https://docs.retellai.com/features/secure-webhook before implementing. My understanding, to be verified: the header has the form v={unix ms timestamp},d={hex digest}; the digest is HMAC-SHA256 over the raw body concatenated with the timestamp; the key is the Retell API key that carries the webhook badge.
- Reject timestamps more than five minutes from now. Compare digests in constant time.
- In supabase/functions/retell-voice-webhook/index.ts, read the body once as text, verify before parsing JSON, and return 401 with no database access on failure. Read the key from the RETELL_API_KEY secret. Do not add a bypass flag.
- Remove the wildcard CORS headers from that function. It is called server to server. Return 405 for OPTIONS.

B. Function auth audit (report only)
- The deploy workflow uses --no-verify-jwt for every function. For each function under supabase/functions, record how it authenticates callers: service-role key check, user JWT, provider signature, or nothing.
- Put the table in the PR description. Do not fix anything beyond the Retell webhook in this phase. List anything unauthenticated as a finding with a suggested fix.

C. Migration 045_tenant_entity_brand.sql
- Add to tenants: legal_entity_name TEXT, license_number TEXT, license_state TEXT, brand_name TEXT, trade TEXT NOT NULL DEFAULT 'field_service' with a CHECK allowing 'field_service' and 'remodel', retell_phone_number TEXT.
- Backfill brand_name from name for existing rows.
- Regenerate src/types/database.types.ts.

D. Documentation
- CLAUDE.md: the stack table should say voice and messaging are moving to Retell, with Twilio code kept as legacy. State the real platform default model from llm-router.ts. Say Airbase serves remodel tenants as well as plumbing, HVAC and electrical. Add a second acceptance test beside the Steward Test: "Can the bathroom tenant take a lead from first contact to a signed, scheduled, paid project?"
- docs/current-phase.md and docs/phases.md: add a Remodel track that runs alongside Phase 3 and points to docs/remodel-tenant-spec.md, so remodel work is not flagged as out of phase.
- docs/schema.md: add the new tenant columns.
- Leave the copies under frontend_design untouched and note in the PR that they are stale.

E. Test harness
- Add Deno tests for edge functions with a deno.json at supabase/functions.
- Tests required now: signature verification (valid, wrong key, stale timestamp, malformed header, body tampered); the webhook returns 401 and performs no writes when unsigned; a static check that every CREATE TABLE in supabase/migrations is followed by ENABLE ROW LEVEL SECURITY for that table.
- Add .github/workflows/test.yml to run deno test, npm run lint and npm run build on every pull request.

OUT OF SCOPE
Remodel job types, Retell messaging, any new agent, any UI change.

DONE WHEN
- An unsigned or badly signed POST to retell-voice-webhook returns 401 and writes nothing.
- A correctly signed test payload behaves as before.
- deno test, npm run lint and npm run build pass locally and in the new workflow.
- The docs changes are in, and a remodel task would no longer be out of phase.

PR DESCRIPTION MUST INCLUDE
What was built, the function auth audit table, how each item was verified, what was not verified, new secrets required (RETELL_API_KEY), and manual steps for me (apply migration 045, set the secret, confirm the webhook key in the Retell dashboard).
```

## Phase 1 prompt: Lead responder

```text
You are working in the Airbase repo. This is Phase 1 of the bathroom remodel tenant build. Phase 0 is merged. The full plan is in docs/remodel-tenant-spec.md.

GOAL
Every inbound call, inbound text and web form lead for the bathroom tenant is answered, qualified and booked into an in-home consultation, or saved with a reason, with no human touch. Voice and messaging run on Retell. Retell messaging does not exist in this repo yet, so you are building it from scratch.

STANDING RULES (where this prompt is more specific than the spec, the prompt wins; tell me about any conflict you find)
1. Read first: CLAUDE.md, docs/remodel-tenant-spec.md (all of it once, then the Phase 1 and Data model sections), docs/api-patterns.md, docs/multi-tenancy.md, docs/agents.md.
2. Plan first: reply with your plan (files, migrations, tests, open questions) and wait for my go-ahead before writing code.
3. Work on branch remodel/phase-1-lead-responder cut from main. Never commit or push to main. Open a pull request when done.
4. Local only. Do not apply migrations to, deploy to, or set secrets on any remote project.
5. Do not modify src/modules/voice, send-sms, booking-agent or csr-reply. Steward's behavior must not change. Any change to a shared file is additive and branches on tenants.trade.
6. Follow the repo conventions in CLAUDE.md, including row-level security on every new table and no tenant_id taken from a request body.
7. Check Retell's current API documentation before coding each integration. Do not rely on memory for endpoints or payloads. Mark any assumption you could not confirm.
8. If a business input is missing, stop and ask, or use placeholder config clearly labelled PLACEHOLDER in the seed file. Never invent values silently.

READ THESE FILES BEFORE PLANNING
- supabase/functions/retell-voice-webhook/index.ts (tenant resolution from agent_config.settings.retell_agent_id, tool dispatch)
- supabase/functions/_shared/retell-auth.ts, agent-base.ts, agent-logger.ts
- supabase/functions/ca-dispatch-agent/index.ts and supabase/migrations/025 and 027 (opportunities and their triggers)
- supabase/migrations/015 (booking_conversations), 020 (tenant hours), 019 (service area)
- src/modules/voice/server/agents/: the bathroom remodel intake agent file and base-agent.js (read only, source for the new prompts; do not carry any earlier brand name into new code, prompts, seeds or tenant slugs)

MIGRATIONS (one concern per file, numbered from 046)
- 046_remodel_job_types: add to job_type: remodel_consultation, remodel_install, remodel_inspection, remodel_punch_list. New enum values cannot be used in the transaction that adds them, so keep this file to the ALTER TYPE statements.
- 047_lead_sources: add to lead_source: web_form, ad_lead_form, realtor, restoration_partner, inbound_sms.
- 048_opportunity_lead_fields: add to opportunities: project_type, bathrooms, timeline, budget_range, qualification_notes, disqualified_reason, consent_text, consent_at, next_follow_up_at, follow_up_step.
- 049_conversation_retell: add to booking_conversations: retell_call_id, retell_chat_id, opportunity_id, direction. Add unique indexes on the two Retell IDs for idempotency.
- 050_lead_intake_and_contact_rules: new table lead_intake_sources (source key, secret reference, default lead_source, active). Add to tenants: sms_enabled BOOLEAN DEFAULT false, outbound_contact_start TIME, outbound_contact_end TIME, escalation_phone TEXT.
- Regenerate src/types/database.types.ts.

EDGE FUNCTIONS

A. Shared remodel tools: supabase/functions/_shared/remodel-tools.ts
Implement once, used by voice and chat. Every tool takes tenantId from the resolved Retell agent, never from arguments.
- lookup_customer(phone)
- qualify_lead(project_type, bathrooms, timeline, zip, budget_range): checks zip against tenants.service_area_zips and budget against the lowest active remodel package price; returns qualified or a reason.
- check_consult_availability(date_range): open slots for technicians with tech_type = 'comfort_advisor' inside tenant hours.
- book_consultation(customer, location, slot, notes): upserts customer and service location, creates the opportunity with assigned_to set to the chosen salesperson, creates a job of type remodel_consultation, sets the opportunity to visit_scheduled, sends the customer confirmation, notifies the salesperson through the existing push-notification function. Because assigned_to is set at insert, the existing ca-dispatch trigger must not also assign. Confirm that from the trigger condition and add a test.
- save_lead(reason): creates the customer and an opportunity marked with disqualified_reason or a not-now status.
- escalate_to_human(reason): logs the escalation, sends a push to owner-role users, and returns the tenant escalation_phone for Retell to transfer to.

B. retell-voice-webhook
Select the tool set from tenants.trade. Field-service tenants keep the current tools unchanged. Remodel tenants get the tools above. Log calls to booking_conversations with retell_call_id.

C. retell-chat-webhook (new)
Handles Retell chat and SMS events and tool calls with the same signature verification and tenant resolution. Deduplicate on the Retell chat ID. Log to booking_conversations with channel sms and retell_chat_id. Also handle the per-number inbound SMS webhook so the agent receives dynamic variables: brand name, customer first name if known, open opportunity status.

D. retell-send (new, service-role only)
One function for outbound contact: start an outbound SMS conversation or place an outbound call through Retell's API. Refuses SMS when tenants.sms_enabled is false. Refuses any outbound contact outside the tenant's outbound contact window in the recipient's time zone unless the call is flagged as a reply to the customer's own message. Logs every send.

E. lead-intake (new, public endpoint)
- Accepts a POST from a web form or ad lead form: source key, name, phone, email, zip, project details, consent text, consent timestamp, idempotency key.
- Verifies an HMAC signature using the secret for that source. Rejects unsigned or unknown sources.
- Rejects leads without recorded consent.
- Creates the customer and opportunity, then calls retell-send: a text first if sms_enabled, otherwise a call. If outside the contact window, schedules the first touch for the next permitted time by setting next_follow_up_at.

F. lead-follow-up (new, service-role only)
Finds opportunities whose next_follow_up_at has passed and sends the next touch in the cadence: same day, day 2, day 5, day 10, then status no_decision. Each touch starts a new outbound SMS conversation. Before building this, check whether Retell now supports sending into an existing SMS conversation and tell me what you find. Follow the pattern in migration 041 for the pg_cron schedule: provide the SQL, commented, for me to run.

PROMPTS
Add prompts/remodel-voice-agent.md and prompts/remodel-sms-agent.md, ported from that legacy intake script. Changes from the legacy script: the product is mid-grade fixed-price bathroom packages, not designer remodels; the brand name comes from a {{brand_name}} variable; the price floor comes from a variable, not a hardcoded figure; keep the recording disclosure. The SMS prompt is shorter and never sends more than two messages in a row without a reply.

SEED
Add supabase/seed/remodel-tenant.sql: the bathroom tenant with trade remodel, brand name RECAST California, tenant slug recast-california, legal entity Good Guy Builders, two comfort_advisor technicians for testing, agent_config rows for booking_voice and booking_sms holding PLACEHOLDER Retell agent IDs, PLACEHOLDER service ZIPs and hours.

UI (small)
- Opportunities page: show the new qualification fields and the lead source.
- Booking inbox: show Retell voice and SMS conversations for remodel tenants with the linked opportunity.

TESTS
- Each tool: qualified path, out-of-area, under-budget, no availability.
- Tenant isolation: a tool call resolved to one tenant cannot read or write another tenant's rows.
- lead-intake: bad signature, missing consent, duplicate idempotency key, outside contact window.
- retell-send: refuses SMS when disabled, refuses outside the window.
- No double assignment between book_consultation and the ca-dispatch trigger.
- A field-service tenant's voice webhook behavior is unchanged.

OUT OF SCOPE
Estimates, contracts, projects, the hourly sweep, the on-call table. Escalation in this phase is the simple version above.

INPUTS I STILL OWE (use placeholders, do not block)
Service ZIPs, consultation hours, escalation phone, Retell agent IDs, outbound contact window.

DONE WHEN
- A signed simulated call event, a signed simulated SMS event and a signed form post each produce a customer, an opportunity and a booked remodel_consultation job.
- An out-of-area ZIP is saved with a reason and not booked.
- An escalation request produces a push and returns the transfer number.
- All tests, lint and build pass.

PR DESCRIPTION MUST INCLUDE
What was built, what was verified against Retell's docs and what was assumed, new secrets, the pg_cron SQL, and a step-by-step Retell dashboard setup for me: create the voice and chat agents, register each tool with its webhook URL, attach the chat agent as the inbound SMS agent on the number, set the inbound webhook, and where to put the agent IDs.
```

## Phase 2 prompt: Sale to contract

```text
You are working in the Airbase repo. This is Phase 2 of the bathroom remodel tenant build. Phases 0 and 1 are merged. The full plan is in docs/remodel-tenant-spec.md.

GOAL
A salesperson at an in-home consultation can build a package estimate on a phone, generate a home improvement contract from it, get it signed, and collect the deposit. The legal limits on deposits and progress payments are enforced in code.

STANDING RULES (where this prompt is more specific than the spec, the prompt wins; tell me about any conflict you find)
1. Read first: CLAUDE.md, docs/remodel-tenant-spec.md (all of it once, then the Phase 2, Data model and Authority matrix sections), docs/api-patterns.md.
2. Plan first: reply with your plan (files, migrations, tests, open questions) and wait for my go-ahead before writing code.
3. Work on branch remodel/phase-2-sale-to-contract cut from main. Never commit or push to main. Open a pull request when done.
4. Local only. Do not apply migrations to, deploy to, or set secrets on any remote project.
5. Do not modify the legacy voice module, send-sms, booking-agent or csr-reply. Steward's behavior must not change. Changes to shared files are additive and branch on tenants.trade.
6. Follow the repo conventions in CLAUDE.md.
7. Check any external API against its current documentation before coding.
8. If a business or legal input is missing, stop and ask, or use data clearly labelled PLACEHOLDER. Never invent prices, contract wording or legal rules.

READ THESE FILES BEFORE PLANNING
- supabase/migrations/007, 017 (price book), 022 (estimates), 008 and 009 (invoices, payments), 025 and 027 (opportunities and triggers)
- supabase/functions/process-payment, stripe-webhook, install-crew-agent
- src/features/estimates, src/features/tech-pwa (TechEstimateBuilder, TechEstimatePresent), src/features/pricebook

MIGRATIONS (from 051)
- 051_package_components: for a price book item that is a package: material lines (description, quantity, unit, expected cost), labor hours by phase name, crew size, standard duration in business days, target margin percent.
- 052_contracts: estimate, customer, project description, total cents, status (draft, sent, signed, effective, cancelled, void), PDF storage path, signed PDF path, e-sign provider and envelope ID, signed at, cancellation notice type, cancel-by date, customer_65_or_older flag, template version.
- 053_payment_schedule: payment_schedule_items with contract, order, milestone name, trigger type (contract_signed, materials_delivered, phase_closed, completion), trigger reference, amount cents, invoice ID, status.
- 054_estimate_financing_rename: rename estimates.wisetack_application_id and wisetack_offer_url to financing_application_id and financing_offer_url, add financing_provider. Update every reference in the code and types.
- Regenerate src/types/database.types.ts.

PRICE BOOK SEED
Add to supabase/seed/remodel-tenant.sql, with trade = 'remodel'. These prices are confirmed:
- Tub-to-shower conversion, fixtures included: 16,000 dollars
- Tub replacement in place of a standing shower, fixtures included: 17,000 dollars
- Waterproof LVP flooring, full bathroom: 4,500 dollars
- Paint, whole bathroom: 1,000 dollars
- Vanity and mirror: priced by selection; sink and faucet are included when a vanity is bought
The customer commitment for a standard tub-to-shower conversion is 10 business days: crew work on days 1 to 5, day 6 as crew buffer, days 7 to 10 as company buffer. Store commitment days and crew days separately on the package. The target gross margin is 50 to 55 percent per job, and installer pay is 4,000 dollars all-in per install for the core scope, paid to a licensed subcontractor crew, with upsell labor paid on top from a budget of up to 1,000 dollars. Confirmed component costs for the base tub-to-shower package: wall panels 1,000 dollars; shower door 800; shower base 350; plumbing supplies 300; miscellaneous supplies and debris disposal 300; shower fixtures 150; total materials and disposal 2,900. With crew pay of 4,000 dollars, the direct cost of a base job with no upsells is 6,900 dollars and gross margin is 56.9 percent. Permit fees are passed through to the customer as a fixed, separate line on the contract. Sales commission is 10 percent of the sale and sits below gross margin as a selling cost, never in direct cost. Component costs for the tub replacement package and for every upsell, and permit fees, are not confirmed: seed them as PLACEHOLDER.

ESTIMATE
- For remodel tenants the builder defaults to single presentation mode with packages as line items and add-ons as optional lines.
- Show the customer a start window and a finish date computed from the package's standard duration.
- A line that is not a price book item, or any discount, puts the estimate into a needs-approval state and notifies owner-role users. It cannot be presented until approved. Log the approval in agent_actions or an equivalent audit row.

CONTRACT RULES MODULE: supabase/functions/_shared/contract-rules.ts
Pure functions with full unit tests, keyed on tenants.license_state. Implement CA now and make any other state fail closed with a clear error.
- Maximum deposit: the lesser of 1,000 dollars or 10 percent of the contract price.
- A written contract is required for any job over 500 dollars.
- The payment schedule must describe each milestone and its amount, must sum to the contract total, and may not make any payment other than the deposit due before its trigger event.
- Cancellation notice type: three-day in general, five-day when the customer is 65 or older. Compute and store the cancel-by date, and put the date calculation behind one function marked for attorney review.
Source for these rules: the CSLB home improvement contract guide and the CSLB sample home improvement contract. They are an engineering summary, not legal advice, and the template wording is not yours to write.

CONTRACT GENERATION
- New function generate-contract: builds a PDF from an accepted estimate, the tenant's legal_entity_name, license_number and brand_name, the package scope, start and completion dates, and the payment schedule. Stores it in Supabase Storage and creates the contracts row.
- Template: add a structured template file with every clause body marked PLACEHOLDER PENDING ATTORNEY APPROVAL, laid out to follow the CSLB sample contract's sections, including the required down payment and progress payment statements.
- Add tenants.contract_template_approved BOOLEAN DEFAULT false. While false, a contract can be generated and previewed but cannot be sent to a customer.
- Default schedule: deposit at signing at the legal maximum, a materials-delivered milestone, a rough-in-complete milestone, and balance at completion. The two middle amounts are PLACEHOLDER and editable per contract. Validate every schedule with the rules module.

E-SIGNATURE
The provider is not chosen. Define an EsignProvider interface (send for signature, get status, fetch signed document, verify webhook) and build one adapter named manual: the office uploads a signed PDF and records who signed and when. Add esign-webhook as a stub that routes to the provider adapter. Ask me which provider to integrate before building a real adapter.

DEPOSIT AND FINANCING
- After signing, create the deposit invoice from the first schedule item and send the Stripe payment link through the existing process-payment function.
- Financing: keep it lender-neutral. The salesperson can record a financing application ID, an offer link and an approval status. No lender API integration in this phase.
- A contract becomes effective when it is signed, the cancel-by date has passed, and either the deposit is paid or financing approval is recorded.

OPPORTUNITY AND TRIGGER GUARD
- Signing sets the opportunity to won.
- Important: the existing trigger fires install-crew-agent when an opportunity is won, and that agent would create a single-visit HVAC-style install job. Guard it so it does nothing for tenants with trade = 'remodel'. Project creation and scheduling arrive in Phase 3. Add a test proving a won remodel opportunity creates no install job and that a field-service tenant still gets one.

UI
- Tech app: package estimate, approval state, contract preview, signature status, deposit collection.
- Web: contracts list and detail for the office, with the manual signed-PDF upload.

TESTS
- contract-rules: deposit cap at 16,000, at 5,000 and at 600 dollars; schedule that sums wrong; schedule with a payment before its trigger; non-CA state fails closed; both cancellation notice types.
- Sending is blocked while contract_template_approved is false.
- Off-book line and discount both require approval.
- The trigger guard, both ways.
- Financing column rename leaves no references to the old names.

OUT OF SCOPE
Projects, phases, permits, materials, change orders, milestone invoicing beyond the deposit, any lender API.

INPUTS I STILL OWE (use placeholders, do not block)
Full price book with components, e-signature provider, lending partner handoff, attorney-approved contract text, the two middle milestone amounts.

DONE WHEN
- From a booked consultation, a salesperson can produce an estimate, a contract and a deposit request on a phone using seed data.
- The system refuses a deposit above the cap and a schedule that bills ahead of its trigger.
- A signed contract sets the opportunity to won and creates no install job for the remodel tenant.
- All tests, lint and build pass.

PR DESCRIPTION MUST INCLUDE
What was built, every PLACEHOLDER that must be replaced before go-live, what was not verified, new secrets and storage buckets, and manual steps for me.
```

## Phase 3 prompt: Project production

```text
You are working in the Airbase repo. This is Phase 3 of the bathroom remodel tenant build. Phases 0 to 2 are merged. The full plan is in docs/remodel-tenant-spec.md.

GOAL
An effective contract becomes a project with phases, a material order and a proposed crew schedule. Crews work it day by day in the existing tech app. Permits and materials gate the start date. Hidden conditions become signed change orders before the extra work starts.

CORE DESIGN (do not deviate without asking)
A remodel is a project that contains ordinary jobs. Each crew day or visit is a row in jobs with project_id and phase_id set. The dispatch board, tech app, job_crew, clock-in, photos and invoicing keep working as they do today. Do not build a parallel scheduling system.

STANDING RULES (where this prompt is more specific than the spec, the prompt wins; tell me about any conflict you find)
1. Read first: CLAUDE.md, docs/remodel-tenant-spec.md (all of it once, then the Phase 3, Data model and Authority matrix sections), docs/api-patterns.md, docs/agents.md.
2. Plan first: reply with your plan (files, migrations, tests, open questions) and wait for my go-ahead before writing code.
3. Work on branch remodel/phase-3-project-production cut from main. Never commit or push to main. Open a pull request when done.
4. Local only. Do not apply migrations to, deploy to, or set secrets on any remote project.
5. Do not modify the legacy voice module, send-sms, booking-agent or csr-reply. Steward's behavior must not change. Changes to shared files are additive and branch on tenants.trade.
6. Follow the repo conventions in CLAUDE.md. Every agent goes through loadAgentContext and finalizeAction and calls models only through _shared/llm-router.ts.
7. If a business input is missing, stop and ask, or use data clearly labelled PLACEHOLDER.

READ THESE FILES BEFORE PLANNING
- supabase/functions/install-crew-agent/index.ts and prompts/install-crew-agent.md
- supabase/migrations/005 (jobs), 006 and 024 (technicians), 026 (job_crew), 027 and 040 (triggers)
- Phase 2 work: contracts, payment_schedule_items, package_components, the EsignProvider interface, contract-rules.ts
- supabase/functions/_shared/remodel-tools.ts and retell-send from Phase 1
- src/features/dispatch, src/features/tech-pwa, mobile/src/screens/field

MIGRATIONS (from 055)
- 055_projects: customer, service location, opportunity, estimate, contract, status (pending_start, scheduled, in_progress, punch_list, complete, on_hold, cancelled), target start, target completion, actual start, actual completion, commitment_days, commitment_clock_start.
- 056_project_phases: phase_templates and phase_template_items per tenant and package (order, name, default day offset, default duration, required evidence), and project_phases (project, order, name, planned start, planned end, status, required evidence, closed by, closed at, notes).
- 057_jobs_project_link: add project_id and phase_id to jobs, with indexes.
- 058_permits: permits (project, jurisdiction, permit type, status, submitted at, issued at, permit number, fee cents) and jurisdiction_rules (tenant, jurisdiction, package or work type, permit required yes, no or unknown, notes).
- 059_material_orders: material_orders (project, vendor, status, ordered at, promised date, received at, total cost cents) and material_order_lines.
- 060_change_orders: project, description, reported by, photos, lines, amount cents, status (draft, needs_pricing, sent, signed, declined, void), e-sign envelope ID, signed at.
- 061_warranties: project, start date, term months, terms text.
- Regenerate src/types/database.types.ts.

EDGE FUNCTIONS

A. project-create
Runs when a contract becomes effective. Creates the project, expands the package's phase template into project_phases, generates a draft material order from package_components plus the customer's selections, and creates a permit row whose status comes from jurisdiction_rules for the service location's city. If the rule is unknown, mark the permit as needs_review and notify the office. Idempotent on contract ID.

B. Remodel scheduling
Add a remodel mode to install-crew-agent, selected by tenants.trade, with its own prompt file prompts/remodel-schedule-agent.md. The Phase 2 trigger guard is replaced by this path: for remodel tenants the agent is invoked by project-create, not by the opportunity trigger.
- It may propose a start date only when all three gates are clear: contract effective; permit issued or not required; every material order line received or promised before day one.
- It books one job per crew day from the phase template, typed remodel_install, with a lead and crew in job_crew, and requests the inspection for its template day when the project is scheduled. Days with no crew on site free that crew for another project, so the agent should interleave projects around inspection days. The customer-facing completion date is the commitment date, not the last crew day. Skip weekends. Leave a holiday calendar as a noted follow-up.
- If commitment_days is set, the clock starts at the permit issue date, or at contract effective date when no permit is required. Store commitment_clock_start and surface days remaining.
- The proposal goes through finalizeAction like every other agent.

C. phase-close
Called from the tech app when a crew lead closes a phase. Refuses if required evidence (photos, test result, inspection passed) is missing. Sets the phase closed, advances the project, and sends the customer a short progress message with one photo through retell-send, respecting sms_enabled and the contact window. Emit a phase_closed event row that Phase 5 will use for milestone invoicing.

D. change-order-agent
Triggered when a crew member reports a hidden condition with photos and a note. Drafts a change order from price book items. If nothing in the price book fits, sets needs_pricing and notifies the office. Sending uses the EsignProvider from Phase 2. Jobs for the changed work cannot be scheduled until the change order is signed. A signed change order updates the contract total and adds a payment_schedule_items row, validated by contract-rules.ts.

E. Material and permit status
Updating a material order's promised date or a permit's status re-evaluates the gates. A promised date later than the planned start flags the project and asks the scheduling agent for a new proposal.

SEED
A phase template for the standard tub-to-shower package on the panel system, confirmed by Santosh: day 1 protection and demo, two installers; day 2 rough plumbing and shower base, one installer; day 3 inspection, no crew on site, booked as a remodel_inspection job; day 4 wall panel installation, two installers; day 5 glass door and plumbing trim, two installers; day 6 crew buffer with two installers if needed, punch list and customer walkthrough with signed completion; days 7 to 10 company buffer with no crew scheduled. The customer commitment is 10 business days. Upsells such as flooring, paint and a vanity add phases and days, and their day counts are PLACEHOLDER. jurisdiction_rules starts empty.

UI
- Web: a Projects list and a project page showing phases with planned and actual dates, gates, permit, material order, change orders, crew schedule and days ahead or behind.
- Dispatch board: multi-day remodel jobs are readable as one project across days.
- Tech app and mobile Field app: today's phase checklist with required evidence, a Report a condition action with photos, and a morning confirm that materials are on hand.
- Closeout: walkthrough sign-off, punch list items as jobs typed remodel_punch_list, a warranty record on completion, and the existing review request flow.

TESTS
- project-create is idempotent and produces the right phases and material lines from the seed package.
- No start date can be proposed with an unissued required permit, a late material line, or a contract that is not effective.
- A standard project schedule skips weekends, creates one job per crew day with crew assigned, books the inspection day with no crew, and shows a completion commitment 10 business days from start.
- The commitment clock starts from permit issue.
- phase-close refuses without evidence.
- Changed work cannot be scheduled before the change order is signed, and a signed one updates the total and the schedule.
- A field-service tenant's install flow is unchanged.

OUT OF SCOPE
Milestone invoicing, job costing, the hourly sweep, authority rules, operator write tools.

INPUTS I STILL OWE (use placeholders, do not block)
Phase template confirmed by a crew lead, permit rules for the first cities, package component lists.

DONE WHEN
- An effective contract from seed data produces a project with phases, a draft material order, a permit row and a proposed crew schedule with no manual entry.
- The gates block scheduling when they should.
- A crew lead can close a phase with photos, report a condition, and the change order reaches a signed state through the manual e-sign adapter.
- All tests, lint and build pass.

PR DESCRIPTION MUST INCLUDE
What was built, every PLACEHOLDER, what was not verified, and manual steps for me.
```

## Phase 4 prompt: Operator brain

```text
You are working in the Airbase repo. This is Phase 4 of the bathroom remodel tenant build. Phases 0 to 3 are merged. The full plan is in docs/remodel-tenant-spec.md.

GOAL
The tenant gets one operator agent that staff can message, that takes real actions inside explicit authority limits, that finds problems nobody reported through an hourly sweep, and that pages a human when something is urgent. Every action is logged with its tier and is reversible where the action allows.

STANDING RULES (where this prompt is more specific than the spec, the prompt wins; tell me about any conflict you find)
1. Read first: CLAUDE.md, docs/remodel-tenant-spec.md (all of it once, then the Phase 4 and Authority matrix sections), docs/api-patterns.md, docs/agents.md.
2. Plan first: reply with your plan (files, migrations, tests, open questions) and wait for my go-ahead before writing code.
3. Work on branch remodel/phase-4-operator-brain cut from main. Never commit or push to main. Open a pull request when done.
4. Local only. Do not apply migrations to, deploy to, or set secrets on any remote project.
5. Do not modify the legacy voice module, send-sms, booking-agent or csr-reply. Steward's behavior must not change. Authority rules apply only to tenants that have rows in authority_rules; tenants without rows keep today's confidence-threshold behavior exactly.
6. Follow the repo conventions in CLAUDE.md. All model calls go through _shared/llm-router.ts with resolveModel. Never hardcode a model name in an agent.
7. Check Retell's current API documentation before coding outbound calls or staff messaging.
8. If a business input is missing, stop and ask, or use data clearly labelled PLACEHOLDER.

READ THESE FILES BEFORE PLANNING
- supabase/functions/operator-agent/index.ts and prompts/operator-agent.md
- supabase/functions/_shared/agent-base.ts (loadAgentContext, shouldAutoExecute, finalizeAction), agent-logger.ts, llm-router.ts
- supabase/migrations/010, 013, 018 (agent_actions, agent_config), 035 (operator chat), 041 (pg_cron pattern), 044 (device tokens)
- supabase/functions/push-notification, weekly-briefing, payment-dunning
- mobile/src/screens/command/ApprovalQueueScreen.tsx, src/features/operator-chat
- Everything added in Phases 1 to 3

MIGRATIONS (from 062)
- 062_authority_rules: tenant, action_type, tier (act, act_and_report, ask_first, never), limit_cents nullable, condition JSONB, approver_role. Unique on tenant, action_type and a limit band so one action can have two rows, for example below and above a dollar limit.
- 063_agent_actions_entity: add to agent_actions: entity_type, entity_id, amount_cents, authority_tier, actor_user_id, reversal JSONB describing how to undo.
- 064_on_call: on_call (tenant, role, user, start, end, order) and pages (tenant, reason, urgency, summary, target user, sent at, acknowledged at, rolled to).
- 065_ops_sweep: sweep_findings (tenant, check name, entity, severity, first seen, last seen, resolved at, action ID). Provide the pg_cron SQL commented, following migration 041: hourly from 7am to 8pm tenant time, every four hours overnight.
- Regenerate src/types/database.types.ts.

A. Authority engine: supabase/functions/_shared/authority.ts
- resolveTier(tenantId, actionType, amountCents, context) returns the tier and the approver role from authority_rules.
- Add finalizeWithAuthority beside finalizeAction, leaving finalizeAction untouched. Behavior: never means refuse and log; ask_first means write a proposed action and notify the approver; act_and_report means execute, log and add to the daily digest; act means execute and log.
- Confidence still applies: an action whose confidence is below the agent's threshold drops one tier.
- agent_config.enabled = false remains a full stop for that agent.
- Seed the remodel tenant's rules from the Authority matrix in the spec, row for row. The dollar limits there (500 dollars for standard material reorders, 750 dollars for change orders sent without asking, 500 dollars for discretionary invoices) are PLACEHOLDER until I confirm them.
- Actions in the never tier are not exposed as tools at all: hiring and pay, signing contracts or permit applications, changing authority rules.

B. Operator write tools
Add to operator-agent, each implemented as a thin call into existing functions and each passing through finalizeWithAuthority with an action_type, an amount where relevant and a reversal description:
reschedule_job, reassign_crew, create_change_order_draft, send_change_order, send_customer_message, send_staff_message, place_material_order, create_invoice_for_milestone (stub that returns not available until Phase 5), update_opportunity_status, book_consultation, escalate.
The operator must read current state before acting and must state in its reasoning which rule allowed the action. Customer messages go through retell-send and obey the contact window.

C. Staff channel
- Mobile Command app: add an operator chat screen backed by the existing operator chat tables, with push notifications for replies and for approvals. Add the same panel to the Field app scoped to the technician's own jobs and projects.
- Staff SMS, behind a tenant flag and off by default: an inbound text from a number matching a users or technicians row for that tenant routes to the operator agent with that person's role and current assignments as context. A number matching no staff row is treated as a customer and goes to the Phase 1 flow. Staff can never raise their own authority through a message.

D. ops-sweep (new, service-role only)
One function, one check per module file, each returning findings. Checks:
- Lead with no first response after 5 minutes
- Consultation tomorrow not confirmed
- Estimate sent with no response after 48 hours
- Contract signed with no deposit after 24 hours
- Project start at risk from a permit or a material line
- Phase planned for yesterday not closed
- Change order unsigned after 24 hours
- Invoice past due
- Approval waiting more than 2 hours
Each finding is upserted to sweep_findings so a repeat run does not duplicate it, and each produces an action through finalizeWithAuthority, not just a report line. Thresholds live in agent_config.settings for an agent type named ops_sweep. Also write one daily digest per tenant listing what was done, what is waiting on a human, and what was escalated, delivered to owner-role users by push and shown in the app.

E. page-on-call (new, service-role only)
Resolves who is on call for the role and time, writes a pages row, sends a push, and for urgent pages places an outbound call through retell-send that reads a two-sentence summary. An unacknowledged page rolls to the next person in order after 10 minutes. Replace the Phase 1 simple escalation with this, keeping tenants.escalation_phone as the fallback when the roster is empty.

F. Model configuration
For the remodel tenant, set agent_config.model_id for the operator, change-order and scheduling agents to a Claude model, and leave notification-style agents on the platform default. Before doing so, check Anthropic's current model list and pricing, update MODEL_REGISTRY in llm-router.ts with correct IDs and prices, and tell me what you changed. Do not guess model IDs.

G. Owner controls
A settings page for the remodel tenant: view and edit authority rules (owner role only), a single switch that pauses all autonomous actions, the on-call roster, and the sweep thresholds. An action log view filtered by tier, entity and agent, with a reverse button where a reversal is defined.

TESTS
- resolveTier for each seeded rule, including both sides of each dollar limit.
- Low confidence drops one tier. A never action is refused and is not present in the tool list.
- A tenant with no authority rules behaves exactly as before.
- Each sweep check with a positive and a negative fixture, and no duplicate findings on a second run.
- Paging rolls over after 10 minutes without acknowledgement.
- A staff text cannot trigger an action above that person's role, and an unknown number is routed as a customer.
- The pause switch stops every autonomous action.

OUT OF SCOPE
Milestone invoicing and accounting posting. Any change to Steward's agent behavior.

INPUTS I STILL OWE (use placeholders, do not block)
Confirmed dollar limits, the on-call roster, whether staff SMS is wanted at launch.

DONE WHEN
- With seed data, a crew lead message that tile is two boxes short leads the operator to order the material inside its limit, adjust the schedule if needed and draft the customer message, each logged with its tier.
- A lead left unanswered in a fixture is found and worked by the sweep.
- A test emergency produces a page and a rollover.
- All tests, lint and build pass.

PR DESCRIPTION MUST INCLUDE
What was built, every PLACEHOLDER, the model registry changes and their source, the pg_cron SQL, what was not verified, new secrets, and manual steps for me.
```

## Phase 5 prompt: Billing and books

```text
You are working in the Airbase repo. This is Phase 5 of the bathroom remodel tenant build. Phases 0 to 4 are merged. The full plan is in docs/remodel-tenant-spec.md.

GOAL
Each payment milestone is invoiced when its trigger event happens and never before. Every project shows a true margin. Every financial event is posted once to the accounting system through an outbox, with the ledger kept outside Airbase.

STANDING RULES (where this prompt is more specific than the spec, the prompt wins; tell me about any conflict you find)
1. Read first: CLAUDE.md, docs/remodel-tenant-spec.md (all of it once, then the Phase 5, Data model and Authority matrix sections), docs/api-patterns.md.
2. Plan first: reply with your plan (files, migrations, tests, open questions) and wait for my go-ahead before writing code.
3. Work on branch remodel/phase-5-billing-books cut from main. Never commit or push to main. Open a pull request when done.
4. Local only. Do not apply migrations to, deploy to, or set secrets on any remote project. Do not post anything to a real QuickBooks company or any real ledger.
5. Do not modify the legacy voice module, send-sms, booking-agent or csr-reply. Steward's invoicing and QuickBooks sync must behave exactly as today.
6. Follow the repo conventions in CLAUDE.md. Money is stored in integer cents.
7. If a business or accounting input is missing, stop and ask, or use data clearly labelled PLACEHOLDER. Never invent account mappings.

READ THESE FILES BEFORE PLANNING
- supabase/functions/invoice-agent, close-job, process-payment, stripe-webhook, payment-dunning, qbo-sync
- supabase/migrations/008, 009 (invoices, payments), 029 (profitability views), 040 (invoice trigger), 041 (dunning)
- Phase 2: payment_schedule_items, contracts, contract-rules.ts
- Phase 3: phase-close and its phase_closed events, material_orders, change_orders, projects
- Phase 4: authority.ts and the create_invoice_for_milestone stub
- src/features/analytics/ProfitabilityPage.tsx, src/features/invoicing

MIGRATIONS (from 066)
- 066_tech_cost_rate: add loaded_hourly_cost_cents to technicians.
- 067_project_costs: project_costs (project, category of permit_fee, disposal, subcontractor or other, description, amount cents, incurred on, vendor). A view project_profitability: contract value, signed change orders, invoiced to date, collected to date, labor cost from job clock time multiplied by loaded cost, material cost from received material orders, other costs, margin to date, forecast margin at completion, variance against the package target margin.
- 068_accounting_outbox: tenant, event type (invoice_issued, payment_received, material_cost, labor_cost_batch, other_cost, refund), entity type and ID, payload JSONB, target system, status (pending, posted, failed, skipped), attempts, last error, posted at, external reference. Unique on tenant, event type, entity and target system so an event posts once.
- Regenerate src/types/database.types.ts.

A. milestone-invoice (new, service-role only)
- Consumes trigger events: contract_signed, materials_delivered (a material order marked received), phase_closed, completion (customer walkthrough signed).
- For each payment_schedule_items row whose trigger matches and whose status is pending, create the invoice for exactly the scheduled amount, link it to the item, and send it with the existing payment link and portal flow.
- Hard guard: refuse to create an invoice for an item whose trigger event has not been recorded. This guard is not configurable and has its own tests.
- A signed change order's schedule item is invoiced when its changed work is closed, unless the change order states another trigger.
- Goes through finalizeWithAuthority with action_type milestone_invoice, which the Authority matrix sets to act when the trigger is recorded and the amount equals the signed schedule. Any other invoice over the discretionary limit stays ask_first.
- Replace the Phase 4 stub so the operator's create_invoice_for_milestone tool calls this function.
- The existing jobs_invoice_agent trigger must not also invoice remodel crew-day jobs. Guard it for jobs that have a project_id and add a test.

B. Collections
Milestone invoices use the existing dunning sweep. Add the project and milestone name to reminder content for remodel tenants. A milestone unpaid past its terms raises a sweep finding and, per the authority rules, can pause scheduling of the next phase only with human approval.

C. Job costing
- Labor: sum clock-in to clock-out time on the project's jobs per technician, multiplied by loaded_hourly_cost_cents. Flag jobs with missing clock-outs instead of guessing.
- Materials: actual cost from received material order lines.
- Other: project_costs entries, with a simple form on the project page.
- Extend the profitability page with a project view: contract value, change orders, cost by category, margin to date, forecast at completion, and variance against target. Add the project margin to the daily digest and weekly briefing for remodel tenants.

D. Accounting outbox and adapters
- Every financial event writes an accounting_outbox row in the same transaction as the event.
- accounting-post (new, service-role only) drains pending rows with retry and backoff, and marks a row failed after a set number of attempts with the error kept.
- Define an AccountingAdapter interface: post invoice, post payment, post cost, post refund, each returning an external reference.
- Adapter 1, quickbooks: wraps the existing qbo-sync logic without changing its behavior for Steward.
- Adapter 2, buildersbooks: interface and a stub only. The posting contract for BuildersBooks (chart of accounts, job dimension, tenant mapping, authentication) is not defined yet. Stop and ask me for it before implementing. Do not guess at its schema.
- Target system is a per-tenant setting. The remodel tenant's target is PLACEHOLDER until I confirm.
- Add an admin view of the outbox with a retry button for failed rows.

TESTS
- A milestone invoice is created on its trigger and refused without it, for each trigger type.
- The invoice amount always equals the schedule item, and the schedule still validates under contract-rules.ts after a change order.
- A remodel crew-day job closing does not create a per-job invoice. A field-service job still does.
- Labor cost with complete clock data, and a missing clock-out is flagged, not estimated.
- Project profitability on a fixture project matches hand-computed numbers.
- An outbox event posts exactly once across retries, and a failing adapter leaves the row failed with its error.
- Steward's QuickBooks sync path is unchanged.

OUT OF SCOPE
Payroll, commissions, tax filings, a general ledger inside Airbase, any real BuildersBooks integration before its contract is supplied.

INPUTS I STILL OWE (use placeholders, do not block)
Loaded hourly cost per installer role, target margins per package, the accounting target for the remodel tenant, the BuildersBooks posting contract.

DONE WHEN
- On a fixture project, closing the phase tied to a milestone produces the right invoice with no manual entry, and no invoice can be produced early.
- The project page shows margin to date and forecast margin.
- Every financial event appears once in the outbox and posts once through the test adapter.
- All tests, lint and build pass.

PR DESCRIPTION MUST INCLUDE
What was built, every PLACEHOLDER, what was not verified, new secrets, and manual steps for me.
```
