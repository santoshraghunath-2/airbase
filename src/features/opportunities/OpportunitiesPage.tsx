import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  TrendingUp, Plus, Search, X, Loader2, User, MapPin, Wrench, ChevronRight,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { OpportunityStatus, LeadSource, CustomerRow, ServiceLocationRow } from "@/types/database.types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OppWithRelations {
  id: string;
  status: OpportunityStatus;
  source: LeadSource;
  equipment_notes: string | null;
  notes: string | null;
  estimated_value_cents: number | null;
  created_at: string;
  updated_at: string;
  customers: Pick<CustomerRow, "id" | "name" | "phone"> | null;
  service_locations: Pick<ServiceLocationRow, "id" | "address" | "city" | "state"> | null;
  assigned: { id: string; name: string } | null;
  source_tech: { id: string; name: string } | null;
  // Remodel lead qualification fields
  lead_name: string | null;
  lead_phone: string | null;
  project_summary: string | null;
  budget_range: string | null;
  timeline: string | null;
  service_area_zip: string | null;
  disqualify_reason: string | null;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<OpportunityStatus, string> = {
  new:             "New",
  assigned:        "Assigned",
  contacted:       "Contacted",
  visit_scheduled: "Visit Scheduled",
  visit_complete:  "Visit Complete",
  won:             "Won",
  lost:            "Lost",
  no_decision:     "No Decision",
};

const STATUS_COLOR: Record<OpportunityStatus, string> = {
  new:             "bg-waiting-bg text-waiting-text border-waiting-border",
  assigned:        "bg-ai-tint text-ai-ink border-ai-tint-border",
  contacted:       "bg-blue-50 text-blue-700 border-blue-200",
  visit_scheduled: "bg-purple-50 text-purple-700 border-purple-200",
  visit_complete:  "bg-amber-50 text-amber-700 border-amber-200",
  won:             "bg-confirmed-bg text-confirmed-text border-confirmed-border",
  lost:            "bg-muted text-muted-foreground border-border",
  no_decision:     "bg-muted text-muted-foreground border-border",
};

const STATUS_TABS: { key: OpportunityStatus | "all"; label: string }[] = [
  { key: "all",             label: "All" },
  { key: "new",             label: "New" },
  { key: "assigned",        label: "Assigned" },
  { key: "visit_scheduled", label: "Visit" },
  { key: "won",             label: "Won" },
  { key: "lost",            label: "Lost" },
];

const SOURCE_LABELS: Record<LeadSource, string> = {
  service_call:  "Service call",
  inbound_call:  "Inbound call",
  marketing:     "Marketing",
  referral:      "Referral",
  portal:        "Portal",
  manual:        "Manual",
  web_form:      "Web form",
  retell_chat:   "SMS / AI chat",
};

const BUDGET_LABELS: Record<string, string> = {
  under_8k:  "Under $8K",
  "8k_12k":  "$8K–$12K",
  "12k_20k": "$12K–$20K",
  "20k_plus": "$20K+",
};

const TIMELINE_LABELS: Record<string, string> = {
  asap:          "ASAP",
  "1_3_months":  "1–3 months",
  "3_6_months":  "3–6 months",
  "6_plus_months": "6+ months",
  flexible:      "Flexible",
};

// ─── New Lead dialog ──────────────────────────────────────────────────────────

interface NewLeadDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function NewLeadDialog({ open, onClose, onCreated }: NewLeadDialogProps) {
  const { tenant } = useAuth();
  const [query, setQuery]           = useState("");
  const [customers, setCustomers]   = useState<CustomerRow[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [locations, setLocations]   = useState<ServiceLocationRow[]>([]);
  const [locationId, setLocationId] = useState("");
  const [source, setSource]         = useState<LeadSource>("manual");
  const [equipNotes, setEquipNotes] = useState("");
  const [notes, setNotes]           = useState("");
  const [saving, setSaving]         = useState(false);
  const [searching, setSearching]   = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery(""); setCustomers([]); setSelectedCustomer(null);
      setLocations([]); setLocationId(""); setSource("manual");
      setEquipNotes(""); setNotes("");
    }
  }, [open]);

  useEffect(() => {
    if (!tenant || query.length < 2) { setCustomers([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabase
        .from("customers")
        .select("*")
        .eq("tenant_id", tenant.id)
        .is("deleted_at", null)
        .ilike("name", `%${query}%`)
        .order("name")
        .limit(8);
      setCustomers((data ?? []) as CustomerRow[]);
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query, tenant]);

  async function selectCustomer(c: CustomerRow) {
    setSelectedCustomer(c);
    setQuery(c.name);
    setCustomers([]);
    if (!tenant) return;
    const { data } = await supabase
      .from("service_locations")
      .select("*")
      .eq("customer_id", c.id)
      .order("is_primary", { ascending: false });
    const locs = (data ?? []) as ServiceLocationRow[];
    setLocations(locs);
    setLocationId(locs.find((l) => l.is_primary)?.id ?? locs[0]?.id ?? "");
  }

  async function handleCreate() {
    if (!tenant || !selectedCustomer) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("opportunities").insert({
        tenant_id:           tenant.id,
        customer_id:         selectedCustomer.id,
        service_location_id: locationId || null,
        source,
        equipment_notes:     equipNotes.trim() || null,
        notes:               notes.trim() || null,
        status:              "new",
      });
      if (error) throw error;
      toast.success("Lead created");
      onCreated();
      onClose();
    } catch (e) {
      toast.error("Failed to create lead", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Lead</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Customer search */}
          <div className="relative">
            <label className="text-xs font-medium text-ink-muted block mb-1">Customer *</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
              <Input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelectedCustomer(null); }}
                placeholder="Search by name…"
                className="pl-9"
              />
              {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-ink-muted" />}
            </div>
            {customers.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-xl border border-line bg-paper shadow-lg overflow-hidden">
                {customers.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => void selectCustomer(c)}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-raised transition-colors"
                  >
                    <span className="font-medium text-ink">{c.name}</span>
                    {c.phone && <span className="text-ink-muted ml-2">{c.phone}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Location select */}
          {locations.length > 1 && (
            <div>
              <label className="text-xs font-medium text-ink-muted block mb-1">Service location</label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select address" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.address}{l.city ? `, ${l.city}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Source */}
          <div>
            <label className="text-xs font-medium text-ink-muted block mb-1">Lead source</label>
            <Select value={source} onValueChange={(v) => setSource(v as LeadSource)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(SOURCE_LABELS) as [LeadSource, string][]).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Equipment notes */}
          <div>
            <label className="text-xs font-medium text-ink-muted block mb-1">Equipment notes</label>
            <Textarea
              value={equipNotes}
              onChange={(e) => setEquipNotes(e.target.value)}
              placeholder="Age, condition, what failed…"
              rows={2}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-ink-muted block mb-1">Notes</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Customer concerns, urgency, financing interest…"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => void handleCreate()}
              disabled={!selectedCustomer || saving}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Create Lead
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Opportunity card ─────────────────────────────────────────────────────────

function OppCard({ opp, onStatusChange }: { opp: OppWithRelations; onStatusChange: () => void }) {
  const [updating, setUpdating] = useState(false);

  const nextStatus: Partial<Record<OpportunityStatus, OpportunityStatus>> = {
    new:             "assigned",
    assigned:        "contacted",
    contacted:       "visit_scheduled",
    visit_scheduled: "visit_complete",
    visit_complete:  "won",
  };

  const next = nextStatus[opp.status];

  async function advance() {
    if (!next) return;
    setUpdating(true);
    const { error } = await supabase
      .from("opportunities")
      .update({ status: next })
      .eq("id", opp.id);
    if (error) toast.error("Failed to update");
    else { toast.success(`Moved to ${STATUS_LABELS[next]}`); onStatusChange(); }
    setUpdating(false);
  }

  return (
    <div className="rounded-xl border border-line bg-paper p-4 space-y-3 hover:bg-raised transition-colors">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-ink truncate">{opp.customers?.name ?? "—"}</p>
            <Badge variant="outline" className={cn("text-[10px] border", STATUS_COLOR[opp.status])}>
              {STATUS_LABELS[opp.status]}
            </Badge>
          </div>
          <p className="text-[11px] text-ink-muted mt-0.5">
            {SOURCE_LABELS[opp.source]} · {formatDistanceToNow(new Date(opp.created_at), { addSuffix: true })}
          </p>
        </div>
        {opp.estimated_value_cents && (
          <p className="text-sm font-semibold text-confirmed-text flex-shrink-0">
            ${(opp.estimated_value_cents / 100).toLocaleString()}
          </p>
        )}
      </div>

      {/* Details */}
      <div className="space-y-1.5">
        {opp.service_locations && (
          <div className="flex items-center gap-1.5 text-xs text-ink-muted">
            <MapPin className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">
              {opp.service_locations.address}{opp.service_locations.city ? `, ${opp.service_locations.city}` : ""}
            </span>
          </div>
        )}
        {opp.equipment_notes && (
          <div className="flex items-start gap-1.5 text-xs text-ink-muted">
            <Wrench className="h-3 w-3 flex-shrink-0 mt-0.5" />
            <span className="line-clamp-2">{opp.equipment_notes}</span>
          </div>
        )}
        {opp.assigned && (
          <div className="flex items-center gap-1.5 text-xs text-ai-ink">
            <User className="h-3 w-3 flex-shrink-0" />
            <span>Assigned to {opp.assigned.name}</span>
          </div>
        )}
        {opp.source_tech && (
          <div className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span>Flagged by {opp.source_tech.name}</span>
          </div>
        )}
        {/* Remodel lead qualification fields */}
        {opp.project_summary && (
          <div className="flex items-start gap-1.5 text-xs text-ink-muted">
            <span className="font-medium text-ink-muted min-w-0 flex-shrink-0">Project:</span>
            <span className="line-clamp-2">{opp.project_summary}</span>
          </div>
        )}
        {(opp.budget_range || opp.timeline) && (
          <div className="flex items-center gap-3 text-xs text-ink-muted">
            {opp.budget_range && <span>{BUDGET_LABELS[opp.budget_range] ?? opp.budget_range}</span>}
            {opp.timeline && <span>· {TIMELINE_LABELS[opp.timeline] ?? opp.timeline}</span>}
            {opp.service_area_zip && <span>· {opp.service_area_zip}</span>}
          </div>
        )}
        {opp.disqualify_reason && (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <span>Disqualified: {opp.disqualify_reason.replace(/_/g, " ")}</span>
          </div>
        )}
      </div>

      {/* Advance button */}
      {next && (
        <button
          onClick={() => void advance()}
          disabled={updating}
          className="flex items-center gap-1.5 text-xs font-medium text-ai hover:text-ai-ink transition-colors disabled:opacity-40"
        >
          {updating ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronRight className="h-3 w-3" />}
          Move to {STATUS_LABELS[next]}
        </button>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpportunitiesPage() {
  const { tenant } = useAuth();
  const [opps, setOpps]               = useState<OppWithRelations[]>([]);
  const [loading, setLoading]         = useState(true);
  const [activeTab, setActiveTab]     = useState<OpportunityStatus | "all">("all");
  const [search, setSearch]           = useState("");
  const [showNewLead, setShowNewLead] = useState(false);

  const loadOpps = useCallback(async () => {
    if (!tenant) return;
    const { data, error } = await supabase
      .from("opportunities")
      .select(`
        *,
        customers(id, name, phone),
        service_locations(id, address, city, state),
        assigned:assigned_to(id, name),
        source_tech:source_tech_id(id, name)
      `)
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) { toast.error("Failed to load opportunities"); return; }
    setOpps((data ?? []) as unknown as OppWithRelations[]);
  }, [tenant]);

  useEffect(() => {
    if (!tenant) return;
    void (async () => { await loadOpps(); setLoading(false); })();
  }, [tenant, loadOpps]);

  const filtered = opps.filter((o) => {
    if (activeTab !== "all" && o.status !== activeTab) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        o.customers?.name.toLowerCase().includes(q) ||
        (o.equipment_notes ?? "").toLowerCase().includes(q) ||
        o.assigned?.name.toLowerCase().includes(q) ||
        false
      );
    }
    return true;
  });

  const countByTab = (tab: OpportunityStatus | "all") =>
    tab === "all" ? opps.length : opps.filter((o) => o.status === tab).length;

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-ink-muted" />
          <h1 className="text-xl font-semibold text-ink">Opportunities</h1>
          <span className="text-sm text-ink-muted">({opps.length})</span>
        </div>
        <Button size="sm" onClick={() => setShowNewLead(true)}>
          <Plus className="h-4 w-4 mr-1" /> New Lead
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer, CA, equipment…"
          className="pl-9"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
            <X className="h-4 w-4 text-ink-muted" />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STATUS_TABS.map((tab) => {
          const count = countByTab(tab.key);
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border",
                activeTab === tab.key
                  ? "bg-ink text-bone border-ink"
                  : "bg-paper text-ink-muted border-line hover:bg-raised hover:text-ink",
              )}
            >
              {tab.label}
              <span className={cn(
                "rounded-full px-1.5 text-[10px] font-semibold",
                activeTab === tab.key ? "bg-white/20 text-bone" : "bg-raised text-ink-muted",
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-line border-dashed bg-paper p-12 text-center">
          <TrendingUp className="h-8 w-8 text-ink-muted mx-auto mb-3" />
          <p className="text-sm font-medium text-ink">
            {search ? "No matches" : activeTab === "all" ? "No leads yet" : `No ${STATUS_LABELS[activeTab as OpportunityStatus]} leads`}
          </p>
          {activeTab === "all" && !search && (
            <p className="text-xs text-ink-muted mt-1">
              Leads are created when techs flag a replacement opportunity on a job.
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((o) => (
            <OppCard key={o.id} opp={o} onStatusChange={() => void loadOpps()} />
          ))}
        </div>
      )}

      <NewLeadDialog
        open={showNewLead}
        onClose={() => setShowNewLead(false)}
        onCreated={() => void loadOpps()}
      />
    </div>
  );
}
