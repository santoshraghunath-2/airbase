import { useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Megaphone, Plus, Send, Sparkles, Loader2, Users, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Campaign {
  id:              string;
  name:            string;
  segment:         string;
  channel:         string;
  message_text:    string;
  status:          string;
  sent_at:         string | null;
  recipient_count: number;
  sent_count:      number;
  failed_count:    number;
  created_at:      string;
}

// ─── Segment definitions ──────────────────────────────────────────────────────

const JOB_TYPE_OPTIONS = [
  { value: "plumbing_service",    label: "Plumbing service" },
  { value: "drain_cleaning",      label: "Drain cleaning" },
  { value: "water_heater_repair", label: "Water heater repair" },
  { value: "water_heater_install",label: "Water heater install" },
  { value: "hvac_service",        label: "HVAC service" },
  { value: "hvac_repair",         label: "HVAC repair" },
  { value: "hvac_install",        label: "HVAC install" },
  { value: "hvac_maintenance",    label: "HVAC maintenance" },
  { value: "general_maintenance", label: "General maintenance" },
];

interface SegmentDef {
  value:       string;
  label:       string;
  description: string;
  hint:        string;
}

const SEGMENTS: SegmentDef[] = [
  {
    value:       "reactivation",
    label:       "Win-back",
    description: "No job in 6+ months",
    hint:        "Re-engage customers who've gone quiet",
  },
  {
    value:       "member_upsell",
    label:       "Membership upsell",
    description: "Active, no plan",
    hint:        "Pitch your maintenance plan to unprotected customers",
  },
  {
    value:       "seasonal_blast",
    label:       "Seasonal blast",
    description: "All customers",
    hint:        "Broadest reach — AC tune-ups, winterization, etc.",
  },
  {
    value:       "job_type_followup",
    label:       "Job follow-up",
    description: "Recent job type",
    hint:        "Follow up on customers who had a specific service",
  },
  {
    value:       "equipment_aging",
    label:       "Equipment aging",
    description: "Aging equipment",
    hint:        "Reach owners before their equipment fails",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  draft:     "bg-muted text-muted-foreground border-border",
  scheduled: "bg-waiting-bg text-waiting-text border-waiting-border",
  sending:   "bg-ai-tint text-ai-ink border-ai-tint-border",
  sent:      "bg-confirmed-bg text-confirmed-text border-confirmed-border",
  cancelled: "bg-blocked-bg text-blocked-text border-blocked-border",
};

function segmentLabel(s: string) {
  return SEGMENTS.find((x) => x.value === s)?.label ?? s;
}

// ─── Campaign list row ────────────────────────────────────────────────────────

function CampaignRow({ c }: { c: Campaign }) {
  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-line last:border-0 hover:bg-raised transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink truncate">{c.name}</p>
        <p className="text-xs text-ink-muted mt-0.5">
          {segmentLabel(c.segment)} · SMS
          {c.sent_at ? ` · Sent ${format(new Date(c.sent_at), "MMM d, yyyy")}` : ""}
        </p>
      </div>
      <div className="text-right flex-shrink-0 text-xs text-ink-muted">
        {c.status === "sent" ? (
          <div className="space-y-0.5">
            <p className="font-semibold text-ink">{c.sent_count} sent</p>
            {c.failed_count > 0 && (
              <p className="text-blocked-text">{c.failed_count} failed</p>
            )}
          </div>
        ) : (
          <p>{c.recipient_count} recipients</p>
        )}
      </div>
      <Badge variant="outline" className={cn("text-[10px] border flex-shrink-0", STATUS_COLOR[c.status])}>
        {c.status}
      </Badge>
    </div>
  );
}

// ─── New campaign dialog ──────────────────────────────────────────────────────

interface DialogState {
  step:           1 | 2;
  name:           string;
  segment:        string;
  inactiveMonths: number;
  jobType:        string;
  followupDays:   number;
  equipmentYears: number;
  intent:         string;
  message:        string;
  recipientCount: number | null;
  drafting:       boolean;
  sending:        boolean;
}

const INITIAL: DialogState = {
  step:           1,
  name:           "",
  segment:        "",
  inactiveMonths: 6,
  jobType:        "water_heater_repair",
  followupDays:   90,
  equipmentYears: 10,
  intent:         "",
  message:        "",
  recipientCount: null,
  drafting:       false,
  sending:        false,
};

function buildSegmentParams(s: DialogState): Record<string, unknown> {
  if (s.segment === "reactivation")      return { inactive_months: s.inactiveMonths };
  if (s.segment === "job_type_followup") return { job_type: s.jobType, days: s.followupDays };
  if (s.segment === "equipment_aging")   return { years: s.equipmentYears };
  return {};
}

function NewCampaignDialog({
  open,
  onClose,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const [s, setS] = useState<DialogState>(INITIAL);
  const set = (patch: Partial<DialogState>) => setS((p) => ({ ...p, ...patch }));

  function reset() {
    setS(INITIAL);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function draftWithAI() {
    if (!s.segment || !s.intent.trim()) return;
    set({ drafting: true });
    try {
      const { data, error } = await supabase.functions.invoke("ai-draft-campaign", {
        body: {
          segment:        s.segment,
          segment_params: buildSegmentParams(s),
          intent:         s.intent,
        },
      });
      if (error) throw error;
      const res = data as { message: string; recipient_count: number };
      set({ message: res.message, recipientCount: res.recipient_count });
    } catch (err) {
      toast.error("Draft failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ drafting: false });
    }
  }

  async function send() {
    if (!s.name.trim() || !s.segment || !s.message.trim()) return;
    set({ sending: true });
    try {
      const { data, error } = await supabase.functions.invoke("send-campaign", {
        body: {
          name:           s.name.trim(),
          segment:        s.segment,
          segment_params: buildSegmentParams(s),
          message:        s.message.trim(),
        },
      });
      if (error) throw error;
      const res = data as { sent_count: number; failed_count: number };
      toast.success(
        `Campaign sent to ${res.sent_count} customer${res.sent_count !== 1 ? "s" : ""}`,
        res.failed_count > 0 ? { description: `${res.failed_count} failed to deliver` } : undefined,
      );
      handleClose();
      onSent();
    } catch (err) {
      toast.error("Send failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ sending: false });
    }
  }

  const canAdvance = s.name.trim().length > 0 && s.segment !== "";
  const canSend    = s.message.trim().length > 0 && !s.sending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {s.step === 1 ? "New campaign" : "Draft & send"}
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-1">
          {[1, 2].map((n) => (
            <div
              key={n}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                n <= s.step ? "bg-ink" : "bg-line",
              )}
            />
          ))}
        </div>

        {/* ── Step 1: Setup ── */}
        {s.step === 1 && (
          <div className="space-y-5 pt-1">
            <div className="space-y-1.5">
              <Label>Campaign name</Label>
              <Input
                placeholder="e.g. Summer AC tune-up offer"
                value={s.name}
                onChange={(e) => set({ name: e.target.value })}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label>Who are you reaching?</Label>
              <div className="grid grid-cols-1 gap-2">
                {SEGMENTS.map((seg) => (
                  <button
                    key={seg.value}
                    onClick={() => set({ segment: seg.value })}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                      s.segment === seg.value
                        ? "border-ink bg-raised"
                        : "border-line bg-paper hover:bg-raised",
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        "text-sm font-semibold",
                        s.segment === seg.value ? "text-ink" : "text-ink-2",
                      )}>
                        {seg.label}
                        <span className={cn(
                          "ml-2 text-[11px] font-normal",
                          s.segment === seg.value ? "text-ink-muted" : "text-ink-muted",
                        )}>
                          {seg.description}
                        </span>
                      </p>
                      <p className="text-xs text-ink-muted mt-0.5">{seg.hint}</p>
                    </div>
                    <div className={cn(
                      "h-4 w-4 mt-0.5 rounded-full border-2 flex-shrink-0 transition-colors",
                      s.segment === seg.value ? "border-ink bg-ink" : "border-line",
                    )} />
                  </button>
                ))}
              </div>
            </div>

            {/* Segment params */}
            {s.segment === "reactivation" && (
              <div className="flex items-center gap-2">
                <Label className="whitespace-nowrap">Inactive for at least</Label>
                <Input
                  type="number" min={1} max={36}
                  value={s.inactiveMonths}
                  onChange={(e) => set({ inactiveMonths: parseInt(e.target.value) || 6 })}
                  className="w-20"
                />
                <span className="text-sm text-ink-muted">months</span>
              </div>
            )}
            {s.segment === "job_type_followup" && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Job type</Label>
                  <Select value={s.jobType} onValueChange={(v) => set({ jobType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {JOB_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="whitespace-nowrap">In the last</Label>
                  <Input
                    type="number" min={7} max={365}
                    value={s.followupDays}
                    onChange={(e) => set({ followupDays: parseInt(e.target.value) || 90 })}
                    className="w-20"
                  />
                  <span className="text-sm text-ink-muted">days</span>
                </div>
              </div>
            )}
            {s.segment === "equipment_aging" && (
              <div className="flex items-center gap-2">
                <Label className="whitespace-nowrap">Equipment older than</Label>
                <Input
                  type="number" min={1} max={30}
                  value={s.equipmentYears}
                  onChange={(e) => set({ equipmentYears: parseInt(e.target.value) || 10 })}
                  className="w-20"
                />
                <span className="text-sm text-ink-muted">years</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={() => set({ step: 2 })} disabled={!canAdvance}>
                Next →
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Draft & Send ── */}
        {s.step === 2 && (
          <div className="space-y-4 pt-1">
            <div className="rounded-lg bg-raised border border-line px-3 py-2 text-xs text-ink-muted">
              <span className="font-semibold text-ink">{s.name}</span>
              {" · "}
              {segmentLabel(s.segment)}
            </div>

            <div className="space-y-1.5">
              <Label>Campaign goal</Label>
              <Textarea
                placeholder="e.g. Offer a $50 discount on AC tune-ups before summer heat hits"
                value={s.intent}
                onChange={(e) => set({ intent: e.target.value })}
                rows={2}
              />
            </div>

            <Button
              variant="outline"
              className="w-full border-ai-tint-border text-ai-ink hover:bg-ai-tint"
              onClick={() => void draftWithAI()}
              disabled={!s.intent.trim() || s.drafting}
            >
              {s.drafting
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> Drafting…</>
                : <><Sparkles className="h-3.5 w-3.5 mr-2" /> Draft with AI</>
              }
            </Button>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Message</Label>
                {s.recipientCount !== null && (
                  <span className="flex items-center gap-1 text-xs text-ink-muted">
                    <Users className="h-3 w-3" />
                    {s.recipientCount} recipient{s.recipientCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <Textarea
                placeholder="Your message will appear here after drafting…"
                value={s.message}
                onChange={(e) => set({ message: e.target.value })}
                rows={4}
              />
              <p className="text-[11px] text-ink-muted">
                "Reply STOP to opt out." is appended automatically.
              </p>
            </div>

            {s.recipientCount === 0 && s.recipientCount !== null && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                No customers match this segment — adjust the filters and try again.
              </div>
            )}

            <div className="rounded-lg bg-muted/50 border border-line px-3 py-2.5 text-xs text-ink-muted">
              <span className="font-medium text-ink-2">Scheduled sends</span> — coming soon once pg_cron is configured.
            </div>

            <div className="flex justify-between gap-2 pt-1">
              <Button variant="ghost" onClick={() => set({ step: 1 })}>
                ← Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose}>Cancel</Button>
                <Button
                  onClick={() => void send()}
                  disabled={!canSend || s.recipientCount === 0}
                >
                  {s.sending
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />Sending…</>
                    : <><Send className="h-3.5 w-3.5 mr-2" />Send now</>
                  }
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const { tenant } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading]     = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    void load();
  }, [tenant]);

  async function load() {
    if (!tenant) return;
    setLoading(true);
    const { data } = await supabase
      .from("campaigns")
      .select("*")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setCampaigns((data as Campaign[]) ?? []);
    setLoading(false);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Campaigns</h1>
          <p className="text-sm text-ink-muted mt-0.5">AI-drafted SMS campaigns to targeted customer segments</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" /> New campaign
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-16 text-center space-y-3">
          <Megaphone className="h-8 w-8 text-ink-muted mx-auto" />
          <p className="text-sm font-medium text-ink">No campaigns yet</p>
          <p className="text-xs text-ink-muted">
            Create your first campaign to reach customers with AI-drafted messages.
          </p>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Create campaign
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-line overflow-hidden bg-paper">
          {campaigns.map((c) => <CampaignRow key={c.id} c={c} />)}
        </div>
      )}

      {/* Stats strip for sent campaigns */}
      {!loading && campaigns.some((c) => c.status === "sent") && (
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              label: "Total sent",
              value: campaigns.reduce((n, c) => n + (c.sent_count ?? 0), 0).toLocaleString(),
            },
            {
              label: "Campaigns run",
              value: campaigns.filter((c) => c.status === "sent").length.toString(),
            },
            {
              label: "Avg delivery rate",
              value: (() => {
                const sent     = campaigns.filter((c) => c.status === "sent");
                const total    = sent.reduce((n, c) => n + c.recipient_count, 0);
                const delivered= sent.reduce((n, c) => n + c.sent_count, 0);
                if (!total) return "—";
                return `${Math.round((delivered / total) * 100)}%`;
              })(),
            },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-line bg-paper px-4 py-3">
              <p className="text-xs text-ink-muted">{label}</p>
              <p className="text-xl font-bold text-ink mt-0.5">{value}</p>
            </div>
          ))}
        </div>
      )}

      <NewCampaignDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSent={load}
      />
    </div>
  );
}
