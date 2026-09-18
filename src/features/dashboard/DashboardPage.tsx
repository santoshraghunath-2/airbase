import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  format, startOfDay, endOfDay, startOfWeek, endOfWeek,
  addDays, differenceInDays,
} from "date-fns";
import { AlertTriangle, ArrowRight, CheckCircle, MessageSquare, Phone, RefreshCw, RotateCcw, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { AIBadge } from "@/components/ui/ai-badge";
import { StatusDot } from "@/components/ui/status-dot";
import { formatCurrency, jobTypeLabel, initials } from "@/lib/utils";
import { toast } from "sonner";
import type { BriefingRow, JobWithRelations } from "@/types/database.types";

interface DashboardStats {
  jobsByStatus: Record<string, number>;
  revenueToday: number;
  revenueThisWeek: number;
  unassignedCount: number;
  aiHandledToday: number;
}

interface BookingConversation {
  id: string;
  channel: "voice" | "sms";
  status: "active" | "resolved" | "escalated" | "abandoned";
  phone: string;
  customer_id: string | null;
  job_id: string | null;
  context: Record<string, unknown> | null;
  created_at: string;
  customers?: { name: string } | null;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return phone;
}

interface InvoiceAging {
  recent: { count: number; total: number };
  aging:  { count: number; total: number };
  old:    { count: number; total: number };
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

// ─── ProposalRow ─────────────────────────────────────────────────────────────

interface ProposalRowProps {
  action: AgentAction;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  confirmed: boolean;
}

function ProposalRow({ action, onConfirm, onReject, confirmed }: ProposalRowProps) {
  const pa = action.proposed_action;
  const summary =
    action.reasoning ||
    (pa && typeof pa === "object"
      ? (pa as Record<string, string>).description ?? (pa as Record<string, string>).summary
      : null) ||
    `${action.agent_type} action proposed`;
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
            <p className="text-xs text-ink-muted mt-0.5 tabular-nums">Confidence {confidence}%</p>
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

// ─── EscalationBar ───────────────────────────────────────────────────────────

function EscalationBar({
  escalations,
  onDismiss,
  tenantSlug,
}: {
  escalations: BookingConversation[];
  onDismiss: (id: string) => void;
  tenantSlug: string;
}) {
  if (escalations.length === 0) return null;

  return (
    <div className="rounded-xl border border-waiting-border bg-waiting-bg px-5 py-3.5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-waiting-text flex-shrink-0" />
        <span className="text-sm font-semibold text-waiting-text">
          {escalations.length === 1 ? "Live escalation" : `${escalations.length} live escalations`} — caller transferring to your line
        </span>
        <Link
          to={`/${tenantSlug}/booking`}
          className="ml-auto text-xs font-medium text-waiting-text hover:opacity-70 flex items-center gap-1 flex-shrink-0"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="space-y-1.5">
        {escalations.map((esc) => {
          const reason = esc.context?.escalation_reason as string | undefined;
          const callerLabel = esc.customers?.name ?? formatPhone(esc.phone);
          return (
            <div key={esc.id} className="flex items-center gap-3 text-sm text-waiting-text">
              <Phone className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="font-medium">{callerLabel}</span>
              {reason && <span className="text-waiting-text opacity-70">· {reason}</span>}
              <span className="tabular-nums text-xs opacity-60 flex-shrink-0">{timeAgo(esc.created_at)}</span>
              <button
                onClick={() => onDismiss(esc.id)}
                className="ml-auto text-waiting-text hover:opacity-70 flex-shrink-0"
                aria-label="Dismiss alert"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── BookingActivityFeed ──────────────────────────────────────────────────────

function BookingActivityFeed({
  convos,
  loading,
}: {
  convos: BookingConversation[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    );
  }
  if (convos.length === 0) {
    return <p className="text-sm text-ink-muted py-4 text-center">No inbound activity today</p>;
  }

  return (
    <div className="space-y-0">
      {convos.map((c) => {
        const callerLabel = c.customers?.name ?? formatPhone(c.phone);
        const isVoice = c.channel === "voice";
        const aiBooked = c.job_id != null;
        const statusStyles: Record<string, { bg: string; text: string; label: string }> = {
          active:    { bg: "#D4E6D0", text: "#3D6139", label: "Active" },
          resolved:  { bg: "#EEF0F7", text: "#46537F", label: aiBooked ? "Booked" : "Resolved" },
          escalated: { bg: "#F8F1E1", text: "#8A6A22", label: "Escalated" },
          abandoned: { bg: "#F4EFE6", text: "#9A9082", label: "Abandoned" },
        };
        const style = statusStyles[c.status] ?? statusStyles.resolved;

        return (
          <div
            key={c.id}
            className="flex items-center gap-3 py-2.5 border-b border-line-2 last:border-b-0"
          >
            <span
              className="h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: style.bg, color: style.text }}
            >
              {isVoice
                ? <Phone className="h-3.5 w-3.5" />
                : <MessageSquare className="h-3.5 w-3.5" />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm text-ink leading-tight truncate">{callerLabel}</p>
                {aiBooked && (
                  <span className="text-[10px] font-semibold text-ai-ink flex-shrink-0">✦ AI</span>
                )}
              </div>
              <p className="text-xs text-ink-muted tabular-nums mt-0.5">{timeAgo(c.created_at)}</p>
            </div>
            <span
              className="text-[10px] font-semibold rounded-pill px-1.5 py-0.5 flex-shrink-0"
              style={{ background: style.bg, color: style.text }}
            >
              {style.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── KPICard ──────────────────────────────────────────────────────────────────

function KPICard({
  label, value, sub, loading, warn, ai,
}: {
  label: string; value: string; sub?: string; loading: boolean; warn?: boolean; ai?: boolean;
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
        <p
          className={`text-[28px] font-semibold tracking-tight tabular-nums leading-none ${
            warn ? "text-waiting-text" : ai ? "text-ai" : "text-ink"
          }`}
        >
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

// ─── TechChip ─────────────────────────────────────────────────────────────────

function TechChip({ tech, jobs }: { tech: { id: string; name: string }; jobs: JobWithRelations[] }) {
  const isActive = jobs.some((j) =>
    ["in_progress", "on_site", "arrived", "en_route"].includes(j.status)
  );
  const allDone =
    jobs.length > 0 && jobs.every((j) => ["completed", "invoiced"].includes(j.status));

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg border flex-shrink-0"
      style={
        isActive
          ? { borderColor: "#C8DFCA", background: "#F0F4EC" }
          : { borderColor: "#E8E2D9", background: "#FAFAF8" }
      }
    >
      <div
        className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0"
        style={{
          background: isActive ? "#D4E6D0" : "#EEEBE6",
          color: isActive ? "#4C6749" : "#9A9082",
        }}
      >
        {initials(tech.name)}
      </div>
      <span
        className="text-sm font-medium"
        style={{ color: isActive ? "#4C6749" : allDone ? "#9A9082" : "#6F6658" }}
      >
        {tech.name.split(" ")[0]}
      </span>
      <span
        className="text-[11px]"
        style={{ color: isActive ? "#6B9467" : "#9A9082" }}
      >
        {jobs.length === 0
          ? "Free"
          : allDone
          ? `${jobs.length} done`
          : `${jobs.length} job${jobs.length !== 1 ? "s" : ""}`}
      </span>
      {isActive && (
        <span
          className="h-1.5 w-1.5 rounded-full animate-pulse flex-shrink-0"
          style={{ background: "#6B9467" }}
        />
      )}
    </div>
  );
}

// ─── AgingBucket ──────────────────────────────────────────────────────────────

function AgingBucket({
  label, count, total, warn, critical, loading,
}: {
  label: string; count: number; total: number;
  warn?: boolean; critical?: boolean; loading: boolean;
}) {
  const containerClass = critical
    ? "border-red-200 bg-red-50"
    : warn
    ? "border-waiting-border bg-waiting-bg"
    : "border-line bg-paper";
  const valueClass = critical ? "text-red-600" : warn ? "text-waiting-text" : "text-ink";
  const labelClass = critical ? "text-red-400" : warn ? "text-waiting-text" : "text-ink-muted";

  return (
    <div className={`flex-1 rounded-xl border px-4 py-3.5 ${containerClass}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-widest mb-1.5 ${labelClass}`}>
        {label}
      </p>
      {loading ? (
        <Skeleton className="h-6 w-10 mb-1" />
      ) : (
        <>
          <p className={`text-2xl font-semibold tabular-nums leading-none ${valueClass}`}>
            {count}
          </p>
          <p className={`text-xs mt-1 ${labelClass}`}>{formatCurrency(total)}</p>
        </>
      )}
    </div>
  );
}

// ─── BriefingCard ─────────────────────────────────────────────────────────────

function BriefingCard({
  briefing,
  onGenerate,
  generating,
}: {
  briefing: BriefingRow | null;
  onGenerate: () => void;
  generating: boolean;
}) {
  return (
    <div className="rounded-xl border border-ai-tint-border bg-ai-tint px-6 py-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-ai text-base">✦</span>
          <span className="text-sm font-semibold text-ai-ink">Weekly Briefing</span>
          {briefing && (
            <span className="text-xs text-ai-ink opacity-60">
              Week of {briefing.period_start}
            </span>
          )}
        </div>
        <button
          onClick={onGenerate}
          disabled={generating}
          className="flex items-center gap-1.5 text-xs text-ai-ink hover:opacity-70 transition-opacity disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${generating ? "animate-spin" : ""}`} />
          {generating ? "Generating…" : "Regenerate"}
        </button>
      </div>

      {!briefing ? (
        <p className="text-sm text-ai-ink opacity-70 py-2">
          No briefing yet.{" "}
          <button onClick={onGenerate} disabled={generating} className="underline hover:opacity-70">
            Generate now
          </button>
          {" "}to get your first summary.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-[15px] font-medium text-ai-ink leading-snug">{briefing.headline}</p>
          {briefing.highlights.length > 0 && (
            <ul className="space-y-1">
              {briefing.highlights.map((h, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-ai-ink">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-ai flex-shrink-0" />
                  {h}
                </li>
              ))}
            </ul>
          )}
          {briefing.watch_items.length > 0 && (
            <div className="rounded-lg bg-waiting-bg border border-waiting-border px-4 py-3 space-y-1">
              {briefing.watch_items.map((w, i) => (
                <p key={i} className="flex items-start gap-2 text-sm text-waiting-text">
                  <span className="mt-0.5 flex-shrink-0">⚠</span>
                  {w}
                </p>
              ))}
            </div>
          )}
          <p className="text-sm text-ai-ink italic border-t border-ai-tint-border pt-3">
            {briefing.recommendation}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── DashboardPage ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { tenant } = useAuth();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [todaysJobs, setTodaysJobs] = useState<JobWithRelations[]>([]);
  const [tomorrowJobs, setTomorrowJobs] = useState<JobWithRelations[]>([]);
  const [activeTechs, setActiveTechs] = useState<{ id: string; name: string }[]>([]);
  const [bookingInboxCount, setBookingInboxCount] = useState(0);
  const [invoiceAging, setInvoiceAging] = useState<InvoiceAging | null>(null);
  const [proposals, setProposals] = useState<AgentAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [briefing, setBriefing] = useState<BriefingRow | null | undefined>(undefined);
  const [generatingBriefing, setGeneratingBriefing] = useState(false);
  const [bookingActivity, setBookingActivity] = useState<BookingConversation[]>([]);
  const [inboundStats, setInboundStats] = useState<{ total: number; aiBooked: number } | null>(null);
  const [dismissedEscalations, setDismissedEscalations] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!tenant) return;
    void loadDashboard();
    void loadBriefing();
  }, [tenant]);

  useEffect(() => {
    if (!tenant) return;
    void loadBookingActivity();
    const channel = supabase
      .channel(`booking-convos-${tenant.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "booking_conversations",
        filter: `tenant_id=eq.${tenant.id}`,
      }, () => { void loadBookingActivity(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant]);

  async function loadDashboard() {
    if (!tenant) return;
    setLoading(true);
    try {
      const now = new Date();
      const todayStart    = startOfDay(now).toISOString();
      const todayEnd      = endOfDay(now).toISOString();
      const tomorrowStart = startOfDay(addDays(now, 1)).toISOString();
      const tomorrowEnd   = endOfDay(addDays(now, 1)).toISOString();
      const weekStart     = startOfWeek(now).toISOString();
      const weekEnd       = endOfWeek(now).toISOString();

      const [
        jobsRes, statusRes, revenueRes, weekRevenueRes,
        openInvRes, agentRes, techsRes, bookingRes, tomorrowRes,
      ] = await Promise.all([
        // Today's jobs
        supabase
          .from("jobs")
          .select("*, customers(id,name,phone), service_locations(id,address,city,state), technicians(id,name,phone)")
          .eq("tenant_id", tenant.id)
          .is("deleted_at", null)
          .or(`scheduled_start.gte.${todayStart},scheduled_start.is.null`)
          .lte("scheduled_start", todayEnd)
          .order("scheduled_start", { ascending: true }),

        // Job status counts (active)
        supabase
          .from("jobs")
          .select("status")
          .eq("tenant_id", tenant.id)
          .is("deleted_at", null)
          .not("status", "in", "(cancelled,no_show,invoiced)"),

        // Revenue today
        supabase
          .from("invoices")
          .select("total")
          .eq("tenant_id", tenant.id)
          .eq("status", "paid")
          .gte("paid_at", todayStart)
          .lte("paid_at", todayEnd),

        // Revenue this week
        supabase
          .from("invoices")
          .select("total")
          .eq("tenant_id", tenant.id)
          .eq("status", "paid")
          .gte("paid_at", weekStart)
          .lte("paid_at", weekEnd),

        // Open invoices with dates for aging buckets
        supabase
          .from("invoices")
          .select("id, balance_due, sent_at, created_at")
          .eq("tenant_id", tenant.id)
          .in("status", ["sent", "viewed", "partial", "overdue"]),

        // Agent actions
        supabase
          .from("agent_actions")
          .select("id, agent_type, trigger_event, status, confidence, reasoning, proposed_action, created_at")
          .eq("tenant_id", tenant.id)
          .order("created_at", { ascending: false })
          .limit(30),

        // Active technicians
        supabase
          .from("technicians")
          .select("id, name")
          .eq("tenant_id", tenant.id)
          .eq("is_active", true)
          .order("name"),

        // Booking inbox — active + escalated conversations
        supabase
          .from("booking_conversations")
          .select("*", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .in("status", ["active", "escalated"])
          .is("deleted_at", null),

        // Tomorrow's jobs (first 4)
        supabase
          .from("jobs")
          .select("*, customers(id,name,phone), service_locations(id,address,city,state), technicians(id,name,phone)")
          .eq("tenant_id", tenant.id)
          .is("deleted_at", null)
          .gte("scheduled_start", tomorrowStart)
          .lte("scheduled_start", tomorrowEnd)
          .order("scheduled_start", { ascending: true })
          .limit(4),
      ]);

      setTodaysJobs((jobsRes.data ?? []) as JobWithRelations[]);
      setTomorrowJobs((tomorrowRes.data ?? []) as JobWithRelations[]);
      setActiveTechs((techsRes.data ?? []) as { id: string; name: string }[]);
      setBookingInboxCount(bookingRes.count ?? 0);

      const jobsByStatus: Record<string, number> = {};
      (statusRes.data ?? []).forEach((j) => {
        jobsByStatus[j.status] = (jobsByStatus[j.status] ?? 0) + 1;
      });

      const revenueToday    = (revenueRes.data ?? []).reduce((s, i) => s + (i.total ?? 0), 0);
      const revenueThisWeek = (weekRevenueRes.data ?? []).reduce((s, i) => s + (i.total ?? 0), 0);

      // Invoice aging buckets: key on sent_at, fall back to created_at
      const aging: InvoiceAging = {
        recent: { count: 0, total: 0 },
        aging:  { count: 0, total: 0 },
        old:    { count: 0, total: 0 },
      };
      for (const inv of openInvRes.data ?? []) {
        const refDate = inv.sent_at ? new Date(inv.sent_at) : new Date(inv.created_at);
        const daysOld = differenceInDays(now, refDate);
        const bucket  = daysOld <= 7 ? "recent" : daysOld <= 30 ? "aging" : "old";
        aging[bucket].count++;
        aging[bucket].total += Number(inv.balance_due ?? 0);
      }
      setInvoiceAging(aging);

      const allActions     = (agentRes.data ?? []) as AgentAction[];
      const todayProposals = allActions.filter(
        (a) => a.status === "proposed" && new Date(a.created_at) >= startOfDay(now)
      );
      const aiHandledToday = allActions.filter(
        (a) =>
          (a.status === "auto_executed" || a.status === "operator_approved") &&
          new Date(a.created_at) >= startOfDay(now)
      ).length;

      setProposals(todayProposals);
      setStats({ jobsByStatus, revenueToday, revenueThisWeek, unassignedCount: jobsByStatus["unassigned"] ?? 0, aiHandledToday });
    } finally {
      setLoading(false);
    }
  }

  async function loadBookingActivity() {
    if (!tenant) return;
    const todayStart = startOfDay(new Date()).toISOString();
    const { data } = await supabase
      .from("booking_conversations")
      .select("id, channel, status, phone, customer_id, job_id, context, created_at, customers(name)")
      .eq("tenant_id", tenant.id)
      .gte("created_at", todayStart)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20);
    const convos = (data ?? []) as BookingConversation[];
    setBookingActivity(convos);
    setInboundStats({ total: convos.length, aiBooked: convos.filter((c) => c.job_id != null).length });
  }

  async function loadBriefing() {
    if (!tenant) return;
    const { data } = await supabase
      .from("briefings")
      .select("*")
      .eq("tenant_id", tenant.id)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setBriefing((data as BriefingRow | null) ?? null);
  }

  async function handleGenerateBriefing() {
    setGeneratingBriefing(true);
    try {
      const { data, error } = await supabase.functions.invoke("weekly-briefing");
      if (error) throw error;
      if (data?.briefing) {
        await loadBriefing();
        toast.success("Briefing generated");
      } else {
        toast("No activity to summarize yet");
      }
    } catch {
      toast.error("Failed to generate briefing");
    } finally {
      setGeneratingBriefing(false);
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

  const totalActiveJobs = stats
    ? Object.values(stats.jobsByStatus).reduce((a, b) => a + b, 0)
    : 0;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  // Per-tech job map derived from today's already-loaded jobs
  const techJobMap = new Map<string, JobWithRelations[]>();
  for (const job of todaysJobs) {
    if (job.tech_id) {
      techJobMap.set(job.tech_id, [...(techJobMap.get(job.tech_id) ?? []), job]);
    }
  }

  const visibleProposals = proposals.filter((p) => !confirmedIds.has(p.id) || confirmedIds.has(p.id));

  return (
    <div className="min-h-full bg-bone">
      <div className="max-w-[1180px] mx-auto px-4 sm:px-8 py-6 sm:py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold text-ink">
              {greeting}, {tenant?.name?.split(" ")[0] ?? "there"}
            </h1>
            <p className="text-sm text-ink-muted mt-0.5">
              {format(new Date(), "EEEE, MMMM d")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {bookingInboxCount > 0 && (
              <Link
                to={`/${tenantSlug}/booking`}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-waiting-border bg-waiting-bg text-waiting-text text-sm font-medium hover:opacity-80 transition-opacity"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {bookingInboxCount} in inbox
              </Link>
            )}
            <Link
              to={`/${tenantSlug}/jobs/new`}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-ink text-bone text-sm font-semibold hover:bg-ink-hover transition-colors"
            >
              + New Job
            </Link>
          </div>
        </div>

        {/* AI Briefing */}
        {!loading && visibleProposals.length > 0 && (
          <div className="rounded-xl border border-ai-tint-border bg-ai-tint px-6 py-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-ai text-base">✦</span>
              <span className="text-sm font-semibold text-ai-ink">
                Jordan has {proposals.length} proposal{proposals.length !== 1 ? "s" : ""} for you
              </span>
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

        {/* Escalation bar */}
        <EscalationBar
          escalations={bookingActivity.filter(
            (c) => c.status === "escalated" && !dismissedEscalations.has(c.id)
          )}
          onDismiss={(id) => setDismissedEscalations((s) => new Set(s).add(id))}
          tenantSlug={tenantSlug ?? ""}
        />

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
            sub={stats ? `${formatCurrency(stats.revenueThisWeek)} this week` : undefined}
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
            label="Inbound Today"
            value={inboundStats?.total.toString() ?? "0"}
            sub={
              inboundStats && inboundStats.aiBooked > 0
                ? `✦ ${inboundStats.aiBooked} booked by AI`
                : "Voice + SMS"
            }
            ai
          />
        </div>

        {/* Weekly Briefing */}
        {briefing !== undefined && (
          <BriefingCard
            briefing={briefing}
            onGenerate={handleGenerateBriefing}
            generating={generatingBriefing}
          />
        )}

        {/* Tech utilization strip */}
        <div className="rounded-xl border border-line bg-paper px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
              Technicians Today
            </h2>
            <Link
              to={`/${tenantSlug}/dispatch`}
              className="text-xs text-ink-muted hover:text-ink flex items-center gap-1 transition-colors"
            >
              Dispatch <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {loading ? (
            <div className="flex gap-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-9 w-28 rounded-lg" />
              ))}
            </div>
          ) : activeTechs.length === 0 ? (
            <p className="text-sm text-ink-muted py-1">No active technicians configured</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {activeTechs.map((tech) => (
                <TechChip key={tech.id} tech={tech} jobs={techJobMap.get(tech.id) ?? []} />
              ))}
            </div>
          )}
        </div>

        {/* Invoice aging */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
              Open Invoices
            </h2>
            <Link
              to={`/${tenantSlug}/invoices`}
              className="text-xs text-ink-muted hover:text-ink flex items-center gap-1 transition-colors"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="flex gap-3 sm:gap-4">
            <AgingBucket
              label="0–7 days"
              count={invoiceAging?.recent.count ?? 0}
              total={invoiceAging?.recent.total ?? 0}
              loading={loading}
            />
            <AgingBucket
              label="7–30 days"
              count={invoiceAging?.aging.count ?? 0}
              total={invoiceAging?.aging.total ?? 0}
              warn={(invoiceAging?.aging.count ?? 0) > 0}
              loading={loading}
            />
            <AgingBucket
              label="30+ days"
              count={invoiceAging?.old.count ?? 0}
              total={invoiceAging?.old.total ?? 0}
              critical={(invoiceAging?.old.count ?? 0) > 0}
              loading={loading}
            />
          </div>
        </div>

        {/* Two-column body */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-6">

          {/* Booking activity feed */}
          <div className="rounded-xl border border-line bg-paper px-6 py-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[13px] font-semibold uppercase tracking-widest text-ink-muted">
                Booking Activity
              </h2>
              <Link
                to={`/${tenantSlug}/booking`}
                className="text-xs text-ink-muted hover:text-ink flex items-center gap-1 transition-colors"
              >
                Inbox <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <BookingActivityFeed convos={bookingActivity} loading={loading} />
          </div>

          {/* Today's jobs + tomorrow preview */}
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
              <div className="py-6 text-center">
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
                  <div
                    key={job.id}
                    className="flex items-center gap-3 py-2.5 border-b border-line-2 last:border-b-0"
                  >
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

            {/* Tomorrow preview */}
            {!loading && (
              <div className="mt-5 pt-4 border-t border-line-2">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted mb-2.5">
                  Tomorrow
                </p>
                {tomorrowJobs.length === 0 ? (
                  <p className="text-sm text-ink-muted py-1">Nothing scheduled yet</p>
                ) : (
                  <div className="space-y-1">
                    {tomorrowJobs.map((job) => (
                      <div key={job.id} className="flex items-center gap-3 py-1.5">
                        <StatusDot status={job.status} size="sm" className="flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-ink truncate leading-tight">
                            {job.customers?.name ?? "Unknown"}
                          </p>
                          <p className="text-xs text-ink-muted truncate">
                            {jobTypeLabel(job.job_type)}
                            {job.technicians?.name && ` · ${job.technicians.name}`}
                          </p>
                        </div>
                        {job.scheduled_start && (
                          <span className="text-xs text-ink-muted tabular-nums flex-shrink-0">
                            {format(new Date(job.scheduled_start), "h:mm a")}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
