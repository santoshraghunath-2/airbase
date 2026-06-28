// POST /voice/inbound  — Twilio voice webhook → returns TwiML that opens a
//                        bidirectional Media Stream back to /voice/ws
// GET  /voice/ws       — Twilio Media Stream WebSocket
//                        Audio pipeline: Twilio → Deepgram → Claude → Cartesia → Twilio

import { supabase } from '../index.js'
import { createDeepgramStream } from '../services/deepgram.js'
import { synthesizeSpeech } from '../services/cartesia.js'
import { callAgent } from '../services/claude.js'

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

    // From/To are passed via <Parameter> in the TwiML (Twilio omits them from
    // the start envelope itself).
    const toNumber   = startData.customParameters?.to
    const fromNumber = startData.customParameters?.from

    this.fastify.log.info({ callSid: this.callSid, to: toNumber }, '[session] Call started')

    // Load the brand agent config for the dialed number
    const { data: config, error: configErr } = await supabase
      .from('voice_agent_config')
      .select('*')
      .eq('phone_number', toNumber)
      .eq('active', true)
      .is('deleted_at', null)
      .single()

    if (configErr || !config) {
      this.fastify.log.error({ toNumber, configErr }, '[session] No agent config for number')
      this.hangUp()
      return
    }

    this.brandConfig = config

    // Persist the call record so status callbacks and this session share the row
    const { data: callRow, error: insertErr } = await supabase
      .from('voice_calls')
      .insert({
        tenant_id:       config.tenant_id,
        agent_config_id: config.id,
        twilio_call_sid: this.callSid,
        direction:       'inbound',
        brand_id:        config.brand_id,
        to_number:       toNumber,
        from_number:     fromNumber,
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

    // Open Deepgram STT — transcripts drive the conversation loop
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
    // Twilio sends both 'inbound' (caller) and 'outbound' (our TTS) tracks.
    // We only send caller audio to Deepgram.
    if (media?.track !== 'inbound') return
    const audioBuffer = Buffer.from(media.payload, 'base64')
    this.deepgram?.send(audioBuffer)
  }

  // ---------------------------------------------------------------------------
  // Transcript from Deepgram → Claude → Cartesia → Twilio
  // ---------------------------------------------------------------------------
  async onTranscript(text, isFinal) {
    if (!isFinal || !text.trim()) return

    // Basic barge-in protection: skip new input while we're speaking.
    // Full barge-in (interrupt mid-speech) can be added later.
    if (this.isSpeaking) return

    this.fastify.log.info({ text, state: this.state }, '[session] Transcript')
    this.conversationHistory.push({ role: 'user', content: text })

    const result = await callAgent({
      systemPrompt:        this.brandConfig.system_prompt,
      modelId:             this.brandConfig.model_id,
      conversationHistory: this.conversationHistory,
      state:               this.state,
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
  // Tool call execution
  // ---------------------------------------------------------------------------
  async handleToolCalls(toolCalls) {
    for (const call of toolCalls) {
      try {
        switch (call.name) {
          case 'book_appointment':  await this.toolBookAppointment(call.input); break
          case 'send_sms_summary':  await this.toolSendSms(call.input);         break
          case 'escalate_to_human': await this.toolEscalate(call.input);        break
          case 'save_lead':         await this.toolSaveLead(call.input);        break
          default:
            this.fastify.log.warn({ name: call.name }, '[session] Unknown tool call')
        }
      } catch (err) {
        this.fastify.log.error({ err, tool: call.name }, '[session] Tool execution failed')
      }
    }
  }

  async toolBookAppointment(input) {
    // TODO: integrate Cal.com / Calendly booking API
    await this.upsertLead({ ...input, qualified: true, booked_at: new Date().toISOString() })
    await this.updateOutcome('booked')
    this.state = 'BOOK_OR_CLOSE'
  }

  async toolSendSms(input) {
    // TODO: services/twilio.js sendSms()
    this.fastify.log.info({ to: input.phone }, '[session] SMS queued (not yet implemented)')
  }

  async toolEscalate(input) {
    this.fastify.log.info({ reason: input.reason }, '[session] Escalating to human')
    await this.updateOutcome('escalated_human')
    this.state = 'BOOK_OR_CLOSE'
    // TODO: Twilio REST API — redirect call to <Dial> a live agent number
  }

  async toolSaveLead(input) {
    await this.upsertLead({ ...input, qualified: false })
    await this.updateOutcome('qualified_not_booked')
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

    // Discard any audio Twilio is currently buffering (avoids overlap)
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
    // Closing the WebSocket causes Twilio to end the call
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
      // Always persist the transcript
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

    this.fastify.log.info({ callSid: this.callSid }, '[session] Session closed')
  }
}
