# Airbase Voice Module — Architecture

## Overview

The Voice Module is a self-contained Node.js service embedded inside Airbase. It bridges four external APIs (Twilio, Deepgram, Claude, Cartesia) into a real-time AI voice agent capable of handling inbound calls and outbound form-fill callbacks for any configured brand.

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL TRIGGERS                           │
│                                                                     │
│   Caller dials number          Form submitted on website            │
│         │                              │                            │
│         ▼                              ▼                            │
│   [Twilio Phone]              [Website Form Webhook]                │
└─────────────┬──────────────────────────┬───────────────────────────┘
              │                          │
              ▼                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     VOICE MODULE SERVER (Node.js / Fastify)         │
│                                                                     │
│  POST /voice/inbound          POST /voice/outbound-trigger          │
│  (Twilio webhook)             (form fill webhook)                   │
│       │                              │                              │
│       │ Returns TwiML                │ Validates source             │
│       │ <Stream url="/voice/ws">     │ Calls Twilio REST API        │
│       │                              │ to initiate outbound call    │
│       ▼                              ▼                              │
│  WebSocket /voice/ws  ◄─────────────────────────────               │
│       │                                                             │
│       │  Audio stream (mulaw, 8kHz)                                 │
│       ▼                                                             │
│  ┌─────────────┐                                                    │
│  │  Deepgram   │  Streaming STT → interim + final transcripts       │
│  │  Service    │                                                     │
│  └──────┬──────┘                                                    │
│         │  Transcript text                                          │
│         ▼                                                           │
│  ┌─────────────┐                                                    │
│  │   Claude    │  Conversation AI                                   │
│  │   Agent     │  - Maintains conversation history                  │
│  │             │  - Follows brand-specific system prompt            │
│  │             │  - Executes tool calls when needed                 │
│  └──────┬──────┘                                                    │
│         │  Response text                                            │
│         ▼                                                           │
│  ┌─────────────┐                                                    │
│  │  Cartesia   │  Streaming TTS → audio chunks                      │
│  │  Service    │  Target latency: < 300ms first chunk               │
│  └──────┬──────┘                                                    │
│         │  Audio (mulaw, 8kHz)                                      │
│         ▼                                                           │
│  WebSocket → Twilio Media Stream → Caller hears response            │
│                                                                     │
│  ┌─────────────────────────────────────────┐                        │
│  │           Tool Execution Layer          │                        │
│  │  book_appointment  → Cal.com / Calendly │                        │
│  │  send_sms_summary  → Twilio SMS         │                        │
│  │  escalate_to_human → Twilio Transfer    │                        │
│  │  save_lead         → Supabase           │                        │
│  └─────────────────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SUPABASE (shared)                           │
│                                                                     │
│   voice_calls    — full call log + transcripts                      │
│   voice_leads    — qualified lead data                              │
│   voice_agent_config — per-brand settings                           │
└─────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    AIRBASE REACT DASHBOARD (optional)               │
│                                                                     │
│   VoiceDashboard  — call volume, conversion stats                   │
│   CallLog         — searchable call history + transcripts           │
│   LiveCall        — real-time monitoring of active calls            │
│   AgentConfig     — edit system prompts, toggle brands on/off       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Audio Pipeline Detail

Twilio encodes phone audio as **mulaw (μ-law), 8kHz, mono**. This is the lowest common denominator for PSTN calls.

```
Caller audio
  → Twilio captures
  → Encodes as mulaw 8kHz
  → Sends base64-encoded chunks over WebSocket every 20ms
  → Server decodes
  → Forwards to Deepgram (accepts mulaw 8kHz natively)
  → Deepgram returns transcript in ~200-400ms

Claude response text
  → Sent to Cartesia with voice_id
  → Cartesia returns mulaw 8kHz audio (match Twilio format)
  → Server encodes as base64
  → Sends back over WebSocket to Twilio
  → Twilio plays to caller
```

**Key:** Request Cartesia to output mulaw 8kHz to avoid any transcoding step. This minimizes latency.

---

## Conversation State Machine

Each call runs through a state machine managed by the agent:

```
GREETING
  ↓ (caller responds)
QUALIFY_PROJECT
  ↓ (project type identified)
QUALIFY_BUDGET
  ↓ (budget range captured)
QUALIFY_TIMELINE
  ↓ (urgency assessed)
QUALIFY_CONTACT
  ↓ (name, email, zip confirmed)
BOOK_OR_CLOSE
  ├── BOOK_APPOINTMENT (books a slot, sends SMS confirmation)
  ├── NOT_QUALIFIED (politely closes, offers to send info)
  └── ESCALATE_HUMAN (transfers to live agent)
```

States are tracked in the conversation context object passed to Claude on every turn.

---

## Brand Routing

Inbound calls are routed to the correct agent based on the Twilio number called (`To` field in webhook). Each brand has its own:

| Config Field | GGB Express | Recast Texas |
|---|---|---|
| Phone number | +1 (Bay Area) | +1 (Houston) |
| Agent persona | Alex, GGB Express | Jordan, Recast Texas |
| Qualifying questions | BA-specific, $15K–$35K | TX-specific, fast turnaround |
| Cartesia voice ID | TBD at setup | TBD at setup |
| Booking destination | GGB calendar | Recast calendar |
| SMS sender | GGB Express | Recast Texas |

---

## Claude Tool Definitions

The agent has access to four tools:

```javascript
// 1. Book appointment
{
  name: "book_appointment",
  description: "Book a consultation appointment for a qualified lead",
  input_schema: {
    name: string,
    phone: string,
    email: string,
    zip: string,
    project_type: string,  // "full_bathroom" | "shower_only" | "tub_only" | "kitchen"
    budget_range: string,  // "$10K-$20K" | "$20K-$35K" | "$35K+"
    timeline: string,      // "asap" | "1-3months" | "3-6months" | "just_browsing"
    preferred_slot: string // natural language, e.g. "Tuesday morning"
  }
}

// 2. Send SMS summary
{
  name: "send_sms_summary",
  description: "Send a text message to the caller with next steps",
  input_schema: {
    phone: string,
    message: string  // < 160 chars
  }
}

// 3. Escalate to human
{
  name: "escalate_to_human",
  description: "Transfer the call to a human agent",
  input_schema: {
    reason: string,        // why escalating
    summary: string        // brief summary for human agent
  }
}

// 4. Save lead (no booking)
{
  name: "save_lead",
  description: "Save lead info without booking — for not-yet-ready prospects",
  input_schema: {
    name: string,
    phone: string,
    email: string,
    project_type: string,
    notes: string
  }
}
```

---

## Latency Budget

Target: caller hears a response within **1.5 seconds** of finishing speaking.

| Stage | Target | Notes |
|---|---|---|
| Deepgram end-of-utterance detection | 300ms | Uses `endpointing` config |
| STT final transcript | 200ms | |
| Claude API response | 400ms | Keep prompts concise |
| Cartesia first audio chunk | 300ms | Streaming TTS |
| Audio delivery to Twilio | 100ms | WebSocket round-trip |
| **Total** | **~1.3s** | Within target |

---

## Scalability Notes

- Each active call holds one WebSocket connection and one Deepgram stream
- Claude API calls are stateless — full history passed each turn (summarize after 10 turns)
- Cartesia TTS is streamed — don't wait for full audio before sending to Twilio
- Supabase handles concurrency naturally — no special considerations at this scale
- Fastify handles 10K+ concurrent connections; overkill for current volume, future-safe

---

## Standalone Extraction Plan

When this module is carved out as a standalone product:

1. Move `src/modules/voice/server` → root of new repo
2. Replace Supabase with a lightweight SQLite or keep Supabase (it's already decoupled)
3. The `config/agents.js` file becomes the "product configuration" for new customers
4. Each industry gets a new agent file in `agents/`
5. The React UI in `ui/` becomes a standalone admin dashboard

The server has zero imports from the rest of Airbase intentionally.
