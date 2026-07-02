import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { format, startOfDay, endOfDay } from "date-fns";
import { ArrowRight, CheckCircle, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { AIBadge } from "@/components/ui/ai-badge";
import { StatusDot } from "@/components/ui/status-dot";
import { formatCurrency, jobTypeLabel } from "@/lib/utils";
import type { JobWithRelations } from "@/types/database.types";

interface DashboardStats {
  jobsByStatus: Record<string, number>;
  revenueToday: number;
  openInvoicesCount: number;
  openInvoicesTotal: number;
  unassignedCount: number;
  aiHandledToday: number;
}

interface AgentAction {
  id: string;
  agent_type: string;
  trigger_event: string;
  status: string;
  confidence: number | null;
  reasoning: string | null;
  proposed_action: Record<string, unknown> | null;
  created_at: string;
}

// Confirmed proposal row — periwinkle → green after confirm
interface ProposalRowProps {
  action: AgentAction;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  confirmed: boolean;
}

function ProposalRow({ action, onConfirm, onReject, confirmed }: ProposalRowProps) {
  const pa = action.proposed_action;
  const summary = action.reasoning
    || (pa && typeof pa === "object" ? (pa as Record<string, string>).description ?? (pa as Record<string, string>).summary : null)
    || `${action.agent_type} action proposed`;
  const confidence = action.confidence != null ? Math.round(action.confidence * 100) : null;

  if (confirmed) {
    return (
      <div className="flex items-center gap-3 py-2.5 px-0">
        <div className="flex-1 text-sm text-ink-2 line-through opacity-60">{summary}</div>
        <AIBadge state="approved" className="flex-shrink-0" />
        <button
          onClick={() => onReject(action.id)}
          className="flex-shrink-0 flex items-center gap-1 text-xs text-ink-muted hover:text-ink-2 transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          Undo
        </button>
      </div>
    );
  }

  return (
    <div className="py-2.5 px-0 border-t border-line-2 first:border-t-0">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-ink leading-snug">{summary}</p>
          {confidence != null && (
            <p className="text-xs text-ink-muted mt-0.5 tabular-nums">
              Confidence {confidence}%
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
          <button
            onClick={() => onReject(action.id)}
            className="px-3 py-1.5 rounded-lg border border-line bg-raised text-xs font-medium text-ink-2 hover:bg-panel-warm transition-colors"
          >
            Skip
          </button>
          <button
            onClick={() => onConfirm(action.id)}
            className="px-3 py-1.5 rounded-lg bg-ink text-bone text-xs font-medium hover:bg-ink-hover transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// KPI card
function KPICard({
  label,
  value,
  sub,
  loading,
  warn,
  ai,
}: {
  label: string;
  value: string;
  sub?: string;
  loading: boolean;
  warn?: boolean;
  ai?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-5 py-4 bg-paper ${
        warn ? "border-waiting-border bg-waiting-bg" : ai ? "border-ai-tint-border bg-ai-tint" : "border-line"
      }`}
    >
      <p
        className={`text-[11px] font-semibold uppercase tracking-widest mb-1 ${
          warn ? "text-waiting-text" : ai ? "text-ai-ink" : "text-ink-muted"
        }`}
      >
        {ai && <span className="mr-1">✦</span>}
        {label}
      </p>
      {loading ? (
        <Skeleton className="h-8 w-20 mt-1" />
      ) : (
        <p className={`text-[28px] font-semibold tracking-tight tabular-nums leading-none ${
          warn ? "text-waiting-text" : ai ? "text-ai" : "text-ink"
        }`}>
          {value}
        </p>
      )}
      {sub && !loading && (
        <p className={`text-xs mt-1 ${warn ? "text-waiting-text" : ai ? "text-ai-ink" : "text-ink-muted"}`}>
          {sub}
        </p>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { tenant } = useAuth();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [todaysJobs, setTodaysJobs] = useState<JobWithRelations[]>([]);
  const [proposals, setProposals] = useState<AgentAction[]>([]);
  const [recentActions, setRecentActions] = useState<AgentAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!tenant) return;
    void loadDashboard();
  }, [tenant]);

  async function loadDashboard() {
    if (!tenant) return;
    setLoading(true);
    try {
      const now = new Date();
      const todayStart = startOfDay(now).toISOString();
      const todayEnd = endOfDay(now).toISOString();

      const [jobsRes, statusRes, revenueRes, openInvRes, agentRes] = await Promise.all([
        supabase
          .from("jobs")
          .select("*, customers(id,name,phone), service_locations(id,address,city,state), technicians(id,name,phone)")
          .eq("tenant_id", tenant.id)
          .is("deleted_at", null)
          .or(`scheduled_start.gte.${todayStart},scheduled_start.is.null`)
          .lte("scheduled_start", todayEnd)
          .order("scheduled_start", { ascending: true }),

        supabase
          .from("jobs")
          .select("status")
          .eq("tenant_id", tenant.id)
          .is("deleted_at", null)
          .not("status", "in", "(cancelled,no_show,invoiced)"),

        supabase
          .from("invoices")
          .select("total")
          .eq("tenant_id", tenant.id)
          .eq("status", "paid")
          .gte("paid_at", todayStart)
          .lte("paid_at", todayEnd),

        supabase
          .from("invoices")
          .select("balance_due")
          .eq("tenant_id", tenant.id)
          .in("status", ["sent", "viewed", "partial", "overdue"]),

        // Agent actions — proposals + today's activity
        supabase
          .from("agent_actions")
          .select("id, agent_type, trigger_event, status, confidence, reasoning, proposed_action, created_at")
          .eq("tenant_id", tenant.id)
          .order("created_at", { ascending: false })
          .limit(30),
      ]);

      setTodaysJobs((jobsRes.data ?? []) as JobWithRelations[]);

      const jobsByStatus: Record<string, number> = {};
      (statusRes.data ?? []).forEach((j) => {
        jobsByStatus[j.status] = (jobsByStatus[j.status] ?? 0) + 1;
      });

      const revenueToday = (revenueRes.data ?? []).reduce((s, i) => s + (i.total ?? 0), 0);
      const openInvoicesCount = openInvRes.data?.length ?? 0;
      const openInvoicesTotal = (openInvRes.data ?? []).reduce((s, i) => s + (i.balance_due ?? 0), 0);

      const allActions = (agentRes.data ?? []) as AgentAction[];
      const todayProposals = allActions.filter(
        (a) => a.status === "proposed" && new Date(a.created_at) >= startOfDay(now)
      );
      const aiHandledToday = allActions.filter(
        (a) =>
          (a.status === "auto_executed" || a.status === "operator_approved") &&
          new Date(a.created_at) >= startOfDay(now)
      ).length;

      setProposals(todayProposals);
      setRecentActions(allActions.filter((a) => a.status !== "proposed").slice(0, 8));
      setStats({ jobsByStatus, revenueToday, openInvoicesCount, openInvoicesTotal, unassignedCount: jobsByStatus["unassigned"] ?? 0, aiHandledToday });
    } finally {
      setLoading(false);
    }
  }

  async function confirmProposal(id: string) {
    setConfirmedIds((s) => new Set(s).add(id));
    await supabase.from("agent_actions").update({ status: "operator_approved" }).eq("id", id);
  }

  async function rejectProposal(id: string) {
    setProposals((prev) => prev.filter((p) => p.id !== id));
    setConfirmedIds((s) => { const n = new Set(s); n.delete(id); return n; });
    await supabase.from("agent_actions").update({ status: "operator_rejected" }).eq("id", id);
  }

  const totalActiveJobs = stats ? Object.values(stats.jobsByStatus).reduce((a, b) => a + b, 0) : 0;
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  // Activity feed label map — keyed by agent_type (the DB column that exists)
  function activityLabel(action: AgentAction): string {
    const map: Record<string, string> = {
      dispatch:          "Dispatched job",
      booking:           "Booked new job",
      invoice:           "Auto-sent invoice",
      eta_notification:  "Sent ETA notification",
      review_request:    "Sent review request",
      warranty_detector: "Flagged warranty callback",
      operator:          "Answered operator query",
    };
    return map[action.agent_type] ?? action.trigger_event.replace(/_/g, " ");
  }

  function activityGlyph(action: AgentAction): string {
    const map: Record<string, string> = {
      dispatch:          "⟶",
      booking:           "+",
      invoice:           "◈",
      eta_notification:  "✉",
      review_request:    "★",
      warranty_detector: "⚠",
      operator:          "?",
    };
    return map[action.agent_type] ?? "✦";
  }

  function activityColor(action: AgentAction): { bg: string; text: string } {
    if (action.status === "auto_executed")    return { bg: "#EEF0F7", text: "#46537F" };
    if (action.status === "operator_approved") return { bg: "#ECF1EC", text: "#4C6749" };
    if (action.status === "operator_rejected") return { bg: "#F4EFE6", text: "#9A9082" };
    if (action.status === "proposed")          return { bg: "#F8F1E1", text: "#8A6A22" };
    return { bg: "#F4EFE6", text: "#6F6658" };
  }

  const visibleProposals = proposals.filter((p) => !confirmedIds.has(p.id) || confirmedIds.has(p.id));

  return (
    <div className="min-h-full bg-bone">
      <div className="max-w-[1180px] mx-auto px-4 sm:px-8 py-6 sm:py-8 space-y-6">

        {/* Page header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold text-ink">
              {greeting}, {tenant?.name?.split(" ")[0] ?? "there"}
            </h1>
            <p className="text-sm text-ink-muted mt-0.5">
              {format(new Date(), "EEEE, MMMM d")}
            </p>
          </div>
          <Link
            to={`/${tenantSlug}/jobs/new`}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-ink text-bone text-sm font-semibold hover:bg-ink-hover transition-colors"
          >
            + New Job
          </Link>
        </div>

        {/* AI Briefing card — only when there are proposals */}
        {!loading && visibleProposals.length > 0 && (
          <div className="rounded-xl border border-ai-tint-border bg-ai-tint px-6 py-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-ai text-base">✦</span>
              <span className="text-sm font-semibold text-ai-ink">Jordan has {proposals.length} proposal{proposals.length !== 1 ? "s" : ""} for you</span>
              <span className="ml-auto text-xs text-ai-ink opacity-60">
                {format(new Date(), "h:mm a")}
              </span>
            </div>
            <div className="space-y-0">
              {visibleProposals.map((p) => (
                <ProposalRow
                  key={p.id}
                  action={p}
                  onConfirm={confirmProposal}
                  onReject={rejectProposal}
                  confirmed={confirmedIds.has(p.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KPICard
            loading={loading}
            label="Active Jobs"
            value={totalActiveJobs.toString()}
            sub={`${stats?.jobsByStatus["in_progress"] ?? 0} in progress`}
          />
          <KPICard
            loading={loading}
            label="Revenue Today"
            value={formatCurrency(stats?.revenueToday)}
            sub="Collected today"
          />
          <KPICard
            loading={loading}
            label="Unassigned"
            value={stats?.unassignedCount.toString() ?? "0"}
            sub="Need tech assignment"
            warn={(stats?.unassignedCount ?? 0) > 0}
          />
          <KPICard
            loading={loading}
            label="AI Handled Today"
            value={stats?.aiHandledToday.toString() ?? "0"}
            sub="Actions without you"
            ai
          />
        </div>

        {/* Two-column body */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-6">

          {/* Agent activity feed */}
          <div className="rounded-xl border border-line bg-paper px-6 py-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[13px] font-semibold uppercase tracking-widest text-ink-muted">
                Agent Activity
              </h2>
            </div>
            {loading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
              </div>
            ) : recentActions.length === 0 ? (
              <p className="text-sm text-ink-muted py-4 text-center">No agent activity yet today</p>
            ) : (
              <div className="space-y-1">
                {recentActions.map((action) => {
                  const { bg, text } = activityColor(action);
                  return (
                    <div key={action.id} className="flex items-center gap-3 py-2.5 border-b border-line-2 last:border-b-0">
                      <span
                        className="h-7 w-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0 font-medium"
                        style={{ background: bg, color: text }}
                      >
                        {activityGlyph(action)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ink leading-tight">{activityLabel(action)}</p>
                        <p className="text-xs text-ink-muted tabular-nums mt-0.5">
                          {format(new Date(action.created_at), "h:mm a")}
                          {action.status === "auto_executed" && (
                            <span className="ml-2 inline-flex items-center gap-0.5 text-ai-ink">
                              <span className="text-[10px]">✦</span> Auto
                            </span>
                          )}
                        </p>
                      </div>
                      {action.confidence != null && (
                        <span className="text-xs tabular-nums text-ink-muted flex-shrink-0">
                          {Math.round(action.confidence * 100)}%
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Today's jobs timeline */}
          <div className="rounded-xl border border-line bg-paper px-6 py-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[13px] font-semibold uppercase tracking-widest text-ink-muted">
                Today's Jobs
              </h2>
              <Link
                to={`/${tenantSlug}/dispatch`}
                className="text-xs text-ink-muted hover:text-ink flex items-center gap-1 transition-colors"
              >
                Dispatch <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            {loading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
              </div>
            ) : todaysJobs.length === 0 ? (
              <div className="py-8 text-center">
                <CheckCircle className="h-8 w-8 text-confirmed-dot mx-auto mb-2 opacity-40" />
                <p className="text-sm text-ink-muted">No jobs today</p>
                <Link
                  to={`/${tenantSlug}/jobs/new`}
                  className="mt-3 inline-flex text-xs text-ai hover:text-ai-ink transition-colors"
                >
                  + Book a job
                </Link>
              </div>
            ) : (
              <div className="space-y-1">
                {todaysJobs.map((job) => (
                  <div key={job.id} className="flex items-center gap-3 py-2.5 border-b border-line-2 last:border-b-0">
                    <StatusDot status={job.status} size="sm" className="flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-ink truncate leading-tight">
                        {job.customers?.name ?? "Unknown"}
                      </p>
                      <p className="text-xs text-ink-muted truncate mt-0.5">
                        {jobTypeLabel(job.job_type)}
                        {job.technicians?.name && ` · ${job.technicians.name}`}
                      </p>
                    </div>
                    {job.scheduled_start && (
                      <span className="text-xs text-ink-muted tabular-nums flex-shrink-0">
                        {format(new Date(job.scheduled_start), "h:mm a")}
                      </span>
                    )}
                    {!job.tech_id && (
                      <span className="text-[10px] font-semibold text-waiting-text bg-waiting-bg border border-waiting-border rounded-pill px-1.5 py-0.5 flex-shrink-0">
                        Unassigned
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
