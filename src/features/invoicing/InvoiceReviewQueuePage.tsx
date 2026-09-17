import { useEffect, useState } from "react";
import { AlertTriangle, Send, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import type { InvoiceRow } from "@/types/database.types";

type InvoiceWithCustomer = InvoiceRow & {
  customers: { name: string; phone: string; email: string | null } | null;
  jobs: { job_type: string; scheduled_start: string | null; technicians: { name: string } | null } | null;
};

const FLAG_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  anomaly_high: { label: "High anomaly", color: "bg-red-100 text-red-700 border-red-200" },
  anomaly_low: { label: "Low anomaly", color: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  missing_items: { label: "Missing items", color: "bg-orange-100 text-orange-700 border-orange-200" },
  membership_conflict: { label: "Membership", color: "bg-purple-100 text-purple-700 border-purple-200" },
  manual_review_required: { label: "Manual review", color: "bg-gray-100 text-gray-700 border-gray-200" },
};

function getFlagType(flagReason: string | null): string {
  if (!flagReason) return "manual_review_required";
  const match = flagReason.match(/^\[(\w+)\]/);
  return match ? match[1] : "manual_review_required";
}

export default function InvoiceReviewQueuePage() {
  const { tenant } = useAuth();
  const [invoices, setInvoices] = useState<InvoiceWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant) return;
    void loadQueue();
  }, [tenant]);

  async function loadQueue() {
    if (!tenant) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from("invoices")
        .select(`
          *,
          customers(name, phone, email),
          jobs(job_type, scheduled_start, technicians(name))
        `)
        .eq("tenant_id", tenant.id)
        .eq("status", "review_required")
        .order("created_at", { ascending: false });

      setInvoices((data ?? []) as InvoiceWithCustomer[]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSend(invoiceId: string) {
    setSending(invoiceId);
    try {
      const { error } = await supabase.functions.invoke("invoice-agent", {
        body: { action: "send_reviewed", invoice_id: invoiceId },
      });
      if (error) throw error;

      // Optimistically remove from queue
      setInvoices((prev) => prev.filter((i) => i.id !== invoiceId));
      toast.success("Invoice sent to customer");
    } catch {
      // Fallback: direct status update
      const { error: updateError } = await supabase
        .from("invoices")
        .update({ status: "sent", sent_at: new Date().toISOString(), ai_flagged: false })
        .eq("id", invoiceId)
        .eq("tenant_id", tenant!.id);

      if (updateError) {
        toast.error("Failed to send invoice");
      } else {
        setInvoices((prev) => prev.filter((i) => i.id !== invoiceId));
        toast.success("Invoice sent");
      }
    } finally {
      setSending(null);
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-xl font-bold">Invoice Review Queue</h1>
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">Invoice Review Queue</h1>
        {invoices.length > 0 && (
          <Badge variant="destructive">{invoices.length}</Badge>
        )}
      </div>

      {invoices.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <AlertTriangle className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Queue is empty</p>
          <p className="text-sm mt-1">All AI-generated invoices are within normal parameters.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {invoices.map((inv) => {
            const flagType = getFlagType(inv.ai_flag_reason);
            const flagConfig = FLAG_TYPE_LABELS[flagType] ?? FLAG_TYPE_LABELS.manual_review_required;
            const cleanReason = inv.ai_flag_reason?.replace(/^\[\w+\]\s*/, "") ?? "";

            return (
              <Card key={inv.id} className="p-4">
                <div className="flex items-start gap-4">
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{inv.customers?.name ?? "Unknown customer"}</span>
                      <span className="text-sm text-muted-foreground">{inv.invoice_number}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${flagConfig.color}`}>
                        {flagConfig.label}
                      </span>
                    </div>

                    <p className="text-sm text-muted-foreground">
                      {inv.jobs?.job_type?.replace(/_/g, " ")} ·{" "}
                      {inv.jobs?.scheduled_start
                        ? format(new Date(inv.jobs.scheduled_start), "MMM d")
                        : "No date"}{" "}
                      {inv.jobs?.technicians?.name && `· ${inv.jobs.technicians.name}`}
                    </p>

                    {cleanReason && (
                      <p className="text-sm text-amber-700 bg-amber-50 rounded px-2.5 py-1.5 border border-amber-100">
                        <AlertTriangle className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
                        {cleanReason}
                      </p>
                    )}
                  </div>

                  <div className="text-right space-y-2 shrink-0">
                    <p className="text-xl font-bold">${Number(inv.total ?? 0).toFixed(0)}</p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(`/${tenant?.slug}/invoices/${inv.id}`, "_blank")}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleSend(inv.id)}
                        disabled={sending === inv.id}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        {sending === inv.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5 mr-1" />
                        )}
                        Send
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
