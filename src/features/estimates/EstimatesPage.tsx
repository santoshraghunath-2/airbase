import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Calculator, CheckCircle2, Clock, XCircle, Send, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { EstimateRow, CustomerRow } from "@/types/database.types";

type EstimateWithCustomer = EstimateRow & {
  customers: Pick<CustomerRow, "id" | "name" | "phone"> | null;
};

function centsToDisplay(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

function statusConfig(status: EstimateRow["status"]) {
  switch (status) {
    case "draft":     return { label: "Draft",     cls: "bg-muted text-muted-foreground border-border",                    icon: <Clock className="h-3 w-3" /> };
    case "sent":      return { label: "Sent",       cls: "bg-ai-chip-bg text-ai-ink border-ai-tint-border",                 icon: <Send className="h-3 w-3" /> };
    case "accepted":  return { label: "Accepted",   cls: "bg-confirmed-bg text-confirmed-text border-confirmed-border",     icon: <CheckCircle2 className="h-3 w-3" /> };
    case "declined":  return { label: "Declined",   cls: "bg-blocked-bg text-blocked-text border-blocked-border",           icon: <XCircle className="h-3 w-3" /> };
    case "expired":   return { label: "Expired",    cls: "bg-muted text-muted-foreground border-border",                    icon: <Clock className="h-3 w-3" /> };
    case "converted": return { label: "Converted",  cls: "bg-confirmed-bg text-confirmed-text border-confirmed-border",     icon: <ArrowRight className="h-3 w-3" /> };
  }
}

export default function EstimatesPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { tenant } = useAuth();
  const navigate = useNavigate();

  const [estimates, setEstimates] = useState<EstimateWithCustomer[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [filter, setFilter]       = useState<EstimateRow["status"] | "all">("all");

  const load = useCallback(async () => {
    if (!tenant) return;
    const { data } = await supabase
      .from("estimates")
      .select("*, customers(id,name,phone)")
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    setEstimates((data ?? []) as EstimateWithCustomer[]);
  }, [tenant]);

  useEffect(() => {
    if (!tenant) return;
    void (async () => { await load(); setLoading(false); })();
  }, [tenant, load]);

  // Compute totals per estimate from line items — sum all options' line items per estimate
  const [totals, setTotals] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!tenant || estimates.length === 0) return;
    void (async () => {
      const ids = estimates.map((e) => e.id);
      const { data } = await supabase
        .from("estimate_line_items")
        .select("estimate_id, total_cents, option")
        .in("estimate_id", ids);
      const map: Record<string, number> = {};
      for (const row of data ?? []) {
        // For good_better_best, show "best" total as the headline number
        const e = estimates.find((x) => x.id === row.estimate_id);
        const opt = e?.presentation_mode === "good_better_best" ? "best" : "base";
        if (row.option === opt || row.option === "base") {
          map[row.estimate_id] = (map[row.estimate_id] ?? 0) + row.total_cents;
        }
      }
      setTotals(map);
    })();
  }, [tenant, estimates]);

  const filtered = estimates.filter((e) => {
    if (filter !== "all" && e.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        e.title.toLowerCase().includes(q) ||
        e.customers?.name?.toLowerCase().includes(q) ||
        e.customers?.phone?.includes(q)
      );
    }
    return true;
  });

  // Stats
  const draftCount     = estimates.filter((e) => e.status === "draft").length;
  const sentCount      = estimates.filter((e) => e.status === "sent").length;
  const acceptedCount  = estimates.filter((e) => e.status === "accepted" || e.status === "converted").length;
  const totalAccepted  = estimates
    .filter((e) => e.status === "accepted" || e.status === "converted")
    .reduce((s, e) => s + (totals[e.id] ?? 0), 0);

  return (
    <div className="min-h-full bg-bone">
      <div className="max-w-[1100px] mx-auto px-8 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-ink-muted mb-2">
              <span>Dashboard</span><span>›</span><span className="text-ink">Estimates</span>
            </div>
            <h1 className="text-[22px] font-semibold text-ink">Estimates</h1>
            <p className="text-sm text-ink-muted mt-0.5">Build good / better / best proposals with AI upsell suggestions.</p>
          </div>
          <button
            onClick={() => navigate(`/${tenantSlug}/estimates/new`)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-ink text-bone text-sm font-medium hover:bg-ink-hover transition-colors"
          >
            <Plus className="h-4 w-4" />
            New estimate
          </button>
        </div>

        {loading ? (
          <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-3 mb-6">
              {[
                { label: "Drafts",    value: draftCount,                              cls: "text-ink-muted" },
                { label: "Sent",      value: sentCount,                               cls: "text-ai" },
                { label: "Accepted",  value: acceptedCount,                           cls: "text-confirmed-text" },
                { label: "Won value", value: centsToDisplay(totalAccepted),           cls: "text-confirmed-text" },
              ].map(({ label, value, cls }) => (
                <div key={label} className="rounded-xl border border-line bg-paper px-4 py-4">
                  <p className={cn("text-xl font-semibold tabular-nums", cls)}>{value}</p>
                  <p className="text-xs text-ink-muted mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3 mb-5">
              <div className="flex gap-1 bg-raised rounded-xl p-1 border border-line">
                {(["all", "draft", "sent", "accepted", "declined", "converted"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-[12px] font-medium capitalize transition-colors",
                      filter === f ? "bg-paper text-ink shadow-sm border border-line" : "text-ink-muted hover:text-ink",
                    )}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
              <Input
                className="max-w-xs"
                placeholder="Search customer or title…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* List */}
            {filtered.length === 0 ? (
              <div className="rounded-xl border border-line bg-paper px-6 py-16 text-center">
                <Calculator className="h-8 w-8 text-ink-muted mx-auto mb-3" />
                <p className="text-sm font-medium text-ink mb-1">No estimates yet</p>
                <p className="text-xs text-ink-muted mb-4">Create your first good / better / best proposal.</p>
                <button
                  onClick={() => navigate(`/${tenantSlug}/estimates/new`)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-ink text-bone text-sm font-medium hover:bg-ink-hover transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  New estimate
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-line overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line-2 bg-raised">
                      {["Customer", "Title", "Options", "Top value", "Status", "Created"].map((h) => (
                        <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-widest text-ink-muted px-4 py-2.5">{h}</th>
                      ))}
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((e) => {
                      const sc = statusConfig(e.status);
                      return (
                        <tr
                          key={e.id}
                          className="border-b border-line-2 last:border-b-0 hover:bg-raised transition-colors cursor-pointer"
                          onClick={() => navigate(`/${tenantSlug}/estimates/${e.id}`)}
                        >
                          <td className="px-4 py-3">
                            <p className="text-sm font-medium text-ink">{e.customers?.name ?? "—"}</p>
                            <p className="text-xs text-ink-muted">{e.customers?.phone ?? ""}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-sm text-ink">{e.title}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-ink-muted capitalize">
                              {e.presentation_mode === "good_better_best" ? "Good / Better / Best" : "Single"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm font-medium text-ink tabular-nums">
                              {totals[e.id] ? centsToDisplay(totals[e.id]) : "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium rounded-pill px-2 py-0.5 border", sc.cls)}>
                              {sc.icon}{sc.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-ink-muted">
                              {new Date(e.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-xs font-medium text-ai hover:text-ai-ink">Open →</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
