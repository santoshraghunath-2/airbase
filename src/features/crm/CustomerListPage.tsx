import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { Plus, Search, Phone, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPhone } from "@/lib/utils";
import type { Customer } from "@/types/database.types";
import CustomerFormDialog from "./components/CustomerFormDialog";

export default function CustomerListPage() {
  const { tenant } = useAuth();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const loadCustomers = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      let query = supabase
        .from("customers")
        .select("*")
        .eq("tenant_id", tenant.id)
        .is("deleted_at", null)
        .order("name", { ascending: true });

      if (search.trim()) {
        query = query.or(
          `name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`
        );
      }

      const { data } = await query.limit(100);
      setCustomers(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [tenant, search]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Customers</h1>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4" />
          New Customer
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, phone, or email…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : customers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm mb-3">
            {search ? "No customers match your search" : "No customers yet"}
          </p>
          {!search && (
            <Button variant="outline" onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add first customer
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          {customers.map((customer, idx) => (
            <Link
              key={customer.id}
              to={`/${tenantSlug}/customers/${customer.id}`}
              className={`flex items-center gap-4 px-4 py-3.5 hover:bg-muted/40 transition-colors ${
                idx < customers.length - 1 ? "border-b" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{customer.name}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    {formatPhone(customer.phone)}
                  </span>
                  {customer.email && (
                    <span className="text-xs text-muted-foreground truncate">{customer.email}</span>
                  )}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            </Link>
          ))}
        </div>
      )}

      <CustomerFormDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onSaved={() => { setShowCreateDialog(false); void loadCustomers(); }}
      />
    </div>
  );
}
