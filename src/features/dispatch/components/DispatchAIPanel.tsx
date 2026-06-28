import { useEffect, useState, useCallback } from "react";
import { Sparkles, CheckCircle, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { JobWithRelations } from "@/types/database.types";

interface AgentProposal {
  id: string;
  proposed_action: {
    type: string;
    job_id: string;
    tech_id: string;
    tech_name: string;
    operator_rationale: string;
  };
  reasoning: string;
  confidence: number;
  created_at: string;
}

interface DispatchAIPanelProps {
  jobs: JobWithRelations[];
  onAssigned: () => void;
}

function ConfidencePip({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 90 ? "bg-green-500" :
    pct >= 75 ? "bg-yellow-500" :
    "bg-orange-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{pct}%</span>
    </div>
  );
}

function ProposalCard({
  proposal,
  job,
  onAccept,
  onSkip,
}: {
  proposal: AgentProposal;
  job: JobWithRelations | undefined;
  onAccept: (proposal: AgentProposal) => Promise<void>;
  onSkip: (proposal: AgentProposal) => Promise<void>;
}) {
  const [expanded, setExpanded]   = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [skipping, setSkipping]   = useState(false);

  const handleAccept = async () => {
    setAccepting(true);
    try { await onAccept(proposal); }
    finally { setAccepting(false); }
  };

  const handleSkip = async () => {
    setSkipping(true);
    try { await onSkip(proposal); }
    finally { setSkipping(false); }
  };

  const customerName = job?.customers?.name ?? "Unknown customer";
  const jobType      = job?.job_type?.replace(/_/g, " ") ?? proposal.proposed_action.job_id.slice(0, 8);
  const priority     = job?.priority;

  return (
    <div className="min-w-[300px] max-w-[320px] rounded-lg border bg-card p-4 space-y-3 flex-shrink-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{customerName}</p>
          <p className="text-xs text-muted-foreground capitalize">{jobType}</p>
        </div>
        {priority && priority !== "normal" && (
          <Badge
            variant="outline"
            className={
              priority === "emergency" ? "border-red-300 text-red-700 bg-red-50 text-xs" :
              priority === "high"      ? "border-amber-300 text-amber-700 bg-amber-50 text-xs" :
              "text-xs"
            }
          >
            {priority}
          </Badge>
        )}
      </div>

      {/* Proposed tech */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">Suggested tech</p>
        <p className="text-sm font-semibold">{proposal.proposed_action.tech_name}</p>
        <ConfidencePip confidence={proposal.confidence} />
      </div>

      {/* Operator rationale */}
      <p className="text-xs text-muted-foreground leading-relaxed">
        {proposal.proposed_action.operator_rationale}
      </p>

      {/* Expandable full reasoning */}
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {expanded ? "Hide reasoning" : "View reasoning"}
      </button>
      {expanded && (
        <p className="text-xs text-muted-foreground leading-relaxed bg-muted/50 rounded p-2">
          {proposal.reasoning}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          className="flex-1"
          onClick={handleAccept}
          disabled={accepting || skipping}
        >
          <CheckCircle className="h-3.5 w-3.5 mr-1" />
          {accepting ? "Assigning…" : "Assign"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={handleSkip}
          disabled={accepting || skipping}
        >
          <XCircle className="h-3.5 w-3.5 mr-1" />
          {skipping ? "Skipping…" : "Skip"}
        </Button>
      </div>
    </div>
  );
}

export default function DispatchAIPanel({ jobs, onAssigned }: DispatchAIPanelProps) {
  const { tenant, user } = useAuth();
  const [proposals, setProposals] = useState<AgentProposal[]>([]);
  const [loading, setLoading]     = useState(true);

  const boardJobIds = new Set(jobs.map((j) => j.id));

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const { data } = await supabase
      .from("agent_actions")
      .select("id, proposed_action, reasoning, confidence, created_at")
      .eq("tenant_id", tenant.id)
      .eq("agent_type", "dispatch")
      .eq("status", "proposed")
      .order("created_at", { ascending: false });

    // Only show proposals for jobs currently on the board
    const visible = (data ?? []).filter(
      (p: AgentProposal) => boardJobIds.has(p.proposed_action?.job_id),
    ) as AgentProposal[];

    setProposals(visible);
    setLoading(false);
  }, [tenant, jobs]);

  useEffect(() => { void load(); }, [load]);

  // Realtime: refresh when agent_actions change
  useEffect(() => {
    if (!tenant) return;
    const channel = supabase
      .channel("dispatch-ai-proposals")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_actions",
          filter: `tenant_id=eq.${tenant.id}` },
        () => { void load(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant, load]);

  const handleAccept = async (proposal: AgentProposal) => {
    const { job_id, tech_id } = proposal.proposed_action;
    try {
      const { error: dispatchErr } = await supabase
        .from("jobs")
        .update({ tech_id, status: "dispatched" })
        .eq("id", job_id);
      if (dispatchErr) throw dispatchErr;

      // Mark agent_action approved
      await supabase
        .from("agent_actions")
        .update({
          status:               "operator_approved",
          operator_approved_by: user?.id ?? null,
          executed_at:          new Date().toISOString(),
        })
        .eq("id", proposal.id);

      toast.success(`Assigned to ${proposal.proposed_action.tech_name}`);
      setProposals((prev) => prev.filter((p) => p.id !== proposal.id));
      onAssigned();
    } catch (e) {
      toast.error("Assignment failed", { description: (e as Error).message });
    }
  };

  const handleSkip = async (proposal: AgentProposal) => {
    await supabase
      .from("agent_actions")
      .update({ status: "operator_rejected" })
      .eq("id", proposal.id);

    setProposals((prev) => prev.filter((p) => p.id !== proposal.id));
    toast("Proposal dismissed");
  };

  if (loading) {
    return (
      <div className="px-6 py-3 border-b flex gap-3 overflow-x-auto">
        <Skeleton className="h-[180px] w-[300px] flex-shrink-0" />
        <Skeleton className="h-[180px] w-[300px] flex-shrink-0" />
      </div>
    );
  }

  if (proposals.length === 0) return null;

  return (
    <div className="border-b bg-blue-50/50">
      <div className="px-6 py-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-blue-600" />
        <span className="text-sm font-medium text-blue-900">
          AI dispatch suggestions
        </span>
        <span className="text-xs text-blue-600 bg-blue-100 rounded-full px-2 py-0.5">
          {proposals.length}
        </span>
      </div>
      <div className="flex gap-3 px-6 pb-4 overflow-x-auto">
        {proposals.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            job={jobs.find((j) => j.id === proposal.proposed_action.job_id)}
            onAccept={handleAccept}
            onSkip={handleSkip}
          />
        ))}
      </div>
    </div>
  );
}
