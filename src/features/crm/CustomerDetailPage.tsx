import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import { Phone, Mail, MapPin, Wrench, ChevronLeft, Plus, ExternalLink, Pencil } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPhone, jobStatusLabel, jobStatusColor, jobTypeLabel } from "@/lib/utils";
import CustomerFormDialog from "./components/CustomerFormDialog";
import type { Customer, ServiceLocation, Equipment, Job } from "@/types/database.types";

export default function CustomerDetailPage() {
  const { customerId, tenantSlug } = useParams<{ customerId: string; tenantSlug: string }>();
  const { tenant } = useAuth();
  const [customer, setCustomer]   = useState<Customer | null>(null);
  const [locations, setLocations] = useState<ServiceLocation[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [jobs, setJobs]           = useState<Job[]>([]);
  const [loading, setLoading]     = useState(true);
  const [editOpen, setEditOpen]   = useState(false);

  useEffect(() => {
    if (!tenant || !customerId) return;
    void loadCustomer();
  }, [tenant, customerId]);

  async function loadCustomer() {
    if (!tenant || !customerId) return;
    setLoading(true);
    try {
      const [custRes, locsRes, jobsRes] = await Promise.all([
        supabase.from("customers").select("*").eq("id", customerId).eq("tenant_id", tenant.id).single(),
        supabase.from("service_locations").select("*").eq("customer_id", customerId),
        supabase.from("jobs").select("*").eq("customer_id", customerId).eq("tenant_id", tenant.id)
          .is("deleted_at", null).order("created_at", { ascending: false }).limit(20),
      ]);

      if (custRes.error) throw custRes.error;
      setCustomer(custRes.data);
      setLocations(locsRes.data ?? []);
      setJobs(jobsRes.data ?? []);

      // Load equipment for all locations
      if (locsRes.data && locsRes.data.length > 0) {
        const locIds = locsRes.data.map((l) => l.id);
        const { data: equip } = await supabase
          .from("equipment")
          .select("*")
          .in("location_id", locIds)
          .eq("tenant_id", tenant.id);
        setEquipment(equip ?? []);
      }
    } catch (err) {
      toast.error("Failed to load customer");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Customer not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/${tenantSlug}/customers`}>
            <ChevronLeft className="h-4 w-4" /> Customers
          </Link>
        </Button>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{customer.name}</h1>
          <div className="flex items-center gap-4 mt-1">
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <Phone className="h-3.5 w-3.5" />
              {formatPhone(customer.phone)}
            </span>
            {customer.email && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <Mail className="h-3.5 w-3.5" />
                {customer.email}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" /> Edit
          </Button>
          <Button asChild>
            <Link to={`/${tenantSlug}/jobs/new?customerId=${customer.id}`}>
              <Plus className="h-4 w-4" /> Book Job
            </Link>
          </Button>
        </div>
      </div>

      <CustomerFormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => { setEditOpen(false); void loadCustomer(); }}
        editCustomer={customer}
        editLocation={locations.find((l) => l.is_primary) ?? locations[0] ?? null}
      />

      {customer.notes && (
        <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          {customer.notes}
        </div>
      )}

      <Tabs defaultValue="jobs">
        <TabsList>
          <TabsTrigger value="jobs">Job History ({jobs.length})</TabsTrigger>
          <TabsTrigger value="locations">Locations ({locations.length})</TabsTrigger>
          <TabsTrigger value="equipment">Equipment ({equipment.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="jobs" className="mt-4">
          {jobs.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-muted-foreground text-sm">No jobs yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.map((job) => (
                <div key={job.id} className="flex items-center gap-4 rounded-lg border p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{jobTypeLabel(job.job_type)}</span>
                      <Badge className={`text-xs border ${jobStatusColor(job.status)}`} variant="outline">
                        {jobStatusLabel(job.status)}
                      </Badge>
                    </div>
                    {job.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{job.description}</p>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {format(new Date(job.created_at), "MMM d, yyyy")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="locations" className="mt-4">
          <div className="space-y-3">
            {locations.map((loc) => (
              <Card key={loc.id}>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-sm">{loc.address}</p>
                      {(loc.city || loc.state || loc.zip) && (
                        <p className="text-xs text-muted-foreground">
                          {[loc.city, loc.state, loc.zip].filter(Boolean).join(", ")}
                        </p>
                      )}
                      {loc.location_notes && (
                        <p className="text-xs text-amber-700 mt-1 bg-amber-50 rounded px-2 py-1">
                          {loc.location_notes}
                        </p>
                      )}
                      {loc.is_primary && (
                        <Badge variant="secondary" className="mt-1 text-xs">Primary</Badge>
                      )}
                    </div>
                    <a
                      href={`https://maps.google.com/?q=${encodeURIComponent(
                        `${loc.address} ${loc.city ?? ""} ${loc.state ?? ""}`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto"
                    >
                      <Button variant="ghost" size="sm">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </a>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="equipment" className="mt-4">
          {equipment.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-muted-foreground text-sm">No equipment recorded</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {equipment.map((eq) => (
                <Card key={eq.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                      {eq.category.replace(/_/g, " ")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground space-y-1">
                    {eq.make && <p>Make: <span className="text-foreground">{eq.make}</span></p>}
                    {eq.model && <p>Model: <span className="text-foreground">{eq.model}</span></p>}
                    {eq.serial_number && (
                      <p>Serial: <span className="text-foreground font-mono">{eq.serial_number}</span></p>
                    )}
                    {eq.install_date && (
                      <p>Installed: <span className="text-foreground">{format(new Date(eq.install_date), "MMM yyyy")}</span></p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
