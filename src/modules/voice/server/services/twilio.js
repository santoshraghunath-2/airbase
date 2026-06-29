// Twilio REST API client — outbound call initiation and SMS.
// Uses a lazily-initialized singleton so the SDK client is created once
// and the env vars are read at call time (not at module load).

import twilio from 'twilio'

let _client = null

function getClient() {
  if (_client) return _client
  const sid   = process.env.VOICE_TWILIO_ACCOUNT_SID
  const token = process.env.VOICE_TWILIO_AUTH_TOKEN
  if (!sid || !token) throw new Error('VOICE_TWILIO_ACCOUNT_SID or VOICE_TWILIO_AUTH_TOKEN not set')
  _client = twilio(sid, token)
  return _client
}

/**
 * Initiate an outbound call to a form-fill lead.
 * TCPA: only call leads who submitted a form with explicit consent language.
 *
 * @param {{ to: string, from: string, twimlUrl: string, statusCallbackUrl: string }} opts
 * @returns {Promise<string>} Twilio Call SID
 */
export async function initiateOutboundCall({ to, from, twimlUrl, statusCallbackUrl }) {
  const call = await getClient().calls.create({
    to,
    from,
    url:                  twimlUrl,
    statusCallback:       statusCallbackUrl,
    statusCallbackMethod: 'POST',
    statusCallbackEvent:  ['initiated', 'ringing', 'answered', 'completed'],
  })
  return call.sid
}

/**
 * Send an SMS message.
 *
 * @param {{ to: string, from: string, body: string }} opts
 * @returns {Promise<string>} Twilio Message SID
 */
export async function sendSms({ to, from, body }) {
  const message = await getClient().messages.create({ to, from, body })
  return message.sid
}

/**
 * Redirect an in-progress call to a new TwiML URL.
 * Used to transfer a Media Stream call to a live human (escalate flow).
 *
 * @param {{ callSid: string, twimlUrl: string }} opts
 * @returns {Promise<void>}
 */
export async function redirectCall({ callSid, twimlUrl }) {
  await getClient().calls(callSid).update({ url: twimlUrl, method: 'POST' })
}
