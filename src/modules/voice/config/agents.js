// Per-brand configuration for the Voice Module.
//
// FORM_SOURCE_MAP maps the `source` field in an outbound webhook payload to
// the brand that should handle the call. Add a new entry here whenever a new
// website form is connected.
//
// Phone numbers are read from env vars so no credentials live in code.

export const FORM_SOURCE_MAP = {
  ggb_express_website: {
    brandId:     'ggb_express',
    fromNumber:  process.env.VOICE_TWILIO_PHONE_NUMBER_GGB,
  },
  recast_texas_website: {
    brandId:     'recast_texas',
    fromNumber:  process.env.VOICE_TWILIO_PHONE_NUMBER_RECAST,
  },
  // Steward inbound only — no outbound form-fill trigger for field service
  // Steward calls are handled by voice_agent_config keyed on the Twilio phone number
}

// Brands that support inbound AI calling (used in voice_agent_config seed)
export const INBOUND_BRANDS = {
  ggb_express:              { envKey: 'VOICE_TWILIO_PHONE_NUMBER_GGB',     outboundEnabled: true  },
  recast_texas:             { envKey: 'VOICE_TWILIO_PHONE_NUMBER_RECAST',  outboundEnabled: true  },
  steward_home_services:    { envKey: 'VOICE_TWILIO_PHONE_NUMBER_STEWARD', outboundEnabled: false },
}

/**
 * Resolve brand routing for an inbound form-fill webhook source.
 * Returns null if the source is unknown (request should be rejected).
 *
 * @param {string} source
 * @returns {{ brandId: string, fromNumber: string } | null}
 */
export function resolveBrandFromSource(source) {
  return FORM_SOURCE_MAP[source] ?? null
}
