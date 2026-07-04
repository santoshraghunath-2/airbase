import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { format } from "date-fns";
import {
  Wrench, FileText, CalendarPlus, Star, Loader2, CheckCircle2, AlertCircle,
  ClipboardList, ChevronRight,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn, jobTypeLabel, jobStatusLabel } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PortalTenant  { name: string; phone: string | null; brand_color: string | null }
interface PortalCustomer { name: string; phone: string | null; email: string | null }
interface PortalJob {
  id: string; job_type: string; status: string;
  scheduled_start: string | null; description: string | null; created_at: string;
}
interface PortalInvoice {
  id: string; invoice_number: string | null; status: string;
  total: number | null; balance_due: number | null;
  due_date: string | null; payment_link_url: string | null; created_at: string;
}
interface PortalEquipment {
  id: string; category: string; make: string | null; model: string | null;
  install_date: string | null; warranty_expiry: string | null; last_service_date: string | null;
}
interface PortalMembership {
  status: string; billing_cycle: string; expires_at: string;
  membership_plans: { name: string; benefits: Array<{ text: string }> } | null;
}
interface PortalData {
  tenant:     PortalTenant;
  customer:   PortalCustomer;
  jobs:       PortalJob[];
  invoices:   PortalInvoice[];
  equipment:  PortalEquipment[];
  membership: PortalMembership | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SERVICE_TYPES = [
  "Plumbing repair",
  "Water heater service",
  "Drain cleaning",
  "HVAC service / tune-up",
  "Heating repair",
  "Cooling repair",
  "Annual maintenance",
  "Other / not sure",
];

const INVOICE_STATUS_COLOR: Record<string, string> = {
  sent:    "bg-blue-50 text-blue-700 border-blue-200",
  viewed:  "bg-blue-50 text-blue-700 border-blue-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  overdue: "bg-red-50 text-red-700 border-red-200",
};

function fmt(d: string | null, pattern = "MMM d, yyyy") {
  if (!d) return "—";
  try { return format(new Date(d), pattern); } catch { return "—"; }
}

function fmtCurrency(cents: number | null) {
  if (cents === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents);
}

// ─── Section card ─────────────────────────────────────────────────────────────

function Section({ icon: Icon, title, children }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow-sm">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-neutral-100">
        <Icon className="h-4 w-4 text-neutral-400" />
        <h2 className="text-sm font-semibold text-neutral-800">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ─── Request Service form ─────────────────────────────────────────────────────

function RequestServiceForm({ token, accent }: { token: string; accent: string }) {
  const [serviceType, setServiceType] = useState("");
  const [notes, setNotes]             = useState("");
  const [preferredDate, setPreferred] = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [done, setDone]               = useState(false);

  async function submit() {
    if (!serviceType) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("portal-session", {
        body: { action: "book", token, service_type: serviceType, notes: notes || undefined, preferred_date: preferredDate || undefined },
      });
      if (error) throw error;
      setDone(true);
    } catch {
      alert("Something went wrong. Please call us to schedule.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="flex items-center gap-3 py-2 text-sm text-green-700">
        <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
        <span>Request received! Our team will be in touch shortly to confirm your appointment.</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium text-neutral-500 block mb-2">What do you need help with?</label>
        <div className="grid grid-cols-2 gap-2">
          {SERVICE_TYPES.map((s) => (
            <button
              key={s}
              onClick={() => setServiceType(s)}
              className={cn(
                "text-left px-3 py-2.5 rounded-xl border text-xs font-medium transition-colors",
                serviceType === s
                  ? "border-2 text-white"
                  : "border-neutral-200 text-neutral-600 bg-neutral-50 hover:bg-neutral-100",
              )}
              style={serviceType === s ? { borderColor: accent, backgroundColor: accent } : {}}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-neutral-500 block mb-1">Preferred date (optional)</label>
        <input
          type="date"
          value={preferredDate}
          onChange={(e) => setPreferred(e.target.value)}
          className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-800 focus:outline-none focus:ring-2 focus:ring-offset-1"
          style={{ "--tw-ring-color": accent } as React.CSSProperties}
        />
      </div>

      <div>
        <label className="text-xs font-medium text-neutral-500 block mb-1">Additional notes (optional)</label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Describe the issue or anything helpful for our team…"
          rows={3}
        />
      </div>

      <Button
        onClick={() => void submit()}
        disabled={!serviceType || submitting}
        className="w-full"
        style={{ backgroundColor: accent }}
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
        Request Appointment
      </Button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CustomerPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData]       = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!token) { setInvalid(true); setLoading(false); return; }
    void (async () => {
      try {
        const { data: result, error } = await supabase.functions.invoke("portal-session", {
          body: { action: "load", token },
        });
        if (error || !result?.customer) { setInvalid(true); return; }
        setData(result as PortalData);
      } catch {
        setInvalid(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const accent = data?.tenant?.brand_color ?? "#292420";
  const firstName = data?.customer.name.split(" ")[0] ?? "";

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-4">
          <Skeleton className="h-12 w-40 rounded-xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (invalid || !data) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-6">
        <div className="text-center max-w-sm space-y-3">
          <AlertCircle className="h-10 w-10 text-neutral-400 mx-auto" />
          <h1 className="text-lg font-semibold text-neutral-800">Link expired or not found</h1>
          <p className="text-sm text-neutral-500">
            This portal link may have expired. Please contact your service provider for a new link.
          </p>
        </div>
      </div>
    );
  }

  const { tenant, customer, jobs, invoices, equipment, membership } = data;
  const openInvoiceTotal = invoices.reduce((s, i) => s + (i.balance_due ?? 0), 0);

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="text-white py-6 px-6" style={{ backgroundColor: accent }}>
        <div className="max-w-lg mx-auto">
          <p className="text-sm font-semibold opacity-75 mb-1">{tenant.name}</p>
          <h1 className="text-2xl font-bold">Hi, {firstName} 👋</h1>
          <p className="text-sm opacity-75 mt-1">Your service portal</p>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* Membership banner */}
        {membership && (
          <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 px-5 py-4 flex items-start gap-3">
            <Star className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">
                {membership.membership_plans?.name ?? "Member"}
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                Active · renews {fmt(membership.expires_at)}
              </p>
              {membership.membership_plans?.benefits?.slice(0, 2).map((b, i) => (
                <p key={i} className="text-xs text-amber-700">• {b.text}</p>
              ))}
            </div>
          </div>
        )}

        {/* Open invoices */}
        {invoices.length > 0 && (
          <Section icon={FileText} title={`Open Invoices${invoices.length > 1 ? ` (${invoices.length})` : ""}`}>
            <div className="space-y-3">
              {invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-neutral-800">
                        {inv.invoice_number ? `Invoice #${inv.invoice_number}` : "Invoice"}
                      </p>
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] capitalize border", INVOICE_STATUS_COLOR[inv.status] ?? "")}
                      >
                        {inv.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {inv.due_date ? `Due ${fmt(inv.due_date)}` : `Sent ${fmt(inv.created_at)}`}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-neutral-900">{fmtCurrency(inv.balance_due)}</p>
                    {inv.payment_link_url ? (
                      <a
                        href={inv.payment_link_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium underline mt-0.5 inline-block"
                        style={{ color: accent }}
                      >
                        Pay now →
                      </a>
                    ) : (
                      <p className="text-xs text-neutral-400 mt-0.5">Call to pay</p>
                    )}
                  </div>
                </div>
              ))}
              {invoices.length > 1 && (
                <div className="pt-2 border-t border-neutral-100 flex justify-between items-center">
                  <p className="text-xs text-neutral-500">Total outstanding</p>
                  <p className="text-sm font-bold text-neutral-900">{fmtCurrency(openInvoiceTotal)}</p>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Request service */}
        <Section icon={CalendarPlus} title="Request a Service">
          <RequestServiceForm token={token!} accent={accent} />
        </Section>

        {/* Job history */}
        {jobs.length > 0 && (
          <Section icon={ClipboardList} title="Service History">
            <div className="space-y-3">
              {jobs.map((job) => (
                <div key={job.id} className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-800">{jobTypeLabel(job.job_type)}</p>
                    {job.description && (
                      <p className="text-xs text-neutral-500 mt-0.5 line-clamp-1">{job.description}</p>
                    )}
                    <p className="text-xs text-neutral-400 mt-0.5">
                      {job.scheduled_start ? fmt(job.scheduled_start, "MMM d, yyyy") : fmt(job.created_at, "MMM d, yyyy")}
                    </p>
                  </div>
                  <span className={cn(
                    "text-[10px] font-semibold rounded-full px-2 py-0.5 border flex-shrink-0",
                    job.status === "completed" || job.status === "invoiced"
                      ? "bg-green-50 text-green-700 border-green-200"
                      : "bg-neutral-100 text-neutral-500 border-neutral-200",
                  )}>
                    {jobStatusLabel(job.status)}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Equipment */}
        {equipment.length > 0 && (
          <Section icon={Wrench} title="Your Equipment">
            <div className="space-y-3">
              {equipment.map((eq) => {
                const warrantyExpired = eq.warranty_expiry
                  ? new Date(eq.warranty_expiry) < new Date()
                  : false;
                return (
                  <div key={eq.id} className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
                    <p className="text-sm font-medium text-neutral-800 capitalize">
                      {eq.category.replace(/_/g, " ")}
                      {(eq.make || eq.model) && (
                        <span className="font-normal text-neutral-500"> — {[eq.make, eq.model].filter(Boolean).join(" ")}</span>
                      )}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      {eq.install_date && (
                        <p className="text-xs text-neutral-500">Installed {fmt(eq.install_date, "MMM yyyy")}</p>
                      )}
                      {eq.warranty_expiry && (
                        <p className={cn("text-xs font-medium", warrantyExpired ? "text-red-600" : "text-green-600")}>
                          Warranty {warrantyExpired ? "expired" : "until"} {fmt(eq.warranty_expiry, "MMM yyyy")}
                        </p>
                      )}
                      {eq.last_service_date && (
                        <p className="text-xs text-neutral-500">Last service {fmt(eq.last_service_date, "MMM yyyy")}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Contact */}
        {tenant.phone && (
          <div className="text-center py-4">
            <p className="text-xs text-neutral-400">Questions? Call us at</p>
            <a href={`tel:${tenant.phone}`} className="text-sm font-semibold mt-0.5 inline-block" style={{ color: accent }}>
              {tenant.phone}
            </a>
          </div>
        )}

        <p className="text-center text-[10px] text-neutral-300 pb-4">
          Powered by Airbase
        </p>
      </main>
    </div>
  );
}
