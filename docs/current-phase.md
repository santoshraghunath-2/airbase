# Current Active Phase

**Phase: 2 — AI Operations Layer**
**Started:** [fill in date]
**Target completion:** [fill in date, ~4 months out]

> ⚡ Phase 1 (Core Loop) is COMPLETE. Steward Home Services is running on it.
> We are now building the AI agents that are the core value prop.

## Phase 2 Priority Order

Build in this sequence — each item unblocks the next:

### Sprint 1 — Agent Infrastructure (Week 1–2)
- [ ] `agent_actions` table migration (log all agent decisions + reasoning)
- [ ] `agent_config` table (per-tenant thresholds, auto-execute flags)
- [ ] `skills` taxonomy migration (replace freeform tags with structured enum)
- [ ] Claude API wrapper utility (`/lib/claude.ts`) — typed, with retry logic
- [ ] Agent base pattern — shared Edge Function boilerplate with logging

### Sprint 2 — Dispatch Agent (Week 3–5)
- [ ] Dispatch agent Edge Function (`/supabase/functions/dispatch-agent/`)
- [ ] System prompt: `/prompts/dispatch-agent.md`
- [ ] Google Maps Distance Matrix integration (drive-time scoring)
- [ ] Dispatch board AI panel (proposed assignments with rationale)
- [ ] Accept/reject UI → feedback logged to agent_actions
- [ ] Auto-execute path (when confidence ≥ threshold)

### Sprint 3 — Booking Agent SMS (Week 6–8)
- [ ] Twilio inbound SMS webhook → booking agent Edge Function
- [ ] Booking agent: customer lookup, job classification, availability check, create job
- [ ] System prompt: `/prompts/booking-agent.md`
- [ ] Booking agent dashboard view (active conversations, outcomes)
- [ ] Human escalation flow (hand off to CSR with context summary)

### Sprint 4 — Invoice Agent (Week 9–11)
- [ ] Invoice agent Edge Function (triggered on job close)
- [ ] System prompt: `/prompts/invoice-agent.md`
- [ ] Anomaly detection logic (compare to job type baselines)
- [ ] Auto-send path for clean invoices
- [ ] Invoice review queue for flagged invoices

### Sprint 5 — Operator Agent + Tech Assistant (Week 12–16)
- [ ] Operator command panel (floating chat on all operator screens)
- [ ] Operator agent Edge Function with full DB read tools
- [ ] System prompt: `/prompts/operator-agent.md`
- [ ] Proactive anomaly alerts (push notification when agent detects issues)
- [ ] Tech assistant chat tab in PWA
- [ ] Equipment manual ingestion → pgvector chunks
- [ ] System prompt: `/prompts/tech-assistant.md`
- [ ] AI pricebook import (PDF/CSV → Claude → review → confirm)

### Sprint 6 — Booking Agent Voice (Week 14–18, parallel with Sprint 5)
- [ ] Twilio Voice inbound → streaming Claude → TTS response
- [ ] Voice booking agent system prompt
- [ ] Call recording → transcript → job notes

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
