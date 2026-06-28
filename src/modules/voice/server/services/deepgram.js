// Deepgram STT — streaming speech-to-text for Twilio phone audio (mulaw 8kHz).
// Used by routes/inbound.js CallSession.
//
// Model: nova-2-phonecall — Deepgram's model tuned for 8kHz PSTN telephone audio.
// We use speech_final (endpointing) rather than is_final to decide when to send
// a transcript to Claude. speech_final fires after 300ms of caller silence,
// which is the signal that the caller has finished a turn.

import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk'

const KEEPALIVE_MS = 8_000   // Deepgram closes idle connections after ~10s

/**
 * Opens a Deepgram live transcription stream for one phone call.
 * Resolves once the WebSocket connection is open and ready to receive audio.
 *
 * @param {{
 *   onTranscript: (text: string, isFinal: boolean) => void,
 *   onError:      (err: Error) => void,
 * }} opts
 * @returns {Promise<{ send: (audioBuffer: Buffer) => void, close: () => Promise<void> }>}
 */
export async function createDeepgramStream({ onTranscript, onError }) {
  const apiKey = process.env.VOICE_DEEPGRAM_API_KEY
  if (!apiKey) throw new Error('VOICE_DEEPGRAM_API_KEY is not set')

  const deepgram  = createClient(apiKey)

  const connection = deepgram.listen.live({
    model:           'nova-2-phonecall', // optimized for 8kHz telephone audio
    encoding:        'mulaw',
    sample_rate:     8000,
    channels:        1,
    endpointing:     300,   // ms of silence before speech_final fires
    utterance_end_ms: 1000, // fallback: fire UtteranceEnd after 1s of silence
    interim_results: true,  // receive partials so UI can show live transcript
    smart_format:    true,  // punctuation + number formatting
  })

  // Wait for the WebSocket to open before returning — the caller should not
  // send audio until we signal ready. We use mutually exclusive one-time
  // handlers so an early error rejects cleanly without leaking listeners.
  await new Promise((resolve, reject) => {
    const onOpen = () => {
      connection.removeListener(LiveTranscriptionEvents.Error, onInitError)
      resolve()
    }
    const onInitError = (err) => {
      connection.removeListener(LiveTranscriptionEvents.Open, onOpen)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
    connection.once(LiveTranscriptionEvents.Open,  onOpen)
    connection.once(LiveTranscriptionEvents.Error, onInitError)
  })

  // Keepalive — prevents Deepgram from closing the stream during caller silence
  const keepaliveInterval = setInterval(() => {
    connection.keepAlive()
  }, KEEPALIVE_MS)

  // Transcript handler
  // isFinal here means speech_final — the caller has stopped talking (endpointing).
  // Interim results (is_final: false, speech_final: false) are passed through with
  // isFinal=false in case the UI wants to display live captions.
  connection.on(LiveTranscriptionEvents.Transcript, (data) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript ?? ''
    if (!transcript) return
    const isFinal = data.speech_final === true
    onTranscript(transcript, isFinal)
  })

  // Persistent error handler (after init, errors go to the caller's onError)
  connection.on(LiveTranscriptionEvents.Error, (err) => {
    onError(err instanceof Error ? err : new Error(String(err)))
  })

  connection.on(LiveTranscriptionEvents.Close, () => {
    clearInterval(keepaliveInterval)
  })

  return {
    /**
     * Forward a raw audio buffer from Twilio to Deepgram.
     * Input: mulaw 8kHz mono, base64-decoded back to binary by the caller.
     * @param {Buffer} audioBuffer
     */
    send(audioBuffer) {
      connection.send(audioBuffer)
    },

    /**
     * Gracefully close the Deepgram stream.
     */
    async close() {
      clearInterval(keepaliveInterval)
      connection.requestClose()
    },
  }
}
