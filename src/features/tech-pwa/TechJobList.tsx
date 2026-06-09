import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format, isToday } from "date-fns";
import { MapPin, ChevronRight, Phone } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { jobStatusLabel, jobStatusColor, jobTypeLabel, priorityColor, cn } from "@/lib/utils";
import type { JobWithRelations } from "@/types/database.types";

export default function TechJobList() {
  const { tenant, user } = useAuth();
  const [jobs, setJobs] = useState<JobWithRelations[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant || !user) return;
    void loadJobs();
  }, [tenant, user]);

  async function loadJobs() {
    if (!tenant || !user) return;
    setLoading(true);
    try {
      // Find technician record for this user
      const { data: tech } = await supabase
        .from("technicians")
        .select("id")
        .eq("user_id", user.id)
        .eq("tenant_id", tenant.id)
        .single();

      if (!tech) {
        setJobs([]);
        return;
      }

      const { data } = await supabase
        .from("jobs")
        .select("*, customers(id, name, phone), service_locations(id, address, city, state)")
        .eq("tech_id", tech.id)
        .eq("tenant_id", tenant.id)
        .is("deleted_at", null)
        .not("status", "in", "(cancelled,no_show,invoiced)")
        .order("scheduled_start", { ascending: true });

      setJobs((data ?? []) as JobWithRelations[]);
    } finally {
      setLoading(false);
    }
  }

  const todayJobs = jobs.filter(
    (j) => j.scheduled_start && isToday(new Date(j.scheduled_start))
  );
  const otherJobs = jobs.filter(
    (j) => !j.scheduled_start || !isToday(new Date(j.scheduled_start))
  );

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg font-bold">My Jobs</h1>

      {jobs.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No active jobs assigned to you.
        </div>
      )}

      {todayJobs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Today</p>
          {todayJobs.map((job) => <TechJobRow key={job.id} job={job} />)}
        </div>
      )}

      {otherJobs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Upcoming</p>
          {otherJobs.map((job) => <TechJobRow key={job.id} job={job} />)}
        </div>
      )}
    </div>
  );
}

function TechJobRow({ job }: { job: JobWithRelations }) {
  return (
    <Link
      to={`/tech/jobs/${job.id}`}
      className={cn(
        "block rounded-xl border bg-white p-4 shadow-sm active:bg-muted/40 transition-colors",
        job.priority === "emergency" && "border-red-300"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={cn("h-2 w-2 rounded-full flex-shrink-0", priorityColor(job.priority))} />
            <span className="font-semibold text-sm">{jobTypeLabel(job.job_type)}</span>
          </div>
          <p className="text-base font-medium">{job.customers?.name ?? "—"}</p>
          <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            <span className="truncate">
              {job.service_locations?.address}, {job.service_locations?.city}
            </span>
          </div>
          {job.customers?.phone && (
            <div className="flex items-center gap-1 mt-0.5 text-sm text-muted-foreground">
              <Phone className="h-3.5 w-3.5" />
              <span>{job.customers.phone}</span>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge className={cn("text-xs border", jobStatusColor(job.status))} variant="outline">
            {jobStatusLabel(job.status)}
          </Badge>
          {job.scheduled_start && (
            <span className="text-xs text-muted-foreground">
              {format(new Date(job.scheduled_start), "h:mm a")}
            </span>
          )}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </Link>
  );
}
