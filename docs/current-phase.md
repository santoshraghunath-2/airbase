# Current Active Phase

**Phase: 2 — AI Operations Layer**
**Started:** [fill in date]
**Target completion:** [fill in date, ~4 months out]

> ⚡ Phase 1 (Core Loop) is COMPLETE. Steward Home Services is running on it.
> We are now building the AI agents that are the core value prop.

## Phase 2 Priority Order

Build in this sequence — each item unblocks the next:

### Sprint 1 — Agent Infrastructure (Week 1–2)
- [x] `agent_actions` table migration (log all agent decisions + reasoning)
- [x] `agent_config` table (per-tenant thresholds, auto-execute flags) — migration 013
- [x] `skills` taxonomy migration (replace freeform tags with structured enum) — migration 014
- [x] LLM router (`_shared/llm-router.ts`) — typed, multi-provider, with tool schema translation
- [x] Agent base pattern (`_shared/agent-base.ts`) — `loadAgentContext`, `finalizeAction`, `shouldAutoExecute`, `validateServiceRoleAuth`

### Sprint 2 — Dispatch Agent (Week 3–5)
- [x] Dispatch agent Edge Function (`/supabase/functions/dispatch-agent/`)
- [x] System prompt: `/prompts/dispatch-agent.md`
- [x] Google Maps Distance Matrix integration (drive-time scoring)
- [x] Dispatch board AI panel (proposed assignments with rationale)
- [x] Accept/reject UI → feedback logged to agent_actions
- [x] Auto-execute path (when confidence ≥ threshold)

### Sprint 3 — Booking Agent SMS (Week 6–8)
- [x] Twilio inbound SMS webhook → booking agent Edge Function
- [x] Booking agent: customer lookup, job classification, availability check, create job
- [x] System prompt: `/prompts/booking-agent.md`
- [x] Booking agent dashboard view (active conversations, outcomes)
- [x] Human escalation flow (hand off to CSR with context summary)

### Sprint 4 — Invoice Agent (Week 9–11)
- [x] Invoice agent Edge Function (triggered on job close)
- [x] System prompt: `/prompts/invoice-agent.md`
- [x] Anomaly detection logic (compare to job type baselines)
- [x] Auto-send path for clean invoices
- [x] Invoice review queue for flagged invoices

### Sprint 5 — Operator Agent + Tech Assistant (Week 12–16)
- [x] Operator command panel (floating chat on all operator screens)
- [x] Operator agent Edge Function with full DB read tools
- [x] System prompt: `/prompts/operator-agent.md`
- [x] Proactive anomaly alerts (auto-runs check_anomalies on first panel open)
- [x] Tech assistant chat tab in PWA
- [x] Equipment manual ingestion → pgvector chunks (migration 016)
- [x] System prompt: `/prompts/tech-assistant.md`
- [x] AI pricebook import (PDF/CSV → Claude → review → confirm)

### Sprint 6 — Booking Agent Voice (Week 14–18, parallel with Sprint 5)
- [ ] Twilio Voice inbound → streaming Claude → TTS response
- [ ] Voice booking agent system prompt
- [ ] Call recording → transcript → job notes

### Sprint 6 — Quick Win AI bolt-ons (approved for Phase 2)

Low-effort, high-impact agents that reuse existing Phase 2 infra.
Build after Sprint 5 completes, or in parallel if capacity allows.

- [ ] **ETA notification agent** — SMS customer when tech status → `en_route`; include tech name + ETA; detect and notify if prior job runs long (Twilio trigger on job status change)
- [ ] **Review request agent** — SMS customer 30 min after job → `completed`; personalized with tech name + direct Google listing link (Twilio + 30-min delay)
- [ ] **Warranty / callback detector** — on new job creation, check same customer + overlapping job type within 30 days; auto-waive service call fee, prefer same tech assignment

## What Is NOT In Phase 2

Do not build these yet. Add to `backlog.md` if requested:
- Memberships and recurring billing
- Multi-option estimates
- Customer portal
- Marketing campaigns
- Inventory / fleet
- Multi-location hierarchy

## Phase 2 Done When

All checkboxes above are checked AND:
- Dispatch agent auto-assigns ≥70% of Steward jobs without dispatcher touch
- Booking agent handles ≥60% of Steward inbound SMS bookings end-to-end
- Invoice agent auto-sends within 5 min of job close for ≥80% of standard jobs
- Operator can query any live business data in natural language
- 3 external accounts are using Phase 2 features in production
