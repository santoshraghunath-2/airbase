import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Hammer, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

interface ProjectRow {
  id: string;
  name: string;
  status: string;
  target_start: string | null;
  target_completion: string | null;
  commitment_days: number | null;
  created_at: string;
  customers: { name: string | null }[] | null;
}

function statusStyle(s: string) {
  if (s === "in_progress")  return "bg-ai-chip-bg text-ai-ink border-ai-tint-border";
  if (s === "scheduled")    return "bg-ai-chip-bg text-ai-ink border-ai-tint-border";
  if (s === "punch_list")   return "bg-warned-bg text-warned-text border-warned-border";
  if (s === "complete")     return "bg-confirmed-bg text-confirmed-text border-confirmed-border";
  if (s === "on_hold")      return "bg-warned-bg text-warned-text border-warned-border";
  if (s === "cancelled")    return "bg-muted text-muted-foreground border-border";
  return "bg-muted text-muted-foreground border-border"; // pending_start
}

function statusLabel(s: string) {
  const labels: Record<string, string> = {
    pending_start: "Pending start",
    scheduled:     "Scheduled",
    in_progress:   "In progress",
    punch_list:    "Punch list",
    complete:      "Complete",
    on_hold:       "On hold",
    cancelled:     "Cancelled",
  };
  return labels[s] ?? s;
}

export default function ProjectsPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { tenant } = useAuth();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!tenant) return;
    void (async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name, status, target_start, target_completion, commitment_days, created_at, customers(name)")
        .eq("tenant_id", tenant.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100);
      setProjects((data ?? []) as ProjectRow[]);
      setLoading(false);
    })();
  }, [tenant]);

  if (loading) {
    return (
      <div className="min-h-full bg-bone p-8">
        <Skeleton className="h-8 w-32 mb-6" />
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl mb-3" />)}
      </div>
    );
  }

  return (
    <div className="min-h-full bg-bone">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-xl font-semibold text-ink mb-6">Projects</h1>

        {projects.length === 0 ? (
          <div className="rounded-xl border border-line bg-paper px-6 py-12 text-center">
            <Hammer className="h-8 w-8 text-ink-muted mx-auto mb-3" />
            <p className="text-sm text-ink-muted">No projects yet.</p>
            <p className="text-xs text-ink-muted mt-1">
              A project is created automatically when a contract becomes effective.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate(`/${tenantSlug}/projects/${p.id}`)}
                className="w-full flex items-center gap-4 px-5 py-4 rounded-xl border border-line bg-paper hover:bg-raised transition-colors text-left group"
              >
                <Hammer className="h-4 w-4 text-ink-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-ink truncate">{p.name}</span>
                    <span className={cn(
                      "inline-flex items-center text-[10px] font-semibold uppercase tracking-wide rounded-pill px-2 py-0.5 border shrink-0",
                      statusStyle(p.status),
                    )}>
                      {statusLabel(p.status)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-ink-muted">
                    <span>{p.customers?.[0]?.name ?? "—"}</span>
                    {p.target_start && (
                      <>
                        <span>·</span>
                        <span>Starts {new Date(p.target_start).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      </>
                    )}
                    {p.commitment_days && (
                      <>
                        <span>·</span>
                        <span>{p.commitment_days}-day commitment</span>
                      </>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-ink-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
