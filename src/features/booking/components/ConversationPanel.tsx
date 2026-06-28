import { useState, useRef, useEffect } from "react";
import { format } from "date-fns";
import { Phone, Briefcase, CheckCircle, Send, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { BookingConversation } from "../BookingInboxPage";

interface ConversationPanelProps {
  conversation: BookingConversation;
  onStatusChange: () => void;
}

function rolePill(role: string) {
  switch (role) {
    case "customer": return "bg-slate-100 text-slate-700";
    case "agent":    return "bg-blue-50 text-blue-800 border border-blue-100";
    case "csr":      return "bg-green-50 text-green-800 border border-green-100";
    default:         return "bg-muted text-muted-foreground";
  }
}

function roleLabel(role: string) {
  if (role === "agent") return "AI Agent";
  if (role === "csr")   return "You";
  return "Customer";
}

export default function ConversationPanel({ conversation, onStatusChange }: ConversationPanelProps) {
  const { user } = useAuth();
  const [reply, setReply]     = useState("");
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.messages]);

  const handleSendReply = async () => {
    if (!reply.trim() || sending) return;
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke("csr-reply", {
        body: { conversation_id: conversation.id, message: reply.trim() },
      });
      if (error) throw error;
      setReply("");
      toast.success("Message sent");
      onStatusChange();
    } catch (e) {
      toast.error("Failed to send", { description: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  const handleResolve = async () => {
    setResolving(true);
    try {
      const { error } = await supabase
        .from("booking_conversations")
        .update({ status: "resolved" })
        .eq("id", conversation.id);
      if (error) throw error;
      toast.success("Conversation resolved");
      onStatusChange();
    } catch (e) {
      toast.error("Failed to resolve", { description: (e as Error).message });
    } finally {
      setResolving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleSendReply();
  };

  const isEscalated = conversation.status === "escalated";
  const isResolved  = conversation.status === "resolved";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold">{conversation.phone}</span>
            {isEscalated && (
              <span className="text-xs bg-red-100 text-red-700 border border-red-200 rounded-full px-2 py-0.5">
                Escalated — needs CSR
              </span>
            )}
          </div>
          {conversation.context?.escalation_summary && (
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              <span className="font-medium">Escalation reason:</span>{" "}
              {conversation.context.escalation_summary as string}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {conversation.job_id && (
            <Button variant="outline" size="sm" asChild>
              <a href={`jobs/${conversation.job_id}`} className="flex items-center gap-1">
                <Briefcase className="h-3.5 w-3.5" />
                View job
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          )}
          {!isResolved && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResolve}
              disabled={resolving}
              className="text-green-700 border-green-300 hover:bg-green-50"
            >
              <CheckCircle className="h-3.5 w-3.5 mr-1" />
              {resolving ? "Resolving…" : "Mark resolved"}
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {conversation.messages.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No messages yet.</p>
        ) : (
          conversation.messages.map((msg, i) => {
            const isCustomer = msg.role === "customer";
            return (
              <div
                key={i}
                className={`flex ${isCustomer ? "justify-start" : "justify-end"}`}
              >
                <div className={`max-w-[75%] space-y-1 ${isCustomer ? "" : "items-end flex flex-col"}`}>
                  <div className={`flex items-center gap-1.5 ${isCustomer ? "" : "flex-row-reverse"}`}>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${rolePill(msg.role)}`}>
                      {roleLabel(msg.role)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {msg.timestamp ? format(new Date(msg.timestamp), "h:mm a") : ""}
                    </span>
                  </div>
                  <div
                    className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      isCustomer
                        ? "bg-slate-100 text-slate-900 rounded-tl-sm"
                        : msg.role === "csr"
                        ? "bg-green-600 text-white rounded-tr-sm"
                        : "bg-blue-600 text-white rounded-tr-sm"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* CSR reply input — shown for escalated or active conversations */}
      {!isResolved && (
        <div className="border-t px-6 py-4">
          <div className="flex gap-2 items-end">
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isEscalated
                  ? "Reply to customer as CSR… (⌘+Enter to send)"
                  : "Send a manual message… (⌘+Enter)"
              }
              className="resize-none text-sm min-h-[80px]"
              rows={3}
            />
            <Button
              onClick={() => void handleSendReply()}
              disabled={!reply.trim() || sending}
              className="h-10 w-10 p-0 flex-shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            SMS will be sent from your company Twilio number to {conversation.phone}.
          </p>
        </div>
      )}
    </div>
  );
}
