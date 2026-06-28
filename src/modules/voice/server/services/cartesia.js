// Cartesia TTS — streaming text-to-speech for phone calls.
// Used by routes/inbound.js CallSession.speak().
//
// Output format: pcm_mulaw at 8000 Hz — the exact encoding Twilio expects.
// Cartesia sends base64-encoded audio in JSON chunk messages, which we forward
// directly to Twilio's media event without any decoding/re-encoding step.
// This avoids an entire transcoding pass and keeps latency under 300ms.

import WebSocket from 'ws'
import { randomUUID } from 'crypto'

const CARTESIA_WS_URL    = 'wss://api.cartesia.ai/tts/websocket'
const CARTESIA_VERSION   = '2024-06-10'
const MODEL_ID           = 'sonic-english'
const SYNTHESIS_TIMEOUT  = 10_000  // ms — terminate if Cartesia hangs

/**
 * Synthesize `text` to mulaw 8kHz audio and stream base64-encoded chunks
 * via `onChunk` as they arrive. Resolves when all chunks have been sent.
 *
 * @param {string}   text     Text to synthesize
 * @param {string}   voiceId  Cartesia voice ID from voice_agent_config
 * @param {(chunk: string) => void} onChunk  Called with each base64 mulaw chunk
 * @returns {Promise<void>}
 */
export async function synthesizeSpeech(text, voiceId, onChunk) {
  const apiKey = process.env.VOICE_CARTESIA_API_KEY
  if (!apiKey)  throw new Error('VOICE_CARTESIA_API_KEY is not set')
  if (!voiceId) throw new Error('voice_id is not configured for this brand in voice_agent_config')

  return new Promise((resolve, reject) => {
    let settled   = false
    let timeoutId = null

    // settle() is idempotent — only the first call has any effect
    const settle = (err) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      if (err) reject(err)
      else     resolve()
    }

    // Safety net: terminate if Cartesia stops responding mid-stream
    timeoutId = setTimeout(() => {
      ws.terminate()
      settle(new Error('Cartesia TTS synthesis timed out'))
    }, SYNTHESIS_TIMEOUT)

    const ws = new WebSocket(CARTESIA_WS_URL, {
      headers: {
        'X-API-Key':        apiKey,
        'Cartesia-Version': CARTESIA_VERSION,
      },
    })

    ws.on('open', () => {
      ws.send(JSON.stringify({
        context_id: randomUUID(),
        model_id:   MODEL_ID,
        transcript: text,
        voice: {
          mode: 'id',
          id:   voiceId,
        },
        output_format: {
          container:   'raw',
          encoding:    'pcm_mulaw',
          sample_rate: 8000,
        },
        continue: false,
      }))
    })

    ws.on('message', (data) => {
      let msg
      try {
        msg = JSON.parse(data.toString())
      } catch {
        ws.terminate()
        settle(new Error('Cartesia sent malformed JSON'))
        return
      }

      // Error from Cartesia (bad voice ID, quota exceeded, etc.)
      if (msg.type === 'error') {
        ws.terminate()
        settle(new Error(`Cartesia error: ${msg.error ?? 'unknown'}`))
        return
      }

      // Audio chunk — base64 mulaw, forward directly to Twilio
      if (msg.type === 'chunk' && msg.data) {
        try {
          onChunk(msg.data)
        } catch (err) {
          // onChunk throwing means the Twilio WebSocket closed — stop synthesis
          ws.terminate()
          settle(err)
          return
        }
      }

      // Synthesis complete
      if (msg.done) {
        ws.close()
        settle(null)
      }
    })

    ws.on('error', (err) => settle(err))

    // If the socket closes before msg.done, something went wrong
    ws.on('close', () => {
      settle(new Error('Cartesia connection closed before synthesis completed'))
    })
  })
}
