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
