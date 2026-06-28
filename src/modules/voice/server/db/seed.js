// Seed script — inserts initial voice_agent_config rows for GGB Express and Recast Texas.
// Run once after schema.sql has been applied:
//
//   cd src/modules/voice
//   node server/db/seed.js
//
// Safe to run multiple times — uses upsert on (tenant_id, brand_id).
// TENANT_ID must be set in the environment (copy from the tenants table in Supabase).

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { GGB_EXPRESS_SYSTEM_PROMPT, GGB_EXPRESS_CONFIG } from '../agents/ggb-express-agent.js'
import { RECAST_TEXAS_SYSTEM_PROMPT, RECAST_TEXAS_CONFIG } from '../agents/recast-texas-agent.js'

const TENANT_ID = process.env.SEED_TENANT_ID
if (!TENANT_ID) {
  console.error('SEED_TENANT_ID env var is required — copy the tenant UUID from Supabase')
  process.exit(1)
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
)

const rows = [
  {
    tenant_id:          TENANT_ID,
    brand_id:           GGB_EXPRESS_CONFIG.brandId,
    brand_name:         GGB_EXPRESS_CONFIG.brandName,
    persona_name:       GGB_EXPRESS_CONFIG.personaName,
    system_prompt:      GGB_EXPRESS_SYSTEM_PROMPT,
    model_id:           GGB_EXPRESS_CONFIG.modelId,
    voice_id:           process.env.VOICE_CARTESIA_VOICE_ID_GGB ?? null,
    phone_number:       process.env.VOICE_TWILIO_PHONE_NUMBER_GGB ?? null,
    outbound_enabled:   GGB_EXPRESS_CONFIG.outboundEnabled,
    booking_destination: GGB_EXPRESS_CONFIG.bookingDestination,
    sms_sender:         GGB_EXPRESS_CONFIG.smsSender,
    active:             true,
  },
  {
    tenant_id:          TENANT_ID,
    brand_id:           RECAST_TEXAS_CONFIG.brandId,
    brand_name:         RECAST_TEXAS_CONFIG.brandName,
    persona_name:       RECAST_TEXAS_CONFIG.personaName,
    system_prompt:      RECAST_TEXAS_SYSTEM_PROMPT,
    model_id:           RECAST_TEXAS_CONFIG.modelId,
    voice_id:           process.env.VOICE_CARTESIA_VOICE_ID_RECAST ?? null,
    phone_number:       process.env.VOICE_TWILIO_PHONE_NUMBER_RECAST ?? null,
    outbound_enabled:   RECAST_TEXAS_CONFIG.outboundEnabled,
    booking_destination: RECAST_TEXAS_CONFIG.bookingDestination,
    sms_sender:         RECAST_TEXAS_CONFIG.smsSender,
    active:             true,
  },
]

const { data, error } = await supabase
  .from('voice_agent_config')
  .upsert(rows, { onConflict: 'tenant_id,brand_id' })
  .select('id, brand_id, brand_name')

if (error) {
  console.error('Seed failed:', error.message)
  process.exit(1)
}

console.log('Seeded voice_agent_config:')
for (const row of data) {
  console.log(`  ${row.brand_id} (${row.brand_name}) — id: ${row.id}`)
}
