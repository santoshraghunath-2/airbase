import { useEffect, useState, useCallback } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { MessageSquare, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  { key: "resolved",  label: "Resolved" },
];

function statusBadge(status: string) {
  switch (status) {
    case "active":    return <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 text-xs">Active</Badge>;
    case "escalated": return <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50 text-xs">Escalated</Badge>;
    case "resolved":  return <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50 text-xs">Resolved</Badge>;
    default:          return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

function lastMessagePreview(conv: BookingConversation): string {
  const msgs = conv.messages;
  if (!msgs.length) return "No messages";
  const last = msgs[msgs.length - 1];
  return last.content.length > 80 ? last.content.slice(0, 77) + "…" : last.content;
}

function lastMessageRole(conv: BookingConversation): string {
  const msgs = conv.messages;
  if (!msgs.length) return "";
  return msgs[msgs.length - 1].role;
}

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

  // Realtime subscription
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

  // Keep selected conversation in sync with live data
  useEffect(() => {
    if (selected) {
      const updated = conversations.find((c) => c.id === selected.id);
      if (updated) setSelected(updated);
    }
  }, [conversations]);

  const counts = {
    all:       conversations.length,
    active:    conversations.filter((c) => c.status === "active").length,
    escalated: conversations.filter((c) => c.status === "escalated").length,
    resolved:  conversations.filter((c) => c.status === "resolved").length,
  };

  const escalatedCount = filter === "all" ? counts.escalated : 0;

  return (
    <div className="flex h-full">
      {/* Left: conversation list */}
      <div className="w-80 flex-shrink-0 border-r flex flex-col">
        {/* Header */}
        <div className="px-4 py-4 border-b">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Booking Inbox
          </h1>
          {escalatedCount > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {escalatedCount} conversation{escalatedCount > 1 ? "s" : ""} need{escalatedCount === 1 ? "s" : ""} attention
            </div>
          )}
        </div>

        {/* Status tabs */}
        <div className="flex border-b px-1 pt-1">
          {STATUS_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`flex-1 text-xs py-2 px-1 font-medium border-b-2 transition-colors ${
                filter === key
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
              {counts[key] > 0 && (
                <span className={`ml-1 rounded-full px-1.5 py-0.5 text-xs ${
                  filter === key ? "bg-blue-100 text-blue-700" : "bg-muted"
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
            <div className="p-3 space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6">
              <CheckCircle className="h-10 w-10 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No {filter !== "all" ? filter : ""} conversations</p>
            </div>
          ) : (
            conversations.map((conv) => {
              const isSelected = selected?.id === conv.id;
              const role = lastMessageRole(conv);
              return (
                <button
                  key={conv.id}
                  onClick={() => setSelected(conv)}
                  className={`w-full text-left px-4 py-3 border-b hover:bg-muted/40 transition-colors ${
                    isSelected ? "bg-blue-50 border-l-2 border-l-blue-500" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-sm font-medium truncate">{conv.phone}</span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {statusBadge(conv.status)}
                    </div>
                  </div>
                  <p className={`text-xs truncate ${role === "customer" ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                    {role === "agent" ? "Agent: " : role === "csr" ? "You: " : ""}
                    {lastMessagePreview(conv)}
                  </p>
                  <div className="flex items-center gap-1 mt-1">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(conv.last_message_at), { addSuffix: true })}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right: conversation detail */}
      <div className="flex-1 overflow-hidden">
        {selected ? (
          <ConversationPanel
            conversation={selected}
            onStatusChange={() => void load()}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center p-12">
            <MessageSquare className="h-16 w-16 text-muted-foreground/20 mb-4" />
            <p className="text-sm text-muted-foreground">Select a conversation to view</p>
          </div>
        )}
      </div>
    </div>
  );
}
