import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams, useParams, Link } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Search, ChevronLeft, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { formatPhone, jobTypeLabel } from "@/lib/utils";
import type { Customer, ServiceLocation, JobType, VisitReason } from "@/types/database.types";

const JOB_TYPES: JobType[] = [
  "plumbing_service", "drain_cleaning", "water_heater_repair", "water_heater_install",
  "hvac_service", "hvac_repair", "hvac_install", "hvac_maintenance",
  "electrical_service", "electrical_repair", "electrical_install",
  "general_maintenance", "estimate_only",
];

const VISIT_REASONS = [
  { value: "new_request",    label: "New Request" },
  { value: "callback",       label: "Callback — prior work failed (no charge)" },
  { value: "parts_warranty", label: "Parts Warranty — manufacturer covers part, labor billed" },
  { value: "labor_warranty", label: "Labor Warranty — company covers all ($0)" },
  { value: "recall",         label: "Recall — manufacturer ($0, flag for claim)" },
];

const schema = z.object({
  customer_id: z.string().min(1, "Select a customer"),
  location_id: z.string().min(1, "Select a service location"),
  job_type: z.string().min(1, "Select a job type"),
  visit_reason: z.string().default("new_request"),
  priority: z.string().default("normal"),
  description: z.string().optional(),
  scheduled_start: z.string().optional(),
  scheduled_end: z.string().optional(),
  estimated_duration_minutes: z.coerce.number().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function NewJobPage() {
  const { tenant } = useAuth();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefilledCustomerId = searchParams.get("customerId");

  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [locations, setLocations] = useState<ServiceLocation[]>([]);
  const [saving, setSaving] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { priority: "normal" },
  });

  // Pre-fill customer if coming from customer detail page
  useEffect(() => {
    if (prefilledCustomerId && tenant) {
      void loadCustomerById(prefilledCustomerId);
    }
  }, [prefilledCustomerId, tenant]);

  async function loadCustomerById(id: string) {
    const { data } = await supabase
      .from("customers")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenant!.id)
      .single();
    if (data) {
      setSelectedCustomer(data);
      setValue("customer_id", data.id);
      void loadLocations(data.id);
    }
  }

  const searchCustomers = useCallback(async () => {
    if (!tenant || customerSearch.length < 2) {
      setCustomers([]);
      return;
    }
    const { data } = await supabase
      .from("customers")
      .select("*")
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null)
      .or(`name.ilike.%${customerSearch}%,phone.ilike.%${customerSearch}%`)
      .limit(10);
    setCustomers(data ?? []);
  }, [tenant, customerSearch]);

  useEffect(() => {
    void searchCustomers();
  }, [searchCustomers]);

  async function loadLocations(cid: string) {
    const { data } = await supabase
      .from("service_locations")
      .select("*")
      .eq("customer_id", cid);
    setLocations(data ?? []);
    if (data && data.length === 1) {
      setValue("location_id", data[0].id);
    }
  }

  function selectCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setValue("customer_id", customer.id);
    setCustomers([]);
    setCustomerSearch("");
    void loadLocations(customer.id);
  }

  async function onSubmit(values: FormValues) {
    if (!tenant) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("jobs").insert({
        tenant_id:                    tenant.id,
        customer_id:                  values.customer_id,
        location_id:                  values.location_id,
        job_type:                     values.job_type,
        visit_reason:                 (values.visit_reason as VisitReason) ?? "new_request",
        priority:                     values.priority,
        status:                       "unassigned",
        description:                  values.description || null,
        scheduled_start:              values.scheduled_start || null,
        scheduled_end:                values.scheduled_end || null,
        estimated_duration_minutes:   values.estimated_duration_minutes || null,
      });

      if (error) throw error;

      toast.success("Job created");
      navigate(`/${tenantSlug}/dispatch`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create job");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/${tenantSlug}/dashboard`}>
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">Book Job</h1>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Customer */}
        <Card>
          <CardContent className="pt-5 space-y-4">
            <p className="font-medium text-sm">Customer</p>
            {selectedCustomer ? (
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
                <div>
                  <p className="font-medium text-sm">{selectedCustomer.name}</p>
                  <p className="text-xs text-muted-foreground">{formatPhone(selectedCustomer.phone)}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedCustomer(null);
                    setValue("customer_id", "");
                    setValue("location_id", "");
                    setLocations([]);
                  }}
                >
                  Change
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search customer by name or phone…"
                  className="pl-9"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                />
                {customers.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg">
                    {customers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full text-left px-4 py-2.5 hover:bg-muted text-sm"
                        onClick={() => selectCustomer(c)}
                      >
                        <span className="font-medium">{c.name}</span>
                        <span className="ml-2 text-muted-foreground">{formatPhone(c.phone)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {errors.customer_id && (
              <p className="text-xs text-destructive">{errors.customer_id.message}</p>
            )}

            {/* Location selector */}
            {locations.length > 0 && (
              <div className="space-y-1.5">
                <Label>Service Location *</Label>
                <Controller
                  name="location_id"
                  control={control}
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select location" />
                      </SelectTrigger>
                      <SelectContent>
                        {locations.map((loc) => (
                          <SelectItem key={loc.id} value={loc.id}>
                            {loc.address}{loc.city ? `, ${loc.city}` : ""}
                            {loc.is_primary ? " (Primary)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.location_id && (
                  <p className="text-xs text-destructive">{errors.location_id.message}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Job details */}
        <Card>
          <CardContent className="pt-5 space-y-4">
            <p className="font-medium text-sm">Job Details</p>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Job Type *</Label>
                <Controller
                  name="job_type"
                  control={control}
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        {JOB_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>{jobTypeLabel(t)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.job_type && (
                  <p className="text-xs text-destructive">{errors.job_type.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Controller
                  name="priority"
                  control={control}
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="emergency">🔴 Emergency</SelectItem>
                        <SelectItem value="high">🟠 High</SelectItem>
                        <SelectItem value="normal">🔵 Normal</SelectItem>
                        <SelectItem value="low">⚪ Low</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Visit Reason</Label>
              <Controller
                name="visit_reason"
                control={control}
                defaultValue="new_request"
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value ?? "new_request"}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VISIT_REASONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                placeholder="Describe the issue or service needed…"
                rows={3}
                {...register("description")}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Scheduled Start</Label>
                <Input type="datetime-local" {...register("scheduled_start")} />
              </div>
              <div className="space-y-1.5">
                <Label>Scheduled End</Label>
                <Input type="datetime-local" {...register("scheduled_end")} />
              </div>
            </div>

            <div className="space-y-1.5 max-w-xs">
              <Label>Est. Duration (minutes)</Label>
              <Input
                type="number"
                placeholder="60"
                min={15}
                step={15}
                {...register("estimated_duration_minutes")}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" asChild>
            <Link to={`/${tenantSlug}/dashboard`}>Cancel</Link>
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Job
          </Button>
        </div>
      </form>
    </div>
  );
}
