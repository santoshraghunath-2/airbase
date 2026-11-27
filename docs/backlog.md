# Airbase — Backlog

Features not yet in scope. Do not build these until the phase is activated.

---

## Remodel tenant — Retell setup (manual, one-time)

Do these in the Retell dashboard before the remodel lead responder can go live.
All tool schemas are in `supabase/functions/_shared/retell-tools.ts`.
All agent prompts are in `prompts/remodel-voice-agent.md` and `prompts/remodel-sms-agent.md`.

### 1. Create the Voice Agent
- Agent type: **Custom LLM**
- Webhook URL: `https://ghixuuhxwtsrbfwwtybx.supabase.co/functions/v1/retell-voice-webhook`
- Dynamic variables: `company_name`
- Add all 6 tools: `lookup_customer`, `qualify_lead`, `check_consult_availability`, `book_consultation`, `save_lead`, `escalate_to_human`
- Paste system prompt from `prompts/remodel-voice-agent.md`
- Copy the **Agent ID** → update `supabase/seed/remodel-tenant.sql` (voice PLACEHOLDER)

### 2. Create the SMS Agent
- Agent type: **Custom LLM (SMS)**
- Webhook URL: `https://ghixuuhxwtsrbfwwtybx.supabase.co/functions/v1/retell-chat-webhook`
- Dynamic variables: `company_name`
- Same 6 tools as voice agent
- Paste system prompt from `prompts/remodel-sms-agent.md`
- Copy the **Agent ID** → update `supabase/seed/remodel-tenant.sql` (SMS PLACEHOLDER)

### 3. Purchase a phone number
- Buy a number in Retell and assign it to the Voice Agent
- Copy the number → update `supabase/seed/remodel-tenant.sql` (`retell_phone_number` PLACEHOLDER)

### 4. Seed the tenant
After filling all PLACEHOLDERs in `supabase/seed/remodel-tenant.sql`:
```
supabase db query --linked --file supabase/seed/remodel-tenant.sql
```

### 5. Register the pg_cron job for lead follow-up
Run once in the Supabase SQL editor (dashboard → SQL editor):
```sql
SELECT cron.schedule(
  'lead-follow-up',
  '0 */2 * * *',
  $$
    SELECT net.http_post(
      url := 'https://ghixuuhxwtsrbfwwtybx.supabase.co/functions/v1/lead-follow-up',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      )
    );
  $$
);
```

### 6. Wire up the web form intake
- After seeding, the `lead_intake_sources` row for `web-main` will have its `hmac_secret`
- Configure the website form to `POST` to:
  `https://ghixuuhxwtsrbfwwtybx.supabase.co/functions/v1/lead-intake?source=web-main`
- Include header `x-intake-signature` using the HMAC scheme from `_shared/retell-auth.ts`

### 7. Regenerate TypeScript types
```
supabase gen types typescript --project-id ghixuuhxwtsrbfwwtybx > src/types/database.types.ts
```

### 8. Verify the Retell chat function_call format (assumption check)
- Send a test SMS that triggers a tool call (e.g. say "I want to book a consultation")
- Check Retell dashboard webhook logs to confirm whether custom tool calls during chat
  emit a `function_call` event (the current implementation assumes they do)
- If they do NOT, update `retell-chat-webhook/index.ts` to handle the actual format

---

## Phase 2 — Quick Win AI bolt-ons (add before Phase 2 closes)

These reuse existing Phase 2 infra (Twilio SMS + job status triggers) and have the
highest effort-to-impact ratio in the entire product. Approved for Phase 2 sprint 6.

| Feature | Trigger | What it does | Score |
|---|---|---|---|
| **ETA / on-my-way notification** | job status → `en_route` | SMS to customer with tech name + estimated arrival; follow-up if job before runs long | 16/20 |
| **Review request automation** | job status → `completed` | Personalized SMS with tech name + direct Google/Yelp link, sent 30 min after close | 14/20 |
| **Warranty / callback detection** | new job created | Detects same customer + related job type within 30 days; waives service call fee, routes to original tech | 14/20 |

---

## Phase 3 (Revenue Intelligence)

### Weekly briefing — email delivery

Deliver the Monday briefing via email in addition to (or instead of) the in-app card.

- **SendGrid transactional email**: compose a styled HTML email from `briefings` row fields; send to tenant owner's email on briefing generation.
- **Tenant preference**: owner can opt out of email and view in-app only (Settings > Notifications).
- **Trigger**: after `weekly-briefing` edge function inserts the row, fire a `send-briefing-email` function.
- **Template**: plain, readable — headline bold at top, highlights as bullets, watch items in amber box, recommendation in italics.

Blocked on: none. Ready to build once in-app widget is validated.

### Weekly briefing — in-app push notification

Push a browser/PWA notification to the tenant owner when a new briefing is generated (Monday morning).

- Requires `push_subscriptions` table + Supabase Realtime subscription or Web Push API.
- Notification payload: `{ title: "Your weekly briefing is ready", body: briefing.headline }`.
- User must grant browser push permission (prompt after first briefing generation).

Blocked on: push subscription infrastructure (not yet built).

---

### AI/Manual toggle switches (settings)

Per-tenant settings toggles for any feature where AI auto-executes vs. requires operator approval:

| Feature | AI mode | Manual mode |
|---|---|---|
| Review request | Auto-send on job completion (new_request / parts_warranty) | Dispatcher clicks "Request Review" button |
| Dispatch suggestions | AI assigns, operator can override | AI proposes, dispatcher approves every assignment |
| Invoice auto-send | AI sends if confidence ≥ threshold | All invoices require dispatcher review |
| Membership outreach | AI sends pre-expiry SMS automatically | Operator reviews and sends each batch |

Build as `agent_config.auto_execute` boolean — this column already exists in `agent_config` table. UI needed: Settings page toggle row per agent type. Builds operator comfort during onboarding; can be loosened over time as trust is established.

---


### AI agents — prioritized

| Feature | What it does | Score | Notes |
|---|---|---|---|
| **Collections agent** | Graduated SMS/voice follow-up on overdue invoices; escalates to human on dispute | 17/20 | Highest combined score; eliminates most-dreaded manual task |
| **Membership renewal agent** | Identifies plans expiring in 30 days; SMS/voice pitch + Stripe renewal; handles objections | 16/20 | Same architecture as booking agent; pure incremental revenue |
| **Estimate + upsell engine** | Generates structured estimate from diagnosis notes + pricebook; surfaces upsell opportunities based on equipment age / job type | 15/20 | Extends invoice agent; highest revenue impact per job |
| **Proactive anomaly alerts** | AI watches business in background; pushes alerts for callback rate spikes, invoice lag, board imbalances — without being asked | 15/20 | Transforms Airbase from tool → ops partner; the long-term moat |
| **Win-back / dormant customer** | Scores customers by recency × LTV; reaches out to 18m+ dormant accounts with personalized SMS | 13/20 | Pure incremental revenue from existing asset |
| **Slow-day demand generation** | Detects thin board coverage early in the week; drafts + sends targeted promo to right customer segment | 13/20 | Converts sunk labor cost (idle tech time) into revenue |

### Core Phase 3 features (non-AI)

#### Memberships & Recurring Billing
Full membership lifecycle — the single highest-margin recurring revenue stream for a trades company.

**Database (new migrations)**
- `memberships` table — plan definitions: name, description, price, billing_cycle (monthly/annual), benefits JSONB, trade, is_active
- `customer_memberships` table — enrollment records: customer_id, plan_id, status (active/paused/lapsed/cancelled), stripe_subscription_id, start_date, next_renewal_date, card_on_file_last4
- Benefit rules stored as JSONB on plan: discount_pct, waived_fee_types (trip_charge, etc.), priority_scheduling, free_visits_per_year, parts_discount_pct

**Core UI**
- Membership Plans page (`/settings/memberships`) — CRUD for plan tiers (e.g. Silver $9.99/mo, Gold $19.99/mo)
- Customer Memberships tab on CustomerDetailPage — active plan, renewal date, benefits summary, enroll/cancel
- Enroll flow — select plan, collect card (Stripe Payment Element), confirm → Stripe subscription → write customer_memberships row
- Memberships list page (`/memberships`) — all active/lapsed members, MRR widget, renewal calendar

**Stripe integration**
- Create Stripe Product + Price for each plan on save
- Subscription lifecycle: create on enroll, cancel on cancel, handle `invoice.payment_failed` (pause + notify), `customer.subscription.deleted` (mark lapsed)
- Card-on-file update flow (Stripe Setup Intent)

**Benefits applied at runtime**
- `invoice-agent` checks `customer_memberships` when drafting — applies discount_pct, waives trip charge automatically
- Dispatch agent gives priority scheduling to members (higher score in assignment ranking)
- Job booking form shows member badge + active benefits on customer lookup

**Membership agent (Edge Function)**
- Nightly cron — finds memberships expiring in 60 / 30 / 7 days
- Sends personalized renewal reminder SMS (Claude drafts, operator previews first send)
- On lapse: 7 / 30 / 90-day win-back sequences
- Auto-sends on subsequent contacts once operator sets opt-in flag per customer

**Out of scope for membership MVP**
- Multi-membership per customer, commercial/site-wide plans, gifting, mid-cycle proration (Phase 4+)

#### Other Phase 3 features
- Multi-option estimate builder (good/better/best)
- Customer financing (Wisetack)
- Customer portal (view history, pay, schedule)
- Job profitability analytics
- Weekly AI owner briefing email

---

## Phase 4 — Remodel track: manual production setup

### pg_cron jobs (run once in Supabase SQL editor after applying migrations)

#### 1. Ops sweep — hourly 7am–8pm PST
```sql
SELECT cron.schedule(
  'ops-sweep-hourly',
  '0 15-23,0-4 * * *',
  $$ SELECT net.http_post(
       url     := current_setting('app.settings.supabase_url') || '/functions/v1/ops-sweep',
       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')),
       body    := '{}'::jsonb
     ) $$
);
```

#### 2. Ops sweep — every 4 hours overnight (PST midnight–7am)
```sql
SELECT cron.schedule(
  'ops-sweep-overnight',
  '0 5,9 * * *',
  $$ SELECT net.http_post(
       url     := current_setting('app.settings.supabase_url') || '/functions/v1/ops-sweep',
       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')),
       body    := '{}'::jsonb
     ) $$
);
```

#### 3. Page-on-call rollover — every 11 minutes
```sql
SELECT cron.schedule(
  'page-on-call-rollover',
  '*/11 * * * *',
  $$ SELECT net.http_post(
       url     := current_setting('app.settings.supabase_url') || '/functions/v1/page-on-call',
       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')),
       body    := '{"mode":"rollover"}'::jsonb
     ) $$
);
```

> All three go in the **Supabase dashboard → SQL editor** after migrations 063–066 are applied.
> `app.settings.supabase_url` and `app.settings.service_role_key` must already be set as app settings in your Supabase project (they are set by Supabase Cloud automatically on managed projects).

---

### PLACEHOLDER values to confirm before going live

All are in `supabase/seed/remodel-tenant.sql`. Run `grep -n PLACEHOLDER supabase/seed/remodel-tenant.sql` to find exact line numbers.

| # | File / location | Placeholder | What to put there |
|---|---|---|---|
| 1 | `seed/remodel-tenant.sql` line ~24 | `00000000-0000-0000-0000-000000000002` (tenant UUID) | Keep as-is for dev; replace with `gen_random_uuid()` for production |
| 2 | `seed/remodel-tenant.sql` | `PLACEHOLDER_CSLB_LICENSE` | RECAST California's CSLB license number (e.g. `1012345`) |
| 3 | `seed/remodel-tenant.sql` | `PLACEHOLDER_E164_RETELL_NUMBER` | Retell-purchased phone number in E.164 format (e.g. `+14155550100`) |
| 4 | `seed/remodel-tenant.sql` | `PLACEHOLDER_CONTACT_EMAIL` | Tenant contact email (e.g. `hello@recastcalifornia.com`) |
| 5 | `seed/remodel-tenant.sql` | `PLACEHOLDER_CONTACT_PHONE` | Tenant contact phone in E.164 (e.g. `+14155550101`) |
| 6 | `seed/remodel-tenant.sql` | `PLACEHOLDER_WEBSITE` | Tenant website URL (e.g. `https://recastcalifornia.com`) |
| 7 | `seed/remodel-tenant.sql` | `PLACEHOLDER_CONSULTANT_1_NAME` | First comfort advisor's display name |
| 8 | `seed/remodel-tenant.sql` | `PLACEHOLDER_CONSULTANT_1_PHONE` | First comfort advisor's phone (E.164) |
| 9 | `seed/remodel-tenant.sql` | `PLACEHOLDER_CONSULTANT_1_EMAIL` | First comfort advisor's email |
| 10 | `seed/remodel-tenant.sql` | `PLACEHOLDER_CONSULTANT_2_NAME/PHONE/EMAIL` | Second comfort advisor's details |
| 11 | `seed/remodel-tenant.sql` | `PLACEHOLDER_RETELL_VOICE_AGENT_ID` | Retell dashboard → Agents → voice agent → Agent ID |
| 12 | `seed/remodel-tenant.sql` | `PLACEHOLDER_RETELL_SMS_AGENT_ID` | Retell dashboard → Agents → SMS/chat agent → Agent ID |
| 13 | `seed/remodel-tenant.sql` | `PLACEHOLDER_HMAC_SECRET_32_CHARS_MIN` | Generate with `openssl rand -hex 32` |
| 14 | `seed/remodel-tenant.sql` | Vanity line item price (`0`) | Set per-quote; update seed or insert a real price if a standard starting price is agreed |
| 15 | `seed/remodel-tenant.sql` (Phase 4 authority rules) | `send_change_order` limit `75000` cents | Confirm $750 limit with Santosh; update row if different |
| 16 | `seed/remodel-tenant.sql` (Phase 4 authority rules) | `place_material_order` limit `50000` cents | Confirm $500 limit with Santosh; update row if different |
| 17 | `seed/remodel-tenant.sql` (Phase 4 authority rules) | `create_invoice_for_milestone` limit `50000` cents | Confirm $500 limit with Santosh; update row if different |

> Items 15–17 also need to be updated directly in the `authority_rules` production table row if the seed is not re-run.

---

## Phase 4 (Enterprise)

### AI agents

| Feature | What it does | Score | Notes |
|---|---|---|---|
| **Voice-to-structured job notes** | Tech speaks diagnosis at job close; AI converts to structured notes (symptoms, root cause, repair, parts, recommendations) | 14/20 | Quality multiplier for every other AI feature; requires UX decision |
| **Parts lookup + PO automation** | Tech requests part by voice/text; AI checks supplier stock + price, presents options, generates PO on approval | 13/20 | Needs supplier catalog layer; dispatcher saves 30–45 min/day |
| **Dynamic pricing** | Adjusts pricing based on time of day, board load, job urgency, and customer history | 11/20 | High revenue upside; requires operator policy buy-in |

### Core Phase 4 features (non-AI)
- Multi-location / MSO hierarchy
- Commercial multi-site billing
- Inventory module (truck stock, POs, warehouse)
- Fleet tracking (GPS, maintenance, fuel)
- Advanced payroll (commissions, spiffs)
- Gusto integration
- React Native mobile apps (iOS + Android)
- Full accounting module (P&L, job costing)
- Open API + webhooks
- Zapier integration
- White-label mode

---

## Phase 5 (Platform)
- Supplier marketplace (enables parts lookup agent at scale)
- Cross-account benchmarking (powers industry anomaly detection)
- Agent marketplace
- Predictive maintenance engine
- Custom AI agent builder
- Industry fine-tuned model

---

## Scoring reference

Features scored across four dimensions (1–5 each, max 20):
- **R** Revenue impact — moves subscriber's top line
- **T** Time freed — hours/week recovered per FTE
- **X** Anxiety eliminated — removes dread from a human's day
- **E** Build ease — 5 = reuses existing infra, 1 = new tech required
