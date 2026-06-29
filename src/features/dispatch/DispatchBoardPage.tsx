import { useEffect, useRef, useState } from "react";
import {
  DndContext, DragEndEvent, closestCenter,
  DragOverlay, DragStartEvent, useSensor, useSensors, PointerSensor,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { format, startOfDay, endOfDay, addDays, subDays } from "date-fns";
import { ChevronLeft, ChevronRight, LayoutGrid, GanttChartSquare } from "lucide-react";
import { supabase, realtimeClient } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import TechColumn from "./components/TechColumn";
import JobCardOverlay from "./components/JobCardOverlay";
import DispatchAIPanel from "./components/DispatchAIPanel";
import DispatchGanttView from "./components/DispatchGanttView";
import type { JobWithRelations, Technician } from "@/types/database.types";

type ViewMode = "columns" | "gantt";

export default function DispatchBoardPage() {
  const { tenant } = useAuth();
  const [date, setDate]   = useState(new Date());
  const [view, setView]   = useState<ViewMode>("gantt");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [jobs, setJobs]               = useState<JobWithRelations[]>([]);
  const [loading, setLoading]         = useState(true);
  const [activeJob, setActiveJob]     = useState<JobWithRelations | null>(null);
  const [aiPlacedCount, setAiPlacedCount] = useState(0);
  const initialLoadDone               = useRef(false);

  useEffect(() => {
    if (!tenant) return;
    initialLoadDone.current = false;
    void loadBoard();

    const channel = realtimeClient
      .channel("dispatch-board")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs", filter: `tenant_id=eq.${tenant.id}` },
        () => { void loadBoard(); }
      )
      .subscribe();

    return () => { void realtimeClient.removeChannel(channel); };
  }, [tenant, date]);

  async function loadBoard() {
    if (!tenant) return;
    if (!initialLoadDone.current) setLoading(true);
    try {
      const dayStart = startOfDay(date).toISOString();
      const dayEnd   = endOfDay(date).toISOString();

      const [techRes, jobsRes, aiRes] = await Promise.all([
        supabase
          .from("technicians")
          .select("*")
          .eq("tenant_id", tenant.id)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("jobs")
          .select("*, customers(id,name,phone), service_locations(id,address,city,state), technicians(id,name,phone)")
          .eq("tenant_id", tenant.id)
          .is("deleted_at", null)
          .not("status", "in", "(cancelled,no_show)")
          .or(`status.eq.unassigned,and(scheduled_start.gte.${dayStart},scheduled_start.lte.${dayEnd})`),
        supabase
          .from("agent_actions")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("action_type", "dispatch_job")
          .eq("status", "auto_executed")
          .gte("created_at", dayStart)
          .lte("created_at", dayEnd),
      ]);

      setTechnicians(techRes.data ?? []);
      setJobs((jobsRes.data ?? []) as JobWithRelations[]);
      setAiPlacedCount(aiRes.data?.length ?? 0);
      initialLoadDone.current = true;
    } finally {
      setLoading(false);
    }
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveJob(jobs.find((j) => j.id === event.active.id) ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveJob(null);
    const { active, over } = event;
    if (!over || over.id === "unassigned") return;

    const jobId  = active.id as string;
    const techId = over.id as string;
    const job    = jobs.find((j) => j.id === jobId);
    if (!job || job.tech_id === techId) return;

    setJobs((prev) =>
      prev.map((j) => j.id === jobId ? { ...j, tech_id: techId, status: "dispatched" } : j)
    );

    try {
      const { error } = await supabase
        .from("jobs").update({ tech_id: techId, status: "dispatched" }).eq("id", jobId);
      if (error) throw error;
      toast.success("Job dispatched");
    } catch {
      toast.error("Failed to dispatch job — reverting");
      void loadBoard();
    }
  }

  const unassignedJobs = jobs.filter((j) => !j.tech_id || j.status === "unassigned");
  const assignedJobCount = jobs.filter((j) => j.tech_id && j.status !== "unassigned").length;

  return (
    <div className="flex flex-col h-full bg-bone">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-line bg-paper flex-shrink-0">
        <h1 className="text-[15px] font-semibold text-ink">Dispatch</h1>

        {/* Date navigation */}
        <div className="flex items-center gap-1 ml-3">
          <button
            className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-panel-warm text-ink-muted hover:text-ink transition-colors"
            onClick={() => setDate((d) => subDays(d, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium min-w-[148px] text-center tabular-nums text-ink">
            {format(date, "EEE, MMM d, yyyy")}
          </span>
          <button
            className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-panel-warm text-ink-muted hover:text-ink transition-colors"
            onClick={() => setDate((d) => addDays(d, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            className="h-8 px-3 rounded-lg border border-line bg-raised text-xs font-medium text-ink-2 hover:bg-panel-warm transition-colors ml-1"
            onClick={() => setDate(new Date())}
          >
            Today
          </button>
        </div>

        {/* AI placed pill */}
        {!loading && aiPlacedCount > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-ai-chip-bg border border-ai-tint-border text-ai-ink text-xs font-medium">
            <span className="text-[10px]">✦</span>
            AI placed {aiPlacedCount} of {assignedJobCount + aiPlacedCount} today
          </div>
        )}

        {/* View segmented control */}
        <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-line bg-bone p-0.5">
          {(["columns", "gantt"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                view === v
                  ? "bg-paper text-ink shadow-sm border border-line"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {v === "columns" ? <LayoutGrid className="h-3.5 w-3.5" /> : <GanttChartSquare className="h-3.5 w-3.5" />}
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* AI suggestions panel */}
      {!loading && (
        <DispatchAIPanel jobs={jobs} onAssigned={() => void loadBoard()} />
      )}

      {/* Board */}
      {loading ? (
        <div className="flex gap-4 p-6 overflow-x-auto flex-1">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="min-w-[260px] space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ))}
        </div>
      ) : view === "gantt" ? (
        <DispatchGanttView
          date={date}
          jobs={jobs}
          technicians={technicians}
          onRefresh={() => void loadBoard()}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-0 flex-1 overflow-x-auto">
            <TechColumn techId="unassigned" techName="Unassigned" jobs={unassignedJobs} isUnassigned />
            {technicians.map((tech) => (
              <TechColumn
                key={tech.id}
                techId={tech.id}
                techName={tech.name}
                jobs={jobs.filter((j) => j.tech_id === tech.id && j.status !== "unassigned")}
              />
            ))}
          </div>
          <DragOverlay>
            {activeJob && <JobCardOverlay job={activeJob} />}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
