import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, CheckCircle2, Clock, AlertTriangle, Package,
  FileText, Wrench, Camera, ChevronDown, ChevronUp, DollarSign, Plus, TrendingUp,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Phase {
  id: string;
  sort_order: number;
  name: string;
  status: string;
  planned_start: string | null;
  planned_end: string | null;
  actual_end: string | null;
  crew_size: number;
  job_type: string;
  required_evidence: string[];
  notes: string | null;
}

interface MaterialOrder {
  id: string;
  vendor: string;
  status: string;
  promised_date: string | null;
  total_cost_cents: number;
}

interface Permit {
  id: string;
  jurisdiction: string;
  permit_type: string;
  status: string;
  permit_number: string | null;
}

interface ChangeOrder {
  id: string;
  title: string;
  status: string;
  amount_cents: number;
  created_at: string;
}

interface ProjectCost {
  id: string;
  cost_type: "labor" | "material" | "other";
  description: string;
  amount_cents: number;
  occurred_at: string;
}

interface ProjectDetail {
  id: string;
  name: string;
  status: string;
  target_start: string | null;
  target_completion: string | null;
  actual_start: string | null;
  actual_completion: string | null;
  commitment_days: number | null;
  commitment_clock_start: string | null;
  created_at: string;
  customers: { id: string; name: string | null; phone: string | null }[] | null;
  contracts: { id: string; total_cents: number }[] | null;
  project_phases: Phase[];
  material_orders: MaterialOrder[];
  permits: Permit[];
  change_orders: ChangeOrder[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function phaseIcon(status: string) {
  if (status === "complete")     return <CheckCircle2 className="h-4 w-4 text-confirmed-text shrink-0" />;
  if (status === "in_progress")  return <Clock className="h-4 w-4 text-ai-ink shrink-0 animate-pulse" />;
  if (status === "skipped")      return <ChevronDown className="h-4 w-4 text-ink-muted shrink-0" />;
  return <Clock className="h-4 w-4 text-ink-muted shrink-0" />;
}

function permitBadge(status: string) {
  if (status === "not_required") return "text-confirmed-text";
  if (status === "issued")       return "text-confirmed-text";
  if (status === "needs_review") return "text-warned-text";
  if (status === "submitted")    return "text-ai-ink";
  if (status === "failed")       return "text-blocked-text";
  return "text-ink-muted";
}

function materialBadge(status: string) {
  if (status === "received") return "text-confirmed-text";
  if (status === "ordered")  return "text-ai-ink";
  if (status === "partial")  return "text-warned-text";
  return "text-ink-muted";
}

function centsDisplay(c: number) {
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

function businessDaysRemaining(clockStart: string | null, commitmentDays: number | null): number | null {
  if (!clockStart || !commitmentDays) return null;
  const start   = new Date(clockStart);
  const today   = new Date();
  let worked = 0;
  const cursor = new Date(start);
  while (cursor <= today) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) worked++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.max(0, commitmentDays - worked);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function marginColor(pct: number | null) {
  if (pct === null) return "text-ink-muted";
  if (pct >= 60)   return "text-confirmed-text font-semibold";
  if (pct >= 35)   return "text-warned-text font-semibold";
  return "text-blocked-text font-semibold";
}

export default function ProjectDetailPage() {
  const { tenantSlug, projectId } = useParams<{ tenantSlug: string; projectId: string }>();
  const { tenant } = useAuth();
  const navigate = useNavigate();

  const [project,     setProject]     = useState<ProjectDetail | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [expanded,    setExpanded]    = useState<Record<string, boolean>>({});
  const [costs,       setCosts]       = useState<ProjectCost[]>([]);
  const [addingCost,  setAddingCost]  = useState(false);
  const [costLoading, setCostLoading] = useState(false);

  const newCostType  = useRef<HTMLButtonElement>(null);
  const [newCostForm, setNewCostForm] = useState<{
    cost_type: "labor" | "material" | "other";
    description: string;
    amount: string;
    occurred_at: string;
  }>({
    cost_type:   "other",
    description: "",
    amount:      "",
    occurred_at: new Date().toISOString().slice(0, 10),
  });

  useEffect(() => {
    if (!tenant || !projectId) return;
    void (async () => {
      const { data } = await supabase
        .from("projects")
        .select(`
          id, name, status, target_start, target_completion, actual_start, actual_completion,
          commitment_days, commitment_clock_start, created_at,
          customers(id, name, phone),
          contracts(id, total_cents),
          project_phases(id, sort_order, name, status, planned_start, planned_end, actual_end, crew_size, job_type, required_evidence, notes),
          material_orders(id, vendor, status, promised_date, total_cost_cents),
          permits(id, jurisdiction, permit_type, status, permit_number),
          change_orders(id, title, status, amount_cents, created_at)
        `)
        .eq("id", projectId)
        .eq("tenant_id", tenant.id)
        .single();
      setProject(data as ProjectDetail | null);
      setLoading(false);
    })();
  }, [tenant, projectId]);

  useEffect(() => {
    if (!tenant || !projectId) return;
    void loadCosts();
  }, [tenant, projectId]);

  async function loadCosts() {
    setCostLoading(true);
    const { data } = await supabase
      .from("project_costs")
      .select("id, cost_type, description, amount_cents, occurred_at")
      .eq("project_id", projectId)
      .eq("tenant_id", tenant!.id)
      .is("deleted_at", null)
      .order("occurred_at", { ascending: false });
    setCosts((data as ProjectCost[]) ?? []);
    setCostLoading(false);
  }

  async function submitCost() {
    const amountCents = Math.round(parseFloat(newCostForm.amount) * 100);
    if (!newCostForm.description.trim() || isNaN(amountCents) || amountCents <= 0) {
      toast.error("Fill in description and a valid amount.");
      return;
    }
    const { error } = await supabase.from("project_costs").insert({
      tenant_id:   tenant!.id,
      project_id:  projectId,
      cost_type:   newCostForm.cost_type,
      description: newCostForm.description.trim(),
      amount_cents: amountCents,
      occurred_at: newCostForm.occurred_at,
    });
    if (error) {
      toast.error(`Failed to log cost: ${error.message}`);
      return;
    }
    setAddingCost(false);
    setNewCostForm({ cost_type: "other", description: "", amount: "", occurred_at: new Date().toISOString().slice(0, 10) });
    toast.success("Cost logged");
    void loadCosts();
  }

  if (loading) {
    return (
      <div className="min-h-full bg-bone p-8">
        <Skeleton className="h-6 w-32 mb-6" />
        <Skeleton className="h-48 rounded-xl mb-4" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-full bg-bone flex items-center justify-center">
        <p className="text-sm text-ink-muted">Project not found.</p>
      </div>
    );
  }

  const daysRemaining = businessDaysRemaining(
    project.commitment_clock_start,
    project.commitment_days,
  );

  const sortedPhases = [...(project.project_phases ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  const hasGateIssues =
    project.permits.some((p) => ["needs_review", "pending", "submitted"].includes(p.status)) ||
    project.material_orders.some((m) => ["draft", "ordered", "partial"].includes(m.status));

  return (
    <div className="min-h-full bg-bone">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Back */}
        <button
          onClick={() => navigate(`/${tenantSlug}/projects`)}
          className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink mb-6 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Projects
        </button>

        {/* Header */}
        <div className="rounded-xl border border-line bg-paper px-6 py-5 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-ink">{project.name}</h1>
              <p className="text-xs text-ink-muted mt-0.5">{project.customers?.[0]?.name ?? "—"}</p>
            </div>
            <div className="text-right shrink-0">
              {project.contracts?.[0] && (
                <div className="text-base font-semibold text-ink tabular-nums">
                  {centsDisplay(project.contracts[0].total_cents)}
                </div>
              )}
              <div className="text-xs text-ink-muted capitalize">{project.status.replace("_", " ")}</div>
            </div>
          </div>

          {/* Timeline */}
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-ink-muted">
            {project.target_start && (
              <span>
                Start: <strong className="text-ink">{new Date(project.target_start).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</strong>
              </span>
            )}
            {project.target_completion && (
              <span>
                Completion: <strong className="text-ink">{new Date(project.target_completion).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</strong>
              </span>
            )}
            {daysRemaining !== null && project.status === "in_progress" && (
              <span className={cn(daysRemaining <= 2 ? "text-warned-text font-semibold" : "")}>
                {daysRemaining} commitment day{daysRemaining !== 1 ? "s" : ""} remaining
              </span>
            )}
          </div>

          {/* Gate alerts */}
          {hasGateIssues && (
            <div className="mt-3 flex items-center gap-2 text-xs text-warned-text">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Gates not yet clear — scheduling blocked until permit issued and materials confirmed.
            </div>
          )}
        </div>

        {/* Phase schedule */}
        <div className="rounded-xl border border-line bg-paper px-6 py-5 mb-4">
          <h2 className="text-sm font-semibold text-ink mb-4">Phases</h2>
          {sortedPhases.length === 0 ? (
            <p className="text-xs text-ink-muted">No phases yet. Schedule will be proposed once gates are clear.</p>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {sortedPhases.map((phase) => (
                <div key={phase.id} className="py-3">
                  <div className="flex items-center gap-3">
                    {phaseIcon(phase.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-sm font-medium",
                          phase.status === "complete" ? "text-ink-muted line-through" : "text-ink",
                        )}>
                          {phase.name}
                        </span>
                        {phase.job_type === "remodel_inspection" && (
                          <span className="text-[10px] text-ink-muted border border-line rounded px-1.5 py-0.5">Inspection</span>
                        )}
                        {phase.crew_size === 0 && phase.job_type !== "remodel_inspection" && (
                          <span className="text-[10px] text-ink-muted border border-line rounded px-1.5 py-0.5">No crew</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-ink-muted mt-0.5">
                        {phase.planned_start && (
                          <span>{new Date(phase.planned_start).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                        )}
                        {phase.crew_size > 0 && (
                          <span>· {phase.crew_size} crew</span>
                        )}
                        {phase.required_evidence?.length > 0 && phase.status !== "complete" && (
                          <span className="flex items-center gap-1 text-warned-text">
                            <Camera className="h-3 w-3" />
                            Evidence required
                          </span>
                        )}
                      </div>
                    </div>
                    {phase.status !== "complete" && phase.status !== "skipped" && (
                      <button
                        onClick={() => setExpanded((e) => ({ ...e, [phase.id]: !e[phase.id] }))}
                        className="text-ink-muted hover:text-ink transition-colors"
                      >
                        {expanded[phase.id] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                  {expanded[phase.id] && (
                    <div className="mt-2 ml-7 text-xs text-ink-muted">
                      {phase.required_evidence?.length > 0 && (
                        <p>Required evidence: {phase.required_evidence.join(", ")}</p>
                      )}
                      {phase.notes && <p className="mt-1">{phase.notes}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Gates: permit + materials */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          {/* Permits */}
          <div className="rounded-xl border border-line bg-paper px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="h-4 w-4 text-ink-muted" />
              <h3 className="text-sm font-semibold text-ink">Permit</h3>
            </div>
            {project.permits.length === 0 ? (
              <p className="text-xs text-ink-muted">No permit record.</p>
            ) : (
              project.permits.map((permit) => (
                <div key={permit.id} className="text-xs">
                  <span className="capitalize">{permit.permit_type}</span>
                  <span className="text-ink-muted"> · {permit.jurisdiction}</span>
                  <div className={cn("font-medium mt-0.5 capitalize", permitBadge(permit.status))}>
                    {permit.status.replace("_", " ")}
                    {permit.permit_number && ` #${permit.permit_number}`}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Materials */}
          <div className="rounded-xl border border-line bg-paper px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <Package className="h-4 w-4 text-ink-muted" />
              <h3 className="text-sm font-semibold text-ink">Materials</h3>
            </div>
            {project.material_orders.length === 0 ? (
              <p className="text-xs text-ink-muted">No material orders.</p>
            ) : (
              project.material_orders.map((order) => (
                <div key={order.id} className="text-xs">
                  <span className="text-ink">{order.vendor}</span>
                  <span className="text-ink-muted"> · {centsDisplay(order.total_cost_cents)}</span>
                  <div className={cn("font-medium mt-0.5 capitalize", materialBadge(order.status))}>
                    {order.status}
                    {order.promised_date && ` · Due ${new Date(order.promised_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Change orders */}
        {project.change_orders.length > 0 && (
          <div className="rounded-xl border border-line bg-paper px-6 py-5 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Wrench className="h-4 w-4 text-ink-muted" />
              <h2 className="text-sm font-semibold text-ink">Change orders</h2>
            </div>
            <div className="flex flex-col divide-y divide-line">
              {project.change_orders.map((co) => (
                <div key={co.id} className="flex items-center justify-between py-2.5 text-xs">
                  <div>
                    <p className="text-ink font-medium">{co.title}</p>
                    <p className={cn(
                      "mt-0.5 capitalize",
                      co.status === "signed" ? "text-confirmed-text" :
                      co.status === "needs_pricing" ? "text-warned-text" :
                      "text-ink-muted",
                    )}>
                      {co.status.replace("_", " ")}
                    </p>
                  </div>
                  <span className="tabular-nums font-medium text-ink">{centsDisplay(co.amount_cents)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Profitability summary */}
        {(() => {
          const contractTotal = project.contracts?.[0]?.total_cents ?? 0;
          const matCost = project.material_orders
            .filter((m) => m.status === "received")
            .reduce((s, m) => s + m.total_cost_cents, 0);
          const laborCost   = costs.filter((c) => c.cost_type === "labor").reduce((s, c) => s + c.amount_cents, 0);
          const matCostLogs = costs.filter((c) => c.cost_type === "material").reduce((s, c) => s + c.amount_cents, 0);
          const otherCost   = costs.filter((c) => c.cost_type === "other").reduce((s, c) => s + c.amount_cents, 0);
          const totalCost   = matCost + matCostLogs + laborCost + otherCost;
          const grossProfit = contractTotal - totalCost;
          const marginPct   = contractTotal > 0 ? Math.round((grossProfit / contractTotal) * 1000) / 10 : null;

          return (
            <div className="rounded-xl border border-line bg-paper px-6 py-5 mb-4">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="h-4 w-4 text-ink-muted" />
                <h2 className="text-sm font-semibold text-ink">Profitability</h2>
                {marginPct !== null && (
                  <span className={cn("ml-auto text-sm tabular-nums font-semibold", marginColor(marginPct))}>
                    {marginPct}% margin
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <p className="text-ink-muted">Contract</p>
                  <p className="font-semibold text-ink tabular-nums">{centsDisplay(contractTotal)}</p>
                </div>
                <div>
                  <p className="text-ink-muted">Materials</p>
                  <p className="font-semibold text-ink tabular-nums">{centsDisplay(matCost + matCostLogs)}</p>
                </div>
                <div>
                  <p className="text-ink-muted">Labor</p>
                  <p className="font-semibold text-ink tabular-nums">{centsDisplay(laborCost)}</p>
                </div>
                <div>
                  <p className="text-ink-muted">Gross profit</p>
                  <p className={cn("font-semibold tabular-nums", grossProfit >= 0 ? "text-confirmed-text" : "text-blocked-text")}>
                    {centsDisplay(grossProfit)}
                  </p>
                </div>
              </div>
              {totalCost === 0 && (
                <p className="mt-3 text-xs text-ink-muted">
                  Log labor and other costs below to see true margin.
                </p>
              )}
            </div>
          );
        })()}

        {/* Project costs */}
        <div className="rounded-xl border border-line bg-paper px-6 py-5">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="h-4 w-4 text-ink-muted" />
            <h2 className="text-sm font-semibold text-ink">Costs</h2>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto text-xs h-7"
              onClick={() => setAddingCost((v) => !v)}
            >
              <Plus className="h-3 w-3 mr-1" />
              Log cost
            </Button>
          </div>

          {addingCost && (
            <div className="mb-4 rounded-lg bg-raised border border-line p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-ink-muted mb-1 block">Type</label>
                  <Select
                    value={newCostForm.cost_type}
                    onValueChange={(v) => setNewCostForm((f) => ({ ...f, cost_type: v as "labor" | "material" | "other" }))}
                  >
                    <SelectTrigger className="h-8 text-xs" ref={newCostType}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="labor">Labor</SelectItem>
                      <SelectItem value="material">Material</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-ink-muted mb-1 block">Date</label>
                  <Input
                    type="date"
                    className="h-8 text-xs"
                    value={newCostForm.occurred_at}
                    onChange={(e) => setNewCostForm((f) => ({ ...f, occurred_at: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-ink-muted mb-1 block">Description</label>
                <Input
                  className="h-8 text-xs"
                  placeholder="e.g. Tile removal labor — 4 hrs"
                  value={newCostForm.description}
                  onChange={(e) => setNewCostForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-ink-muted mb-1 block">Amount ($)</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="h-8 text-xs"
                  placeholder="0.00"
                  value={newCostForm.amount}
                  onChange={(e) => setNewCostForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAddingCost(false)}>Cancel</Button>
                <Button size="sm" className="h-7 text-xs" onClick={() => void submitCost()}>Save</Button>
              </div>
            </div>
          )}

          {costLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
            </div>
          ) : costs.length === 0 ? (
            <p className="text-xs text-ink-muted">No costs logged yet.</p>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {costs.map((cost) => (
                <div key={cost.id} className="flex items-center justify-between py-2.5 text-xs">
                  <div>
                    <p className="text-ink font-medium">{cost.description}</p>
                    <p className="text-ink-muted mt-0.5 capitalize">
                      {cost.cost_type} · {new Date(cost.occurred_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                  </div>
                  <span className="tabular-nums font-medium text-ink shrink-0">{centsDisplay(cost.amount_cents)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
