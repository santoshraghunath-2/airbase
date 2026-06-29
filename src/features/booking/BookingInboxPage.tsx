import { useEffect, useState, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Phone, CheckCircle, MapPin, Clock, User, Briefcase } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AIBadge } from "@/components/ui/ai-badge";
import ConversationPanel from "./components/ConversationPanel";

export interface BookingConversation {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  phone: string;
  channel: string;
  status: "active" | "resolved" | "escalated" | "abandoned";
  job_id: string | null;
  messages: Array<{ role: string; content: string; timestamp: string; message_sid?: string }>;
  context: Record<string, unknown>;
  last_message_at: string;
  created_at: string;
}

type StatusFilter = "all" | "active" | "escalated" | "resolved";

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all",       label: "All" },
  { key: "active",    label: "Active" },
  { key: "escalated", label: "Escalated" },
  { key: "resolved",  label: "Done" },
];

function lastMessagePreview(conv: BookingConversation): string {
  const msgs = conv.messages;
  if (!msgs.length) return "No messages";
  const last = msgs[msgs.length - 1];
  return last.content.length > 72 ? last.content.slice(0, 69) + "…" : last.content;
}

function lastMessageRole(conv: BookingConversation): string {
  return conv.messages.length ? conv.messages[conv.messages.length - 1].role : "";
}

/* ── Context pane ──────────────────────────────────────────────────────────── */

function ContextPane({ conv, onConfirmJob }: {
  conv: BookingConversation;
  onConfirmJob: (conv: BookingConversation, draftJob: Record<string, string>) => Promise<void>;
}) {
  const ctx = conv.context as Record<string, unknown>;

  // Extract structured context from the JSONB field
  const problem   = ctx.problem   as string | undefined;
  const address   = ctx.address   as string | undefined;
  const deadline  = ctx.deadline  as string | undefined;
  const priority  = ctx.priority  as string | undefined;
  const customer  = ctx.customer  as Record<string, string> | undefined;
  const draftJob  = ctx.draft_job as Record<string, string> | undefined;
  const confidence = ctx.confidence as number | undefined;

  function ContextRow({ icon, label, value, verified }: {
    icon: React.ReactNode; label: string; value?: string; verified?: boolean;
  }) {
    if (!value) return null;
    return (
      <div className="flex items-start gap-2.5 py-2.5 border-b border-line-2 last:border-b-0">
        <span className="text-ink-muted mt-0.5 flex-shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-muted mb-0.5">{label}</p>
          <p className="text-sm text-ink leading-snug">{value}</p>
        </div>
        {verified && (
          <span className="text-[10px] text-confirmed-text bg-confirmed-bg border border-confirmed-border rounded-pill px-1.5 py-0.5 flex-shrink-0 font-medium">
            ✓ verified
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="w-[310px] flex-shrink-0 border-l border-line bg-panel-warm flex flex-col">
      {/* Header */}
      <div className="px-5 py-4 border-b border-line">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[12px] text-ai">✦</span>
          <p className="text-xs font-semibold text-ai-ink">What Jordan already knows</p>
        </div>
        {confidence != null && (
          <p className="text-[11px] text-ink-muted tabular-nums">
            {Math.round(confidence * 100)}% confident
          </p>
        )}
      </div>

      {/* Context fields */}
      <div className="flex-1 overflow-y-auto px-5 py-1">
        {!problem && !address && !customer && (
          <p className="text-sm text-ink-muted py-6 text-center">
            No context extracted yet
          </p>
        )}
        <ContextRow icon={<Briefcase className="h-3.5 w-3.5" />} label="Problem" value={problem} />
        <ContextRow icon={<MapPin className="h-3.5 w-3.5" />}   label="Address" value={address} verified={!!address} />
        <ContextRow icon={<Clock className="h-3.5 w-3.5" />}    label="Deadline" value={deadline} />
        <ContextRow icon={<User className="h-3.5 w-3.5" />}     label="Priority" value={priority} />
        {customer?.name && (
          <ContextRow icon={<User className="h-3.5 w-3.5" />}   label="Customer" value={customer.name} />
        )}
      </div>

      {/* Draft job card */}
      {draftJob && (
        <div className="m-4 mt-0 rounded-xl border border-ai-tint-border bg-ai-tint px-4 py-3.5">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[11px] text-ai">✦</span>
            <p className="text-xs font-semibold text-ai-ink">Draft job ready</p>
          </div>
          {draftJob.job_type && (
            <p className="text-sm text-ink font-medium">{draftJob.job_type.replace(/_/g, " ")}</p>
          )}
          {draftJob.notes && (
            <p className="text-xs text-ink-2 mt-1 leading-snug">{draftJob.notes}</p>
          )}
          <button
            className="mt-3 w-full py-2 rounded-lg bg-ink text-bone text-xs font-semibold hover:bg-ink-hover transition-colors"
            onClick={() => void onConfirmJob(conv, draftJob)}
          >
            Confirm & Create Job
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────────────────────────── */

export default function BookingInboxPage() {
  const { tenant } = useAuth();
  const [conversations, setConversations] = useState<BookingConversation[]>([]);
  const [filter, setFilter]               = useState<StatusFilter>("all");
  const [loading, setLoading]             = useState(true);
  const [selected, setSelected]           = useState<BookingConversation | null>(null);

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const query = supabase
      .from("booking_conversations")
      .select("*")
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null)
      .order("last_message_at", { ascending: false })
      .limit(200);

    if (filter !== "all") query.eq("status", filter);

    const { data } = await query;
    setConversations((data ?? []) as BookingConversation[]);
    setLoading(false);
  }, [tenant, filter]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!tenant) return;
    const channel = supabase
      .channel("booking-inbox")
      .on("postgres_changes", {
        event: "*", schema: "public", table: "booking_conversations",
        filter: `tenant_id=eq.${tenant.id}`,
      }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant, load]);

  useEffect(() => {
    if (selected) {
      const updated = conversations.find((c) => c.id === selected.id);
      if (updated) setSelected(updated);
    }
  }, [conversations]);

  const handleConfirmJob = useCallback(async (conv: BookingConversation, draftJob: Record<string, string>) => {
    if (!tenant || !conv.customer_id) {
      toast.error("Cannot create job — no customer linked to this conversation");
      return;
    }
    try {
      const { data: locations } = await supabase
        .from("service_locations")
        .select("id")
        .eq("customer_id", conv.customer_id)
        .eq("tenant_id", tenant.id)
        .limit(1);

      if (!locations?.length) {
        toast.error("No service location found for this customer. Open the customer record first.");
        return;
      }

      const { data: job, error } = await supabase.from("jobs").insert({
        tenant_id:   tenant.id,
        customer_id: conv.customer_id,
        location_id: locations[0].id,
        job_type:    draftJob.job_type ?? "plumbing_service",
        description: draftJob.notes ?? draftJob.description ?? "",
        status:      "unassigned",
        priority:    "normal",
        source:      "ai_booking",
      }).select("id").single();

      if (error) throw error;
      await supabase.from("booking_conversations").update({ job_id: job.id }).eq("id", conv.id);
      toast.success("Job created and linked to conversation");
      void load();
    } catch (err) {
      toast.error("Failed to create job", { description: (err as Error).message });
    }
  }, [tenant, load]);

  const counts = {
    all:       conversations.length,
    active:    conversations.filter((c) => c.status === "active").length,
    escalated: conversations.filter((c) => c.status === "escalated").length,
    resolved:  conversations.filter((c) => c.status === "resolved").length,
  };

  // Group for the "Needs a human" / "AI handling" split
  const escalatedConvs = conversations.filter((c) => c.status === "escalated");
  const aiHandlingConvs = conversations.filter((c) => c.status === "active");
  const doneConvs = conversations.filter((c) => c.status === "resolved" || c.status === "abandoned");

  const filteredConversations =
    filter === "all"       ? conversations :
    filter === "escalated" ? escalatedConvs :
    filter === "active"    ? aiHandlingConvs :
                             doneConvs;

  function ConvRow({ conv }: { conv: BookingConversation }) {
    const isSelected = selected?.id === conv.id;
    const isEscalated = conv.status === "escalated";
    const role = lastMessageRole(conv);
    const channelIcon = conv.channel === "voice" ? (
      <Phone className="h-3.5 w-3.5" />
    ) : (
      <MessageSquare className="h-3.5 w-3.5" />
    );
    const isVoiceLive = conv.channel === "voice" && conv.status === "active";

    return (
      <button
        onClick={() => setSelected(conv)}
        className={`w-full text-left px-4 py-3.5 border-b border-line-2 transition-colors ${
          isSelected
            ? isEscalated
              ? "bg-blocked-bg border-l-2 border-l-blocked-dot"
              : "bg-ai-tint border-l-2 border-l-ai"
            : "hover:bg-bone"
        }`}
      >
        {/* Avatar + channel + name row */}
        <div className="flex items-center gap-2.5 mb-1.5">
          <div className="h-7 w-7 rounded-full bg-panel-warm border border-line flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-semibold text-ink-2">
              {conv.phone.slice(-2)}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-ink truncate">{conv.phone}</span>
              {isVoiceLive && (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-confirmed-dot opacity-75 [animation:abpulse_2.4s_ease-in-out_infinite]" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-confirmed-dot" />
                </span>
              )}
            </div>
          </div>
          <span className="text-ink-muted flex-shrink-0">{channelIcon}</span>
        </div>

        {/* Preview */}
        <p className={`text-xs truncate mb-1.5 ${role === "customer" ? "text-ink font-medium" : "text-ink-muted"}`}>
          {role === "agent" ? <span className="text-ai-ink">Jordan: </span> : role === "csr" ? "You: " : ""}
          {lastMessagePreview(conv)}
        </p>

        {/* Footer row */}
        <div className="flex items-center gap-2">
          {isEscalated && (
            <AIBadge state="flagged" label="Needs human" className="text-[10px]" />
          )}
          {conv.status === "resolved" && (
            <AIBadge state="approved" label="Done" className="text-[10px]" />
          )}
          <span className="ml-auto text-[11px] text-ink-muted tabular-nums">
            {formatDistanceToNow(new Date(conv.last_message_at), { addSuffix: true })}
          </span>
        </div>
      </button>
    );
  }

  return (
    <div className="flex h-full bg-bone">
      {/* Pane 1 — Conversation list */}
      <div className="w-[320px] flex-shrink-0 border-r border-line flex flex-col bg-paper">
        {/* Header */}
        <div className="px-5 py-4 border-b border-line">
          <div className="flex items-center justify-between">
            <h1 className="text-[15px] font-semibold text-ink">Booking Inbox</h1>
            <span className="tabular-nums text-xs font-semibold text-ink-muted bg-panel-warm border border-line rounded-pill px-2 py-0.5">
              {counts.all}
            </span>
          </div>
          {counts.escalated > 0 && (
            <div className="mt-2.5 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blocked-bg border border-blocked-border text-blocked-text text-xs font-medium">
              <span className="text-[11px]">⚠</span>
              {counts.escalated} conversation{counts.escalated > 1 ? "s" : ""} need{counts.escalated === 1 ? "s" : ""} a human
            </div>
          )}
        </div>

        {/* Status tabs */}
        <div className="flex border-b border-line px-1 pt-1 bg-paper">
          {STATUS_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`flex-1 flex items-center justify-center gap-1 text-xs py-2 px-1 font-medium border-b-2 transition-colors ${
                filter === key
                  ? "border-ink text-ink"
                  : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              {label}
              {counts[key] > 0 && (
                <span className={`rounded-pill px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                  filter === key ? "bg-ink text-bone" : "bg-panel-warm text-ink-muted"
                }`}>
                  {counts[key]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-[72px] w-full rounded-lg" />)}
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <CheckCircle className="h-10 w-10 text-ink-muted/20 mb-2" />
              <p className="text-sm text-ink-muted">
                No {filter !== "all" ? filter : ""} conversations
              </p>
            </div>
          ) : (
            <>
              {/* "Needs a human" group */}
              {filter === "all" && escalatedConvs.length > 0 && (
                <>
                  <p className="px-4 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-blocked-text">
                    Needs a human
                  </p>
                  {escalatedConvs.map((conv) => <ConvRow key={conv.id} conv={conv} />)}
                </>
              )}
              {/* "AI handling" group */}
              {filter === "all" && aiHandlingConvs.length > 0 && (
                <>
                  <p className="px-4 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
                    AI handling · monitor only
                  </p>
                  {aiHandlingConvs.map((conv) => <ConvRow key={conv.id} conv={conv} />)}
                </>
              )}
              {/* Done */}
              {filter === "all" && doneConvs.length > 0 && (
                <>
                  <p className="px-4 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
                    Done
                  </p>
                  {doneConvs.map((conv) => <ConvRow key={conv.id} conv={conv} />)}
                </>
              )}
              {/* Filtered view */}
              {filter !== "all" && filteredConversations.map((conv) => (
                <ConvRow key={conv.id} conv={conv} />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Pane 2 — Thread */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {selected ? (
          <ConversationPanel conversation={selected} onStatusChange={() => void load()} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center p-12">
            <MessageSquare className="h-14 w-14 text-ink-muted/15 mb-4" />
            <p className="text-sm text-ink-muted font-medium">Select a conversation</p>
            <p className="text-xs text-ink-muted/60 mt-1">
              {counts.all > 0 ? `${counts.all} conversation${counts.all > 1 ? "s" : ""} in inbox` : "Inbox is empty"}
            </p>
          </div>
        )}
      </div>

      {/* Pane 3 — Context (only when a conversation is selected) */}
      {selected && <ContextPane conv={selected} onConfirmJob={handleConfirmJob} />}
    </div>
  );
}
