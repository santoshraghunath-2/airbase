import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'

const ALLOWED_MODELS = [
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
  'deepseek-chat',
]

function EditConfigDialog({ config, open, onClose, onSaved }) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    persona_name:       '',
    model_id:           '',
    voice_id:           '',
    system_prompt:      '',
    booking_destination: '',
    outbound_enabled:   false,
    active:             true,
  })

  useEffect(() => {
    if (config) {
      setForm({
        persona_name:       config.persona_name       ?? '',
        model_id:           config.model_id           ?? 'claude-sonnet-4-6',
        voice_id:           config.voice_id           ?? '',
        system_prompt:      config.system_prompt      ?? '',
        booking_destination: config.booking_destination ?? '',
        outbound_enabled:   config.outbound_enabled   ?? false,
        active:             config.active             ?? true,
      })
    }
  }, [config])

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const save = async () => {
    if (!config) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('voice_agent_config')
        .update({
          persona_name:       form.persona_name,
          model_id:           form.model_id,
          voice_id:           form.voice_id       || null,
          system_prompt:      form.system_prompt,
          booking_destination: form.booking_destination || null,
          outbound_enabled:   form.outbound_enabled,
          active:             form.active,
        })
        .eq('id', config.id)

      if (error) throw error

      toast({ title: 'Saved', description: `${config.brand_name} config updated.` })
      onSaved()
      onClose()
    } catch (err) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit — {config?.brand_name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Persona name</label>
              <Input
                value={form.persona_name}
                onChange={e => set('persona_name', e.target.value)}
                placeholder="e.g. Alex"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Model</label>
              <Select value={form.model_id} onValueChange={v => set('model_id', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALLOWED_MODELS.map(m => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Cartesia voice ID</label>
            <Input
              value={form.voice_id}
              onChange={e => set('voice_id', e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Booking destination URL</label>
            <Input
              value={form.booking_destination}
              onChange={e => set('booking_destination', e.target.value)}
              placeholder="https://cal.com/..."
            />
            <p className="text-xs text-muted-foreground">
              Cal.com or Calendly booking link — used by the book_appointment tool
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">System prompt</label>
            <Textarea
              value={form.system_prompt}
              onChange={e => set('system_prompt', e.target.value)}
              rows={14}
              className="font-mono text-xs"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">
                Inactive agents do not answer calls
              </p>
            </div>
            <Switch
              checked={form.active}
              onCheckedChange={v => set('active', v)}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Outbound calling</p>
              <p className="text-xs text-muted-foreground">
                Enables form-fill callbacks (TCPA consent required on all forms)
              </p>
            </div>
            <Switch
              checked={form.outbound_enabled}
              onCheckedChange={v => set('outbound_enabled', v)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function AgentConfig({ tenantId }) {
  const [configs, setConfigs]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [editing, setEditing]   = useState(null)
  const [dialogOpen, setDialog] = useState(false)

  const load = () => {
    if (!tenantId) return
    setLoading(true)
    supabase
      .from('voice_agent_config')
      .select('*')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at')
      .then(({ data }) => {
        setConfigs(data ?? [])
        setLoading(false)
      })
  }

  useEffect(load, [tenantId])

  const openEdit = (config) => {
    setEditing(config)
    setDialog(true)
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Agent configuration</h2>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brand</TableHead>
                <TableHead>Persona</TableHead>
                <TableHead>Phone number</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Outbound</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                Array.from({ length: 2 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              )}
              {!loading && configs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No agents configured — run the seed script to add GGB Express and Recast Texas.
                  </TableCell>
                </TableRow>
              )}
              {configs.map(cfg => (
                <TableRow key={cfg.id}>
                  <TableCell className="font-medium">{cfg.brand_name}</TableCell>
                  <TableCell>{cfg.persona_name ?? '—'}</TableCell>
                  <TableCell className="font-mono text-sm">{cfg.phone_number ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{cfg.model_id}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      cfg.active
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {cfg.active ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`text-sm ${cfg.outbound_enabled ? 'text-green-700' : 'text-muted-foreground'}`}>
                      {cfg.outbound_enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(cfg)}
                    >
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <EditConfigDialog
        config={editing}
        open={dialogOpen}
        onClose={() => setDialog(false)}
        onSaved={load}
      />
    </div>
  )
}
