import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  CalendarClock,
  DollarSign,
  AlertTriangle,
  FileText,
  Plus,
  ArrowRight,
} from "lucide-react";
import { format, startOfDay, endOfDay } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, jobStatusLabel, jobStatusColor, jobTypeLabel } from "@/lib/utils";
import type { JobWithRelations } from "@/types/database.types";

interface DashboardStats {
  jobsByStatus: Record<string, number>;
  revenueToday: number;
  openInvoicesCount: number;
  openInvoicesTotal: number;
  unassignedCount: number;
}

export default function DashboardPage() {
  const { tenant } = useAuth();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [todaysJobs, setTodaysJobs] = useState<JobWithRelations[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant) return;
    void loadDashboard();
  }, [tenant]);

  async function loadDashboard() {
    if (!tenant) return;
    setLoading(true);
    try {
      const now = new Date();
      const todayStart = startOfDay(now).toISOString();
      const todayEnd = endOfDay(now).toISOString();

      // Load today's jobs
      const { data: jobs } = await supabase
        .from("jobs")
        .select("*, customers(id, name, phone), service_locations(id, address, city, state), technicians(id, name, phone)")
        .eq("tenant_id", tenant.id)
        .is("deleted_at", null)
        .or(`scheduled_start.gte.${todayStart},scheduled_start.is.null`)
        .lte("scheduled_start", todayEnd)
        .order("scheduled_start", { ascending: true });

      setTodaysJobs((jobs ?? []) as JobWithRelations[]);

      // Jobs by status
      const { data: allActiveJobs } = await supabase
        .from("jobs")
        .select("status")
        .eq("tenant_id", tenant.id)
        .is("deleted_at", null)
        .not("status", "in", "(cancelled,no_show,invoiced)");

      const jobsByStatus: Record<string, number> = {};
      (allActiveJobs ?? []).forEach((j) => {
        jobsByStatus[j.status] = (jobsByStatus[j.status] ?? 0) + 1;
      });

      // Revenue today (paid invoices)
      const { data: paidInvoices } = await supabase
        .from("invoices")
        .select("total")
        .eq("tenant_id", tenant.id)
        .eq("status", "paid")
        .gte("paid_at", todayStart)
        .lte("paid_at", todayEnd);

      const revenueToday = (paidInvoices ?? []).reduce(
        (sum, inv) => sum + (inv.total ?? 0),
        0
      );

      // Open invoices
      const { data: openInvoices } = await supabase
        .from("invoices")
        .select("balance_due")
        .eq("tenant_id", tenant.id)
        .in("status", ["sent", "viewed", "partial", "overdue"]);

      const openInvoicesCount = openInvoices?.length ?? 0;
      const openInvoicesTotal = (openInvoices ?? []).reduce(
        (sum, inv) => sum + (inv.balance_due ?? 0),
        0
      );

      setStats({
        jobsByStatus,
        revenueToday,
        openInvoicesCount,
        openInvoicesTotal,
        unassignedCount: jobsByStatus["unassigned"] ?? 0,
      });
    } finally {
      setLoading(false);
    }
  }

  const totalActiveJobs = stats
    ? Object.values(stats.jobsByStatus).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {format(new Date(), "EEEE, MMMM d")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {tenant?.name} — Operations Dashboard
          </p>
        </div>
        <Button asChild>
          <Link to={`/${tenantSlug}/jobs/new`}>
            <Plus className="h-4 w-4" />
            Book Job
          </Link>
        </Button>
      </div>

      {/* Unassigned alert */}
      {!loading && (stats?.unassignedCount ?? 0) > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
          <span className="text-sm text-amber-800 font-medium">
            {stats!.unassignedCount} unassigned{" "}
            {stats!.unassignedCount === 1 ? "job" : "jobs"} need dispatch
          </span>
          <Button variant="outline" size="sm" asChild className="ml-auto border-amber-300 text-amber-700">
            <Link to={`/${tenantSlug}/dispatch`}>
              Go to Dispatch <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          loading={loading}
          title="Active Jobs"
          value={totalActiveJobs.toString()}
          icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
          description={`${stats?.jobsByStatus["in_progress"] ?? 0} in progress`}
        />
        <StatCard
          loading={loading}
          title="Revenue Today"
          value={formatCurrency(stats?.revenueToday)}
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          description="Collected payments"
        />
        <StatCard
          loading={loading}
          title="Open Invoices"
          value={stats?.openInvoicesCount.toString() ?? "0"}
          icon={<FileText className="h-4 w-4 text-muted-foreground" />}
          description={formatCurrency(stats?.openInvoicesTotal) + " outstanding"}
        />
        <StatCard
          loading={loading}
          title="Unassigned"
          value={stats?.unassignedCount.toString() ?? "0"}
          icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
          description="Need tech assignment"
          highlight={!!stats?.unassignedCount && stats.unassignedCount > 0}
        />
      </div>

      {/* Today's jobs */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Today's Jobs</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/${tenantSlug}/dispatch`}>
              View Dispatch <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : todaysJobs.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-muted-foreground text-sm">No jobs scheduled for today</p>
            <Button variant="outline" size="sm" className="mt-3" asChild>
              <Link to={`/${tenantSlug}/jobs/new`}>
                <Plus className="h-3 w-3 mr-1" /> Book a job
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {todaysJobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center gap-4 rounded-lg border bg-card p-4 hover:bg-muted/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-medium text-sm truncate">
                      {job.customers?.name ?? "Unknown Customer"}
                    </span>
                    <Badge
                      className={`text-xs border ${jobStatusColor(job.status)}`}
                      variant="outline"
                    >
                      {jobStatusLabel(job.status)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {jobTypeLabel(job.job_type)} •{" "}
                    {job.service_locations?.address ?? "No address"},{" "}
                    {job.service_locations?.city}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-medium">
                    {job.technicians?.name ?? (
                      <span className="text-amber-600">Unassigned</span>
                    )}
                  </p>
                  {job.scheduled_start && (
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(job.scheduled_start), "h:mm a")}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  description,
  loading,
  highlight,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  description: string;
  loading: boolean;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-amber-200 bg-amber-50/50" : ""}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  );
}
