// Centralised DB query helpers for the Voice Module.
// Used by the UI components (via a thin API layer) and by server routes
// that need richer queries than a single supabase.from().select() call.
//
// All functions accept an explicit tenantId — never derive it from request body.

import { supabase } from '../index.js'

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/**
 * Paginated call log for a tenant, newest first.
 *
 * @param {string} tenantId
 * @param {{ limit?: number, offset?: number, brandId?: string, outcome?: string }} opts
 */
export async function getRecentCalls(tenantId, { limit = 50, offset = 0, brandId, outcome } = {}) {
  let q = supabase
    .from('voice_calls')
    .select(`
      id, direction, brand_id, from_number, to_number,
      status, outcome, duration_seconds, summary,
      started_at, ended_at, created_at
    `)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (brandId)  q = q.eq('brand_id', brandId)
  if (outcome)  q = q.eq('outcome', outcome)

  const { data, error } = await q
  if (error) throw error
  return data
}

/**
 * Single call with its full transcript and associated lead.
 *
 * @param {string} callId
 */
export async function getCallWithTranscript(callId) {
  const { data, error } = await supabase
    .from('voice_calls')
    .select('*, voice_leads(*)')
    .eq('id', callId)
    .single()
  if (error) throw error
  return data
}

/**
 * Aggregate call stats for a tenant over the last N days.
 *
 * @param {string} tenantId
 * @param {{ days?: number }} opts
 * @returns {{ total: number, booked: number, avgDuration: number, conversionRate: number }}
 */
export async function getCallStats(tenantId, { days = 7 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('voice_calls')
    .select('outcome, duration_seconds, brand_id')
    .eq('tenant_id', tenantId)
    .gte('created_at', since)
    .is('deleted_at', null)

  if (error) throw error

  const total       = data.length
  const booked      = data.filter(c => c.outcome === 'booked').length
  const totalSecs   = data.reduce((s, c) => s + (c.duration_seconds ?? 0), 0)
  const avgDuration = total > 0 ? Math.round(totalSecs / total) : 0

  return {
    total,
    booked,
    avgDuration,
    conversionRate: total > 0 ? booked / total : 0,
  }
}

/**
 * Currently active (in-progress) calls for a tenant.
 * Used by the LiveCall dashboard.
 *
 * @param {string} tenantId
 */
export async function getActiveCalls(tenantId) {
  const { data, error } = await supabase
    .from('voice_calls')
    .select('id, brand_id, from_number, direction, conversation_state, started_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'in_progress')
    .is('deleted_at', null)
    .order('started_at', { ascending: false })

  if (error) throw error
  return data
}

// ---------------------------------------------------------------------------
// Agent config
// ---------------------------------------------------------------------------

/**
 * All agent configs for a tenant (active and inactive).
 *
 * @param {string} tenantId
 */
export async function getAgentConfigs(tenantId) {
  const { data, error } = await supabase
    .from('voice_agent_config')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('created_at')

  if (error) throw error
  return data
}

/**
 * Update mutable fields on an agent config.
 * Only allows a safe subset of fields to be modified.
 *
 * @param {string} configId
 * @param {{ system_prompt?: string, persona_name?: string, voice_id?: string,
 *           model_id?: string, active?: boolean, outbound_enabled?: boolean,
 *           booking_destination?: string }} fields
 */
export async function updateAgentConfig(configId, fields) {
  const ALLOWED = [
    'system_prompt', 'persona_name', 'voice_id', 'model_id',
    'active', 'outbound_enabled', 'booking_destination', 'sms_sender',
  ]
  const safe = Object.fromEntries(
    Object.entries(fields).filter(([k]) => ALLOWED.includes(k))
  )

  const { data, error } = await supabase
    .from('voice_agent_config')
    .update(safe)
    .eq('id', configId)
    .select()
    .single()

  if (error) throw error
  return data
}
