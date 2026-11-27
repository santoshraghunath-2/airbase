import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface KPIs {
  total_jobs:     number;
  total_revenue:  number;
  total_cost:     number;
  gross_profit:   number;
  avg_margin_pct: number | null;
}

interface ReportRow {
  group_key:    string;
  job_count:    number;
  revenue:      number;
  parts_cost:   number;
  labor_cost:   number;
  gross_profit: number;
  margin_pct:   number | null;
}

interface ProjectProfRow {
  project_id:           string;
  project_name:         string;
  project_status:       string;
  contract_total_cents: number;
  collected_cents:      number;
  labor_cost_cents:     number;
  material_cost_cents:  number;
  other_cost_cents:     number;
  total_cost_cents:     number;
  gross_profit_cents:   number;
  margin_pct:           number | null;
}

type GroupBy = "tech" | "zone" | "job_type" | "customer";

// ─── Date range presets ───────────────────────────────────────────────────────

type Preset = "this_month" | "last_month" | "last_90" | "ytd" | "all_time";

function presetDates(preset: Preset): { start: string; end: string } {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const todayStr = fmt(today);

  if (preset === "this_month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: fmt(start), end: todayStr };
  }
  if (preset === "last_month") {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end   = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: fmt(start), end: fmt(end) };
  }
  if (preset === "last_90") {
    const start = new Date(today);
    start.setDate(today.getDate() - 90);
    return { start: fmt(start), end: todayStr };
  }
  if (preset === "ytd") {
    const start = new Date(today.getFullYear(), 0, 1);
    return { start: fmt(start), end: todayStr };
  }
  // all_time: go back 5 years
  const start = new Date(today.getFullYear() - 5, 0, 1);
  return { start: fmt(start), end: todayStr };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function marginColor(pct: number | null) {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 60) return "text-emerald-600 font-semibold";
  if (pct >= 35) return "text-amber-600 font-semibold";
  return "text-red-600 font-semibold";
}

function marginBg(pct: number | null) {
  if (pct === null) return "";
  if (pct >= 60) return "bg-emerald-50";
  if (pct >= 35) return "bg-amber-50";
  return "bg-red-50";
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper px-5 py-4">
      <p className="text-xs text-ink-muted font-medium">{label}</p>
      <p className="text-2xl font-bold text-ink mt-1">{value}</p>
      {sub && <p className="text-xs text-ink-muted mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Breakdown table ──────────────────────────────────────────────────────────

function BreakdownTable({ rows, loading }: { rows: ReportRow[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2 mt-4">
        {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-line p-10 text-center text-sm text-ink-muted">
        No jobs in this period.
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-raised text-xs text-ink-muted">
            <th className="text-left px-4 py-3 font-medium">Group</th>
            <th className="text-right px-4 py-3 font-medium">Jobs</th>
            <th className="text-right px-4 py-3 font-medium">Revenue</th>
            <th className="text-right px-4 py-3 font-medium">Cost</th>
            <th className="text-right px-4 py-3 font-medium">Gross profit</th>
            <th className="text-right px-4 py-3 font-medium">Margin</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.group_key}
              className={cn(
                "border-b border-line last:border-0",
                marginBg(row.margin_pct),
                i % 2 === 0 ? "" : "bg-raised/40",
              )}
            >
              <td className="px-4 py-3 font-medium text-ink">{row.group_key}</td>
              <td className="px-4 py-3 text-right text-ink-muted">{row.job_count}</td>
              <td className="px-4 py-3 text-right text-ink">{fmtCurrency(row.revenue)}</td>
              <td className="px-4 py-3 text-right text-ink-muted">
                {fmtCurrency((row.parts_cost ?? 0) + (row.labor_cost ?? 0))}
              </td>
              <td className="px-4 py-3 text-right text-ink">{fmtCurrency(row.gross_profit)}</td>
              <td className={cn("px-4 py-3 text-right", marginColor(row.margin_pct))}>
                {row.margin_pct !== null ? `${row.margin_pct}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProfitabilityPage() {
  const { tenant } = useAuth();
  const isRemodel = (tenant as { trade?: string } | null)?.trade === "remodel";

  const [preset, setPreset]     = useState<Preset>("this_month");
  const [kpis, setKpis]         = useState<KPIs | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [activeTab, setActiveTab]   = useState<GroupBy>("tech");
  const [rows, setRows]             = useState<ReportRow[]>([]);
  const [rowLoading, setRowLoading] = useState(false);
  const [projectRows, setProjectRows]       = useState<ProjectProfRow[]>([]);
  const [projectRowLoading, setProjectRowLoading] = useState(false);
  const [topTab, setTopTab] = useState<"jobs" | "projects">("jobs");

  const { start, end } = presetDates(preset);

  useEffect(() => {
    if (!tenant) return;
    void loadKPIs();
  }, [tenant, preset]);

  useEffect(() => {
    if (!tenant) return;
    void loadReport(activeTab);
  }, [tenant, preset, activeTab]);

  async function loadKPIs() {
    setKpiLoading(true);
    try {
      const { data, error } = await supabase
        .rpc("get_profitability_kpis", { p_start: start, p_end: end })
        .single();
      if (error) throw error;
      setKpis(data as KPIs);
    } catch {
      setKpis(null);
    } finally {
      setKpiLoading(false);
    }
  }

  async function loadReport(groupBy: GroupBy) {
    setRowLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_profitability_report", {
        p_start:    start,
        p_end:      end,
        p_group_by: groupBy,
      });
      if (error) throw error;
      setRows((data as ReportRow[]) ?? []);
    } catch {
      setRows([]);
    } finally {
      setRowLoading(false);
    }
  }

  async function loadProjectProfitability() {
    if (!isRemodel) return;
    setProjectRowLoading(true);
    try {
      const { data, error } = await supabase
        .from("project_profitability")
        .select("project_id, project_name, project_status, contract_total_cents, collected_cents, labor_cost_cents, material_cost_cents, other_cost_cents, total_cost_cents, gross_profit_cents, margin_pct")
        .order("contract_total_cents", { ascending: false });
      if (error) throw error;
      setProjectRows((data as ProjectProfRow[]) ?? []);
    } catch {
      setProjectRows([]);
    } finally {
      setProjectRowLoading(false);
    }
  }

  useEffect(() => {
    if (!tenant || !isRemodel) return;
    void loadProjectProfitability();
  }, [tenant, isRemodel]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Job Profitability</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Margin by tech, zone, job type, and customer
          </p>
        </div>
        <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="this_month">This month</SelectItem>
            <SelectItem value="last_month">Last month</SelectItem>
            <SelectItem value="last_90">Last 90 days</SelectItem>
            <SelectItem value="ytd">Year to date</SelectItem>
            <SelectItem value="all_time">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI cards */}
      {kpiLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : kpis ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KPICard label="Jobs"         value={String(kpis.total_jobs)} />
          <KPICard label="Revenue"      value={fmtCurrency(kpis.total_revenue)} />
          <KPICard label="Gross profit" value={fmtCurrency(kpis.gross_profit)}
            sub={`Cost: ${fmtCurrency(kpis.total_cost)}`} />
          <KPICard
            label="Avg margin"
            value={kpis.avg_margin_pct !== null ? `${kpis.avg_margin_pct}%` : "—"}
            sub={kpis.avg_margin_pct !== null
              ? kpis.avg_margin_pct >= 60 ? "Healthy" : kpis.avg_margin_pct >= 35 ? "Watch" : "Below target"
              : "No revenue yet"}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-line p-6 text-sm text-ink-muted">
          Could not load KPIs.
        </div>
      )}

      {/* Cost note */}
      {!kpiLoading && kpis && kpis.total_cost === 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          Cost data is $0 — set technician burden rates in Settings → Team and add costs to pricebook items to enable margin tracking.
        </div>
      )}

      {/* Top-level Jobs / Projects toggle (remodel tenants only) */}
      {isRemodel && (
        <Tabs value={topTab} onValueChange={(v) => setTopTab(v as "jobs" | "projects")}>
          <TabsList>
            <TabsTrigger value="jobs">Service jobs</TabsTrigger>
            <TabsTrigger value="projects">Remodel projects</TabsTrigger>
          </TabsList>

          <TabsContent value="jobs">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as GroupBy)}>
              <TabsList>
                <TabsTrigger value="tech">By Tech</TabsTrigger>
                <TabsTrigger value="zone">By Zone</TabsTrigger>
                <TabsTrigger value="job_type">By Job Type</TabsTrigger>
                <TabsTrigger value="customer">By Customer</TabsTrigger>
              </TabsList>
              {(["tech", "zone", "job_type", "customer"] as GroupBy[]).map((tab) => (
                <TabsContent key={tab} value={tab}>
                  <BreakdownTable rows={rows} loading={rowLoading} />
                </TabsContent>
              ))}
            </Tabs>
          </TabsContent>

          <TabsContent value="projects">
            {projectRowLoading ? (
              <div className="space-y-2 mt-4">
                {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
              </div>
            ) : projectRows.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-line p-10 text-center text-sm text-ink-muted">
                No project data yet.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-raised text-xs text-ink-muted">
                      <th className="text-left px-4 py-3 font-medium">Project</th>
                      <th className="text-right px-4 py-3 font-medium">Contract</th>
                      <th className="text-right px-4 py-3 font-medium">Collected</th>
                      <th className="text-right px-4 py-3 font-medium">Total cost</th>
                      <th className="text-right px-4 py-3 font-medium">Gross profit</th>
                      <th className="text-right px-4 py-3 font-medium">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectRows.map((row, i) => (
                      <tr key={row.project_id} className={cn("border-b border-line last:border-0", i % 2 === 0 ? "" : "bg-raised/40")}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-ink">{row.project_name}</p>
                          <p className="text-xs text-ink-muted capitalize">{row.project_status.replace("_", " ")}</p>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtCurrency(row.contract_total_cents / 100)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink-muted">{fmtCurrency(row.collected_cents / 100)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink-muted">{fmtCurrency(row.total_cost_cents / 100)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtCurrency(row.gross_profit_cents / 100)}</td>
                        <td className={cn("px-4 py-3 text-right", marginColor(row.margin_pct))}>
                          {row.margin_pct !== null ? `${row.margin_pct}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Field-service only breakdown (non-remodel tenants) */}
      {!isRemodel && (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as GroupBy)}>
          <TabsList>
            <TabsTrigger value="tech">By Tech</TabsTrigger>
            <TabsTrigger value="zone">By Zone</TabsTrigger>
            <TabsTrigger value="job_type">By Job Type</TabsTrigger>
            <TabsTrigger value="customer">By Customer</TabsTrigger>
          </TabsList>
          {(["tech", "zone", "job_type", "customer"] as GroupBy[]).map((tab) => (
            <TabsContent key={tab} value={tab}>
              <BreakdownTable rows={rows} loading={rowLoading} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
