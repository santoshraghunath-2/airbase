import { useState } from "react";
import { Bot, Check, X, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import type { AgentProposal } from "@/types/database.types";

interface Props {
  jobId: string;
  proposal: AgentProposal;
  techName: string;
  alternativeTechName?: string;
  onAccepted: () => void;
  onRejected: () => void;
}

export default function AiProposalPanel({
  jobId,
  proposal,
  techName,
  alternativeTechName,
  onAccepted,
  onRejected,
}: Props) {
  const [loading, setLoading] = useState<"accept" | "reject" | null>(null);
  const [showAlternatives, setShowAlternatives] = useState(false);

  const confidencePct = Math.round(proposal.confidence * 100);

  const confidenceColor =
    confidencePct >= 85
      ? "bg-green-500"
      : confidencePct >= 65
      ? "bg-yellow-500"
      : "bg-red-500";

  async function handleAccept() {
    setLoading("accept");
    try {
      const { error } = await supabase.functions.invoke("dispatch-job", {
        body: { job_id: jobId, tech_id: proposal.tech_id },
      });
      if (error) throw error;

      // Log acceptance to agent_actions
      await supabase
        .from("agent_actions")
        .update({ status: "operator_approved" })
        .eq("id", proposal.action_id);

      toast.success(`Dispatched to ${techName}`);
      onAccepted();
    } catch {
      toast.error("Failed to dispatch");
    } finally {
      setLoading(null);
    }
  }

  async function handleReject() {
    setLoading("reject");
    try {
      await supabase
        .from("agent_actions")
        .update({ status: "operator_rejected" })
        .eq("id", proposal.action_id);

      toast.info("Proposal rejected — assign manually");
      onRejected();
    } catch {
      toast.error("Failed to reject");
    } finally {
      setLoading(null);
    }
  }

  async function handleAcceptAlternative() {
    if (!proposal.alternative_tech_id) return;
    setLoading("accept");
    try {
      const { error } = await supabase.functions.invoke("dispatch-job", {
        body: { job_id: jobId, tech_id: proposal.alternative_tech_id },
      });
      if (error) throw error;

      await supabase
        .from("agent_actions")
        .update({ status: "operator_approved" })
        .eq("id", proposal.action_id);

      toast.success(`Dispatched to ${alternativeTechName}`);
      onAccepted();
    } catch {
      toast.error("Failed to dispatch");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
      <div className="flex items-center gap-2 text-blue-700 text-sm font-medium">
        <Bot className="h-4 w-4" />
        AI Recommendation
      </div>

      {/* Tech name + confidence bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-sm">{techName}</span>
          <Badge variant="secondary" className="text-xs">
            {confidencePct}% match
          </Badge>
        </div>
        <div className="h-2 rounded-full bg-blue-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${confidenceColor}`}
            style={{ width: `${confidencePct}%` }}
          />
        </div>
      </div>

      {/* Rationale */}
      <p className="text-sm text-gray-700 italic">"{proposal.rationale}"</p>

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
          onClick={handleAccept}
          disabled={loading !== null}
        >
          {loading === "accept" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5 mr-1" />
          )}
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={handleReject}
          disabled={loading !== null}
        >
          {loading === "reject" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5 mr-1" />
          )}
          Reassign
        </Button>
      </div>

      {/* Alternatives toggle */}
      {proposal.alternative_tech_id && alternativeTechName && (
        <div>
          <button
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
            onClick={() => setShowAlternatives((s) => !s)}
          >
            {showAlternatives ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            See alternatives
          </button>

          {showAlternatives && (
            <div className="mt-2 rounded-md border border-blue-100 bg-white p-3 space-y-2">
              <p className="text-xs text-gray-500 font-medium">Alternative</p>
              <div className="flex items-center justify-between">
                <span className="text-sm">{alternativeTechName}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={handleAcceptAlternative}
                  disabled={loading !== null}
                >
                  Assign
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
