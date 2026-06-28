// POST /voice/outbound-trigger
//
// Receives form-fill webhooks from GGB Express and Recast Texas websites.
// Validates the source and secret, then initiates a Twilio outbound call
// to the lead's phone number.
//
// TCPA: outbound is restricted to form-fill leads ONLY. The website form must
// include explicit consent language before this endpoint is wired to it:
//   "By submitting this form, you consent to receive calls or texts from
//    [Brand Name] at the number provided, including via automated means."
//
// Response strategy: reply 202 immediately, then act asynchronously. Form
// submission tools (Webflow, Typeform, Zapier) have short timeout windows.

import { supabase } from '../index.js'
import { initiateOutboundCall } from '../services/twilio.js'
import { resolveBrandFromSource } from '../../config/agents.js'

export async function outboundRoutes(fastify) {
  fastify.post('/outbound-trigger', async (request, reply) => {
    const body = request.body ?? {}

    // 1. Validate webhook secret — reject unknown callers
    const expectedSecret = process.env.VOICE_WEBHOOK_SECRET
    if (expectedSecret && body.secret !== expectedSecret) {
      fastify.log.warn({ ip: request.ip }, '[outbound] Invalid webhook secret')
      reply.code(401).send({ error: 'Unauthorized' })
      return
    }

    // 2. Validate required fields
    const { source, name, phone, email, zip, project } = body
    if (!phone) {
      reply.code(400).send({ error: 'phone is required' })
      return
    }

    // 3. Resolve brand from source identifier
    const brandRouting = resolveBrandFromSource(source)
    if (!brandRouting) {
      fastify.log.warn({ source }, '[outbound] Unknown form source')
      reply.code(400).send({ error: `Unknown form source: ${source}` })
      return
    }

    if (!brandRouting.fromNumber) {
      fastify.log.error({ brandId: brandRouting.brandId }, '[outbound] fromNumber not configured')
      reply.code(503).send({ error: 'Brand phone number not configured' })
      return
    }

    // 4. Load the agent config from the DB so we have tenant_id and config id
    const { data: config, error: configErr } = await supabase
      .from('voice_agent_config')
      .select('id, tenant_id, brand_id, brand_name, outbound_enabled')
      .eq('brand_id', brandRouting.brandId)
      .eq('active', true)
      .is('deleted_at', null)
      .single()

    if (configErr || !config) {
      fastify.log.error({ brandId: brandRouting.brandId, configErr }, '[outbound] Config not found')
      reply.code(503).send({ error: 'Agent not configured' })
      return
    }

    if (!config.outbound_enabled) {
      reply.code(403).send({ error: 'Outbound calling is disabled for this brand' })
      return
    }

    // 5. Create lead record BEFORE calling — establishes the TCPA audit trail
    const { data: leadRow, error: leadErr } = await supabase
      .from('voice_leads')
      .insert({
        tenant_id: config.tenant_id,
        name:      name   ?? null,
        phone,
        email:     email  ?? null,
        zip:       zip    ?? null,
        notes:     project ?? null,
        qualified: false,
      })
      .select('id')
      .single()

    if (leadErr) {
      fastify.log.error({ leadErr }, '[outbound] Failed to create lead record')
    }

    // 6. Create placeholder call record (no Twilio SID yet)
    const { data: callRow, error: callErr } = await supabase
      .from('voice_calls')
      .insert({
        tenant_id:       config.tenant_id,
        agent_config_id: config.id,
        direction:       'outbound',
        brand_id:        config.brand_id,
        to_number:       phone,
        from_number:     brandRouting.fromNumber,
        status:          'queued',
        outcome:         'in_progress',
        started_at:      new Date().toISOString(),
      })
      .select('id')
      .single()

    if (callErr) {
      fastify.log.error({ callErr }, '[outbound] Failed to create call record')
    }

    // 7. Acknowledge immediately — don't block the form submission on Twilio latency
    reply.code(202).send({ received: true, callId: callRow?.id ?? null })

    // 8. Initiate the Twilio call (async — reply already sent)
    const baseUrl = process.env.VOICE_BASE_URL
    try {
      const callSid = await initiateOutboundCall({
        to:               phone,
        from:             brandRouting.fromNumber,
        twimlUrl:         `${baseUrl}/voice/inbound`,
        statusCallbackUrl:`${baseUrl}/voice/status`,
      })

      fastify.log.info({ callSid, to: phone, brand: config.brand_id }, '[outbound] Call initiated')

      // Update call record with the real Twilio SID
      if (callRow?.id) {
        await supabase
          .from('voice_calls')
          .update({ twilio_call_sid: callSid, status: 'ringing' })
          .eq('id', callRow.id)
      }

      // Link lead to the call
      if (leadRow?.id && callRow?.id) {
        await supabase
          .from('voice_leads')
          .update({ call_id: callRow.id })
          .eq('id', leadRow.id)
      }
    } catch (err) {
      fastify.log.error({ err, phone, brand: config.brand_id }, '[outbound] Call initiation failed')

      if (callRow?.id) {
        await supabase
          .from('voice_calls')
          .update({ status: 'failed', outcome: 'failed', error: err.message })
          .eq('id', callRow.id)
      }
    }
  })
}
