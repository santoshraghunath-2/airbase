// Steward Home Services — AI voice booking agent for plumbing / HVAC / electrical field service.
// This agent books service calls, not remodeling consultations.
// It integrates with the Airbase Supabase job table directly.

// ---------------------------------------------------------------------------
// Date heuristic (matches booking-agent SMS agent logic)
// ---------------------------------------------------------------------------
export function parseDateHeuristic(description) {
  const d = (description ?? '').toLowerCase().trim()
  const today = new Date()
  const addDays = (n) => {
    const r = new Date(today)
    r.setDate(r.getDate() + n)
    return r.toISOString().slice(0, 10)
  }
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

  if (d === 'today')              return addDays(0)
  if (d.includes('tomorrow'))     return addDays(1)
  if (d.includes('day after tomorrow')) return addDays(2)
  if (d.includes('this week'))    return addDays(1)
  if (d.includes('next week'))    return addDays(7)
  if (d.includes('asap') || d.includes('as soon as')) return addDays(1)

  for (let i = 0; i < dayNames.length; i++) {
    if (d.includes(dayNames[i])) {
      const diff = (i - today.getDay() + 7) % 7 || 7
      return addDays(diff)
    }
  }
  const parsed = new Date(description)
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)

  return addDays(1)
}

// ---------------------------------------------------------------------------
// Job type classification
// ---------------------------------------------------------------------------

// Maps caller descriptions to Airbase job types
const JOB_TYPE_CATEGORY = {
  drain_cleaning:       'plumbing',
  plumbing_service:     'plumbing',
  water_heater_repair:  'plumbing',
  water_heater_install: 'plumbing',
  hvac_service:         'hvac',
  hvac_repair:          'hvac',
  hvac_install:         'hvac',
  hvac_maintenance:     'hvac',
  electrical_service:   'electrical',
  electrical_repair:    'electrical',
  electrical_install:   'electrical',
  general_maintenance:  'general',
}

export function getRelatedJobTypes(jobType) {
  const cat = JOB_TYPE_CATEGORY[jobType]
  if (!cat) return [jobType]
  return Object.entries(JOB_TYPE_CATEGORY)
    .filter(([, c]) => c === cat)
    .map(([t]) => t)
}

// ---------------------------------------------------------------------------
// Tool definitions (Anthropic format)
// ---------------------------------------------------------------------------
export const STEWARD_TOOL_DEFINITIONS = [
  {
    name: 'check_availability',
    description:
      'Check if we have technicians available for a service date and job type. ' +
      'Call this when the caller mentions a preferred date or asks about availability.',
    input_schema: {
      type: 'object',
      properties: {
        preferred_date: {
          type: 'string',
          description: 'Plain English date, e.g. "tomorrow", "Monday", "this Friday", or YYYY-MM-DD.',
        },
        job_type: {
          type: 'string',
          description:
            'Classified job type: drain_cleaning, plumbing_service, water_heater_repair, ' +
            'water_heater_install, hvac_service, hvac_repair, hvac_install, hvac_maintenance, ' +
            'electrical_service, electrical_repair, electrical_install, or general_maintenance.',
        },
      },
      required: ['preferred_date', 'job_type'],
    },
  },
  {
    name: 'create_booking',
    description:
      'Create a service appointment in the system. Call only when you have: ' +
      'the customer name, service address, job type, preferred date, and preferred time. ' +
      'Do NOT call this until you have confirmed these with the caller.',
    input_schema: {
      type: 'object',
      properties: {
        customer_name: {
          type: 'string',
          description: "Caller's full name.",
        },
        address: {
          type: 'string',
          description: 'Street address of the service location.',
        },
        city: {
          type: 'string',
          description: 'City.',
        },
        state: {
          type: 'string',
          description: 'State abbreviation, e.g. CA.',
        },
        zip: {
          type: 'string',
          description: 'ZIP code.',
        },
        job_type: {
          type: 'string',
          description: 'Classified job type (same as check_availability).',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'emergency'],
          description: '"emergency" only for active water leaks, no heat in winter, electrical hazards. Default: "normal".',
        },
        preferred_date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format.',
        },
        preferred_time: {
          type: 'string',
          enum: ['morning', 'afternoon', 'anytime'],
          description: '"morning" = 8am–12pm, "afternoon" = 12pm–5pm.',
        },
        notes: {
          type: 'string',
          description: "Brief description of the problem in the customer's own words.",
        },
      },
      required: ['customer_name', 'address', 'job_type', 'preferred_date', 'preferred_time'],
    },
  },
  {
    name: 'send_confirmation_sms',
    description:
      'Send a text message to the caller confirming their booking. ' +
      'Always call this immediately after create_booking succeeds.',
    input_schema: {
      type: 'object',
      properties: {
        phone: {
          type: 'string',
          description: 'Phone number to text (E.164 format, e.g. +14155551234).',
        },
        message: {
          type: 'string',
          description: 'Confirmation message. Keep under 160 characters.',
        },
      },
      required: ['phone', 'message'],
    },
  },
  {
    name: 'escalate_to_dispatcher',
    description:
      'Transfer this call to a human dispatcher. Use for: ' +
      'active emergencies needing immediate dispatch, ' +
      'caller requesting a person, ' +
      'billing disputes or complaints, ' +
      'anything outside booking scope.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Why the call is being escalated (for internal log).',
        },
        summary: {
          type: 'string',
          description:
            'What the caller needs — read by the dispatcher who picks up. Be specific.',
        },
      },
      required: ['reason', 'summary'],
    },
  },
]

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
export const STEWARD_SYSTEM_PROMPT = `You are Jordan, the AI booking assistant for Steward Home Services — a plumbing, HVAC, and electrical company serving the San Francisco Bay Area.

You are recording this call for quality purposes. Mention this at the start.

Your only job is to book service appointments. Do not give DIY advice, quotes, or diagnoses.

CONVERSATION FLOW:

1. GREETING
   "Thanks for calling Steward Home Services, this is Jordan! Just so you know, I'm recording this call for quality. What can I help you with today?"

2. UNDERSTAND THE PROBLEM
   Listen for the service type. Classify to one of: drain clog, leak, water heater, HVAC, electrical, or general.
   Ask one focused follow-up to confirm if unclear. Example: "Is that a slow drain or a complete backup?"
   Do NOT ask multiple questions at once.

3. COLLECT SERVICE ADDRESS
   "And what address should we send a tech to?"
   Confirm city if the address is ambiguous.

4. CHECK AVAILABILITY
   "When were you hoping to get someone out?"
   Use check_availability with the date and classified job type.
   Offer the result: "We have availability on [date] — would morning (8am to noon) or afternoon (noon to 5pm) work better?"

5. GET CALLER NAME
   "Great — and your name for the appointment?"
   If the caller already gave a name earlier, confirm it rather than asking again.

6. CONFIRM AND BOOK
   Confirm all details aloud: "So I have [name] at [address], [service], on [date] in the [time slot]. Does that all look right?"
   Use create_booking once confirmed.
   Immediately use send_confirmation_sms to text the confirmation.
   Close: "You're all set. You'll get a text reminder when the tech is on the way. Anything else I can help with?"

TONE:
- 1–3 sentences per response maximum. This is a phone call.
- Warm and efficient. Sound like a real receptionist, not a menu.
- Use the caller's first name once you have it.
- For emergencies (active leak, no heat, sparking electrical): express urgency, confirm it's high priority, and book with priority="emergency".

JOB TYPE CLASSIFICATION:
- drain_cleaning — slow/clogged drain, backup, toilet won't flush
- plumbing_service — leak, running toilet, low pressure, pipe issue
- water_heater_repair — no hot water, lukewarm, water heater making noise
- water_heater_install — replace water heater, new unit
- hvac_service — AC not cooling, heat not working, HVAC tune-up
- hvac_repair — AC/furnace broken, not turning on
- hvac_install — new AC or furnace installation
- hvac_maintenance — annual maintenance visit
- electrical_service — outlet/switch not working, breaker tripping
- electrical_repair — flickering lights, burning smell from panel
- electrical_install — add circuit, EV charger, panel upgrade
- general_maintenance — anything that doesn't fit above

NEVER:
- Give price estimates ("a technician will provide a written quote on-site")
- Promise a specific technician by name
- Commit to a minute-level arrival time (use "morning" or "afternoon" windows only)
- Ask for credit card information — payment is collected on-site

ESCALATE to dispatcher immediately if:
- Caller describes active flooding, carbon monoxide, or sparking/fire
- Caller asks to speak with a person and doesn't accept AI
- The issue is a billing dispute or complaint about prior service`

// ---------------------------------------------------------------------------
// Brand config
// ---------------------------------------------------------------------------
export const STEWARD_CONFIG = {
  brandId:     'steward_home_services',
  brandName:   'Steward Home Services',
  personaName: 'Jordan',
  modelId:     'claude-sonnet-4-6',
  outboundEnabled: false,
}
