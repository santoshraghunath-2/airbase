# Airbase Voice Module

## Project Overview

A production-ready AI voice calling module built into Airbase (the AI-native FSM platform for Steward Home Services). Handles both inbound calls and outbound calls to form fills only. Designed as a self-contained module that can be extracted into a standalone product later.

**Primary use case today:** GGB Express Bathrooms (Bay Area) and Recast Texas — qualifying inbound leads and immediately calling back form submissions.

---

## Business Context

**Operator:** Good Guy Builders / Steward Home Services (Santosh, Bay Area entrepreneur)
**Brands using this module:**
- **GGB Express Bathrooms** — $15K–$35K bathroom remodels, Bay Area CA
- **Recast Texas** — Fast bath/kitchen remodels, Houston TX launch
- **Steward Home Services** — Plumbing/HVAC field service (future use)

**Call types:**
- **Inbound** — AI picks up any call to the business number 24/7
- **Outbound** — Fires automatically when a form fill webhook arrives. ONLY calls form fill leads. No cold outbound. No list dialing.

**TCPA note:** Outbound is restricted to form fill leads only. These contacts have explicitly requested to be called. The form must include consent language. Do not add any other outbound trigger without legal review.

---

## Tech Stack

### Airbase (parent platform)
- React 19 + Vite + Tailwind + shadcn/ui
- Supabase (Postgres + Edge Functions + RLS)
- Claude API (multi-provider LLM routing)
- Twilio (SMS + voice)
- Netlify deployment

### Voice Module Specific
- **Telephony:** Twilio (Media Streams via WebSocket)
- **Speech-to-Text:** Deepgram (streaming, nova-2 model)
- **AI Brain:** Anthropic Claude API (claude-sonnet-4-6)
- **Text-to-Speech:** Cartesia (low-latency streaming TTS)
- **Server:** Node.js with Fastify + ws (WebSocket)
- **Database:** Shared Supabase instance (voice module uses its own schema prefix: `voice_*`)

---

## Repository Structure

```
airbase/
├── src/
│   ├── modules/
│   │   └── voice/                    ← Everything lives here
│   │       ├── server/
│   │       │   ├── index.js          ← Fastify server entry point
│   │       │   ├── routes/
│   │       │   │   ├── inbound.js    ← Twilio inbound webhook + WS handler
│   │       │   │   ├── outbound.js   ← Form fill webhook → initiates call
│   │       │   │   └── status.js     ← Twilio call status callbacks
│   │       │   ├── services/
│   │       │   │   ├── deepgram.js   ← STT streaming service
│   │       │   │   ├── cartesia.js   ← TTS streaming service
│   │       │   │   ├── claude.js     ← Conversation AI service
│   │       │   │   └── twilio.js     ← Twilio client + call initiation
│   │       │   ├── agents/
│   │       │   │   ├── base-agent.js         ← Shared agent logic
│   │       │   │   ├── ggb-express-agent.js  ← GGB Express qualifying script
│   │       │   │   └── recast-texas-agent.js ← Recast Texas qualifying script
│   │       │   └── db/
│   │       │       ├── schema.sql    ← voice_* table definitions
│   │       │       └── queries.js    ← All DB interactions
│   │       ├── ui/                   ← React components for Airbase dashboard
│   │       │   ├── VoiceDashboard.jsx
│   │       │   ├── CallLog.jsx
│   │       │   ├── LiveCall.jsx
│   │       │   └── AgentConfig.jsx
│   │       └── config/
│   │           └── agents.js         ← Per-brand agent configuration
```

---

## Environment Variables

See `.env.example` in the voice module. All vars are prefixed `VOICE_` to avoid collisions with the rest of Airbase.

Required before first run:
```
VOICE_TWILIO_ACCOUNT_SID
VOICE_TWILIO_AUTH_TOKEN
VOICE_TWILIO_PHONE_NUMBER_GGB        ← GGB Express inbound number
VOICE_TWILIO_PHONE_NUMBER_RECAST     ← Recast Texas inbound number
VOICE_DEEPGRAM_API_KEY
VOICE_CARTESIA_API_KEY
VOICE_CARTESIA_VOICE_ID_GGB          ← Voice ID for GGB agent
VOICE_CARTESIA_VOICE_ID_RECAST       ← Voice ID for Recast agent
ANTHROPIC_API_KEY                    ← Already set in Airbase, reuse
```

---

## Database Schema (voice_* prefix)

Tables to create in shared Supabase instance:
- `voice_calls` — call log (sid, direction, brand, caller, duration, outcome, transcript, created_at)
- `voice_leads` — qualified lead data extracted from calls (name, phone, email, zip, project_type, budget, timeline, booked_at)
- `voice_agent_config` — per-brand agent settings (brand_id, system_prompt, voice_id, phone_number, active)

---

## Agent Architecture

Each brand has its own agent config. The base agent handles:
- Conversation state machine (greeting → qualify → book → close)
- Turn management (don't talk over caller, handle silence)
- Tool calls: `book_appointment`, `send_sms_summary`, `escalate_to_human`
- Graceful handoff if caller asks for a human

Brand agents extend base with:
- Brand-specific system prompt and persona
- Qualifying questions tuned to that business
- CRM/booking destination

---

## Call Flow

### Inbound
```
Caller dials Twilio number
→ Twilio POST /voice/inbound (TwiML response)
→ TwiML opens Media Stream WebSocket to /voice/ws
→ Audio chunks → Deepgram STT → transcript
→ Transcript → Claude agent → response text
→ Response text → Cartesia TTS → audio
→ Audio → Twilio Media Stream → caller hears response
→ Loop until call ends
→ Outcome + transcript saved to voice_calls
→ If qualified: lead saved to voice_leads
```

### Outbound (form fills only)
```
Form submitted on website
→ Webhook POST /voice/outbound-trigger (with lead data)
→ Validate: source must be a known form endpoint
→ Twilio REST API initiates outbound call to lead's phone
→ On answer: same WebSocket + agent flow as inbound
→ Outcome saved, lead updated
```

---

## Standalone Deployment

The voice module is designed to run independently of the full Airbase stack:

```bash
cd src/modules/voice
npm install
node server/index.js
```

It only requires its own env vars and a Supabase connection. The React UI components are optional — the server runs headlessly.

When carving out as a standalone product for other industries, the key files to fork are:
- `agents/base-agent.js` (keep as-is)
- `config/agents.js` (new brand config)
- Create a new `agents/[industry]-agent.js`

---

## Development Notes

- Use `ngrok` or Twilio Dev Phone for local testing — Twilio webhooks need a public URL
- Deepgram nova-2 model recommended for phone audio (8kHz, mulaw encoding from Twilio)
- Cartesia latency target: < 300ms first audio chunk
- Claude context window: keep conversation history, summarize if > 10 turns
- All calls are recorded and transcribed by default (Supabase storage). Add a disclosure to agent greeting.

---

## Current Status

**Not yet started.** This CLAUDE.md was created to initialize the module. Begin with:
1. `schema.sql` — create voice_* tables in Supabase
2. `server/index.js` — Fastify server skeleton
3. `routes/inbound.js` — Twilio webhook + TwiML response
4. `services/deepgram.js` — STT streaming
5. Build up from there one service at a time
