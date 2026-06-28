import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import CallLog from './CallLog'
import LiveCall from './LiveCall'

function StatCard({ title, value, sub, loading }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <>
            <p className="text-3xl font-bold">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function fmtDuration(seconds) {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

function fmtPct(rate) {
  return `${Math.round(rate * 100)}%`
}

export default function VoiceDashboard({ tenantId }) {
  const [stats, setStats]         = useState(null)
  const [statsLoading, setLoading] = useState(true)
  const [window, setWindow]       = useState(7)

  useEffect(() => {
    if (!tenantId) return
    setLoading(true)

    const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000).toISOString()

    supabase
      .from('voice_calls')
      .select('outcome, duration_seconds, brand_id')
      .eq('tenant_id', tenantId)
      .gte('created_at', since)
      .is('deleted_at', null)
      .then(({ data, error }) => {
        if (error || !data) { setLoading(false); return }

        const total       = data.length
        const booked      = data.filter(c => c.outcome === 'booked').length
        const totalSecs   = data.reduce((s, c) => s + (c.duration_seconds ?? 0), 0)
        const avgDuration = total > 0 ? Math.round(totalSecs / total) : 0

        setStats({ total, booked, avgDuration, rate: total > 0 ? booked / total : 0 })
        setLoading(false)
      })
  }, [tenantId, window])

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Voice</h1>
        <div className="flex gap-2">
          {[7, 30].map(d => (
            <button
              key={d}
              onClick={() => setWindow(d)}
              className={`text-sm px-3 py-1 rounded-md border transition-colors ${
                window === d
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:border-primary'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Total calls"
          value={stats?.total ?? '—'}
          sub={`last ${window} days`}
          loading={statsLoading}
        />
        <StatCard
          title="Appointments booked"
          value={stats?.booked ?? '—'}
          loading={statsLoading}
        />
        <StatCard
          title="Conversion rate"
          value={stats ? fmtPct(stats.rate) : '—'}
          loading={statsLoading}
        />
        <StatCard
          title="Avg call duration"
          value={stats ? fmtDuration(stats.avgDuration) : '—'}
          loading={statsLoading}
        />
      </div>

      {/* Active calls */}
      <LiveCall tenantId={tenantId} />

      {/* Call log */}
      <CallLog tenantId={tenantId} />
    </div>
  )
}
