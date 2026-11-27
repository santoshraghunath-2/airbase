import { useEffect, useState } from "react";
import { RefreshCw, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OutboxRow {
  id:            string;
  event_type:    string;
  entity_type:   string;
  entity_id:     string;
  target_system: string;
  status:        "pending" | "posting" | "posted" | "failed";
  attempts:      number;
  last_error:    string | null;
  posted_at:     string | null;
  created_at:    string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: OutboxRow["status"]) {
  if (status === "posted")  return <span className="text-xs text-confirmed-text flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Posted</span>;
  if (status === "failed")  return <span className="text-xs text-blocked-text flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Failed</span>;
  if (status === "posting") return <span className="text-xs text-ai-ink flex items-center gap-1"><Clock className="h-3 w-3 animate-pulse" /> Posting…</span>;
  return <span className="text-xs text-warned-text flex items-center gap-1"><Clock className="h-3 w-3" /> Pending</span>;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AccountingOutboxPage() {
  const { tenant } = useAuth();
  const { toast } = useToast();
  const [rows, setRows]           = useState<OutboxRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [retrying, setRetrying]   = useState(false);
  const [filter, setFilter]       = useState<"all" | "pending" | "failed" | "posted">("all");

  useEffect(() => {
    if (!tenant) return;
    void load();
  }, [tenant]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("accounting_outbox")
      .select("id, event_type, entity_type, entity_id, target_system, status, attempts, last_error, posted_at, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    setRows((data as OutboxRow[]) ?? []);
    setLoading(false);
  }

  async function retryFailed() {
    setRetrying(true);
    // Reset failed rows back to pending so the drainer picks them up
    const failedIds = rows.filter((r) => r.status === "failed").map((r) => r.id);
    if (!failedIds.length) {
      toast({ title: "No failed rows to retry" });
      setRetrying(false);
      return;
    }
    await supabase
      .from("accounting_outbox")
      .update({ status: "pending", attempts: 0, last_error: null })
      .in("id", failedIds);

    // Trigger the drainer
    await supabase.functions.invoke("accounting-post", { body: { tenant_id: tenant!.id } });

    toast({ title: `Retrying ${failedIds.length} failed row${failedIds.length === 1 ? "" : "s"}` });
    setRetrying(false);
    setTimeout(() => void load(), 2000);
  }

  const filtered = filter === "all"
    ? rows
    : rows.filter((r) => r.status === filter);

  const failedCount  = rows.filter((r) => r.status === "failed").length;
  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink">Accounting Outbox</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Events queued for posting to your accounting system
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {failedCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void retryFailed()}
              disabled={retrying}
              className="text-xs text-blocked-text border-blocked-border hover:bg-blocked-bg"
            >
              {retrying ? <RefreshCw className="h-3 w-3 mr-1.5 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1.5" />}
              Retry {failedCount} failed
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void load()} className="text-xs">
            <RefreshCw className="h-3 w-3 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Pending",  count: pendingCount,  color: "text-warned-text" },
          { label: "Failed",   count: failedCount,   color: "text-blocked-text" },
          { label: "Posted",   count: rows.filter((r) => r.status === "posted").length, color: "text-confirmed-text" },
        ].map(({ label, count, color }) => (
          <div key={label} className="rounded-xl border border-line bg-paper px-4 py-3">
            <p className="text-xs text-ink-muted">{label}</p>
            <p className={cn("text-2xl font-bold tabular-nums mt-0.5", color)}>{count}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-line">
        {(["all", "pending", "failed", "posted"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-4 py-2 text-xs font-medium capitalize transition-colors border-b-2 -mb-px",
              filter === f
                ? "border-ink text-ink"
                : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-ink-muted">
          {filter === "all" ? "No accounting events yet." : `No ${filter} events.`}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-raised text-xs text-ink-muted">
                <th className="text-left px-4 py-3 font-medium">Event</th>
                <th className="text-left px-4 py-3 font-medium">Entity</th>
                <th className="text-left px-4 py-3 font-medium">System</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Attempts</th>
                <th className="text-left px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0 hover:bg-raised/40 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink capitalize">{row.event_type.replace("_", " ")}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-muted">
                    <p className="capitalize">{row.entity_type}</p>
                    <p className="font-mono text-[10px]">{row.entity_id.slice(0, 8)}…</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink capitalize">{row.target_system}</td>
                  <td className="px-4 py-3">
                    {statusBadge(row.status)}
                    {row.last_error && (
                      <p className="text-[10px] text-blocked-text mt-1 max-w-xs truncate" title={row.last_error}>
                        {row.last_error}
                      </p>
                    )}
                    {row.posted_at && (
                      <p className="text-[10px] text-confirmed-text mt-1">{fmtDate(row.posted_at)}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-xs text-ink-muted">{row.attempts}</td>
                  <td className="px-4 py-3 text-xs text-ink-muted">{fmtDate(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
