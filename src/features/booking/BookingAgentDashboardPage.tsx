import { useEffect, useState } from "react";
import { MessageSquare, CheckCircle, AlertCircle, Clock, UserX } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { supabase, realtimeClient } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
// booking_conversations is the production table (migration 015)
type ConvWithCustomer = {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  phone: string;
  channel: string;
  status: "active" | "resolved" | "escalated" | "abandoned";
  job_id: string | null;
  messages: unknown;
  context: unknown;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  customers: { name: string; phone: string } | null;
  jobs: { job_type: string; scheduled_start: string | null } | null;
};

const STATUS_CONFIG = {
  active: { label: "Active", icon: MessageSquare, color: "bg-blue-100 text-blue-700" },
  resolved: { label: "Booked", icon: CheckCircle, color: "bg-green-100 text-green-700" },
  escalated: { label: "Escalated", icon: AlertCircle, color: "bg-red-100 text-red-700" },
  abandoned: { label: "Abandoned", icon: UserX, color: "bg-gray-100 text-gray-600" },
} as const;

export default function BookingAgentDashboardPage() {
  const { tenant } = useAuth();
  const [conversations, setConversations] = useState<ConvWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ booked: 0, escalated: 0, abandoned: 0, active: 0 });

  useEffect(() => {
    if (!tenant) return;
    void loadConversations();

    const channel = realtimeClient
      .channel("booking-dashboard")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "booking_conversations",
        filter: `tenant_id=eq.${tenant.id}`,
      }, () => { void loadConversations(); })
      .subscribe();

    return () => { void realtimeClient.removeChannel(channel); };
  }, [tenant]);

  async function loadConversations() {
    if (!tenant) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from("booking_conversations")
        .select(`
          *,
          customers(name, phone),
          jobs(job_type, scheduled_start)
        `)
        .eq("tenant_id", tenant.id)
        .order("last_message_at", { ascending: false })
        .limit(100);

      const convs = (data ?? []) as ConvWithCustomer[];
      setConversations(convs);

      setStats({
        booked: convs.filter((c) => c.status === "resolved").length,
        escalated: convs.filter((c) => c.status === "escalated").length,
        abandoned: convs.filter((c) => c.status === "abandoned").length,
        active: convs.filter((c) => c.status === "active").length,
      });
    } finally {
      setLoading(false);
    }
  }

  const activeConvs = conversations.filter((c) => c.status === "active");
  const recentConvs = conversations.filter((c) => c.status !== "active" && c.status !== "abandoned").slice(0, 20);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-xl font-bold">Booking Agent</h1>
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold">Booking Agent — SMS</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(
          [
            { label: "Active", value: stats.active, icon: MessageSquare, color: "text-blue-600" },
            { label: "Booked", value: stats.booked, icon: CheckCircle, color: "text-green-600" },
            { label: "Escalated", value: stats.escalated, icon: AlertCircle, color: "text-red-600" },
            { label: "Abandoned", value: stats.abandoned, icon: UserX, color: "text-gray-500" },
          ] as const
        ).map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center gap-3">
              <Icon className={`h-6 w-6 ${color}`} />
              <div>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-sm text-muted-foreground">{label}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Active conversations */}
      {activeConvs.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Active ({activeConvs.length})
          </h2>
          {activeConvs.map((conv) => (
            <ConversationRow key={conv.id} conv={conv} />
          ))}
        </div>
      )}

      {/* Recent conversations */}
      {recentConvs.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Recent
          </h2>
          {recentConvs.map((conv) => (
            <ConversationRow key={conv.id} conv={conv} />
          ))}
        </div>
      )}

      {conversations.length === 0 && (
        <Card className="p-12 text-center text-muted-foreground">
          <MessageSquare className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No conversations yet</p>
          <p className="text-sm mt-1">Inbound SMS messages will appear here when customers text in.</p>
        </Card>
      )}
    </div>
  );
}

function ConversationRow({ conv }: { conv: ConvWithCustomer }) {
  const config = STATUS_CONFIG[conv.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.active;
  const Icon = config.icon;

  const msgCount = Array.isArray(conv.messages) ? (conv.messages as unknown[]).length : 0;
  const lastActivity = formatDistanceToNow(new Date(conv.last_message_at ?? conv.updated_at), { addSuffix: true });

  return (
    <Card className="p-4">
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">
              {conv.customers?.name ?? conv.phone ?? "Unknown"}
            </span>
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${config.color}`}>
              <Icon className="h-3 w-3" />
              {config.label}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-xs text-muted-foreground">{conv.phone}</span>
            {conv.jobs && (
              <span className="text-xs text-muted-foreground">
                → {conv.jobs.job_type.replace(/_/g, " ")}
                {conv.jobs.scheduled_start && ` · ${format(new Date(conv.jobs.scheduled_start), "MMM d h:mma")}`}
              </span>
            )}
{conv.status === "escalated" && (
              <span className="text-xs text-red-600 truncate max-w-[200px]">
                Escalated
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {lastActivity}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{msgCount} messages</p>
        </div>
      </div>
    </Card>
  );
}
