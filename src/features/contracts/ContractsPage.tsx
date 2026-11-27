import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FileText, ChevronRight, Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContractRow {
  id: string;
  status: string;
  total_cents: number;
  template_version: string;
  created_at: string;
  signed_at: string | null;
  cancel_by_date: string | null;
  esign_provider: string | null;
  customers: { name: string }[] | null;
  estimates: { title: string }[] | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusStyle(s: string) {
  if (s === "effective")  return "bg-confirmed-bg text-confirmed-text border-confirmed-border";
  if (s === "signed")     return "bg-ai-chip-bg text-ai-ink border-ai-tint-border";
  if (s === "sent")       return "bg-ai-chip-bg text-ai-ink border-ai-tint-border";
  if (s === "cancelled")  return "bg-blocked-bg text-blocked-text border-blocked-border";
  if (s === "void")       return "bg-muted text-muted-foreground border-border";
  return "bg-muted text-muted-foreground border-border"; // draft
}

function centsDisplay(c: number) {
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ContractsPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { tenant } = useAuth();
  const navigate = useNavigate();

  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    if (!tenant) return;
    void (async () => {
      const { data } = await supabase
        .from("contracts")
        .select(`
          id, status, total_cents, template_version, created_at, signed_at, cancel_by_date, esign_provider,
          customers(name),
          estimates(title)
        `)
        .eq("tenant_id", tenant.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100);
      setContracts((data ?? []) as ContractRow[]);
      setLoading(false);
    })();
  }, [tenant]);

  if (loading) {
    return (
      <div className="min-h-full bg-bone p-8">
        <Skeleton className="h-8 w-48 mb-6" />
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl mb-3" />)}
      </div>
    );
  }

  return (
    <div className="min-h-full bg-bone">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-ink">Contracts</h1>
          <button
            onClick={() => navigate(`/${tenantSlug}/estimates/new`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-ai-tint-border bg-ai-chip-bg text-ai-ink text-xs font-medium hover:bg-ai-chip-bg/70 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New estimate
          </button>
        </div>

        {/* Template approval warning */}
        {tenant && !(tenant as unknown as { contract_template_approved?: boolean }).contract_template_approved && (
          <div className="mb-4 rounded-xl border border-warned-border bg-warned-bg px-4 py-3 text-xs text-warned-text">
            <strong>Contract template not yet approved.</strong> Contracts can be generated and
            previewed but cannot be sent to customers until the template is attorney-approved and
            marked approved in tenant settings.
          </div>
        )}

        {contracts.length === 0 ? (
          <div className="rounded-xl border border-line bg-paper px-6 py-12 text-center">
            <FileText className="h-8 w-8 text-ink-muted mx-auto mb-3" />
            <p className="text-sm text-ink-muted">No contracts yet.</p>
            <p className="text-xs text-ink-muted mt-1">
              Accept an estimate to generate the first contract.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {contracts.map((c) => (
              <button
                key={c.id}
                onClick={() => navigate(`/${tenantSlug}/contracts/${c.id}`)}
                className="w-full flex items-center gap-4 px-5 py-4 rounded-xl border border-line bg-paper hover:bg-raised transition-colors text-left group"
              >
                <FileText className="h-4 w-4 text-ink-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-ink truncate">
                      {c.customers?.[0]?.name ?? "Unknown customer"}
                    </span>
                    <span className={cn(
                      "inline-flex items-center text-[10px] font-semibold uppercase tracking-wide rounded-pill px-2 py-0.5 border",
                      statusStyle(c.status),
                    )}>
                      {c.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-ink-muted">
                    <span>{c.estimates?.[0]?.title ?? "—"}</span>
                    <span>·</span>
                    <span className="tabular-nums">{centsDisplay(c.total_cents)}</span>
                    <span>·</span>
                    <span>{new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                    {c.status === "draft" && (
                      <>
                        <span>·</span>
                        <span className="text-warned-text">template v{c.template_version}</span>
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
