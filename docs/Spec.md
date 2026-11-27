# Airbase Bathroom Remodel Tenant Spec

Nov 21, 2026 · @Santosh

## Summary

This spec adds a bathroom remodeling business to Airbase as its own tenant, run by an AI operator with Santosh and hired staff as the people. It is written to be handed to Claude Code one phase at a time.

It is based on a read of `santoshraghunath-2/airbase` at commit `ecce9cf` (Oct 25, 2026). The code was read, not run, so nothing here confirms what is deployed.

**Decisions already made**

- The business runs as a tenant on Airbase, not a standalone system.
- Retell is the path for voice and messaging. The legacy Twilio code stays in the repo untouched.
- The always-reachable layer comes first, before any remodel-specific modules.
- Heavy thinking stays on the Claude subscription. Only real-time events use paid model calls.

**Core design choice**

A remodel is modeled as a **project** that contains ordinary Airbase **jobs**, one per crew day or visit. The dispatch board, tech app, crew table, clock-in, photos and invoicing keep working unchanged, and the project adds phases, permits, materials, change orders and a payment schedule on top.

**Build order**

1. Phase 0: Hardening. Close the open webhook, update the project guide, add a test harness.
2. Phase 1: Lead responder. Every call, text and form fill is answered and booked into an in-home visit.
3. Phase 2: Sale to contract. Package estimate, contract, deposit and financing handoff.
4. Phase 3: Project production. Phases, crews, permits, materials and change orders.
5. Phase 4: Operator brain. Action tools, authority tiers, staff channel, hourly sweep and escalation.
6. Phase 5: Billing and books. Progress billing, job costing and posting to the accounting system.

Phases 1 and 2 are enough to start selling with jobs run manually. Phase 4 can be pulled ahead of Phase 3 if staff coordination becomes the bottleneck before volume does.

## Current state

Airbase already has most of the pipeline and agent plumbing a remodel business needs. What it lacks is everything that makes a remodel a multi-day contract instead of a service call.

**Reuse as-is**

| Capability | Where it lives |
| --- | --- |
| Sales pipeline, new through won or lost | `opportunities` (migration 025) |
| Salesperson assignment to a new lead | `ca-dispatch-agent`, trigger in 027 |
| Estimates with single or three-option presentation | `estimates`, `estimate_line_items` (022) |
| Crew scheduling when a deal is won | `install-crew-agent`, `job_crew` (026) |
| Salesperson and crew roles | `technicians.tech_type`: `comfort_advisor`, `install_lead`, `install` (024) |
| Action log with reasoning and confidence | `agent_actions` (010), `agent-base.ts` |
| Per-agent autonomy and model choice | `agent_config` (013, 018) |
| Approval queue on mobile, push notifications | `mobile/` Command app, `push-notification` |
| Retell inbound voice with tool calls | `retell-voice-webhook` |
| Conversation log for calls and texts | `booking_conversations` (015) |
| Payments, portal, reviews, dunning | `process-payment`, `stripe-webhook`, portal, `review-request`, `payment-dunning` |
| Job profitability | views in 029 |

**Missing for remodels**

- **Job types.** The `job_type` enum lists plumbing, HVAC and electrical work only.
- **Projects.** A job is one visit. Nothing groups ten crew days into one remodel with phases.
- **Contract paperwork.** No contract, e-signature, deposit, payment schedule or change order exists.
- **Permits and materials.** Neither is tracked, so neither can gate a start date.
- **Messaging on Retell.** `send-sms`, `booking-agent` and `csr-reply` all call Twilio directly.
- **An operator that acts.** `operator-agent` has five read-only tools.
- **A heartbeat.** There is a weekly briefing and a nightly dunning sweep, and nothing hourly.
- **Tests.** The repo has a scenarios document and no automated tests.

**Mismatches to know about**

- `CLAUDE.md` names Twilio for voice and Claude as the default model. The code uses Retell for voice and defaults to `deepseek-flash`.
- `CLAUDE.md` tells Claude Code to refuse work outside the active phase, and `docs/current-phase.md` says Phase 3. Remodel work will be refused until Phase 0 updates those files.
- The org to trade-entity model from the plumbing playbook spec is not in the code. Tenants are flat, with `parent_tenant_id` reserved.
- The legacy voice module (`src/modules/voice`) holds intake scripts for GGB Express Bathrooms and Recast Texas. Those scripts are the starting point for the Retell agent prompts.

## Tenant and brand model

The bathroom business is a new tenant, separate from Steward, with brand stored apart from legal entity so a rename to Recast is a settings change.

**Tenant setup**

- Create tenant `ggb-express` (working name GGB Express Bathrooms, matching the legacy voice scripts).
- Create a root tenant for Good Guy Brands and set `parent_tenant_id` on both Steward and the bathroom tenant. Parent-level access is not built yet, so this only records the relationship for later.
- Do not build the org to trade-entity model now. It is a larger refactor and nothing in Phases 0 to 5 needs it.

**Brand apart from entity**

Add these columns to `tenants`:

| Column | Purpose |
| --- | --- |
| `legal_entity_name` | Name on contracts and invoices (Good Guy Builders) |
| `license_number` | Contractor license printed on contracts and ads |
| `license_state` | `CA` now, `TX` when Houston joins |
| `brand_name` | Customer-facing name used by agents, texts and the portal |
| `trade` | `remodel`, used to pick prompts, job types and crew rules |

Every prompt and template reads `brand_name`, never a hardcoded name. Switching GGB Express to Recast becomes one row update plus new Retell agent greetings.

**Consequence to accept**

Separate tenants mean separate customer records. A Steward plumbing customer who buys a bathroom exists twice until parent-level access is built. Cross-sell between the two is a manual referral for now, logged as an opportunity with source `referral`.

**Houston later**

Recast Texas joins as a third tenant under the same parent, with its own license state, tax rules, price book and Retell number. No Phase 0 to 5 work should assume California except the contract rules in Phase 2, which are keyed on `license_state`.

## Phase 0: Hardening

Phase 0 closes one security hole and removes the guardrails that would make Claude Code refuse the rest of this spec. It is small and has no dependencies.

**Tasks**

- [ ] **Verify Retell signatures.** In `retell-voice-webhook`, the check is commented out. Reject any request whose `x-retell-signature` header fails HMAC-SHA256 verification against the raw body, keyed with the Retell API key that carries the webhook badge. Enforce a five-minute timestamp window. Put the check in `_shared/retell-auth.ts` so the Phase 1 chat webhook uses the same code. Method: [Retell secure webhook docs](https://docs.retellai.com/features/secure-webhook).
- [ ] **Drop the open CORS header** on that function. Retell calls it server to server.
- [ ] **Make the repo private again.** No real keys are committed, only placeholders.
- [ ] **Update `CLAUDE.md`.** Voice and messaging are Retell. The default model is `deepseek-flash`. Airbase serves remodel tenants as well as plumbing, HVAC and electrical.
- [ ] **Add a remodel track to `docs/current-phase.md` and `docs/phases.md`**, pointing at this spec, so the phase guard permits the work.
- [ ] **Add a second acceptance test to `CLAUDE.md`** beside the Steward Test: "Can the bathroom tenant take a lead from first contact to a signed, scheduled, paid project?"
- [ ] **Add a test harness.** Deno tests for edge functions, starting with signature verification, tenant resolution from a Retell agent ID, and a check that every new table has row-level security.
- [ ] **Leave the legacy code alone.** `src/modules/voice`, `send-sms`, `booking-agent` and `csr-reply` stay as they are. Steward keeps using them until its own migration is scheduled.

**Done when**

- An unsigned POST to the Retell webhook returns 401 and writes nothing.
- Claude Code accepts a remodel task without flagging it as out of phase.
- `deno test` runs in CI and passes.

## Phase 1: Lead responder

Phase 1 makes sure every call, text and form fill gets an answer in under a minute and ends in a booked in-home visit or a logged reason why not.

**Channels**

| Channel | How it works | New code |
| --- | --- | --- |
| Inbound call | Retell voice agent on the bathroom number, tools served by the existing webhook | Remodel tool set in `retell-voice-webhook` |
| Inbound text | Retell chat agent attached to the same number as its inbound SMS agent | `retell-chat-webhook` |
| Web form, ad lead form | Signed POST creates the lead, then Retell texts and calls out | `lead-intake` |
| Outbound text | Retell Create Outbound SMS, chat agent speaks first | `retell-send` |
| Outbound call | Retell outbound call from the same number | `retell-send` |

**What Retell requires for texting** ([Retell SMS docs](https://docs.retellai.com/deploy/enable-sms))

- Two-way texting needs A2P 10DLC registration, on a Retell-provided number or on your own Twilio number that is already compliant.
- Registration on a Retell number is a brand fee ($4 low-volume or $45 standard) plus a $15 campaign fee, with review taking about two to three weeks or longer.
- The SMS add-on is $20 a month per number plus $0.01 per message sent.
- A2P texting covers US numbers only, not toll-free.

Because of the review time, **start A2P registration on day one**, before any code. Voice works without it.

**Lead flow**

1. A lead arrives by call, text or form.
2. `lookup_customer` matches the phone number or creates the customer.
3. The agent qualifies: project type, number of bathrooms, timeline, ZIP against `service_area_zips`, and budget fit against the package floor.
4. A qualified lead gets an `opportunities` row and a booked visit. An unqualified one is saved with the reason.
5. `book_consultation` creates a job of type `remodel_consultation`, assigned to a salesperson (`tech_type = comfort_advisor`), and sets the opportunity to `visit_scheduled`.
6. The customer gets a confirmation text. The salesperson gets a push notification with the qualification notes.
7. Anything angry, confused or out of pattern calls `escalate_to_human`, which pages the on-call person.

**Remodel tool set** (shared by voice and chat)

- `lookup_customer(phone)`
- `qualify_lead(project_type, bathrooms, timeline, zip, budget_range)`
- `check_consult_availability(date_range)`
- `book_consultation(customer, location, slot, notes)`
- `save_lead(reason)` for not-now and out-of-area leads
- `escalate_to_human(reason)`

The webhook picks the tool set from `tenants.trade`, so Steward's booking tools are untouched.

**Form intake rules**

- Each form source has its own HMAC secret. Unsigned posts are rejected.
- The form must capture consent to be called and texted. Store the consent text and timestamp on the opportunity.
- Outbound contact happens only inside permitted calling hours in the lead's time zone. A late-night form fill gets a text at the next permitted hour.
- Target: first outbound text within 60 seconds of the form post, first call attempt within 5 minutes.

**Follow-up**

A lead that goes quiet gets a set cadence: same day, day 2, day 5, day 10, then marked `no_decision`. Each touch is a new outbound SMS conversation, because sending a follow-up into an existing Retell SMS thread is reported as unsupported in Retell's community forum. Confirm this against the current API before building the cadence.

**Agent prompts**

Port `ggb-express-agent.js` from the legacy voice module into a Retell agent prompt. Update it to the current product: mid-grade fixed-price packages, not designer remodels, with the price floor taken from the price book.

**Done when**

- A test call, a test text and a test form each produce a customer, an opportunity and a booked consultation job with no human touch.
- An out-of-area ZIP is saved and politely declined.
- Saying "let me talk to a person" pages the on-call phone withine 30 seconds.
- Every conversation appears in `booking_conversations` with its Retell call or chat ID.

## Phase 2: Sale to contract

Phase 2 lets a salesperson leave the home with a signed contract and a collected deposit, with the paperwork generated from the price book and the legal limits enforced in code.

**Price book as packages**

Load the fixed-price packages as `pricebook_items` with `trade = 'remodel'`. Prices stated so far:

| Package | Price |
| --- | --- |
| Tub-to-shower conversion, fixtures included | $16,000 |
| Tub replacement in place of a standing shower, fixtures included | $17,000 |
| Waterproof LVP flooring, full bathroom | $4,500 |
| Paint, whole bathroom | $1,000 |
| Vanity and mirror | By selection, sink and faucet included with a vanity |

The full price book is still to come. Add a `package_components` table so each package carries its material list, labor hours by phase and target margin. Phase 3 scheduling and Phase 5 costing both read from it.

**Estimate**

- Use the existing estimate builder in `single` presentation mode, with packages as line items and add-ons as optional lines.
- The salesperson builds it in the tech app during the visit. Standard duration and crew size come from the package, so the customer sees a start window and a finish date on the spot.
- Any price not in the price book needs approval before it is shown. See the authority matrix.

**Contract**

Generate the home improvement contract as a PDF from the accepted estimate, then send it for e-signature. For `license_state = 'CA'` the generator must enforce what CSLB requires ([CSLB contract guide](https://www.cslb.ca.gov/Consumers/Hire_A_Contractor/Home_Improvement_Contracts/What_Is_A_Contract.aspx), [CSLB sample contract](https://www.cslb.ca.gov/Resources/GuidesAndPublications/2025/SAMPLE%20HOME%20IMPROVEMENT%20CONTRACT.pdf)):

- A written contract for any job over $500.
- A down payment of no more than $1,000 or 10 percent of the contract price, whichever is less.
- A schedule of progress payments that describes each phase and its amount, with no payment collected ahead of work completed or materials delivered.
- The right-to-cancel notice, three days in general and five days for customers 65 or older.
- Changes only by written, signed change order.

Start from CSLB's sample contract and have a California construction attorney approve the final template once. The code enforces the numbers. The attorney owns the wording.

**Cash flow consequence**

On a $16,000 job the deposit is capped at $1,000. Materials have to be funded before the first progress payment. The payment schedule should therefore put a milestone at materials delivery, which is the earliest point a larger payment is allowed.

**Default payment schedule** (editable per contract, validated against the rules above)

| Milestone | Trigger | Share |
| --- | --- | --- |
| Deposit | Contract signed | $1,000 or 10 percent, whichever is less |
| Materials | Materials delivered to site | Up to delivered material value |
| Rough-in complete | Demo, plumbing and waterproofing phases signed off | To be set |
| Completion | Customer sign-off | Balance |

**Deposit and financing**

- The deposit is collected by Stripe payment link from the signed contract screen, using the existing `process-payment` function.
- A financed customer is handed to the lending partner at estimate time. The estimate already has fields for a financing application and offer link, currently named for Wisetack. Rename them to be lender-neutral.
- A project cannot move to scheduling until the contract is signed, the cancellation window has passed and the deposit or financing approval is recorded.

**Done when**

- A salesperson can go from a booked visit to a signed contract and a paid deposit on a phone, without office help.
- The system refuses a deposit over the legal cap and refuses a payment schedule that bills ahead of progress.
- Signing sets the opportunity to `won`. The project itself is created in Phase 3, once the contract is effective.

## Phase 3: Project production

Phase 3 turns a signed contract into a scheduled, tracked build that finishes on its promised date, with every blocker visible before it costs a day.

**Project and phases**

- A `projects` row is created when the opportunity is won. It links the customer, location, opportunity, estimate and contract.
- Each package expands into `project_phases` from a template. Default template for a tub-to-shower conversion, to be confirmed against how crews work:

| Order | Phase | Evidence required to close |
| --- | --- | --- |
| 1 | Protection and demo | Before photos, demo photos |
| 2 | Rough plumbing | Photo of valve and drain, inspection if permitted |
| 3 | Pan and waterproofing | Photos, flood test result |
| 4 | Walls and surround | Photos |
| 5 | Fixtures and glass | Photos |
| 6 | Flooring, paint, vanity (if sold) | Photos |
| 7 | Punch list and clean | Punch list cleared |
| 8 | Customer walkthrough | Signed completion |

- Each crew day is an ordinary job with `project_id` and `phase_id` set and a `job_type` of `remodel_install`. Crews use the existing tech app with no new screens beyond a phase checklist.

**Scheduling**

- Extend `install-crew-agent` with a remodel mode: it books consecutive business days for the whole project, 10 business days for a standard shower replacement or tub-to-shower conversion.
- The agent may only propose a start date when all three gates are clear: contract effective, permit issued or not required, materials received or confirmed for delivery before day one.
- For the realtor channel, the three-week commitment is tracked from the permit issue date, and the project shows days remaining against it.

**Permits**

- A `permits` table tracks jurisdiction, permit type, status, dates submitted and issued, and inspection dates.
- Whether a package needs a permit depends on the city. Store the rule per jurisdiction as data, filled in as each city is first worked.
- Inspections are scheduled as jobs of type `remodel_inspection` so they appear on the board and block the next phase until passed.

**Materials**

- A `material_orders` table is generated from `package_components` plus the customer's selections.
- Each line tracks vendor, order date, promised date, received date and cost.
- A promised date later than the planned start flags the project and proposes a new start.

**Change orders**

- Crews report a hidden condition from the tech app with photos and a short note.
- The agent drafts a change order from the price book. Anything not in the price book goes to a human to price.
- Work on the change does not start until the customer signs. The signed change order updates the contract total and the payment schedule.

**Daily rhythm**

- Morning: crew lead confirms the day's phase and materials on hand.
- End of day: crew lead closes the phase checklist with photos. The customer gets a short progress text with one photo.
- A phase not closed by end of day is flagged in the sweep with the reason.

**Closeout**

Customer walkthrough, signed completion, final invoice, review request through the existing satisfaction routing, and a warranty record with its start date.

**Done when**

- A won opportunity produces a project with phases, a material order and a proposed crew schedule without manual entry.
- A project with an unissued permit or late materials cannot be given a start date.
- A crew lead can report a hidden condition and the customer can sign the change order the same day.
- The owner can see, for every active project, the phase it is in and days ahead or behind.

## Phase 4: Operator brain

Phase 4 gives the business one operator that staff can message, that acts within set limits, that notices what nobody reported, and that knows when to call a person.

**Where the thinking happens**

Three different models do the work, and the spec should not blur them:

| Layer | Runs on | Paid by |
| --- | --- | --- |
| Live calls and texts with customers | The model selected inside the Retell agent | Retell usage |
| Decisions inside Airbase (scheduling, change orders, operator actions, sweeps) | `llm-router`, model set per agent in `agent_config` | Model API usage |
| Planning, analysis, reports, building the system | Claude app and Claude Code | The existing subscription |

For this tenant, set `agent_config.model_id` to a Claude model for the operator, change-order and scheduling agents, and leave routine notifications on the cheap default. Confirm current model IDs and prices before setting them. The registry in `llm-router.ts` lists `claude-sonnet-4-6` and `claude-opus-4-6`, which may no longer be the right choices.

**Operator actions**

`operator-agent` has five read tools today. Add write tools, each one going through `finalizeAction` so it is logged, gated and reversible:

- `reschedule_job`, `reassign_crew`
- `create_change_order_draft`, `send_change_order`
- `send_customer_message`, `send_staff_message`
- `place_material_order`
- `create_invoice_for_milestone`
- `update_opportunity_status`, `book_consultation`
- `escalate(person, reason, urgency)`

**Authority tiers**

Replace the single confidence threshold with a rule per action type, stored in an `authority_rules` table: a tier (`act`, `act_and_report`, `ask_first`), an optional dollar limit, and who approves. The matrix below is the starting data. Confidence still applies inside a tier: a low-confidence `act` is demoted to `ask_first`.

**Staff channel**

- First: chat in the mobile Command app, backed by the existing operator chat tables, with push notifications. This needs no carrier registration.
- Second: a staff text number on Retell, once A2P is approved. Messages from a phone number matching a `users` or `technicians` row route to the operator agent with that person's role and current jobs as context.
- Every promise a staff member makes to a customer must be logged through this channel. What is not logged does not exist for the operator.

**Hourly sweep**

A `pg_cron` schedule, the same mechanism the dunning sweep uses, calls a new `ops-sweep` function every hour during business hours and every four hours overnight. It checks:

- Leads with no reply after 5 minutes, and consultations not confirmed for tomorrow
- Estimates sent with no response after 48 hours
- Contracts signed with no deposit after 24 hours
- Projects with a start date at risk from a permit or a material order
- Phases not closed yesterday
- Change orders unsigned after 24 hours
- Invoices past due
- Approvals waiting more than 2 hours

Each finding becomes an action under the authority rules, not a report line. The sweep also writes one daily digest for the owner.

**Escalation**

- An `on_call` table holds who is on call by role and time window.
- Urgent items (active leak, injury, a customer threatening to cancel, a crew that did not show) page by push and by an outbound Retell call that reads a two-sentence summary.
- An unacknowledged page rolls to the next person after 10 minutes.

**Done when**

- A crew lead can message "tile is short two boxes" and the operator orders the material, adjusts the schedule if needed, and tells the customer, all within its limits.
- A lead left unanswered is caught and worked by the sweep within the hour.
- Every action shows in the log with its tier, its reasoning and how to reverse it.
- A test emergency reaches a human phone within two minutes.

## Phase 5: Billing and books

Phase 5 bills each milestone the moment it is earned and gives a true margin on every project, with the ledger kept in the accounting system and not in Airbase.

**Progress billing**

- A `payment_schedule_items` row exists for each milestone from the contract.
- Closing the phase that triggers a milestone drafts its invoice through the existing invoice agent. Receiving materials on site triggers the materials milestone.
- No invoice can be issued for a milestone whose trigger has not happened. This is the code-level guard for the rule against billing ahead of progress.
- A signed change order adds its amount to the schedule, due when the changed work is complete unless the change order says otherwise.
- Collection uses the existing payment links, portal and dunning sweep.

**Job costing**

- Labor: clock-in and clock-out per job already exist. Add a loaded hourly cost per technician.
- Materials: actual cost from `material_orders`.
- Other: permit fees, disposal, subcontractors, entered against the project.
- Extend the profitability views in migration 029 with a project-level view: contract value, change orders, cost by category, margin against the package target.

**Posting to the books**

- Airbase currently syncs invoices to QuickBooks Online through `qbo-sync`. The intended ledger is BuildersBooks.
- Build an `accounting_outbox` table: one row per invoice, payment, material cost and labor cost batch, with a status and a target system.
- Write the posting logic behind an adapter interface, with a QuickBooks adapter wrapping the existing function and a BuildersBooks adapter added once its interface is defined.
- The BuildersBooks side has not been reviewed for this spec. The posting contract (accounts, job dimension, tenant mapping) is an open item below.

**Done when**

- Closing a phase produces the right milestone invoice with no manual entry.
- A project page shows margin to date and forecast margin at completion.
- Every financial event in Airbase appears once in the ledger, and a failed post is retried and visible.

## Data model

All changes are additive. No existing column is dropped or renamed except the two Wisetack fields, and Steward's data is untouched. Migrations continue from 045, and every new table gets `tenant_id`, row-level security, timestamps and soft delete per the repo conventions.

| Phase | Migration | Change |
| --- | --- | --- |
| 0 | `045_tenant_entity_brand` | `tenants`: add `legal_entity_name`, `license_number`, `license_state`, `brand_name`, `trade`, `retell_phone_number` |
| 1 | `046_remodel_job_types` | `job_type` enum: add `remodel_consultation`, `remodel_install`, `remodel_inspection`, `remodel_punch_list` |
| 1 | `047_lead_sources` | `lead_source` enum: add `web_form`, `ad_lead_form`, `realtor`, `restoration_partner`, `inbound_sms` |
| 1 | `048_opportunity_lead_fields` | `opportunities`: add `project_type`, `bathrooms`, `timeline`, `budget_range`, `qualification_notes`, `consent_text`, `consent_at`, `next_follow_up_at`, `follow_up_step` |
| 1 | `049_conversation_retell` | `booking_conversations`: add `retell_call_id`, `retell_chat_id`, `opportunity_id`, `direction` |
| 1 | `050_lead_sources_config` | New `lead_intake_sources`: source key, HMAC secret reference, default campaign |
| 2 | `051_package_components` | New `package_components`: pricebook item, material lines, labor hours by phase, crew size, standard duration days, target margin |
| 2 | `052_contracts` | New `contracts`: estimate, PDF path, e-sign envelope ID, status, signed at, cancel-by date, customer 65-or-older flag, total |
| 2 | `053_payment_schedule` | New `payment_schedule_items`: contract, milestone, trigger type, trigger reference, amount, invoice |
| 2 | `054_estimate_financing_rename` | `estimates`: rename the two Wisetack columns to `financing_application_id` and `financing_offer_url`, add `financing_provider` |
| 3 | `055_projects` | New `projects`: customer, location, opportunity, estimate, contract, status, target start, target completion, actual dates, commitment clock start |
| 3 | `056_project_phases` | New `project_phases` and `phase_templates`: order, name, planned date, status, required evidence, closed by, closed at |
| 3 | `057_jobs_project_link` | `jobs`: add `project_id`, `phase_id` |
| 3 | `058_permits` | New `permits` and `jurisdiction_rules` |
| 3 | `059_material_orders` | New `material_orders` and `material_order_lines` |
| 3 | `060_change_orders` | New `change_orders`: project, description, photos, lines, amount, status, signed at, e-sign envelope ID |
| 3 | `061_warranties` | New `warranties`: project, start date, term, terms text |
| 4 | `062_authority_rules` | New `authority_rules`: action type, tier, dollar limit, approver role |
| 4 | `063_agent_actions_entity` | `agent_actions`: add `entity_type`, `entity_id`, `amount_cents`, `authority_tier`, `actor_user_id` |
| 4 | `064_on_call` | New `on_call`: role, user, window, order, plus `pages` log |
| 4 | `065_ops_sweep_cron` | `pg_cron` schedule for `ops-sweep`, new `sweep_findings` |
| 5 | `066_tech_cost_rate` | `technicians`: add `loaded_hourly_cost_cents` |
| 5 | `067_project_costs` | New `project_costs` for non-labor, non-material costs, plus project profitability view |
| 5 | `068_accounting_outbox` | New `accounting_outbox`: event type, payload, target system, status, attempts |

**New edge functions**

| Phase | Function | Trigger |
| --- | --- | --- |
| 0 | `_shared/retell-auth.ts` | Imported by every Retell webhook |
| 1 | `retell-chat-webhook` | Retell chat events and tool calls |
| 1 | `lead-intake` | Signed POST from forms and ad platforms |
| 1 | `retell-send` | Outbound text or call, called by agents |
| 1 | `lead-follow-up` | Called by the sweep |
| 2 | `generate-contract`, `esign-webhook` | Estimate accepted, signature events |
| 3 | `project-create`, `phase-close`, `change-order-agent` | Opportunity won, crew closes a phase, crew reports a condition |
| 4 | `ops-sweep`, `page-on-call` | `pg_cron`, escalations |
| 5 | `milestone-invoice`, `accounting-post` | Phase or delivery event, outbox rows |

**Hooks left for later**

- `tenants.trade` and `license_state` let kitchens and Houston be added as data.
- `parent_tenant_id` is set now, so parent-level reporting and shared customers can be built without a data migration.
- `phase_templates` and `package_components` are per tenant, so a second remodel product needs no code.
- `accounting_outbox` takes a new ledger with one adapter.

## Authority matrix

The operator acts alone on routine, reversible work inside the price book, reports after the fact on small money, and asks first on anything that spends real money, changes a promise or touches a person's job. The dollar limits are proposed starting points for Santosh to set.

| Action | Tier | Limit or condition | Approver when asking |
| --- | --- | --- | --- |
| Reply to a lead, qualify, book a consultation | Act | Inside service area and calendar |  |
| Send confirmations, reminders, progress updates | Act | Template-based content |  |
| Follow up on a quiet lead or unsigned estimate | Act | Within the set cadence |  |
| Draft an estimate from packages | Act | Price book items only |  |
| Quote a price not in the price book | Ask first | Always | Owner |
| Discount or concession | Ask first | Always | Owner |
| Generate and send a contract | Act and report | From an accepted estimate, template unchanged |  |
| Propose a project schedule and crew | Act and report | All gates clear |  |
| Move a start date the customer has been told | Ask first | Always | Operations lead |
| Reorder a standard material | Act and report | Up to $500 per order |  |
| Place the initial material order for a project | Ask first | Until three projects have run clean, then act and report | Operations lead |
| Draft a change order | Act | Price book items only |  |
| Send a change order to the customer | Act and report | Up to $750 |  |
| Send a change order to the customer | Ask first | Over $750 or not in price book | Owner |
| Issue a milestone invoice | Act | Trigger event recorded, amount equals the signed schedule |  |
| Issue any other invoice | Ask first | Over $500, matching the existing rule | Owner |
| Refund or credit | Ask first | Always | Owner |
| Chase an overdue invoice | Act | Standard dunning steps |  |
| Respond to a complaint | Ask first | Draft only | Owner |
| Reply to a public review | Ask first | Draft only | Owner |
| Hire, discipline, change pay | Never | Prepares material only | Owner |
| Sign a contract or permit application | Never | Prepares material only | License holder |
| Change an authority rule | Never |  | Owner |

**Rules that sit above the matrix**

- Nothing is sent to a customer outside permitted contact hours except replies to their own message.
- An action the operator is not confident about drops one tier.
- Every action is logged with its tier and can be reversed where the action allows it.
- The existing guide rule against auto-sending invoices over $500 is kept for discretionary invoices and relaxed only for milestone invoices that match a signed schedule.
- The owner can pause all autonomous actions for the tenant with one switch, using the existing `agent_config.enabled` flag.

## Open items

These are the inputs only Santosh can supply and the facts that need checking before the phase that depends on them.

**Needed from Santosh**

- [ ] **Phase 1:** Start A2P 10DLC registration for the bathroom number now. Decide between a Retell-provided number and an existing compliant Twilio number.
- [ ] **Phase 1:** Resolved Nov 21: Retell messaging is not built. The repo is the source of truth, so Phase 1 builds it from scratch.
- [ ] **Phase 1:** Service-area ZIP list and consultation hours.
- [ ] **Phase 1:** Who takes escalations in the first month, and their phone number.
- [ ] **Phase 2:** The full price book, with material list and labor hours per package.
- [ ] **Phase 2:** E-signature provider. None is integrated today.
- [ ] **Phase 2:** The lending partner and how applications are handed off (link, API or manual).
- [ ] **Phase 2:** A California construction attorney to approve the contract template.
- [ ] **Phase 2:** The middle milestone amounts in the payment schedule.
- [ ] **Phase 3:** Confirm the phase template against how crews build a tub-to-shower conversion.
- [ ] **Phase 3:** Which cities are worked first, for the permit rules table.
- [ ] **Phase 4:** Sign off or change the dollar limits in the authority matrix.
- [ ] **Phase 5:** Loaded hourly cost per installer role.
- [ ] **All:** Brand name at launch, GGB Express Bathrooms or Recast.

**To verify before building**

- **Follow-up texts in an existing Retell conversation.** Reported as unsupported in Retell's community forum. If still true, the follow-up cadence uses a new conversation per touch.
- **Which models Retell agents can run.** This sets the quality and cost of live conversations and is separate from the models Airbase calls.
- **Current Claude model IDs and prices** for the `llm-router` registry.
- **BuildersBooks posting interface.** The accounting repo was not reviewed for this spec. It needs a read before Phase 5 is detailed.
- **What is live.** This spec comes from reading code. Which functions are deployed, which Retell agents exist and whether Steward runs on this build were not checked.
- **Contact-hour and consent rules** for outbound calls and texts, confirmed with counsel alongside the contract template.

## Sources

- Airbase repository `santoshraghunath-2/airbase`, commit `ecce9cf`, read Nov 21, 2026
- [Retell: Enable SMS](https://docs.retellai.com/deploy/enable-sms)
- [Retell: Secure webhook](https://docs.retellai.com/features/secure-webhook)
- [CSLB: What is a contract](https://www.cslb.ca.gov/Consumers/Hire_A_Contractor/Home_Improvement_Contracts/What_Is_A_Contract.aspx)
- [CSLB: Sample home improvement contract](https://www.cslb.ca.gov/Resources/GuidesAndPublications/2025/SAMPLE%20HOME%20IMPROVEMENT%20CONTRACT.pdf)

The Retell and CSLB points were taken from those pages and search results on Nov 21, 2026. The contract rules are a summary for engineering, not legal advice.
