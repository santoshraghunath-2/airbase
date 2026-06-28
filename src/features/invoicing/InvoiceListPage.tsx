import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { format } from "date-fns";
import { Plus, Search, Sparkles, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatCurrency, cn } from "@/lib/utils";
import type { Invoice, InvoiceStatus } from "@/types/database.types";

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  review_required: "bg-amber-100 text-amber-700 border-amber-200",
  sent: "bg-blue-100 text-blue-700 border-blue-200",
  viewed: "bg-indigo-100 text-indigo-700 border-indigo-200",
  partial: "bg-orange-100 text-orange-700 border-orange-200",
  paid: "bg-green-100 text-green-700 border-green-200",
  overdue: "bg-red-100 text-red-700 border-red-200",
  void: "bg-gray-100 text-gray-400 border-gray-200",
};

type InvoiceWithCustomer = Invoice & {
  customers: { name: string } | null;
};

export default function InvoiceListPage() {
  const { tenant } = useAuth();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [invoices, setInvoices] = useState<InvoiceWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const reviewCount = invoices.filter((inv) => inv.status === "review_required").length;

  const loadInvoices = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      let query = supabase
        .from("invoices")
        .select("*, customers(name)")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data } = await query.limit(200);
      setInvoices((data ?? []) as InvoiceWithCustomer[]);
    } finally {
      setLoading(false);
    }
  }, [tenant, statusFilter]);

  useEffect(() => { void loadInvoices(); }, [loadInvoices]);

  const filtered = invoices.filter((inv) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      inv.invoice_number?.toLowerCase().includes(q) ||
      inv.customers?.name.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Invoices</h1>
        <Button size="sm" asChild>
          <Link to={`/${tenantSlug}/invoices/new`}>
            <Plus className="h-4 w-4" /> New Invoice
          </Link>
        </Button>
      </div>

      {reviewCount > 0 && (
        <button
          onClick={() => setStatusFilter("review_required")}
          className="flex items-center gap-3 w-full rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left hover:bg-amber-100 transition-colors"
        >
          <div className="flex items-center gap-2 flex-1">
            <Sparkles className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <span className="text-sm font-medium text-amber-900">
              {reviewCount} invoice{reviewCount > 1 ? "s" : ""} flagged by AI — review before sending
            </span>
          </div>
          <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
        </button>
      )}

      <div className="flex gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search invoice # or customer…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="review_required">Review Required</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="viewed">Viewed</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    {search || statusFilter !== "all" ? "No matching invoices" : "No invoices yet"}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((inv) => (
                  <TableRow key={inv.id} className="cursor-pointer" onClick={() => {}}>
                    <TableCell>
                      <Link
                        to={`/${tenantSlug}/invoices/${inv.id}`}
                        className="font-mono text-sm font-medium text-blue-600 hover:underline"
                      >
                        {inv.invoice_number ?? "Draft"}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">
                      {inv.customers?.name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn("text-xs border capitalize", STATUS_COLORS[inv.status])}
                        variant="outline"
                      >
                        {inv.status.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(inv.total)}
                    </TableCell>
                    <TableCell className={cn(
                      "text-right font-medium",
                      (inv.balance_due ?? 0) > 0 ? "text-red-600" : "text-green-600"
                    )}>
                      {formatCurrency(inv.balance_due)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(inv.created_at), "MMM d, yyyy")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
