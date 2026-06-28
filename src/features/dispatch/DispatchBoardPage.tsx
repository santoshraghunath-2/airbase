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
import { Button } from "@/components/ui/button";
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

  // Require 8px of movement before a drag activates — prevents plain clicks from firing DragEnd.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [jobs, setJobs]               = useState<JobWithRelations[]>([]);
  const [loading, setLoading]         = useState(true);
  const [activeJob, setActiveJob]     = useState<JobWithRelations | null>(null);
  const initialLoadDone               = useRef(false);

  useEffect(() => {
    if (!tenant) return;
    initialLoadDone.current = false; // show skeleton when date or tenant changes
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

      const [techRes, jobsRes] = await Promise.all([
        supabase
          .from("technicians")
          .select("*")
          .eq("tenant_id", tenant.id)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("jobs")
          .select("*, customers(id, name, phone), service_locations(id, address, city, state), technicians(id, name, phone)")
          .eq("tenant_id", tenant.id)
          .is("deleted_at", null)
          .not("status", "in", "(cancelled,no_show)")
          // Always show unassigned jobs regardless of date; show assigned jobs for the selected date only.
          .or(`status.eq.unassigned,and(scheduled_start.gte.${dayStart},scheduled_start.lte.${dayEnd})`),
      ]);

      setTechnicians(techRes.data ?? []);
      setJobs((jobsRes.data ?? []) as JobWithRelations[]);
      initialLoadDone.current = true;
    } finally {
      setLoading(false);
    }
  }

  function handleDragStart(event: DragStartEvent) {
    const job = jobs.find((j) => j.id === event.active.id);
    setActiveJob(job ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveJob(null);
    const { active, over } = event;
    if (!over || over.id === "unassigned") return;

    const jobId  = active.id as string;
    const techId = over.id as string;
    const job    = jobs.find((j) => j.id === jobId);
    if (!job) return;
    if (job.tech_id === techId) return;

    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId ? { ...j, tech_id: techId, status: "dispatched" } : j
      )
    );

    try {
      const { error } = await supabase
        .from("jobs")
        .update({ tech_id: techId, status: "dispatched" })
        .eq("id", jobId);
      if (error) throw error;
      toast.success("Job dispatched");
    } catch {
      toast.error("Failed to dispatch job — reverting");
      void loadBoard();
    }
  }

  const unassignedJobs = jobs.filter((j) => !j.tech_id || j.status === "unassigned");

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b bg-background">
        <h1 className="text-xl font-bold">Dispatch</h1>

        {/* Date navigation */}
        <div className="flex items-center gap-1 ml-4">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDate((d) => subDays(d, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[148px] text-center tabular-nums">
            {format(date, "EEE, MMM d, yyyy")}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDate((d) => addDays(d, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs ml-1" onClick={() => setDate(new Date())}>
            Today
          </Button>
        </div>

        {/* View toggle */}
        <div className="ml-auto flex items-center gap-0.5 rounded-lg border bg-muted p-0.5">
          <button
            onClick={() => setView("columns")}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              view === "columns"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Columns
          </button>
          <button
            onClick={() => setView("gantt")}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              view === "gantt"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <GanttChartSquare className="h-3.5 w-3.5" />
            Gantt
          </button>
        </div>
      </div>

      {/* AI suggestions panel — only shown when proposals exist */}
      {!loading && (
        <DispatchAIPanel jobs={jobs} onAssigned={() => void loadBoard()} />
      )}

      {/* Board content */}
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
            <TechColumn
              techId="unassigned"
              techName="Unassigned"
              jobs={unassignedJobs}
              isUnassigned
            />
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
