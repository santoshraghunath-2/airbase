import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

const STATE_LABELS = {
  GREETING:         'Greeting',
  QUALIFY_PROJECT:  'Project',
  QUALIFY_BUDGET:   'Budget',
  QUALIFY_TIMELINE: 'Timeline',
  QUALIFY_CONTACT:  'Contact info',
  BOOK_OR_CLOSE:    'Booking',
}

const STATE_STEP = {
  GREETING:         1,
  QUALIFY_PROJECT:  2,
  QUALIFY_BUDGET:   3,
  QUALIFY_TIMELINE: 4,
  QUALIFY_CONTACT:  5,
  BOOK_OR_CLOSE:    6,
}

function elapsed(startedAt) {
  if (!startedAt) return '0:00'
  const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function ConversationProgress({ state }) {
  const steps = Object.keys(STATE_STEP)
  const current = STATE_STEP[state] ?? 0
  return (
    <div className="flex items-center gap-1 mt-2">
      {steps.map(s => (
        <div
          key={s}
          className={`h-1.5 flex-1 rounded-full transition-colors ${
            STATE_STEP[s] <= current ? 'bg-primary' : 'bg-muted'
          }`}
          title={STATE_LABELS[s]}
        />
      ))}
    </div>
  )
}

function ActiveCallCard({ call, tick }) {
  return (
    <div className="rounded-lg border p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Pulsing green dot */}
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          <span className="text-sm font-medium capitalize">
            {call.brand_id?.replace('_', ' ') ?? 'Unknown brand'}
          </span>
          <Badge variant="outline" className="text-xs">
            {call.direction}
          </Badge>
        </div>
        <span className="text-sm text-muted-foreground font-mono">
          {elapsed(call.started_at)}
        </span>
      </div>

      <p className="text-sm text-muted-foreground font-mono">
        {call.from_number ?? call.to_number ?? '—'}
      </p>

      <div>
        <p className="text-xs text-muted-foreground">
          State: {STATE_LABELS[call.conversation_state] ?? call.conversation_state ?? 'Greeting'}
        </p>
        <ConversationProgress state={call.conversation_state ?? 'GREETING'} />
      </div>
    </div>
  )
}

export default function LiveCall({ tenantId }) {
  const [activeCalls, setActiveCalls] = useState([])
  const [loading, setLoading]         = useState(true)
  const [tick, setTick]               = useState(0)

  // Load active calls
  useEffect(() => {
    if (!tenantId) return
    setLoading(true)

    supabase
      .from('voice_calls')
      .select('id, brand_id, from_number, to_number, direction, conversation_state, started_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'in_progress')
      .is('deleted_at', null)
      .order('started_at', { ascending: false })
      .then(({ data }) => {
        setActiveCalls(data ?? [])
        setLoading(false)
      })
  }, [tenantId])

  // Realtime subscription — keep the active call list current
  useEffect(() => {
    if (!tenantId) return

    const channel = supabase
      .channel('voice-live-calls')
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'public',
          table:  'voice_calls',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const updated = payload.new

          if (updated.status === 'in_progress') {
            // Upsert into active list
            setActiveCalls(prev => {
              const exists = prev.some(c => c.id === updated.id)
              if (exists) return prev.map(c => c.id === updated.id ? updated : c)
              return [updated, ...prev]
            })
          } else {
            // Remove from active list when call ends
            setActiveCalls(prev => prev.filter(c => c.id !== updated.id))
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [tenantId])

  // Clock tick for elapsed time display
  useEffect(() => {
    if (activeCalls.length === 0) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [activeCalls.length])

  if (activeCalls.length === 0 && !loading) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Live calls
          {activeCalls.length > 0 && (
            <Badge className="bg-green-500 text-white">
              {activeCalls.length} active
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeCalls.map(call => (
              <ActiveCallCard key={call.id} call={call} tick={tick} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
