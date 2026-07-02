import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Search, Plus, ArrowRight, ArrowUpDown, ChevronLeft, ChevronRight, X, Pencil,
} from "lucide-react";
import { format, startOfDay, endOfDay, subDays } from "date-fns";
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
  jobStatusLabel, jobStatusColor, jobTypeLabel,
} from "@/lib/utils";
import JobEditDialog from "./components/JobEditDialog";
import type { JobWithRelations } from "@/types/database.types";
import type { JobStatus } from "@/types/database.types";

// ─── Filter state ─────────────────────────────────────────────────────────────

type SortField = "scheduled_start" | "created_at" | "priority";
type SortDir   = "asc" | "desc";

const PRIORITY_ORDER: Record<string, number> = {
  emergency: 0, high: 1, normal: 2, low: 3,
};

const DATE_PRESETS = [
  { label: "Today",       value: "today" },
  { label: "Yesterday",   value: "yesterday" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days",value: "30d" },
  { label: "All time",    value: "all" },
] as const;

type DatePreset = typeof DATE_PRESETS[number]["value"];

function presetToRange(preset: DatePreset): { from: string | null; to: string | null } {
  const now = new Date();
  switch (preset) {
    case "today":
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    case "yesterday": {
      const y = subDays(now, 1);
      return { from: startOfDay(y).toISOString(), to: endOfDay(y).toISOString() };
    }
    case "7d":
      return { from: subDays(now, 7).toISOString(), to: endOfDay(now).toISOString() };
    case "30d":
      return { from: subDays(now, 30).toISOString(), to: endOfDay(now).toISOString() };
    default:
      return { from: null, to: null };
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function JobListPage() {
  const { tenant }     = useAuth();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();

  const [jobs, setJobs]             = useState<JobWithRelations[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(0);
  const [loading, setLoading]       = useState(true);
  const [editingJob, setEditingJob] = useState<JobWithRelations | null>(null);

  // Filters
  const [search, setSearch]         = useState("");
  const [statusFilter, setStatus]   = useState<JobStatus | "all">("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("30d");
  const [sortField, setSortField]   = useState<SortField>("scheduled_start");
  const [sortDir, setSortDir]       = useState<SortDir>("desc");

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);

    const { from, to } = presetToRange(datePreset);

    let query = supabase
      .from("jobs")
      .select(
        "*, customers(id, name, phone), service_locations(id, address, city, state), technicians(id, name)",
        { count: "exact" },
      )
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null)
      .order(sortField, { ascending: sortDir === "asc" })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    if (from)                   query = query.gte("scheduled_start", from);
    if (to)                     query = query.lte("scheduled_start", to);

    const { data, count, error } = await query;
    if (error) { setLoading(false); return; }

    let rows = (data ?? []) as JobWithRelations[];

    // Client-side customer search (Supabase doesn't support ilike on joined columns easily)
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (j) =>
          j.customers?.name?.toLowerCase().includes(q) ||
          j.customers?.phone?.includes(q) ||
          j.job_type?.toLowerCase().includes(q) ||
          j.description?.toLowerCase().includes(q),
      );
    }

    setJobs(rows);
    setTotal(count ?? 0);
    setLoading(false);
  }, [tenant, statusFilter, datePreset, sortField, sortDir, page, search]);

  useEffect(() => { setPage(0); }, [statusFilter, datePreset, search]);
  useEffect(() => { void load(); }, [load]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Jobs</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading…" : `${total} total jobs`}
          </p>
        </div>
        <Button asChild>
          <Link to={`/${tenantSlug}/jobs/new`}>
            <Plus className="h-4 w-4" />
            Book Job
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9 h-9 text-sm"
            placeholder="Customer, phone, job type…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearch("")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Status */}
        <Select value={statusFilter} onValueChange={(v) => setStatus(v as JobStatus | "all")}>
          <SelectTrigger className="h-9 w-[160px] text-sm">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            <SelectItem value="dispatched">Dispatched</SelectItem>
            <SelectItem value="en_route">En route</SelectItem>
            <SelectItem value="in_progress">In progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="invoiced">Invoiced</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="no_show">No show</SelectItem>
          </SelectContent>
        </Select>

        {/* Date preset */}
        <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DatePreset)}>
          <SelectTrigger className="h-9 w-[140px] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Customer</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                <button
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                  onClick={() => toggleSort("priority")}
                >
                  Priority
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Technician</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                <button
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                  onClick={() => toggleSort("scheduled_start")}
                >
                  Scheduled
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Location</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-t">
                  {Array.from({ length: 8 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : jobs.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground text-sm">
                  No jobs found matching these filters.
                </td>
              </tr>
            ) : (
              jobs
                .sort(sortField === "priority"
                  ? (a, b) => {
                      const diff = (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2);
                      return sortDir === "asc" ? diff : -diff;
                    }
                  : () => 0
                )
                .map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    tenantSlug={tenantSlug!}
                    onEdit={() => setEditingJob(job)}
                  />
                ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-2">{page + 1} / {totalPages}</span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <JobEditDialog
        open={!!editingJob}
        job={editingJob}
        onClose={() => setEditingJob(null)}
        onSaved={() => { setEditingJob(null); void load(); }}
      />
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function JobRow({
  job, tenantSlug, onEdit,
}: { job: JobWithRelations; tenantSlug: string; onEdit: () => void }) {
  const isUnassigned = job.status === "unassigned";

  return (
    <tr className="border-t hover:bg-muted/30 transition-colors group">
      <td className="px-4 py-3 font-medium">
        {job.customers?.name ?? <span className="text-muted-foreground">—</span>}
        {job.customers?.phone && (
          <div className="text-xs text-muted-foreground font-normal">{job.customers.phone}</div>
        )}
      </td>

      <td className="px-4 py-3 text-muted-foreground capitalize">
        {jobTypeLabel(job.job_type)}
      </td>

      <td className="px-4 py-3">
        <Badge variant="outline" className={`text-xs border ${jobStatusColor(job.status)}`}>
          {jobStatusLabel(job.status)}
        </Badge>
      </td>

      <td className="px-4 py-3">
        {job.priority && job.priority !== "normal" ? (
          <span
            className={
              job.priority === "emergency" ? "text-red-600 font-semibold text-xs" :
              job.priority === "high"      ? "text-amber-600 font-semibold text-xs" :
              "text-xs text-muted-foreground"
            }
          >
            {job.priority}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">normal</span>
        )}
      </td>

      <td className="px-4 py-3">
        {job.technicians?.name ?? (
          <span className="text-amber-600 text-xs font-medium">Unassigned</span>
        )}
      </td>

      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
        {job.scheduled_start
          ? format(new Date(job.scheduled_start), "MMM d, h:mm a")
          : <span className="text-xs">Not scheduled</span>}
      </td>

      <td className="px-4 py-3 text-muted-foreground text-xs">
        {job.service_locations
          ? `${job.service_locations.address ?? ""}${job.service_locations.city ? `, ${job.service_locations.city}` : ""}`
          : "—"}
      </td>

      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={onEdit}
            title="Edit job"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {isUnassigned ? (
            <Button size="sm" variant="default" className="h-7 text-xs gap-1" asChild>
              <Link to={`/${tenantSlug}/dispatch`}>
                Dispatch <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              asChild
            >
              <Link to={`/${tenantSlug}/customers/${job.customer_id}`}>
                View customer
              </Link>
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
