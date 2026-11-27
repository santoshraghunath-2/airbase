import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileText, Upload, CheckCircle2, Clock, XCircle, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaymentScheduleItem {
  id: string;
  sort_order: number;
  description: string;
  trigger_type: string;
  amount_cents: number;
  status: string;
  due_date: string | null;
  paid_at: string | null;
}

interface ContractDetail {
  id: string;
  status: string;
  total_cents: number;
  template_version: string;
  esign_provider: string | null;
  esign_envelope_id: string | null;
  pdf_path: string | null;
  signed_pdf_path: string | null;
  signed_at: string | null;
  signer_name: string | null;
  cancel_by_date: string | null;
  customer_65_or_older: boolean;
  effective_at: string | null;
  created_at: string;
  customers: { id: string; name: string; phone: string | null } | null;
  estimates: { id: string; title: string; selected_option: string | null } | null;
  payment_schedule_items: PaymentScheduleItem[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusIcon(s: string) {
  if (s === "effective")  return <CheckCircle2 className="h-4 w-4 text-confirmed-text" />;
  if (s === "signed")     return <CheckCircle2 className="h-4 w-4 text-ai-ink" />;
  if (s === "cancelled")  return <XCircle className="h-4 w-4 text-blocked-text" />;
  if (s === "void")       return <XCircle className="h-4 w-4 text-ink-muted" />;
  return <Clock className="h-4 w-4 text-ink-muted" />;
}

function statusLabel(s: string) {
  const labels: Record<string, string> = {
    draft: "Draft",
    sent: "Sent to customer",
    signed: "Signed — awaiting deposit",
    effective: "Effective",
    cancelled: "Cancelled",
    void: "Void",
  };
  return labels[s] ?? s;
}

function centsDisplay(c: number) {
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

function triggerLabel(t: string) {
  const labels: Record<string, string> = {
    contract_signed: "Upon signing",
    materials_delivered: "Materials delivered",
    phase_closed: "Phase complete",
    completion: "Upon completion",
  };
  return labels[t] ?? t;
}

function scheduleItemStatus(item: PaymentScheduleItem) {
  if (item.status === "paid") return { label: "Paid", cls: "text-confirmed-text" };
  if (item.status === "invoiced") return { label: "Invoiced", cls: "text-ai-ink" };
  return { label: "Pending", cls: "text-ink-muted" };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ContractDetailPage() {
  const { tenantSlug, contractId } = useParams<{ tenantSlug: string; contractId: string }>();
  const { tenant } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [contract,    setContract]    = useState<ContractDetail | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [uploading,   setUploading]   = useState(false);
  const [signerName,  setSignerName]  = useState("");
  const [signedAt,    setSignedAt]    = useState(() => new Date().toISOString().slice(0, 16));

  useEffect(() => {
    if (!tenant || !contractId) return;
    void (async () => {
      const { data } = await supabase
        .from("contracts")
        .select(`
          id, status, total_cents, template_version, esign_provider, esign_envelope_id,
          pdf_path, signed_pdf_path, signed_at, signer_name, cancel_by_date,
          customer_65_or_older, effective_at, created_at,
          customers(id, name, phone),
          estimates(id, title, selected_option),
          payment_schedule_items(id, sort_order, description, trigger_type, amount_cents, status, due_date, paid_at)
        `)
        .eq("id", contractId)
        .eq("tenant_id", tenant.id)
        .single();
      setContract(data as ContractDetail | null);
      setLoading(false);
    })();
  }, [tenant, contractId]);

  async function handleManualUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file || !signerName.trim() || !contract) return;

    if (!file.name.endsWith(".pdf")) {
      toast.error("Only PDF files are accepted.");
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("contract_id", contract.id);
      form.append("signer_name", signerName.trim());
      form.append("signed_at", new Date(signedAt).toISOString());
      form.append("signed_pdf", file);

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/esign-webhook?provider=manual`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
          body: form,
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }

      toast.success("Signed PDF uploaded. Contract marked signed.");
      // Refresh
      const { data: updated } = await supabase
        .from("contracts")
        .select(`
          id, status, total_cents, template_version, esign_provider, esign_envelope_id,
          pdf_path, signed_pdf_path, signed_at, signer_name, cancel_by_date,
          customer_65_or_older, effective_at, created_at,
          customers(id, name, phone),
          estimates(id, title, selected_option),
          payment_schedule_items(id, sort_order, description, trigger_type, amount_cents, status, due_date, paid_at)
        `)
        .eq("id", contractId!)
        .eq("tenant_id", tenant!.id)
        .single();
      setContract(updated as ContractDetail | null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function openPdf(path: string | null | undefined) {
    if (!path) return;
    const { data } = await supabase.storage.from("contracts").createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    else toast.error("Could not generate PDF link.");
  }

  if (loading) {
    return (
      <div className="min-h-full bg-bone p-8">
        <Skeleton className="h-6 w-32 mb-6" />
        <Skeleton className="h-48 rounded-xl mb-4" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="min-h-full bg-bone flex items-center justify-center">
        <p className="text-sm text-ink-muted">Contract not found.</p>
      </div>
    );
  }

  const canUploadSigned = ["draft", "sent"].includes(contract.status);
  const sortedSchedule = [...(contract.payment_schedule_items ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  return (
    <div className="min-h-full bg-bone">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Back */}
        <button
          onClick={() => navigate(`/${tenantSlug}/contracts`)}
          className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink mb-6 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Contracts
        </button>

        {/* Header card */}
        <div className="rounded-xl border border-line bg-paper px-6 py-5 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-ink mb-0.5">
                {contract.customers?.name ?? "Unknown customer"}
              </h1>
              <p className="text-xs text-ink-muted">
                {contract.estimates?.title ?? "—"}
                {contract.estimates?.selected_option && (
                  <span className="ml-2 capitalize text-ai-ink font-medium">
                    {contract.estimates.selected_option}
                  </span>
                )}
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="text-lg font-semibold text-ink tabular-nums">
                {centsDisplay(contract.total_cents)}
              </div>
              <div className="text-xs text-ink-muted">total contract value</div>
            </div>
          </div>

          {/* Status row */}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              {statusIcon(contract.status)}
              <span className="font-medium text-ink">{statusLabel(contract.status)}</span>
            </div>
            {contract.signed_at && (
              <span className="text-ink-muted">
                Signed {new Date(contract.signed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                {contract.signer_name && ` by ${contract.signer_name}`}
              </span>
            )}
            {contract.cancel_by_date && contract.status === "signed" && (
              <span className="text-warned-text">
                Cancellation window until {new Date(contract.cancel_by_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            )}
            {contract.effective_at && (
              <span className="text-confirmed-text">
                Effective {new Date(contract.effective_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            )}
          </div>

          {/* Cancellation notice for 65+ */}
          {contract.customer_65_or_older && (
            <div className="mt-3 flex items-center gap-2 text-xs text-warned-text">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              5-day cancellation window applies (customer 65+)
            </div>
          )}

          {/* PDF links */}
          {(contract.pdf_path || contract.signed_pdf_path) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {contract.pdf_path && (
                <button
                  onClick={() => openPdf(contract.pdf_path)}
                  className="flex items-center gap-1.5 text-xs text-ai-ink hover:underline"
                >
                  <FileText className="h-3.5 w-3.5" />
                  View unsigned PDF
                </button>
              )}
              {contract.signed_pdf_path && (
                <button
                  onClick={() => openPdf(contract.signed_pdf_path)}
                  className="flex items-center gap-1.5 text-xs text-confirmed-text hover:underline"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  View signed PDF
                </button>
              )}
            </div>
          )}
        </div>

        {/* Payment schedule */}
        <div className="rounded-xl border border-line bg-paper px-6 py-5 mb-4">
          <h2 className="text-sm font-semibold text-ink mb-4">Payment schedule</h2>
          {sortedSchedule.length === 0 ? (
            <p className="text-xs text-ink-muted">No payment schedule items.</p>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {sortedSchedule.map((item) => {
                const { label, cls } = scheduleItemStatus(item);
                return (
                  <div key={item.id} className="flex items-center justify-between py-3 gap-4">
                    <div className="min-w-0">
                      <p className="text-sm text-ink">{item.description}</p>
                      <p className="text-xs text-ink-muted mt-0.5">{triggerLabel(item.trigger_type)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-medium text-ink tabular-nums">
                        {centsDisplay(item.amount_cents)}
                      </p>
                      <p className={cn("text-xs mt-0.5", cls)}>{label}</p>
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between pt-3">
                <span className="text-xs font-semibold text-ink">Total</span>
                <span className="text-sm font-semibold text-ink tabular-nums">
                  {centsDisplay(contract.total_cents)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Manual signed-PDF upload */}
        {canUploadSigned && (
          <div className="rounded-xl border border-line bg-paper px-6 py-5">
            <h2 className="text-sm font-semibold text-ink mb-1">Upload signed contract</h2>
            <p className="text-xs text-ink-muted mb-4">
              Once the customer signs the printed contract, upload the scanned PDF here to mark it signed and start the cancellation window.
            </p>
            <form onSubmit={handleManualUpload} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-ink mb-1">Signer name</label>
                <input
                  type="text"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="Customer full name"
                  className="w-full rounded-lg border border-line bg-bone px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-ai-tint-border"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink mb-1">Date signed</label>
                <input
                  type="datetime-local"
                  value={signedAt}
                  onChange={(e) => setSignedAt(e.target.value)}
                  className="w-full rounded-lg border border-line bg-bone px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ai-tint-border"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink mb-1">Signed PDF</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="w-full text-xs text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-ai-chip-bg file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ai-ink hover:file:bg-ai-chip-bg/70"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={uploading}
                className="self-start flex items-center gap-2 px-4 py-2 rounded-xl bg-ink text-paper text-xs font-semibold hover:bg-ink/90 disabled:opacity-50 transition-colors"
              >
                <Upload className="h-3.5 w-3.5" />
                {uploading ? "Uploading…" : "Mark as signed"}
              </button>
            </form>
          </div>
        )}

        {/* Signed — awaiting deposit hint */}
        {contract.status === "signed" && (
          <div className="rounded-xl border border-line bg-paper px-6 py-5">
            <h2 className="text-sm font-semibold text-ink mb-1">Next step: collect deposit</h2>
            <p className="text-xs text-ink-muted">
              The contract is signed. Once the deposit payment is recorded the contract will
              automatically become effective (after the cancellation window closes).
              Send the customer a Stripe payment link or collect in person with Stripe Terminal.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
