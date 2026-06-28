# Airbase — Test Scenarios

> Covers everything seeded in `supabase/seed/steward.sql` and all Phase 1 + Voice Module features.
> Goal: verify Airbase's core value prop — a home services company running as autonomously as possible.

---

## Before You Start — Wire Auth Accounts

The seed inserts `users` rows with `auth_id = NULL`. Supabase Auth is separate.
Until `auth_id` is linked, `get_my_tenant_id()` returns `NULL` and every RLS-guarded
query returns zero rows.

**Steps:**

1. Go to Supabase dashboard → Authentication → Add user for each email below.
2. Copy the generated auth UUID, then run:

```sql
UPDATE users SET auth_id = '<uuid>' WHERE email = 'alex@stewardhomeservices.com';
UPDATE users SET auth_id = '<uuid>' WHERE email = 'maria@stewardhomeservices.com';
UPDATE users SET auth_id = '<uuid>' WHERE email = 'jkim@stewardhomeservices.com';
UPDATE users SET auth_id = '<uuid>' WHERE email = 'crivera@stewardhomeservices.com';
UPDATE users SET auth_id = '<uuid>' WHERE email = 'ppatel@stewardhomeservices.com';
```

You only need `alex` and `maria` to run most scenarios. Add the tech accounts when testing Scenario 3.

---

## Seeded Data Reference

**Tenant:** Steward Home Services · ID `a1b2c3d4-0000-0000-0000-000000000001`

### Users

| Name | Email | Role |
|---|---|---|
| Alex Steward | alex@stewardhomeservices.com | owner |
| Maria Lopez | maria@stewardhomeservices.com | dispatcher |
| James Kim | jkim@stewardhomeservices.com | technician |
| Carlos Rivera | crivera@stewardhomeservices.com | technician |
| Priya Patel | ppatel@stewardhomeservices.com | technician |

### Technician Skills

| Tech | Skills |
|---|---|
| James Kim | plumbing_drain (expert), water_heater_repair (expert), plumbing_service (expert) |
| Carlos Rivera | drain_cleaning (expert), plumbing_service (proficient), general_maintenance (proficient) |
| Priya Patel | water_heater_install (expert), plumbing_service (proficient), hvac_service (learning) |

### Seeded Jobs (today's board)

| Customer | Job Type | Status | Tech | Priority |
|---|---|---|---|---|
| Robert Chen | drain_cleaning | dispatched | James Kim | normal |
| Sarah Johnson | water_heater_repair | en_route | Carlos Rivera | high |
| Michael Torres | plumbing_service | **unassigned** | — | **emergency** |
| Linda Nguyen | drain_cleaning | **unassigned** | — | normal |
| David Park | general_maintenance | in_progress | Priya Patel | normal |
| Jennifer Wu | water_heater_install | scheduled (tomorrow) | Priya Patel | normal |
| Mark Anderson | drain_cleaning | scheduled (tomorrow) | James Kim | normal |
| Amy Martinez | plumbing_service | completed | James Kim | normal |
| Thomas Lee | drain_cleaning | completed | Carlos Rivera | normal |
| Patricia White | water_heater_repair | invoiced | Priya Patel | normal |

### Built Screens

| Screen | Path | Roles |
|---|---|---|
| Login | `/login` | All |
| Dashboard | `/` | Owner, dispatcher |
| Dispatch board | `/dispatch` | Dispatcher |
| New job / booking | `/jobs/new` | Dispatcher |
| Customer list + detail | `/customers` | All |
| Pricebook | `/pricebook` | Owner |
| Invoice list | `/invoices` | Owner, dispatcher |
| Invoice builder | `/invoices/:id` | Dispatcher |
| Tech PWA | `/tech` | Technician |

---

## Scenario 1 — Unassigned Emergency on the Dispatch Board

**Login as:** Maria Lopez (dispatcher)  
**Path:** `/dispatch`

### Steps
1. Open the dispatch board. Observe today's 5 jobs across 3 tech columns.
2. Find **Michael Torres — "Burst pipe"** — `unassigned`, `emergency` priority.
3. Manually drag it to James Kim's column and confirm the assignment.
4. Observe the job card updates (status → dispatched, tech name populated).

### What to verify
- [ ] Emergency job shows distinct priority styling
- [ ] Drag-and-drop assigns correctly
- [ ] Tech column reflects the new job immediately

### The AI promise
This drag should eventually never happen. The dispatch agent scores James as the right
pick (plumbing_service expert + closest drive time via Google Maps Distance Matrix) and
proposes the assignment within seconds of the job being created — auto-executing if
confidence ≥ threshold, or surfacing a one-click approval card if below it.

---

## Scenario 2 — Book a Job from Scratch

**Login as:** Maria Lopez (dispatcher)  
**Path:** `/jobs/new`

### Steps
1. Search for customer **Robert Chen**. Select his address (100 Willow Ave, San Jose).
2. Job type: `drain_cleaning`. Description: "Kitchen sink completely backed up."
3. Priority: `high`. Schedule for today, 2 hours from now.
4. Save. Confirm the job appears on the dispatch board as unassigned.

### What to verify
- [ ] Customer lookup works, address auto-populates
- [ ] Job appears on dispatch board in real time after saving
- [ ] Job is correctly unassigned (no tech yet)

### The AI promise
The booking agent will eventually handle the inbound call from Robert, classify
the job type, check tech availability, create this job, and send a confirmation SMS —
all without Maria touching anything. The CSR role disappears.

---

## Scenario 3 — Tech's Day on the PWA

**Login as:** James Kim (technician) in one tab · Maria Lopez (dispatcher) in another  
**Path:** `/tech` (tech) · `/dispatch` (dispatcher)

### Steps
1. James opens `/tech`. He should see his assigned jobs for today.
2. Tap **drain cleaning for Robert Chen**. Review job details, customer info, and address.
3. Tap **"En route"** — confirm the dispatch board in Maria's tab shows the status change in real time.
4. Tap **"On site"**.
5. Tap **"Complete job"**.
6. Confirm the job moves to `completed` on the dispatch board.

### What to verify
- [ ] Tech sees only his own jobs (RLS is working)
- [ ] Status transitions are reflected on the dispatch board without refresh
- [ ] Job history is updated with timestamps

### The AI promise
On job complete, the invoice agent fires automatically. It reads the job type,
looks up pricebook baselines for drain cleaning, drafts the invoice, and
auto-sends it if the total is within normal range for that job type.
Continue to Scenario 4 to build the invoice manually for now.

---

## Scenario 4 — Invoice Builder and the Anomaly Case

**Login as:** Maria Lopez (dispatcher)  
**Path:** `/invoices`

### Part A — Standard invoice
1. Open the invoice for **Amy Martinez** (completed: "Fixed leaking kitchen faucet").
2. Add line items: Service Call ($99) + Leak Repair Minor ($200) + Parts Flapper Kit ($15).
3. Total should be **$314**. Review and send.
4. Confirm invoice status changes to `sent`.

### Part B — Anomaly test (once invoice agent is live)
1. Create a new job: drain cleaning for any customer.
2. Mark it complete.
3. In the invoice builder, add a **Water Heater Installation — 50 gal ($1,400)** line item.
4. The invoice agent should flag this as anomalous (water heater install on a drain job)
   and hold it in `review_required` instead of auto-sending.

### What to verify
- [ ] Line items calculate correctly
- [ ] Invoice number auto-generates (INV-YYYY-NNNNN format)
- [ ] Status transitions: draft → sent
- [ ] (Future) Anomaly flag appears for the mismatched line item

---

## Scenario 5 — Dispatch Board Under Load

**Login as:** Maria Lopez (dispatcher)  
**Path:** `/dispatch` + `/jobs/new`

### Steps
1. Open the dispatch board. Note that **Carlos Rivera has no jobs today**.
2. Create two new jobs back-to-back from `/jobs/new`:
   - **Job A:** Drain cleaning, San Jose customer, normal priority, today
   - **Job B:** Water heater repair, Sunnyvale customer, normal priority, today
3. Both appear as unassigned on the board.
4. Manually assign: Carlos → Job A (drain, San Jose), Priya → Job B (water heater, Sunnyvale).

### What to verify
- [ ] Multiple unassigned jobs stack correctly on the board
- [ ] Manual assignment works for both
- [ ] Board re-balances visually across tech columns

### The AI promise
The dispatch agent handles this automatically: it runs a skill × drive-time score
for each tech × job combination. Carlos gets the San Jose drain job (his expertise,
closer). Priya gets the Sunnyvale water heater (her specialty). No dispatcher touch.
The board moves from chaos to covered in under 10 seconds.

---

## Scenario 6 — Voice Module End-to-End (GGB Express)

**Requires:** Voice server running + ngrok + Twilio numbers configured (see `SETUP-CHECKLIST.md`)

### Setup
```bash
# 1. Seed voice_agent_config (if not done yet)
cd src/modules/voice
SEED_TENANT_ID=a1b2c3d4-0000-0000-0000-000000000001 node server/db/seed.js

# 2. Start the voice server
npm install
node server/index.js

# 3. In a second terminal
ngrok http 3001
```
Set the GGB Express Twilio number voice webhook → `https://<ngrok-url>/voice/inbound`  
Set the status callback → `https://<ngrok-url>/voice/status`

### Test A — Qualified lead → booking
1. Call the GGB Express Twilio number from your cell.
2. Alex picks up, introduces herself, mentions the call is being recorded.
3. Run through the full flow:
   - Project: "Full bathroom remodel"
   - Budget: "Around $20,000"
   - Timeline: "Hoping to start in the next 3 months"
   - Name + ZIP: yours (use a Bay Area ZIP, e.g. 94025)
4. Alex books the consultation and offers to text you a confirmation.
5. Confirm you receive the SMS.

**What to verify:**
- [ ] Alex picks up within 2–3 seconds
- [ ] Conversation follows GREETING → QUALIFY_PROJECT → QUALIFY_BUDGET → QUALIFY_TIMELINE → QUALIFY_CONTACT → BOOK_OR_CLOSE
- [ ] SMS confirmation arrives
- [ ] `voice_calls` row in Supabase has full transcript + outcome = `booked`
- [ ] `voice_leads` row has your name, phone, ZIP, project_type, qualified = `true`, booked_at set

### Test B — Disqualified lead (budget)
1. Call again. This time give a budget of "$3,000."
2. Alex should acknowledge the budget is below her range, decline to push, and close warmly.

**What to verify:**
- [ ] Alex does not attempt to book
- [ ] `voice_leads` row created with qualified = `false`
- [ ] `voice_calls` outcome = `not_qualified`

### Test C — Escalation
1. Call and mid-conversation say "I'd like to speak to a real person."
2. Alex should immediately use the `escalate_to_human` tool and transfer.

**What to verify:**
- [ ] Escalation happens without delay
- [ ] `voice_calls` outcome = `escalated_human`

### Test D — Outbound form-fill callback
```bash
curl -X POST https://<ngrok-url>/voice/outbound-trigger \
  -H "Content-Type: application/json" \
  -d '{
    "source": "ggb_express_website",
    "name": "Test Lead",
    "phone": "+1YOUR_CELL",
    "email": "test@example.com",
    "zip": "94025",
    "project": "master bathroom remodel",
    "secret": "<VOICE_WEBHOOK_SECRET>"
  }'
```
Your phone should ring within ~10 seconds. Answer and run through the qualifying flow.

---

## The Steward Test

> *"Can the Steward Home Services dispatcher use this to book, dispatch, and close a real plumbing job right now?"*

- [ ] Job booked via `/jobs/new` in under 60 seconds
- [ ] Job appears on dispatch board and is assignable to a tech
- [ ] Tech advances status on PWA: en-route → on-site → complete
- [ ] Invoice built from pricebook items and sent to customer
- [ ] Dispatch board reflects all status changes in real time without refresh
- [ ] Voice call answers 24/7, qualifies caller, and books consultation without any human involvement

When all boxes are checked, Phase 1 + Voice Module are shippable.

---

## Phase 2 AI Scenarios (not yet testable — track progress here)

These become testable as Sprint 2–6 agents are built:

- [ ] **Dispatch agent auto-assign** — new unassigned job → agent proposes tech within 10s → one-click approve
- [ ] **Booking agent SMS** — text "I need a plumber" to Steward's Twilio number → agent books a job, no human
- [ ] **Invoice agent auto-send** — job closes → invoice drafted and sent within 5 min, no dispatcher touch
- [ ] **Operator chat** — ask "Who's available tomorrow afternoon?" and get a live answer from the DB
- [ ] **Anomaly alert** — invoice flagged for mismatched job type, pushed to operator for review
