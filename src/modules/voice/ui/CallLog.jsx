import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const OUTCOME_COLORS = {
  booked:               'bg-green-100 text-green-800',
  qualified_not_booked: 'bg-yellow-100 text-yellow-800',
  not_qualified:        'bg-gray-100 text-gray-600',
  escalated_human:      'bg-blue-100 text-blue-800',
  abandoned:            'bg-red-100 text-red-700',
  failed:               'bg-red-100 text-red-700',
  in_progress:          'bg-purple-100 text-purple-800',
  no_answer:            'bg-gray-100 text-gray-600',
  voicemail:            'bg-gray-100 text-gray-600',
}

const OUTCOME_LABELS = {
  booked:               'Booked',
  qualified_not_booked: 'Qualified',
  not_qualified:        'Not qualified',
  escalated_human:      'Escalated',
  abandoned:            'Abandoned',
  failed:               'Failed',
  in_progress:          'In progress',
  no_answer:            'No answer',
  voicemail:            'Voicemail',
}

function OutcomeBadge({ outcome }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${OUTCOME_COLORS[outcome] ?? 'bg-gray-100 text-gray-600'}`}>
      {OUTCOME_LABELS[outcome] ?? outcome}
    </span>
  )
}

function fmtDuration(secs) {
  if (!secs) return '—'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function TranscriptDrawer({ callId, open, onClose }) {
  const [call, setCall] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !callId) return
    setLoading(true)
    supabase
      .from('voice_calls')
      .select('*, voice_leads(*)')
      .eq('id', callId)
      .single()
      .then(({ data }) => { setCall(data); setLoading(false) })
  }, [callId, open])

  const turns = call?.transcript ?? []
  const lead  = call?.voice_leads?.[0] ?? null

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Call transcript</DialogTitle>
        </DialogHeader>

        {loading && <Skeleton className="h-40 w-full" />}

        {!loading && call && (
          <div className="space-y-4">
            {/* Call metadata */}
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span>{fmtTime(call.started_at)}</span>
              <span>·</span>
              <span>{call.brand_id}</span>
              <span>·</span>
              <span>{call.direction}</span>
              <span>·</span>
              <OutcomeBadge outcome={call.outcome} />
            </div>

            {/* Lead card if present */}
            {lead && (
              <div className="rounded-lg border p-3 text-sm space-y-1">
                <p className="font-medium">Lead captured</p>
                {lead.name  && <p>Name: {lead.name}</p>}
                {lead.phone && <p>Phone: {lead.phone}</p>}
                {lead.email && <p>Email: {lead.email}</p>}
                {lead.zip   && <p>ZIP: {lead.zip}</p>}
                {lead.project_type && <p>Project: {lead.project_type}</p>}
                {lead.budget_range && <p>Budget: {lead.budget_range}</p>}
                {lead.booked_at && (
                  <p className="text-green-700 font-medium">
                    Booked: {fmtTime(lead.booked_at)}
                  </p>
                )}
              </div>
            )}

            {/* Transcript turns */}
            {turns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transcript recorded.</p>
            ) : (
              <div className="space-y-2">
                {turns.map((turn, i) => (
                  <div
                    key={i}
                    className={`flex gap-2 ${turn.role === 'assistant' ? 'flex-row-reverse' : ''}`}
                  >
                    <span className="mt-1 shrink-0 text-xs text-muted-foreground">
                      {turn.role === 'user' ? 'Caller' : 'Agent'}
                    </span>
                    <div
                      className={`rounded-lg px-3 py-2 text-sm max-w-[80%] ${
                        turn.role === 'user'
                          ? 'bg-muted'
                          : 'bg-primary text-primary-foreground'
                      }`}
                    >
                      {turn.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

const PAGE_SIZE = 25

export default function CallLog({ tenantId }) {
  const [calls, setCalls]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [offset, setOffset]       = useState(0)
  const [hasMore, setHasMore]     = useState(false)
  const [brandFilter, setBrand]   = useState('all')
  const [outcomeFilter, setOutcome] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [drawerOpen, setDrawer]   = useState(false)

  const load = useCallback(async (off = 0) => {
    if (!tenantId) return
    setLoading(true)

    let q = supabase
      .from('voice_calls')
      .select(`
        id, direction, brand_id, from_number, to_number,
        status, outcome, duration_seconds, started_at
      `)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(off, off + PAGE_SIZE - 1)

    if (brandFilter   !== 'all') q = q.eq('brand_id', brandFilter)
    if (outcomeFilter !== 'all') q = q.eq('outcome',  outcomeFilter)

    const { data } = await q
    const rows = data ?? []
    setCalls(off === 0 ? rows : prev => [...prev, ...rows])
    setHasMore(rows.length === PAGE_SIZE)
    setOffset(off)
    setLoading(false)
  }, [tenantId, brandFilter, outcomeFilter])

  useEffect(() => { load(0) }, [load])

  const openTranscript = (id) => {
    setSelectedId(id)
    setDrawer(true)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Call log</CardTitle>
          <div className="flex gap-2">
            <Select value={brandFilter} onValueChange={v => { setBrand(v); load(0) }}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All brands" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All brands</SelectItem>
                <SelectItem value="ggb_express">GGB Express</SelectItem>
                <SelectItem value="recast_texas">Recast Texas</SelectItem>
              </SelectContent>
            </Select>

            <Select value={outcomeFilter} onValueChange={v => { setOutcome(v); load(0) }}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All outcomes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All outcomes</SelectItem>
                <SelectItem value="booked">Booked</SelectItem>
                <SelectItem value="qualified_not_booked">Qualified</SelectItem>
                <SelectItem value="not_qualified">Not qualified</SelectItem>
                <SelectItem value="escalated_human">Escalated</SelectItem>
                <SelectItem value="abandoned">Abandoned</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Number</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && calls.length === 0 && (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            )}
            {!loading && calls.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No calls yet
                </TableCell>
              </TableRow>
            )}
            {calls.map(call => (
              <TableRow key={call.id} className="cursor-pointer hover:bg-muted/50">
                <TableCell className="text-sm">{fmtTime(call.started_at)}</TableCell>
                <TableCell className="text-sm capitalize">
                  {call.brand_id?.replace('_', ' ') ?? '—'}
                </TableCell>
                <TableCell className="text-sm capitalize">{call.direction}</TableCell>
                <TableCell className="text-sm font-mono">
                  {call.direction === 'inbound' ? call.from_number : call.to_number}
                </TableCell>
                <TableCell className="text-sm">{fmtDuration(call.duration_seconds)}</TableCell>
                <TableCell><OutcomeBadge outcome={call.outcome} /></TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openTranscript(call.id)}
                  >
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {hasMore && (
          <div className="flex justify-center py-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => load(offset + PAGE_SIZE)}
              disabled={loading}
            >
              Load more
            </Button>
          </div>
        )}
      </CardContent>

      <TranscriptDrawer
        callId={selectedId}
        open={drawerOpen}
        onClose={() => setDrawer(false)}
      />
    </Card>
  )
}
