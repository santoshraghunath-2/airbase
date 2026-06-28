import 'dotenv/config'
import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import fastifyFormbody from '@fastify/formbody'
import { createClient } from '@supabase/supabase-js'

import { inboundRoutes } from './routes/inbound.js'
import { outboundRoutes } from './routes/outbound.js'
import { statusRoutes } from './routes/status.js'

// ---------------------------------------------------------------------------
// Env validation — fail fast before binding the port
// ---------------------------------------------------------------------------
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'VOICE_TWILIO_ACCOUNT_SID',
  'VOICE_TWILIO_AUTH_TOKEN',
  'VOICE_DEEPGRAM_API_KEY',
  'VOICE_CARTESIA_API_KEY',
  'ANTHROPIC_API_KEY',
]

const missing = REQUIRED_ENV.filter(k => !process.env[k])
if (missing.length) {
  console.error(`[voice] Missing required env vars: ${missing.join(', ')}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Supabase client — service-role key (bypasses RLS intentionally).
// Never derive tenant_id from the request body; resolve it from call context.
// ---------------------------------------------------------------------------
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
)

// ---------------------------------------------------------------------------
// Fastify instance
// ---------------------------------------------------------------------------
const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'warn' : 'info'),
  },
})

// Parse Twilio URL-encoded POST webhooks (application/x-www-form-urlencoded)
server.register(fastifyFormbody)

// WebSocket support for Twilio Media Streams
server.register(fastifyWebsocket)

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
server.register(inboundRoutes,  { prefix: '/voice' })
server.register(outboundRoutes, { prefix: '/voice' })
server.register(statusRoutes,   { prefix: '/voice' })

// Liveness probe — used by Render / Railway / any process monitor
server.get('/health', async () => ({
  status: 'ok',
  service: 'airbase-voice',
  ts: new Date().toISOString(),
}))

// ---------------------------------------------------------------------------
// Error handlers
// ---------------------------------------------------------------------------
server.setNotFoundHandler((request, reply) => {
  reply.code(404).send({ error: 'Not found', path: request.url })
})

server.setErrorHandler((error, request, reply) => {
  server.log.error({ err: error, url: request.url }, 'Unhandled error')
  reply.code(error.statusCode ?? 500).send({
    error: error.message ?? 'Internal server error',
  })
})

// ---------------------------------------------------------------------------
// Startup / shutdown
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.VOICE_SERVER_PORT ?? '3001', 10)

async function start() {
  try {
    await server.listen({ port: PORT, host: '0.0.0.0' })
    server.log.info(`[voice] Listening on port ${PORT}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

process.on('SIGTERM', async () => {
  server.log.info('[voice] SIGTERM — shutting down')
  await server.close()
  process.exit(0)
})

process.on('SIGINT', async () => {
  server.log.info('[voice] SIGINT — shutting down')
  await server.close()
  process.exit(0)
})

start()
