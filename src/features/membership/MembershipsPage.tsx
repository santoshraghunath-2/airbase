import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Plus, Trash2, Loader2, Users, TrendingUp, AlertTriangle, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { MembershipPlanRow, MembershipRow, CustomerRow, BillingCycle } from "@/types/database.types";

// ─── Types ────────────────────────────────────────────────────────────────────

type MemberFilter = "all" | "active" | "expiring" | "lapsed";

interface MembershipWithRelations extends MembershipRow {
  customers: Pick<CustomerRow, "id" | "name" | "phone"> | null;
  membership_plans: Pick<MembershipPlanRow, "id" | "name" | "billing_cycle" | "price_cents"> | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function daysUntil(dateStr: string): number {
  const now = new Date();
  const exp = new Date(dateStr);
  return Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function statusBadge(status: MembershipRow["status"], expiresAt: string) {
  if (status === "cancelled") return { label: "Cancelled", cls: "bg-muted text-muted-foreground border-border" };
  if (status === "lapsed")    return { label: "Lapsed",    cls: "bg-blocked-bg text-blocked-text border-blocked-border" };
  if (status === "pending")   return { label: "Pending",   cls: "bg-waiting-bg text-waiting-text border-waiting-border" };
  const days = daysUntil(expiresAt);
  if (days <= 30) return { label: `Exp. in ${days}d`, cls: "bg-waiting-bg text-waiting-text border-waiting-border" };
  return { label: "Active", cls: "bg-confirmed-bg text-confirmed-text border-confirmed-border" };
}

// ─── Plan card ────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  enrolledCount,
  isOwner,
  onToggleActive,
  onUpdate,
}: {
  plan: MembershipPlanRow;
  enrolledCount: number;
  isOwner: boolean;
  onToggleActive: (plan: MembershipPlanRow) => Promise<void>;
  onUpdate: (id: string, patch: Partial<MembershipPlanRow>) => Promise<void>;
}) {
  const [editing, setEditing]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [draft, setDraft]       = useState({
    name:             plan.name,
    description:      plan.description ?? "",
    price_cents:      plan.price_cents,
    billing_cycle:    plan.billing_cycle,
    discount_percent: plan.discount_percent,
    priority_dispatch: plan.priority_dispatch,
    free_service_call: plan.free_service_call,
    benefits_text:    (plan.benefits as Array<{ text: string }>).map((b) => b.text).join("\n"),
  });

  async function saveEdit() {
    setSaving(true);
    const benefits = draft.benefits_text
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => ({ text: t }));
    await onUpdate(plan.id, {
      name:             draft.name,
      description:      draft.description || null,
      price_cents:      Math.round(draft.price_cents),
      billing_cycle:    draft.billing_cycle as "monthly" | "annual",
      discount_percent: Math.max(0, Math.min(100, draft.discount_percent)),
      priority_dispatch: draft.priority_dispatch,
      free_service_call: draft.free_service_call,
      benefits,
    });
    setSaving(false);
    setEditing(false);
  }

  return (
    <div className={cn(
      "rounded-xl border bg-paper transition-all",
      plan.is_active ? "border-line" : "border-line-2 opacity-60",
    )}>
      {/* Header */}
      <div className="flex items-start gap-4 px-5 py-4 border-b border-line-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-[15px] font-semibold text-ink">{plan.name}</h3>
            {!plan.is_active && (
              <span className="text-[10px] font-semibold text-ink-muted bg-muted rounded-pill px-2 py-0.5">Archived</span>
            )}
          </div>
          <p className="text-sm text-ai font-semibold">
            {centsToDisplay(plan.price_cents)}
            <span className="text-ink-muted font-normal text-xs"> / {plan.billing_cycle}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-ink-muted bg-raised rounded-lg px-2 py-1">
            {enrolledCount} member{enrolledCount !== 1 ? "s" : ""}
          </span>
          {isOwner && (
            <>
              <button
                onClick={() => setEditing(!editing)}
                className="text-[11px] font-medium text-ink-muted hover:text-ink px-2 py-1 rounded-lg hover:bg-raised transition-colors"
              >
                {editing ? "Cancel" : "Edit"}
              </button>
              <button
                onClick={() => void onToggleActive(plan)}
                className="text-[11px] font-medium text-ink-muted hover:text-ink px-2 py-1 rounded-lg hover:bg-raised transition-colors"
                title={plan.is_active ? "Archive plan" : "Restore plan"}
              >
                {plan.is_active ? <Trash2 className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Benefits summary */}
      {!editing && (
        <div className="px-5 py-3.5 flex flex-wrap gap-2">
          {plan.discount_percent > 0 && (
            <span className="text-[11px] text-ai-ink bg-ai-chip-bg border border-ai-tint-border rounded-pill px-2 py-0.5">
              {plan.discount_percent}% off parts
            </span>
          )}
          {plan.free_service_call && (
            <span className="text-[11px] text-confirmed-text bg-confirmed-bg border border-confirmed-border rounded-pill px-2 py-0.5">
              Free service calls
            </span>
          )}
          {plan.priority_dispatch && (
            <span className="text-[11px] text-ai-ink bg-ai-chip-bg border border-ai-tint-border rounded-pill px-2 py-0.5">
              Priority dispatch
            </span>
          )}
          {(plan.benefits as Array<{ text: string }>).map((b, i) => (
            <span key={i} className="text-[11px] text-ink-muted bg-raised border border-line-2 rounded-pill px-2 py-0.5">
              {b.text}
            </span>
          ))}
        </div>
      )}

      {/* Edit form */}
      {editing && isOwner && (
        <div className="px-5 py-4 space-y-4 border-t border-line-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px] text-ink-muted">Plan name</Label>
              <Input value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] text-ink-muted">Description</Label>
              <Input value={draft.description} onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))} placeholder="Optional tagline" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px] text-ink-muted">Price (cents)</Label>
              <Input
                type="number" min={0}
                value={draft.price_cents}
                onChange={(e) => setDraft((p) => ({ ...p, price_cents: Number(e.target.value) }))}
                placeholder="e.g. 39900 = $399"
              />
              <p className="text-[10px] text-ink-muted">{centsToDisplay(draft.price_cents)} {draft.billing_cycle}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] text-ink-muted">Billing cycle</Label>
              <select
                value={draft.billing_cycle}
                onChange={(e) => setDraft((p) => ({ ...p, billing_cycle: e.target.value as BillingCycle }))}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="annual">Annual</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] text-ink-muted">Parts discount %</Label>
              <Input
                type="number" min={0} max={100}
                value={draft.discount_percent}
                onChange={(e) => setDraft((p) => ({ ...p, discount_percent: Number(e.target.value) }))}
              />
            </div>
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-[13px] text-ink">
              <input
                type="checkbox"
                checked={draft.free_service_call}
                onChange={(e) => setDraft((p) => ({ ...p, free_service_call: e.target.checked }))}
                className="rounded"
              />
              Free service calls
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-[13px] text-ink">
              <input
                type="checkbox"
                checked={draft.priority_dispatch}
                onChange={(e) => setDraft((p) => ({ ...p, priority_dispatch: e.target.checked }))}
                className="rounded"
              />
              Priority dispatch
            </label>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] text-ink-muted">Additional benefits (one per line)</Label>
            <textarea
              value={draft.benefits_text}
              onChange={(e) => setDraft((p) => ({ ...p, benefits_text: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none"
              placeholder="Annual tune-up included&#10;Priority scheduling&#10;10% off labor"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="text-xs text-ink-muted hover:text-ink px-3 py-1.5 transition-colors">
              Cancel
            </button>
            <button
              onClick={() => void saveEdit()}
              disabled={saving || !draft.name.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-ink text-bone text-xs font-medium disabled:opacity-40 hover:bg-ink-hover transition-colors"
            >
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              Save changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Enroll modal (inline) ────────────────────────────────────────────────────

function EnrollForm({
  plans,
  tenantId,
  onDone,
}: {
  plans: MembershipPlanRow[];
  tenantId: string;
  onDone: () => void;
}) {
  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers]           = useState<Pick<CustomerRow, "id" | "name" | "phone">[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Pick<CustomerRow, "id" | "name" | "phone"> | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState(plans[0]?.id ?? "");
  const [billingCycle, setBillingCycle]     = useState<"monthly" | "annual">("annual");
  const [saving, setSaving]                 = useState(false);

  useEffect(() => {
    if (!customerSearch.trim()) { setCustomers([]); return; }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("customers")
        .select("id,name,phone")
        .eq("tenant_id", tenantId)
        .ilike("name", `%${customerSearch}%`)
        .limit(6);
      setCustomers((data ?? []) as typeof customers);
    }, 300);
    return () => clearTimeout(timer);
  }, [customerSearch, tenantId]);

  async function enroll() {
    if (!selectedCustomer || !selectedPlanId) return;
    setSaving(true);
    const today = new Date();
    const expiresAt = new Date(today);
    if (billingCycle === "annual") {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    }
    const { error } = await supabase.from("memberships").insert({
      tenant_id:     tenantId,
      customer_id:   selectedCustomer.id,
      plan_id:       selectedPlanId,
      status:        "active",
      billing_cycle: billingCycle,
      started_at:    today.toISOString().split("T")[0],
      expires_at:    expiresAt.toISOString().split("T")[0],
      auto_renew:    true,
    });
    if (error) {
      if (error.code === "23505") {
        toast.error("Customer already has an active membership");
      } else {
        toast.error("Failed to enroll", { description: error.message });
      }
    } else {
      toast.success(`${selectedCustomer.name} enrolled`);
      onDone();
    }
    setSaving(false);
  }

  const activePlans = plans.filter((p) => p.is_active);

  return (
    <div className="rounded-xl border border-ai-tint-border bg-ai-tint px-5 py-5 space-y-4">
      <p className="text-sm font-semibold text-ai-ink">Enroll a customer</p>

      {/* Customer search */}
      <div className="space-y-1.5">
        <Label className="text-[12px] text-ink-muted">Customer</Label>
        {selectedCustomer ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-confirmed-border bg-confirmed-bg">
            <span className="flex-1 text-sm font-medium text-ink">{selectedCustomer.name}</span>
            <span className="text-xs text-ink-muted">{selectedCustomer.phone}</span>
            <button onClick={() => setSelectedCustomer(null)} className="text-ink-muted hover:text-ink text-xs">✕</button>
          </div>
        ) : (
          <div className="relative">
            <Input
              placeholder="Search customer name…"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              autoFocus
            />
            {customers.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-10 mt-1 rounded-xl border border-line bg-paper shadow-lg overflow-hidden">
                {customers.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setSelectedCustomer(c); setCustomerSearch(""); setCustomers([]); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-raised text-left transition-colors"
                  >
                    <span className="text-sm font-medium text-ink">{c.name}</span>
                    <span className="text-xs text-ink-muted ml-auto">{c.phone}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Plan selector */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[12px] text-ink-muted">Plan</Label>
          <select
            value={selectedPlanId}
            onChange={(e) => setSelectedPlanId(e.target.value)}
            className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"
          >
            {activePlans.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {centsToDisplay(p.price_cents)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[12px] text-ink-muted">Billing</Label>
          <select
            value={billingCycle}
            onChange={(e) => setBillingCycle(e.target.value as "monthly" | "annual")}
            className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="annual">Annual</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onDone} className="text-xs text-ink-muted hover:text-ink px-3 py-1.5 transition-colors">Cancel</button>
        <button
          onClick={() => void enroll()}
          disabled={!selectedCustomer || !selectedPlanId || saving}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-ink text-bone text-xs font-medium hover:bg-ink-hover transition-colors disabled:opacity-40"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Enroll customer
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MembershipsPage() {
  const { tenant, user } = useAuth();
  const isOwner = user?.role === "owner";

  const [tab, setTab]             = useState<"members" | "plans">("members");
  const [filter, setFilter]       = useState<MemberFilter>("all");
  const [search, setSearch]       = useState("");
  const [memberships, setMemberships] = useState<MembershipWithRelations[]>([]);
  const [plans, setPlans]         = useState<MembershipPlanRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showEnroll, setShowEnroll]   = useState(false);
  const [showNewPlan, setShowNewPlan] = useState(false);
  const [newPlanSaving, setNewPlanSaving] = useState(false);
  const [newPlanDraft, setNewPlanDraft]   = useState({
    name: "", description: "", price_cents: 39900, billing_cycle: "annual" as BillingCycle,
    discount_percent: 0, priority_dispatch: false, free_service_call: false, benefits_text: "",
  });

  const load = useCallback(async () => {
    if (!tenant) return;
    const [mRes, pRes] = await Promise.all([
      supabase
        .from("memberships")
        .select("*, customers(id,name,phone), membership_plans(id,name,billing_cycle,price_cents)")
        .eq("tenant_id", tenant.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("membership_plans")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);
    setMemberships((mRes.data ?? []) as MembershipWithRelations[]);
    setPlans((pRes.data ?? []) as MembershipPlanRow[]);
  }, [tenant]);

  useEffect(() => {
    if (!tenant) return;
    void (async () => { await load(); setLoading(false); })();
  }, [tenant, load]);

  // Stats
  const activeCount    = memberships.filter((m) => m.status === "active").length;
  const expiringCount  = memberships.filter((m) => m.status === "active" && daysUntil(m.expires_at) <= 30).length;
  const lapsedCount    = memberships.filter((m) => m.status === "lapsed").length;
  const monthlyRevenue = memberships
    .filter((m) => m.status === "active")
    .reduce((sum, m) => {
      const p = m.membership_plans;
      if (!p) return sum;
      const monthly = p.billing_cycle === "annual" ? p.price_cents / 12 : p.price_cents;
      return sum + monthly;
    }, 0);

  // Filtered members
  const filteredMembers = memberships.filter((m) => {
    if (filter === "active"   && m.status !== "active") return false;
    if (filter === "lapsed"   && m.status !== "lapsed") return false;
    if (filter === "expiring" && (m.status !== "active" || daysUntil(m.expires_at) > 30)) return false;
    if (search) {
      const q = search.toLowerCase();
      return m.customers?.name?.toLowerCase().includes(q) || m.customers?.phone?.includes(q);
    }
    return true;
  });

  async function cancelMembership(m: MembershipWithRelations) {
    const { error } = await supabase
      .from("memberships")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", m.id);
    if (error) toast.error("Failed to cancel");
    else { toast.success("Membership cancelled"); await load(); }
  }

  async function renewMembership(m: MembershipWithRelations) {
    const plan = plans.find((p) => p.id === m.plan_id);
    if (!plan) return;
    const newExpiry = new Date(m.expires_at);
    if (m.billing_cycle === "annual") newExpiry.setFullYear(newExpiry.getFullYear() + 1);
    else newExpiry.setMonth(newExpiry.getMonth() + 1);
    const { error } = await supabase
      .from("memberships")
      .update({ status: "active", expires_at: newExpiry.toISOString().split("T")[0], last_renewed_at: new Date().toISOString() })
      .eq("id", m.id);
    if (error) toast.error("Failed to renew");
    else { toast.success("Membership renewed"); await load(); }
  }

  async function createPlan() {
    if (!tenant || !newPlanDraft.name.trim()) return;
    setNewPlanSaving(true);
    const benefits = newPlanDraft.benefits_text
      .split("\n").map((t) => t.trim()).filter(Boolean).map((t) => ({ text: t }));
    const { error } = await supabase.from("membership_plans").insert({
      tenant_id:        tenant.id,
      name:             newPlanDraft.name.trim(),
      description:      newPlanDraft.description || null,
      billing_cycle:    newPlanDraft.billing_cycle as "monthly" | "annual",
      price_cents:      Math.round(newPlanDraft.price_cents),
      discount_percent: newPlanDraft.discount_percent,
      priority_dispatch: newPlanDraft.priority_dispatch,
      free_service_call: newPlanDraft.free_service_call,
      benefits,
    });
    if (error) {
      toast.error("Failed to create plan", { description: error.message });
    } else {
      toast.success(`${newPlanDraft.name} created`);
      setNewPlanDraft({ name: "", description: "", price_cents: 39900, billing_cycle: "annual", discount_percent: 0, priority_dispatch: false, free_service_call: false, benefits_text: "" });
      setShowNewPlan(false);
      await load();
    }
    setNewPlanSaving(false);
  }

  async function updatePlan(id: string, patch: Partial<MembershipPlanRow>) {
    const { error } = await supabase.from("membership_plans").update(patch).eq("id", id);
    if (error) toast.error("Failed to save plan");
    else { toast.success("Plan saved"); await load(); }
  }

  async function togglePlanActive(plan: MembershipPlanRow) {
    await updatePlan(plan.id, { is_active: !plan.is_active });
  }

  const enrolledCountByPlan = (planId: string) =>
    memberships.filter((m) => m.plan_id === planId && m.status === "active").length;

  return (
    <div className="min-h-full bg-bone">
      <div className="max-w-[1100px] mx-auto px-8 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-ink-muted mb-2">
              <span>Dashboard</span><span>›</span><span className="text-ink">Memberships</span>
            </div>
            <h1 className="text-[22px] font-semibold text-ink">Memberships</h1>
            <p className="text-sm text-ink-muted mt-0.5">Manage maintenance plans and member accounts.</p>
          </div>
          {tab === "members" && (
            <button
              onClick={() => setShowEnroll(!showEnroll)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-ink text-bone text-sm font-medium hover:bg-ink-hover transition-colors"
            >
              <Plus className="h-4 w-4" />
              Enroll customer
            </button>
          )}
          {tab === "plans" && isOwner && (
            <button
              onClick={() => setShowNewPlan(!showNewPlan)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-ink text-bone text-sm font-medium hover:bg-ink-hover transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create plan
            </button>
          )}
        </div>

        {loading ? (
          <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-3 mb-6">
              {[
                { label: "Active members", value: activeCount, icon: <Users className="h-4 w-4" />, cls: "text-confirmed-text" },
                { label: "Monthly revenue", value: centsToDisplay(Math.round(monthlyRevenue)), icon: <TrendingUp className="h-4 w-4" />, cls: "text-ai" },
                { label: "Expiring in 30 days", value: expiringCount, icon: <AlertTriangle className="h-4 w-4" />, cls: expiringCount > 0 ? "text-waiting-text" : "text-ink-muted" },
                { label: "Lapsed", value: lapsedCount, icon: <BadgeCheck className="h-4 w-4" />, cls: lapsedCount > 0 ? "text-blocked-text" : "text-ink-muted" },
              ].map(({ label, value, icon, cls }) => (
                <div key={label} className="rounded-xl border border-line bg-paper px-4 py-4">
                  <div className={cn("mb-2", cls)}>{icon}</div>
                  <p className="text-xl font-semibold text-ink tabular-nums">{value}</p>
                  <p className="text-xs text-ink-muted mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 mb-5 border-b border-line-2">
              {(["members", "plans"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "px-4 py-2.5 text-[13px] font-medium capitalize border-b-2 -mb-px transition-colors",
                    tab === t ? "border-ink text-ink" : "border-transparent text-ink-muted hover:text-ink",
                  )}
                >
                  {t === "members" ? `Members (${activeCount})` : `Plans (${plans.filter((p) => p.is_active).length})`}
                </button>
              ))}
            </div>

            {/* Members tab */}
            {tab === "members" && (
              <div className="space-y-4">
                {showEnroll && tenant && (
                  <EnrollForm
                    plans={plans}
                    tenantId={tenant.id}
                    onDone={async () => { setShowEnroll(false); await load(); }}
                  />
                )}

                {/* Filters + search */}
                <div className="flex items-center gap-3">
                  <div className="flex gap-1 bg-raised rounded-xl p-1 border border-line">
                    {(["all", "active", "expiring", "lapsed"] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-[12px] font-medium capitalize transition-colors",
                          filter === f ? "bg-paper text-ink shadow-sm border border-line" : "text-ink-muted hover:text-ink",
                        )}
                      >
                        {f === "expiring" ? "Expiring soon" : f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>
                  <Input
                    className="max-w-xs"
                    placeholder="Search customer…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                {/* Members table */}
                {filteredMembers.length === 0 ? (
                  <div className="rounded-xl border border-line bg-paper px-6 py-12 text-center">
                    <BadgeCheck className="h-8 w-8 text-ink-muted mx-auto mb-3" />
                    <p className="text-sm font-medium text-ink mb-1">No members yet</p>
                    <p className="text-xs text-ink-muted">Enroll your first customer to get started.</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-line overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-line-2 bg-raised">
                          <th className="text-left text-[11px] font-semibold uppercase tracking-widest text-ink-muted px-4 py-2.5">Customer</th>
                          <th className="text-left text-[11px] font-semibold uppercase tracking-widest text-ink-muted px-4 py-2.5">Plan</th>
                          <th className="text-left text-[11px] font-semibold uppercase tracking-widest text-ink-muted px-4 py-2.5">Status</th>
                          <th className="text-left text-[11px] font-semibold uppercase tracking-widest text-ink-muted px-4 py-2.5">Expires</th>
                          <th className="text-left text-[11px] font-semibold uppercase tracking-widest text-ink-muted px-4 py-2.5">Billing</th>
                          <th className="px-4 py-2.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMembers.map((m) => {
                          const badge = statusBadge(m.status, m.expires_at);
                          const days  = daysUntil(m.expires_at);
                          return (
                            <tr key={m.id} className="border-b border-line-2 last:border-b-0 hover:bg-raised transition-colors">
                              <td className="px-4 py-3">
                                <p className="text-sm font-medium text-ink">{m.customers?.name ?? "—"}</p>
                                <p className="text-xs text-ink-muted">{m.customers?.phone ?? ""}</p>
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm text-ink">{m.membership_plans?.name ?? "—"}</p>
                              </td>
                              <td className="px-4 py-3">
                                <span className={cn("text-[11px] font-medium rounded-pill px-2 py-0.5 border", badge.cls)}>
                                  {badge.label}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm text-ink tabular-nums">{new Date(m.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                                {m.status === "active" && days <= 60 && (
                                  <p className="text-[11px] text-ink-muted">{days} days</p>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-xs capitalize text-ink-muted">{m.billing_cycle}</span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1 justify-end">
                                  {(m.status === "lapsed" || (m.status === "active" && days <= 30)) && (
                                    <button
                                      onClick={() => void renewMembership(m)}
                                      className="text-xs text-confirmed-text hover:text-confirmed-text/80 font-medium px-2 py-1 rounded-lg hover:bg-confirmed-bg transition-colors"
                                    >
                                      Renew
                                    </button>
                                  )}
                                  {m.status === "active" && (
                                    <button
                                      onClick={() => void cancelMembership(m)}
                                      className="text-xs text-ink-muted hover:text-blocked-text font-medium px-2 py-1 rounded-lg hover:bg-blocked-bg transition-colors"
                                    >
                                      Cancel
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Plans tab */}
            {tab === "plans" && (
              <div className="space-y-4">
                {/* New plan form */}
                {showNewPlan && isOwner && (
                  <div className="rounded-xl border border-ai-tint-border bg-ai-tint px-5 py-5 space-y-4">
                    <p className="text-sm font-semibold text-ai-ink">New membership plan</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-[12px] text-ink-muted">Plan name *</Label>
                        <Input value={newPlanDraft.name} onChange={(e) => setNewPlanDraft((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Basic Home Care" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[12px] text-ink-muted">Tagline</Label>
                        <Input value={newPlanDraft.description} onChange={(e) => setNewPlanDraft((p) => ({ ...p, description: e.target.value }))} placeholder="Optional description" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-[12px] text-ink-muted">Price (cents) *</Label>
                        <Input
                          type="number" min={0}
                          value={newPlanDraft.price_cents}
                          onChange={(e) => setNewPlanDraft((p) => ({ ...p, price_cents: Number(e.target.value) }))}
                        />
                        <p className="text-[10px] text-ink-muted">{centsToDisplay(newPlanDraft.price_cents)}</p>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[12px] text-ink-muted">Billing</Label>
                        <select
                          value={newPlanDraft.billing_cycle}
                          onChange={(e) => setNewPlanDraft((p) => ({ ...p, billing_cycle: e.target.value as BillingCycle }))}
                          className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"
                        >
                          <option value="annual">Annual</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[12px] text-ink-muted">Parts discount %</Label>
                        <Input
                          type="number" min={0} max={100}
                          value={newPlanDraft.discount_percent}
                          onChange={(e) => setNewPlanDraft((p) => ({ ...p, discount_percent: Number(e.target.value) }))}
                        />
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer text-[13px] text-ink">
                        <input
                          type="checkbox"
                          checked={newPlanDraft.free_service_call}
                          onChange={(e) => setNewPlanDraft((p) => ({ ...p, free_service_call: e.target.checked }))}
                          className="rounded"
                        />
                        Free service calls
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-[13px] text-ink">
                        <input
                          type="checkbox"
                          checked={newPlanDraft.priority_dispatch}
                          onChange={(e) => setNewPlanDraft((p) => ({ ...p, priority_dispatch: e.target.checked }))}
                          className="rounded"
                        />
                        Priority dispatch
                      </label>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[12px] text-ink-muted">Benefits (one per line)</Label>
                      <textarea
                        value={newPlanDraft.benefits_text}
                        onChange={(e) => setNewPlanDraft((p) => ({ ...p, benefits_text: e.target.value }))}
                        rows={3}
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none"
                        placeholder="Annual tune-up included&#10;Priority scheduling"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setShowNewPlan(false)} className="text-xs text-ink-muted hover:text-ink px-3 py-1.5 transition-colors">Cancel</button>
                      <button
                        onClick={() => void createPlan()}
                        disabled={!newPlanDraft.name.trim() || newPlanSaving}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-ink text-bone text-xs font-medium disabled:opacity-40 hover:bg-ink-hover transition-colors"
                      >
                        {newPlanSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                        Create plan
                      </button>
                    </div>
                  </div>
                )}

                {plans.length === 0 ? (
                  <div className="rounded-xl border border-line bg-paper px-6 py-12 text-center">
                    <BadgeCheck className="h-8 w-8 text-ink-muted mx-auto mb-3" />
                    <p className="text-sm font-medium text-ink mb-1">No plans defined</p>
                    <p className="text-xs text-ink-muted">Create your first membership plan to start enrolling customers.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {plans.map((plan) => (
                      <PlanCard
                        key={plan.id}
                        plan={plan}
                        enrolledCount={enrolledCountByPlan(plan.id)}
                        isOwner={isOwner}
                        onToggleActive={togglePlanActive}
                        onUpdate={updatePlan}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
