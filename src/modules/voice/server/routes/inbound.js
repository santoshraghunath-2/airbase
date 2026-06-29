// POST /voice/inbound  — Twilio voice webhook → returns TwiML that opens a
//                        bidirectional Media Stream back to /voice/ws
// GET  /voice/ws       — Twilio Media Stream WebSocket
//                        Audio pipeline: Twilio → Deepgram → Claude → Cartesia → Twilio

import { supabase } from '../index.js'
import { createDeepgramStream } from '../services/deepgram.js'
import { synthesizeSpeech } from '../services/cartesia.js'
import { callAgent } from '../services/claude.js'
import { sendSms, redirectCall } from '../services/twilio.js'
import {
  TOOL_DEFINITIONS as REMODELING_TOOL_DEFINITIONS,
} from '../agents/base-agent.js'
import {
  STEWARD_TOOL_DEFINITIONS,
  parseDateHeuristic,
  getRelatedJobTypes,
} from '../agents/steward-booking-agent.js'

// E.164 phone numbers only — strip anything else to prevent XML injection.
function sanitizePhone(value) {
  return String(value ?? '').replace(/[^+\d]/g, '')
}

export async function inboundRoutes(fastify) {
  // -------------------------------------------------------------------------
  // POST /voice/inbound
  // Twilio sends a POST when a call arrives. We return TwiML that opens a
  // Media Stream WebSocket back to this server. From/To are injected as
  // <Parameter> elements so the WebSocket handler can route by brand.
  // -------------------------------------------------------------------------
  fastify.post('/inbound', async (request, reply) => {
    const from = sanitizePhone(request.body?.From)
    const to   = sanitizePhone(request.body?.To)
    const host = request.headers.host
    const wsUrl = `wss://${host}/voice/ws`

    fastify.log.info({ from, to }, '[inbound] Call received')

    reply.type('text/xml')
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="from" value="${from}" />
      <Parameter name="to" value="${to}" />
    </Stream>
  </Connect>
</Response>`
  })

  // -------------------------------------------------------------------------
  // GET /voice/transfer
  // TwiML returned when escalating to a human dispatcher.
  // Requires VOICE_DISPATCHER_NUMBER in env.
  // -------------------------------------------------------------------------
  fastify.post('/transfer', async (request, reply) => {
    const dispatcherNumber = process.env.VOICE_DISPATCHER_NUMBER
    reply.type('text/xml')
    if (dispatcherNumber) {
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Please hold while I connect you with our team.</Say>
  <Dial>${dispatcherNumber}</Dial>
</Response>`
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Our team will call you back shortly. Thank you for calling Steward Home Services.</Say>
  <Hangup/>
</Response>`
  })

  // -------------------------------------------------------------------------
  // GET /voice/ws
  // Twilio opens this WebSocket after the TwiML above fires. Each connection
  // is exactly one call. A CallSession manages all per-call state.
  // -------------------------------------------------------------------------
  fastify.get('/ws', { websocket: true }, (socket, _request) => {
    const session = new CallSession({ socket, fastify })

    socket.on('message', async (data) => {
      try {
        await session.handleTwilioEvent(JSON.parse(data.toString()))
      } catch (err) {
        fastify.log.error({ err }, '[ws] Event handling failed')
      }
    })

    // close fires on both clean disconnect and errors — authoritative cleanup
    socket.on('close', () => {
      session.close().catch(err =>
        fastify.log.error({ err }, '[ws] Session close failed')
      )
    })

    socket.on('error', (err) => {
      fastify.log.error({ err }, '[ws] Socket error')
    })
  })
}

// =============================================================================
// CallSession — owns all state for a single active call
// =============================================================================
class CallSession {
  constructor({ socket, fastify }) {
    this.socket  = socket
    this.fastify = fastify

    // Set during 'start' event
    this.streamSid   = null
    this.callSid     = null
    this.dbCallId    = null
    this.brandConfig = null
    this.fromNumber  = null  // caller's phone number
    this.toNumber    = null  // our Twilio number

    // Brand-specific tool definitions and handler mode
    this.toolDefinitions = null
    this.brandMode       = 'remodeling'  // 'remodeling' | 'steward'

    // Steward-specific: track created job for transcript attachment
    this.createdJobId = null

    // Conversation
    this.conversationHistory = []
    this.state      = 'GREETING'
    this.isSpeaking = false
    this.deepgram   = null
    this.closed     = false
  }

  // ---------------------------------------------------------------------------
  // Twilio event dispatch
  // ---------------------------------------------------------------------------
  async handleTwilioEvent(msg) {
    switch (msg.event) {
      case 'connected':
        this.fastify.log.info('[session] Media Stream connected')
        break
      case 'start':
        await this.onStart(msg.start, msg.streamSid)
        break
      case 'media':
        this.onMedia(msg.media)
        break
      case 'stop':
        this.fastify.log.info({ callSid: msg.stop?.callSid }, '[session] Twilio stop event')
        break
    }
  }

  // ---------------------------------------------------------------------------
  // 'start' — call has connected, initialize everything
  // ---------------------------------------------------------------------------
  async onStart(startData, streamSid) {
    this.streamSid = streamSid
    this.callSid   = startData.callSid

    // From/To are passed via <Parameter> in the TwiML
    this.toNumber   = startData.customParameters?.to
    this.fromNumber = startData.customParameters?.from

    this.fastify.log.info({ callSid: this.callSid, to: this.toNumber }, '[session] Call started')

    // Load the brand agent config for the dialed number
    const { data: config, error: configErr } = await supabase
      .from('voice_agent_config')
      .select('*')
      .eq('phone_number', this.toNumber)
      .eq('active', true)
      .is('deleted_at', null)
      .single()

    if (configErr || !config) {
      this.fastify.log.error({ toNumber: this.toNumber, configErr }, '[session] No agent config for number')
      this.hangUp()
      return
    }

    this.brandConfig = config

    // Select tool set based on brand
    if (config.brand_id === 'steward_home_services') {
      this.toolDefinitions = STEWARD_TOOL_DEFINITIONS
      this.brandMode       = 'steward'
    } else {
      this.toolDefinitions = REMODELING_TOOL_DEFINITIONS
      this.brandMode       = 'remodeling'
    }

    // Persist the call record
    const { data: callRow, error: insertErr } = await supabase
      .from('voice_calls')
      .insert({
        tenant_id:       config.tenant_id,
        agent_config_id: config.id,
        twilio_call_sid: this.callSid,
        direction:       'inbound',
        brand_id:        config.brand_id,
        to_number:       this.toNumber,
        from_number:     this.fromNumber,
        status:          'in_progress',
        outcome:         'in_progress',
        started_at:      new Date().toISOString(),
      })
      .select('id')
      .single()

    if (insertErr) {
      this.fastify.log.error({ insertErr }, '[session] Failed to create voice_calls row')
    }
    this.dbCallId = callRow?.id

    // Open Deepgram STT
    this.deepgram = await createDeepgramStream({
      onTranscript: (text, isFinal) => this.onTranscript(text, isFinal),
      onError:      (err) => this.fastify.log.error({ err }, '[session] Deepgram error'),
    })

    // Greet the caller
    const persona = config.persona_name ?? 'an assistant'
    const brand   = config.brand_name   ?? 'us'
    await this.speak(
      `Hi, thanks for calling ${brand}! This is ${persona}. How can I help you today?`
    )
  }

  // ---------------------------------------------------------------------------
  // 'media' — audio chunk from caller → forward to Deepgram
  // ---------------------------------------------------------------------------
  onMedia(media) {
    if (media?.track !== 'inbound') return
    const audioBuffer = Buffer.from(media.payload, 'base64')
    this.deepgram?.send(audioBuffer)
  }

  // ---------------------------------------------------------------------------
  // Transcript from Deepgram → Claude → Cartesia → Twilio
  // ---------------------------------------------------------------------------
  async onTranscript(text, isFinal) {
    if (!isFinal || !text.trim()) return
    if (this.isSpeaking) return

    this.fastify.log.info({ text, state: this.state }, '[session] Transcript')
    this.conversationHistory.push({ role: 'user', content: text })

    const result = await callAgent({
      systemPrompt:        this.brandConfig.system_prompt,
      modelId:             this.brandConfig.model_id,
      conversationHistory: this.conversationHistory,
      state:               this.state,
      toolDefinitions:     this.toolDefinitions,
    })

    if (result.text) {
      this.conversationHistory.push({ role: 'assistant', content: result.text })
      await this.speak(result.text)
    }

    if (result.newState) this.state = result.newState

    if (result.toolCalls?.length) {
      await this.handleToolCalls(result.toolCalls)
    }
  }

  // ---------------------------------------------------------------------------
  // Tool call routing — brand-aware
  // ---------------------------------------------------------------------------
  async handleToolCalls(toolCalls) {
    for (const call of toolCalls) {
      try {
        if (this.brandMode === 'steward') {
          await this.handleStewardTool(call.name, call.input)
        } else {
          await this.handleRemodelingTool(call.name, call.input)
        }
      } catch (err) {
        this.fastify.log.error({ err, tool: call.name }, '[session] Tool execution failed')
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Steward (field service booking) tool handlers
  // ---------------------------------------------------------------------------

  async handleStewardTool(name, input) {
    switch (name) {
      case 'check_availability':
        await this.stewardCheckAvailability(input)
        break
      case 'create_booking':
        await this.stewardCreateBooking(input)
        break
      case 'send_confirmation_sms':
        await this.toolSendSms({ phone: input.phone, message: input.message })
        break
      case 'escalate_to_dispatcher':
        await this.toolEscalate(input)
        break
      default:
        this.fastify.log.warn({ name }, '[session:steward] Unknown tool call')
    }
  }

  async stewardCheckAvailability(input) {
    const { preferred_date, job_type } = input
    const date = parseDateHeuristic(preferred_date)
    const dayStart = date + 'T00:00:00.000Z'
    const dayEnd   = date + 'T23:59:59.999Z'
    const relatedTypes = getRelatedJobTypes(job_type)

    const { data: techSkills } = await supabase
      .from('tech_skills')
      .select('tech_id')
      .eq('tenant_id', this.brandConfig.tenant_id)
      .in('skill', relatedTypes)

    const qualifiedTechIds = [...new Set((techSkills ?? []).map(r => r.tech_id))]

    if (qualifiedTechIds.length === 0) {
      const msg = "I'm sorry, we don't have a technician available for that service type right now. Let me connect you with our dispatch team."
      this.conversationHistory.push({ role: 'assistant', content: msg })
      await this.speak(msg)
      return
    }

    const { data: jobsOnDay } = await supabase
      .from('jobs')
      .select('tech_id')
      .eq('tenant_id', this.brandConfig.tenant_id)
      .in('tech_id', qualifiedTechIds)
      .gte('scheduled_start', dayStart)
      .lte('scheduled_start', dayEnd)
      .not('status', 'in', '(cancelled,no_show)')

    const busyTechs = new Set((jobsOnDay ?? []).map(j => j.tech_id))
    const available = qualifiedTechIds.filter(id => !busyTechs.has(id)).length

    let msg
    if (available > 0) {
      const formattedDate = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric',
      })
      msg = `We have availability on ${formattedDate}. Would morning, that's 8 to noon, or afternoon, noon to 5, work better for you?`
    } else {
      msg = `We're fully booked on that day. Would the next business day work, or would you prefer a different date?`
    }

    this.conversationHistory.push({ role: 'assistant', content: msg })
    await this.speak(msg)
  }

  async stewardCreateBooking(input) {
    const tenantId = this.brandConfig.tenant_id

    // Resolve or create customer by phone
    let customerId = null
    if (this.fromNumber) {
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('phone', this.fromNumber)
        .is('deleted_at', null)
        .single()

      if (existing) {
        customerId = existing.id
      }
    }

    if (!customerId) {
      const { data: newCust } = await supabase
        .from('customers')
        .insert({
          tenant_id: tenantId,
          name:      input.customer_name,
          phone:     this.fromNumber ?? '',
          source:    'voice_agent',
        })
        .select('id')
        .single()
      customerId = newCust?.id
    }

    // Resolve or create service location
    let locationId = null
    if (customerId && input.address) {
      const { data: existingLoc } = await supabase
        .from('service_locations')
        .select('id')
        .eq('customer_id', customerId)
        .ilike('address', `%${input.address.split(' ')[0]}%`)
        .limit(1)
        .single()

      if (existingLoc) {
        locationId = existingLoc.id
      } else {
        const { data: newLoc } = await supabase
          .from('service_locations')
          .insert({
            tenant_id:  tenantId,
            customer_id: customerId,
            address:    input.address,
            city:       input.city   ?? '',
            state:      input.state  ?? 'CA',
            zip:        input.zip    ?? '',
            is_primary: true,
          })
          .select('id')
          .single()
        locationId = newLoc?.id ?? null
      }
    }

    // Scheduled time
    const timeMap = { morning: '09:00:00', afternoon: '13:00:00', anytime: '09:00:00' }
    const timeStr = timeMap[input.preferred_time] ?? '09:00:00'
    const scheduledStart = `${input.preferred_date}T${timeStr}`

    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .insert({
        tenant_id:       tenantId,
        customer_id:     customerId,
        location_id:     locationId,
        job_type:        input.job_type,
        priority:        input.priority ?? 'normal',
        status:          'unassigned',
        scheduled_start: scheduledStart,
        description:     input.notes ?? `Booked via voice agent from ${this.fromNumber ?? 'unknown'}`,
        source:          'voice_agent',
      })
      .select('id')
      .single()

    if (jobErr) {
      this.fastify.log.error({ jobErr }, '[session:steward] Failed to create job')
      const errMsg = "I'm sorry, I ran into a problem saving your appointment. Let me connect you with our team to finish booking."
      this.conversationHistory.push({ role: 'assistant', content: errMsg })
      await this.speak(errMsg)
      return
    }

    this.createdJobId = job.id
    await this.updateOutcome('booked')

    const timeLabel = input.preferred_time === 'afternoon' ? 'afternoon' : 'morning'
    const formattedDate = new Date(input.preferred_date + 'T12:00:00Z').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    })
    const confirmation = `${formattedDate} ${timeLabel}`
    const msg = `You're all set, ${input.customer_name.split(' ')[0]}! I've got a technician scheduled for ${confirmation}. I'll send a text confirmation to your phone now.`
    this.conversationHistory.push({ role: 'assistant', content: msg })
    await this.speak(msg)
  }

  // ---------------------------------------------------------------------------
  // Remodeling (GGB / Recast) tool handlers — original implementation
  // ---------------------------------------------------------------------------

  async handleRemodelingTool(name, input) {
    switch (name) {
      case 'book_appointment':
        await this.upsertLead({ ...input, qualified: true, booked_at: new Date().toISOString() })
        await this.updateOutcome('booked')
        this.state = 'BOOK_OR_CLOSE'
        break
      case 'send_sms_summary':
        await this.toolSendSms({ phone: input.phone, message: input.message })
        break
      case 'escalate_to_human':
        await this.toolEscalate(input)
        break
      case 'save_lead':
        await this.upsertLead({ ...input, qualified: false })
        await this.updateOutcome('qualified_not_booked')
        break
      default:
        this.fastify.log.warn({ name }, '[session:remodeling] Unknown tool call')
    }
  }

  // ---------------------------------------------------------------------------
  // Shared tool implementations
  // ---------------------------------------------------------------------------

  async toolSendSms({ phone, message }) {
    const fromNumber = this.toNumber ?? this.brandConfig?.sms_sender
    if (!fromNumber || !phone) {
      this.fastify.log.warn({ phone, fromNumber }, '[session] SMS skipped — missing phone or from number')
      return
    }
    try {
      await sendSms({ to: phone, from: fromNumber, body: message })
      this.fastify.log.info({ to: phone }, '[session] Confirmation SMS sent')
    } catch (err) {
      this.fastify.log.error({ err, to: phone }, '[session] SMS send failed')
    }
  }

  async toolEscalate({ reason, summary }) {
    this.fastify.log.info({ reason, summary }, '[session] Escalating to human')
    await this.updateOutcome('escalated_human')
    this.state = 'BOOK_OR_CLOSE'

    const baseUrl = process.env.VOICE_BASE_URL
    if (!this.callSid || !baseUrl) {
      this.fastify.log.warn('[session] Cannot redirect call — VOICE_BASE_URL or callSid missing')
      return
    }

    try {
      // Redirect the in-progress call to TwiML that dials the dispatcher
      await redirectCall({
        callSid:  this.callSid,
        twimlUrl: `${baseUrl}/voice/transfer`,
      })
      this.fastify.log.info({ callSid: this.callSid }, '[session] Call redirected to dispatcher')
    } catch (err) {
      this.fastify.log.error({ err }, '[session] Failed to redirect call to dispatcher')
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  async upsertLead(fields) {
    if (!this.dbCallId || !this.brandConfig) return
    const { error } = await supabase.from('voice_leads').upsert({
      tenant_id: this.brandConfig.tenant_id,
      call_id:   this.dbCallId,
      ...fields,
    })
    if (error) this.fastify.log.error({ error }, '[session] Failed to upsert lead')
  }

  async updateOutcome(outcome) {
    if (!this.dbCallId) return
    await supabase
      .from('voice_calls')
      .update({ outcome })
      .eq('id', this.dbCallId)
  }

  // Synthesize text → mulaw 8kHz audio → stream chunks to Twilio
  async speak(text) {
    this.isSpeaking = true
    this.sendToTwilio({ event: 'clear', streamSid: this.streamSid })
    try {
      await synthesizeSpeech(text, this.brandConfig?.voice_id, (chunk) => {
        this.sendToTwilio({
          event:     'media',
          streamSid: this.streamSid,
          media:     { payload: chunk },
        })
      })
    } catch (err) {
      this.fastify.log.error({ err }, '[session] TTS failed')
    } finally {
      this.isSpeaking = false
    }
  }

  hangUp() {
    if (this.socket.readyState === 1) this.socket.close()
  }

  sendToTwilio(obj) {
    if (this.socket.readyState === 1) {
      this.socket.send(JSON.stringify(obj))
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup — called by socket 'close' event (the authoritative signal)
  // ---------------------------------------------------------------------------
  async close() {
    if (this.closed) return
    this.closed = true

    await this.deepgram?.close()

    if (this.dbCallId) {
      // Always persist the full transcript
      await supabase
        .from('voice_calls')
        .update({
          transcript:         this.conversationHistory,
          conversation_state: this.state,
        })
        .eq('id', this.dbCallId)

      // Mark 'abandoned' only if a tool call hasn't already resolved the outcome
      await supabase
        .from('voice_calls')
        .update({ outcome: 'abandoned' })
        .eq('id', this.dbCallId)
        .eq('outcome', 'in_progress')
    }

    // Steward: attach transcript as internal notes on the job that was created
    if (this.createdJobId && this.conversationHistory.length > 0) {
      const transcriptText = this.conversationHistory
        .map(m => `[${m.role === 'user' ? 'Customer' : 'Agent'}]: ${m.content}`)
        .join('\n')
      const notes = `=== Voice Booking Transcript ===\n${transcriptText}`
      await supabase
        .from('jobs')
        .update({ internal_notes: notes })
        .eq('id', this.createdJobId)
    }

    this.fastify.log.info({ callSid: this.callSid }, '[session] Session closed')
  }
}
