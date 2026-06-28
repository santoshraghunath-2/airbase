# Airbase — Backlog

Features not yet in scope. Do not build these until the phase is activated.

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
- Membership tiers + recurring billing
- Multi-option estimate builder (good/better/best)
- Customer financing (Wisetack)
- Customer portal (view history, pay, schedule)
- Job profitability analytics
- Weekly AI owner briefing email

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
