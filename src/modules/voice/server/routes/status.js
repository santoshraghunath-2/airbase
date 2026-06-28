// Route: POST /voice/status
//
// Twilio calls this URL on every call status change
// (initiated → ringing → in-progress → completed / failed / busy / no-answer).
// We use it to update voice_calls.status and set ended_at + duration_seconds
// on terminal events.
//
// Twilio requires a 200 response — any non-2xx triggers a retry storm.
// Always reply 200 first, then do DB work asynchronously.

import { supabase } from '../index.js'

export async function statusRoutes(fastify) {
  fastify.post('/status', async (request, reply) => {
    // Acknowledge immediately — Twilio retries if it doesn't get 200 fast
    reply.code(200).send()

    const {
      CallSid: twilioCallSid,
      CallStatus: callStatus,
      CallDuration: callDurationStr,
    } = request.body ?? {}

    if (!twilioCallSid) return

    const terminal = ['completed', 'busy', 'failed', 'no-answer', 'canceled']
    const isTerminal = terminal.includes(callStatus)

    const update = { status: callStatus }
    if (isTerminal) {
      update.ended_at = new Date().toISOString()
      if (callDurationStr) update.duration_seconds = parseInt(callDurationStr, 10)
    }

    const { error } = await supabase
      .from('voice_calls')
      .update(update)
      .eq('twilio_call_sid', twilioCallSid)

    if (error) {
      fastify.log.error({ err: error, twilioCallSid }, '[status] Failed to update voice_calls')
    }
  })
}
