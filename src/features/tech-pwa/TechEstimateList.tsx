import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Calculator, CheckCircle2, Clock, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { EstimateRow } from "@/types/database.types";

type EstimateItem = Pick<
  EstimateRow,
  "id" | "title" | "status" | "presentation_mode" | "created_at" | "selected_option"
> & { customer_name: string; total_cents: number };

function statusIcon(s: EstimateRow["status"]) {
  switch (s) {
    case "draft":     return <Clock className="h-4 w-4 text-slate-400" />;
    case "sent":      return <Send className="h-4 w-4 text-blue-500" />;
    case "accepted":
    case "converted": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    default:          return <Clock className="h-4 w-4 text-slate-400" />;
  }
}

function statusLabel(s: EstimateRow["status"]) {
  switch (s) {
    case "draft":     return "Draft";
    case "sent":      return "Sent";
    case "accepted":  return "Accepted";
    case "converted": return "Converted";
    case "declined":  return "Declined";
    case "expired":   return "Expired";
  }
}

function cents(n: number) {
  return `$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

export default function TechEstimateList() {
  const { tenant, user } = useAuth();
  const navigate = useNavigate();
  const [estimates, setEstimates] = useState<EstimateItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant || !user) return;
    void (async () => {
      // resolve tech id
      const { data: tech } = await supabase
        .from("technicians")
        .select("id")
        .eq("user_id", user.id)
        .eq("tenant_id", tenant.id)
        .maybeSingle();

      // fetch estimates this tech created (or all for owner role)
      let q = supabase
        .from("estimates")
        .select("id, title, status, presentation_mode, created_at, selected_option, customers(name)")
        .eq("tenant_id", tenant.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(50);

      if (tech) q = q.eq("tech_id", tech.id);

      const { data: rows } = await q;

      // fetch best-tier totals per estimate
      if (!rows || rows.length === 0) { setEstimates([]); setLoading(false); return; }
      const ids = rows.map((r) => r.id);
      const { data: lineItems } = await supabase
        .from("estimate_line_items")
        .select("estimate_id, total_cents, option")
        .in("estimate_id", ids);

      const totalMap: Record<string, number> = {};
      for (const li of lineItems ?? []) {
        const row = rows.find((r) => r.id === li.estimate_id);
        const targetOpt = row?.presentation_mode === "good_better_best" ? "best" : "base";
        if (li.option === targetOpt) totalMap[li.estimate_id] = (totalMap[li.estimate_id] ?? 0) + li.total_cents;
      }

      setEstimates(
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status as EstimateRow["status"],
          presentation_mode: r.presentation_mode as EstimateRow["presentation_mode"],
          created_at: r.created_at,
          selected_option: r.selected_option as EstimateRow["selected_option"],
          // @ts-expect-error — joined
          customer_name: r.customers?.name ?? "Unknown",
          total_cents: totalMap[r.id] ?? 0,
        })),
      );
      setLoading(false);
    })();
  }, [tenant, user]);

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-slate-900">My Estimates</h2>
        <button
          onClick={() => navigate("/tech/estimates/new")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-medium active:bg-blue-700"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>

      {estimates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
          <Calculator className="h-8 w-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-700 mb-1">No estimates yet</p>
          <p className="text-xs text-slate-400 mb-4">Build good / better / best options on-site</p>
          <button
            onClick={() => navigate("/tech/estimates/new")}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-medium"
          >
            Create estimate
          </button>
        </div>
      ) : (
        estimates.map((e) => (
          <button
            key={e.id}
            onClick={() => navigate(`/tech/estimates/${e.id}`)}
            className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left active:bg-slate-50 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{e.customer_name}</p>
                <p className="text-xs text-slate-500 truncate">{e.title}</p>
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-sm font-bold text-slate-900 tabular-nums">{cents(e.total_cents)}</p>
                <p className="text-xs text-slate-400">
                  {e.presentation_mode === "good_better_best" ? "G/B/B" : "Single"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-2">
              {statusIcon(e.status)}
              <span className={cn(
                "text-xs font-medium",
                e.status === "accepted" || e.status === "converted" ? "text-green-600" :
                e.status === "sent" ? "text-blue-600" : "text-slate-500",
              )}>
                {statusLabel(e.status)}
              </span>
              <span className="text-xs text-slate-300 ml-auto">
                {new Date(e.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            </div>
          </button>
        ))
      )}
    </div>
  );
}
