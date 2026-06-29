# Airbase — Project Constitution

> AI-native field service management for plumbing, HVAC, and electrical companies.
> This file is read by Claude Code at the start of every session. Keep it loaded.

---

## What Airbase Is

Airbase is an AI-first operating system for trades companies (plumbing, HVAC, electrical).
It replaces ServiceTitan's manually-operated workflows with autonomous AI agents.
Every function a dispatcher, CSR, or office manager does today — Airbase infers, proposes, and executes.

**The company running on it:** Steward Home Services (plumbing/home services, Bay Area).
Steward is the production pilot. Every feature must work for Steward before it ships to anyone else.

**The core differentiation over ServiceTitan:**
- AI agents replace manual dispatch, booking, invoicing, and membership renewal
- Natural language operator interface (no menu-diving)
- $499/location/month flat — not $300–500/tech/month
- Month-to-month, no lock-in, full data export always available

---

## Tech Stack — Non-Negotiable

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS, shadcn/ui |
| Mobile (tech app) | PWA first (Phase 1–2), React Native in Phase 4 |
| Backend / DB | Supabase (Postgres + Edge Functions + Realtime + RLS) |
| AI / Agents | Multi-provider LLM router (`llm-router.ts`) — Anthropic Claude *(default)*, OpenAI, DeepSeek, Kimi |
| Voice/SMS | Twilio (Voice + SMS + Conversations) |
| Payments | Stripe + Stripe Terminal |
| Accounting sync | QuickBooks Online API |
| Routing/Maps | Google Maps Platform (Distance Matrix, Geocoding) |
| Email | SendGrid (transactional) |
| Deployment | Netlify (frontend), Supabase Cloud (backend) |
| CI/CD | GitHub Actions |

**Never suggest:** Next.js, Prisma, MongoDB, Firebase, AWS, Vercel (we use Netlify).
**Always use:** Supabase Edge Functions (Deno) for serverless logic, not Express/Node servers.

---

## Database Conventions

- All tables use `snake_case`
- Every tenant-scoped table has a `tenant_id UUID NOT NULL REFERENCES tenants(id)`
- Use Row-Level Security (RLS) on every table — no exceptions
- Primary keys: `id UUID DEFAULT gen_random_uuid()`
- All timestamps: `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()`
- Soft deletes: `deleted_at TIMESTAMPTZ NULL` (never hard-delete customer/job data)
- AI agent actions log to `agent_actions` table with `reasoning JSONB` column
- Every agent action must be reversible and have a `reversed_by` FK path

**Naming:**
- Tables: plural nouns (`jobs`, `technicians`, `invoices`)
- Junction tables: `entity_a_entity_b` (`job_parts`, `tech_skills`)
- Status enums: defined as Postgres `ENUM` types, not raw strings

---

## Code Style

- TypeScript everywhere — strict mode, no `any`
- Components: functional only, hooks-based
- File naming: `kebab-case.tsx` for components, `camelCase.ts` for utilities
- No inline styles — Tailwind utility classes only
- shadcn/ui for all UI primitives — don't reinvent buttons, modals, tables
- Error handling: every async function has try/catch, errors surfaced to UI via toast
- Loading states: every data fetch shows a skeleton, never blank screen
- Optimistic updates for all user-initiated actions (undo if server rejects)

---

## AI Agent Pattern — How All Agents Work

Every AI agent in Airbase follows this pattern:

```typescript
// 1. Trigger (Supabase Edge Function or webhook)
// 2. Resolve model: agent_config.model_id → tenants.default_model_id → platform default
// 3. Gather context from DB (customer, job, tech, history)
// 4. Call llm-router.ts → callAgent() or runAgentLoop()
// 5. Parse structured tool-use response
// 6. Write proposed action to agent_actions table (status: 'proposed')
// 7. If confidence >= threshold → auto-execute and log
// 8. If below threshold → push notification to operator for approval
// 9. Operator approves/rejects → execute/discard, feedback logged
```

**All AI calls go through `llm-router.ts` — never call any provider SDK directly.**

Model resolution order per call:
1. `options.model` (explicit call-time override — for A/B tests or one-off use)
2. `agent_config.model_id` for this tenant + agent type
3. `tenants.default_model_id`
4. Platform default: `claude-sonnet-4-6`

**Recommended default routing by agent (configurable per tenant):**
| Agent | Recommended model | Reason |
|---|---|---|
| Dispatch | `claude-sonnet-4-6` | Complex multi-factor reasoning, tool loops |
| Booking SMS | `deepseek-chat` | High volume, simple logic, cost-sensitive |
| Booking Voice | `claude-sonnet-4-6` | Nuanced conversation handling |
| Invoice | `deepseek-chat` | Structured extraction, high volume, low stakes |
| Operator | `claude-sonnet-4-6` or `claude-opus-4-6` | Complex queries, DB reads, owner-facing |
| Tech Assistant | `moonshot-v1-32k` | Long equipment manuals need context window |
| Membership | `deepseek-chat` | Templated outreach, high volume |

**Tool schema:** Always declare tools in Anthropic format. The router translates to each provider's native format automatically.

**LLM call settings:**
- Temperature: 0.2 for decisions, 0.7 for customer-facing copy
- Max tokens: 1024 for decisions, 4096 for drafting content
- Log `modelUsed` and `providerUsed` from every `AgentCallResult` to `agent_actions`

**Never:**
- Call `new Anthropic()`, `new OpenAI()`, or any provider SDK directly in an agent function
- Auto-execute financial transactions (invoices >$500, refunds) without operator approval
- Send customer-facing communications without confidence check
- Run agent logic in the React client — always Edge Functions

---

## Phase Awareness

We are currently building: **@docs/current-phase.md**

Before starting any feature, check `docs/current-phase.md` to confirm it belongs to the active phase.
If a request is out-of-phase, flag it and add to `docs/backlog.md` instead of building it.

The phases are defined in `@docs/phases.md`.

---

## File Structure

```
airbase/
├── CLAUDE.md                    ← You are here
├── docs/
│   ├── phases.md                ← All 5 phases, full spec
│   ├── current-phase.md         ← What we're building NOW
│   ├── schema.md                ← Full DB schema reference
│   ├── agents.md                ← Agent specs (prompts, tools, triggers)
│   ├── api-patterns.md          ← LLM router + Supabase Edge Function patterns
│   ├── multi-tenancy.md         ← Tenancy model, RLS, provisioning, platform admin
│   └── backlog.md               ← Out-of-phase items, not yet building
├── src/
│   ├── components/              ← Shared UI components
│   ├── features/                ← Feature-scoped modules
│   │   ├── dispatch/
│   │   ├── booking/
│   │   ├── invoicing/
│   │   ├── membership/
│   │   ├── crm/
│   │   ├── operator-chat/
│   │   └── settings/            ← Includes AI model configuration (Enterprise)
│   ├── hooks/                   ← Custom React hooks (incl. useFeatureGate)
│   ├── lib/                     ← Supabase client, utils
│   └── types/                   ← Shared TypeScript types
├── supabase/
│   ├── functions/
│   │   ├── _shared/
│   │   │   ├── llm-router.ts    ← THE single AI entry point — all agents import this
│   │   │   ├── agent-logger.ts  ← agent_actions table writer
│   │   │   └── feature-gates.ts ← tier-based feature access checks
│   │   ├── dispatch-agent/
│   │   ├── booking-agent/
│   │   ├── invoice-agent/
│   │   ├── membership-agent/
│   │   ├── operator-agent/
│   │   └── provision-tenant/    ← New tenant signup
│   ├── migrations/              ← Numbered SQL migrations
│   └── seed/                    ← Steward test data
└── prompts/                     ← System prompts (plain .md files)
    ├── dispatch-agent.md
    ├── booking-agent.md
    ├── invoice-agent.md
    ├── membership-agent.md
    ├── operator-agent.md
    └── tech-assistant.md
```

---

## Must-Never List

- Never use `localStorage` or `sessionStorage` for auth or business data (use Supabase session)
- Never hardcode API keys — use Supabase secrets / `.env.local`
- Never write business logic in React components — hooks and Edge Functions only
- Never create a new UI component if a shadcn/ui primitive exists
- Never skip RLS on a new table
- Never block the UI thread for AI calls — always async with loading state
- Never auto-send SMS/email to customers without rendering a preview first (Phase 1–2)
- Never suggest increasing scope beyond the current phase
- **Never call any LLM provider SDK directly in an agent** — always import from `_shared/llm-router.ts`
- **Never hardcode a model name in an agent function** — always resolve via `resolveModel()` with the tenant's config
- **Never trust `tenant_id` from a request body** in a service-role Edge Function — always derive it from the authenticated JWT
- **Never query across tenants without explicit platform-admin auth check** — RLS is the guard, but service-role functions must also manually scope by tenant

---

## The Steward Test

Before marking any feature complete, ask:
> "Can the Steward Home Services dispatcher use this to book, dispatch, and close a real plumbing job right now?"

If yes → done. If no → what's blocking it?
