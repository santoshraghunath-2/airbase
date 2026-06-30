# Current Active Phase

**Phase: 3 — Revenue Intelligence**
**Started:** 2026-06-29
**Target completion:** ~4 months out (2026-10-31)

> ⚡ Phase 2 (AI Operations Layer) code is COMPLETE.
> All agents built: dispatch, booking SMS + voice, invoice, operator, tech assistant, ETA/review/warranty bolt-ons.
> Operational metrics will accumulate on Steward over the coming weeks.
> We are now building the revenue-growth layer.

## Phase 3 Priority Order

Build in this sequence:

### Sprint 1 — Membership Foundation (Week 1–3)
- [x] `021_memberships.sql` — `membership_plans` + `memberships` tables, RLS
- [x] Membership Plans page — CRUD for tier definitions (name, price, billing cycle, benefits)
- [x] Customer enrollment — enroll/cancel/renew from the Memberships page
- [ ] Membership status badge on job detail (free service call, priority dispatch, discount)
- [ ] Membership agent Edge Function — nightly sweep: 60/30/7-day pre-expiry SMS outreach
- [ ] System prompt: `/prompts/membership-agent.md`
- [ ] Auto-renewal logic (Stripe recurring subscription creation)
- [ ] Win-back sequences: 7/30/90-day post-lapse outreach

### Sprint 2 — Estimates (Week 4–6)
- [ ] `022_estimates.sql` — `estimates` + `estimate_line_items` tables
- [ ] Estimate builder — good / better / best three-option presentation
- [ ] AI upsell engine — suggest add-ons based on equipment age + job type
- [ ] Estimate → job conversion tracking
- [ ] Customer financing via Wisetack API (optional add-on at estimate time)

### Sprint 3 — Customer Portal (Week 7–9)
- [ ] `023_portal.sql` — `portal_invitations` table, magic-link auth
- [ ] Customer portal: view job history, pay invoice, request appointment, view equipment
- [ ] Portal link auto-sent with invoice (alongside payment link)

### Sprint 4 — Analytics & Intelligence (Week 10–14)
- [ ] Job profitability analytics — margin by tech, zone, job type, customer
- [ ] Marketing campaigns — AI-drafted, operator-reviewed, scheduled sends (email/SMS)
- [ ] Google/Yelp review solicitation routing by satisfaction score
- [ ] Weekly AI business briefing — auto-generated Monday morning summary email to owner

## What Is NOT In Phase 3

- Multi-location hierarchy → Phase 4
- Inventory / fleet → Phase 4
- Native iOS/Android app → Phase 4
- Open API → Phase 4
- Supplier marketplace → Phase 5

## Phase 3 Done When

All Sprint 1–4 checkboxes checked AND:
- ≥20% of Steward customers enrolled in a membership plan
- Estimate close rate trackable (baseline established)
- Owner receives weekly AI briefing every Monday
- At least 5 external accounts on Phase 3 features
