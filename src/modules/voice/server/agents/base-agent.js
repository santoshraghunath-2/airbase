// Shared agent definitions — tool schemas, base behavior text, and state constants.
// Imported by services/claude.js (tool schemas) and brand agent files (base text).

// ---------------------------------------------------------------------------
// Conversation state machine
// ---------------------------------------------------------------------------
export const STATES = {
  GREETING:         'GREETING',
  QUALIFY_PROJECT:  'QUALIFY_PROJECT',
  QUALIFY_BUDGET:   'QUALIFY_BUDGET',
  QUALIFY_TIMELINE: 'QUALIFY_TIMELINE',
  QUALIFY_CONTACT:  'QUALIFY_CONTACT',
  BOOK_OR_CLOSE:    'BOOK_OR_CLOSE',
}

// Summarize history when the conversation exceeds this many turns (user + assistant each = 1 turn)
export const SUMMARY_TURN_THRESHOLD = 10

// ---------------------------------------------------------------------------
// Base behavior — prepended to every brand system prompt
// ---------------------------------------------------------------------------
export const BASE_BEHAVIOR = `You are a friendly, professional phone assistant for a home remodeling company.
Your job is to qualify callers for a free design consultation.

CORE RULES:
- Keep responses SHORT. You are speaking on the phone. 1-3 sentences per turn maximum.
- Never read out lists, bullet points, or long explanations.
- Speak naturally, like a human receptionist would.
- Ask ONE question at a time. Never stack multiple questions.
- If the caller asks for a human, always use the escalate_to_human tool immediately.
- If the caller seems frustrated, slow down and be warmer.
- Always confirm the caller's phone number before ending — even if you called them.
- You are recording and transcribing this call for quality purposes. Mention this once at the start.

DISQUALIFICATION CRITERIA (use save_lead, do not book):
- Budget clearly under $8,000
- Timeline is "just browsing, no real plans"
- Outside service area (see brand config below)
- Commercial property (residential only)

QUALIFICATION CRITERIA (proceed to book):
- Clear project scope (bathroom, kitchen, or specific room)
- Budget $10K+ indicated or implied
- Timeline within 12 months
- Residential property in service area`

// ---------------------------------------------------------------------------
// Tool definitions (Anthropic format)
// The router translates these to each provider's native format if needed.
// ---------------------------------------------------------------------------
export const TOOL_DEFINITIONS = [
  {
    name: 'book_appointment',
    description:
      'Book a free in-home design consultation for a qualified lead. ' +
      'Call this once you have the caller\'s name, phone, project type, budget range, ' +
      'and a preferred time. Email and ZIP are helpful but not required to book.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Full name of the caller',
        },
        phone: {
          type: 'string',
          description: 'Phone number in E.164 format, e.g. +14155551234',
        },
        email: {
          type: 'string',
          description: 'Email address (optional — ask but do not block on it)',
        },
        zip: {
          type: 'string',
          description: 'ZIP code of the property',
        },
        project_type: {
          type: 'string',
          enum: ['full_bathroom', 'shower_only', 'tub_only', 'kitchen', 'other'],
          description: 'Type of remodeling project',
        },
        budget_range: {
          type: 'string',
          description: 'Budget range expressed as a string, e.g. "$15K-$35K" or "$35K+"',
        },
        timeline: {
          type: 'string',
          enum: ['asap', '1-3months', '3-6months', 'just_browsing'],
          description: 'How soon the caller wants to start',
        },
        preferred_slot: {
          type: 'string',
          description:
            'Preferred appointment time in natural language, e.g. "Tuesday morning" or "this weekend"',
        },
      },
      required: ['name', 'phone', 'project_type', 'budget_range', 'timeline'],
    },
  },
  {
    name: 'send_sms_summary',
    description:
      'Send a text message to the caller with confirmation details or next steps. ' +
      'Always call this immediately after booking an appointment.',
    input_schema: {
      type: 'object',
      properties: {
        phone: {
          type: 'string',
          description: 'Phone number to text (E.164 format)',
        },
        message: {
          type: 'string',
          description: 'Message body — keep under 160 characters',
        },
      },
      required: ['phone', 'message'],
    },
  },
  {
    name: 'escalate_to_human',
    description:
      'Transfer the caller to a live human agent. ' +
      'Use when: the caller explicitly asks for a person, the situation is outside your scope, ' +
      'or the caller is clearly upset and needs a human touch.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Why the call is being escalated',
        },
        summary: {
          type: 'string',
          description:
            'Brief summary of the conversation so far — what the caller needs and what was discussed',
        },
      },
      required: ['reason', 'summary'],
    },
  },
  {
    name: 'save_lead',
    description:
      'Save caller information without booking an appointment. ' +
      'Use when the caller does not qualify (budget, area, timeline), is not ready to book, ' +
      'or wants information sent to them instead.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: {
          type: 'string',
          description: 'Phone number (E.164 format)',
        },
        email: { type: 'string' },
        project_type: {
          type: 'string',
          enum: ['full_bathroom', 'shower_only', 'tub_only', 'kitchen', 'other'],
        },
        notes: {
          type: 'string',
          description: 'Why the lead was not booked and any useful context',
        },
      },
      required: ['phone'],
    },
  },
]
