import { useEffect, useState } from "react";
import { DndContext, DragEndEvent, closestCenter, DragOverlay, DragStartEvent } from "@dnd-kit/core";
import { toast } from "sonner";
import { format, startOfDay, endOfDay, addDays, subDays } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase, realtimeClient } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import TechColumn from "./components/TechColumn";
import JobCardOverlay from "./components/JobCardOverlay";
import type { JobWithRelations, Technician } from "@/types/database.types";

export default function DispatchBoardPage() {
  const { tenant } = useAuth();
  const [date, setDate] = useState(new Date());
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [jobs, setJobs] = useState<JobWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeJob, setActiveJob] = useState<JobWithRelations | null>(null);

  useEffect(() => {
    if (!tenant) return;
    void loadBoard();

    // Real-time subscription for job updates
    const channel = realtimeClient
      .channel("dispatch-board")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "jobs",
          filter: `tenant_id=eq.${tenant.id}`,
        },
        () => { void loadBoard(); }
      )
      .subscribe();

    return () => { void realtimeClient.removeChannel(channel); };
  }, [tenant, date]);

  async function loadBoard() {
    if (!tenant) return;
    setLoading(true);
    try {
      const dayStart = startOfDay(date).toISOString();
      const dayEnd = endOfDay(date).toISOString();

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
          .or(`scheduled_start.is.null,and(scheduled_start.gte.${dayStart},scheduled_start.lte.${dayEnd})`),
      ]);

      setTechnicians(techRes.data ?? []);
      setJobs((jobsRes.data ?? []) as JobWithRelations[]);
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
    if (!over) return;

    const jobId = active.id as string;
    const techId = over.id as string;

    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    if (job.tech_id === techId) return;

    // Optimistic update
    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId
          ? { ...j, tech_id: techId, status: "dispatched" }
          : j
      )
    );

    try {
      const { error } = await supabase.functions.invoke("dispatch-job", {
        body: { job_id: jobId, tech_id: techId },
      });
      if (error) throw error;
      toast.success("Job dispatched");
    } catch (err) {
      toast.error("Failed to dispatch job — reverting");
      void loadBoard();
    }
  }

  const unassignedJobs = jobs.filter((j) => !j.tech_id || j.status === "unassigned");

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-4 px-6 py-4 border-b bg-background">
        <h1 className="text-xl font-bold">Dispatch Board</h1>
        <div className="flex items-center gap-2 ml-auto">
          <Button variant="outline" size="icon" onClick={() => setDate((d) => subDays(d, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[140px] text-center">
            {format(date, "EEE, MMM d, yyyy")}
          </span>
          <Button variant="outline" size="icon" onClick={() => setDate((d) => addDays(d, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDate(new Date())}>
            Today
          </Button>
        </div>
      </div>

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
      ) : (
        <DndContext
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-0 flex-1 overflow-x-auto">
            {/* Unassigned column */}
            <TechColumn
              techId="unassigned"
              techName="Unassigned"
              jobs={unassignedJobs}
              isUnassigned
            />

            {/* Tech columns */}
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
