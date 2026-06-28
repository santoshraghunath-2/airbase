// Full interactive Gantt dispatch view.
// Drag unassigned jobs onto a tech row to assign + schedule simultaneously.
// Drag existing job blocks to reschedule or reassign.

import { useRef, useState, useEffect } from "react";
import {
  DndContext, DragEndEvent, DragOverEvent, DragStartEvent,
  DragOverlay, useSensor, useSensors, PointerSensor,
  useDroppable, useDraggable,
} from "@dnd-kit/core";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { jobTypeLabel } from "@/lib/utils";
import type { JobWithRelations, Technician } from "@/types/database.types";

// ─── Grid constants ────────────────────────────────────────────────────────────

const GRID_START  = 6 * 60;               // 6 AM in minutes-from-midnight
const GRID_END    = 21 * 60;              // 9 PM
const TOTAL_MINS  = GRID_END - GRID_START; // 900 minutes
const PX_PER_MIN  = 2;                    // 2 px per minute → 1 800 px wide
const GRID_W      = TOTAL_MINS * PX_PER_MIN;
const TECH_COL_W  = 172;                  // left name column width (px)
const ROW_H       = 72;                   // height of each tech row (px)
const HEADER_H    = 40;                   // time-header height (px)
const UNASSIGNED_H = 72;                  // unassigned bar height (px)
const SNAP        = 15;                   // snap-to-slot granularity (minutes)
const MIN_BLOCK_W = 36;                   // min rendered width of a job block (px)

// ─── Math helpers ──────────────────────────────────────────────────────────────

function snap(m: number) { return Math.round(m / SNAP) * SNAP; }
function clamp(m: number) { return Math.max(GRID_START, Math.min(GRID_END - SNAP, m)); }
function toX(m: number)   { return (m - GRID_START) * PX_PER_MIN; }
function toM(x: number)   { return GRID_START + x / PX_PER_MIN; }

function minsToDate(mins: number, base: Date): Date {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(mins);
  return d;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface DragItem {
  jobId:     string;
  fromTech:  string | null;
  durMins:   number;
  startMins: number | null;
}

interface Preview {
  techId:    string;
  startMins: number;
  durMins:   number;
}

// ─── Status → color ────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  dispatched:  "bg-blue-100  border-blue-400  text-blue-900",
  en_route:    "bg-violet-100 border-violet-400 text-violet-900",
  arrived:     "bg-indigo-100 border-indigo-400 text-indigo-900",
  in_progress: "bg-amber-100  border-amber-400  text-amber-900",
  completed:   "bg-green-100  border-green-400  text-green-900",
};

const PRIORITY_CHIP: Record<string, string> = {
  emergency: "bg-red-500",
  high:      "bg-amber-500",
};

// ─── Main component ────────────────────────────────────────────────────────────

interface Props {
  date:         Date;
  jobs:         JobWithRelations[];
  technicians:  Technician[];
  onRefresh:    () => void;
}

export default function DispatchGanttView({ date, jobs, technicians, onRefresh }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const scrollRef     = useRef<HTMLDivElement>(null);
  const pointerXRef   = useRef(0);

  // Refs used in the pointermove handler (avoid stale closures)
  const dragItemRef   = useRef<DragItem | null>(null);
  const overTechRef   = useRef<string | null>(null);

  // State for rendering
  const [dragItem,    setDragItem]    = useState<DragItem | null>(null);
  const [dropPreview, setDropPreview] = useState<Preview | null>(null);

  // Track pointer X continuously — used at drag-end to compute drop time
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointerXRef.current = e.clientX;
      if (!dragItemRef.current || !overTechRef.current || !scrollRef.current) return;
      const rect     = scrollRef.current.getBoundingClientRect();
      const scrollLeft = scrollRef.current.scrollLeft;
      const relX     = e.clientX - rect.left + scrollLeft - TECH_COL_W;
      const mins     = clamp(snap(toM(relX)));
      setDropPreview({
        techId:    overTechRef.current,
        startMins: mins,
        durMins:   dragItemRef.current.durMins,
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // ── Drag handlers ────────────────────────────────────────────────────────────

  function handleDragStart({ active }: DragStartEvent) {
    const job = jobs.find(j => j.id === active.id);
    if (!job) return;
    const item: DragItem = {
      jobId:     job.id,
      fromTech:  job.tech_id ?? null,
      durMins:   job.estimated_duration_minutes ?? 60,
      startMins: job.scheduled_start
        ? new Date(job.scheduled_start).getHours() * 60 + new Date(job.scheduled_start).getMinutes()
        : null,
    };
    dragItemRef.current = item;
    setDragItem(item);
    overTechRef.current = null;
    setDropPreview(null);
  }

  function handleDragOver({ over }: DragOverEvent) {
    const id = over?.id as string | undefined;
    const techId = id && id !== "unassigned-bar" ? id : null;
    overTechRef.current = techId;
    if (!techId) setDropPreview(null);
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    dragItemRef.current = null;
    overTechRef.current = null;
    setDragItem(null);
    setDropPreview(null);

    // Dropped onto unassigned bar or outside — unassign the job
    if (!over) return;

    const overId = over.id as string;
    const jobId  = active.id as string;
    const job    = jobs.find(j => j.id === jobId);
    if (!job) return;

    if (overId === "unassigned-bar") {
      // Move back to unassigned
      if (job.status === "unassigned" && !job.tech_id) return;
      const { error } = await supabase
        .from("jobs")
        .update({ tech_id: null, status: "unassigned", scheduled_start: null, scheduled_end: null })
        .eq("id", jobId);
      if (error) toast.error("Failed to unassign job");
      else { toast("Job moved to unassigned"); onRefresh(); }
      return;
    }

    // Dropped onto a tech row — compute time from pointer position
    const techId = overId;
    if (!scrollRef.current) return;
    const rect       = scrollRef.current.getBoundingClientRect();
    const scrollLeft = scrollRef.current.scrollLeft;
    const relX       = pointerXRef.current - rect.left + scrollLeft - TECH_COL_W;
    const startMins  = clamp(snap(toM(relX)));
    const durMins    = job.estimated_duration_minutes ?? 60;

    const scheduledStart = minsToDate(startMins, date).toISOString();
    const scheduledEnd   = minsToDate(startMins + durMins, date).toISOString();

    try {
      const { error } = await supabase
        .from("jobs")
        .update({
          tech_id:         techId,
          status:          job.status === "unassigned" || !job.tech_id ? "dispatched" : job.status,
          scheduled_start: scheduledStart,
          scheduled_end:   scheduledEnd,
        })
        .eq("id", jobId);
      if (error) throw error;
      toast.success(`Scheduled for ${format(minsToDate(startMins, date), "h:mm a")}`);
      onRefresh();
    } catch (e) {
      toast.error("Failed to schedule job", { description: (e as Error).message });
    }
  }

  // ── Derived data ──────────────────────────────────────────────────────────────

  const unassigned = jobs.filter(j => !j.tech_id || j.status === "unassigned");
  const assigned   = jobs.filter(j => j.tech_id && j.status !== "unassigned" && j.scheduled_start);

  // "Now" line — only shown when viewing today
  const todayStr   = new Date().toDateString();
  const isToday    = date.toDateString() === todayStr;
  const nowMins    = new Date().getHours() * 60 + new Date().getMinutes();
  const nowX       = isToday && nowMins >= GRID_START && nowMins <= GRID_END
    ? toX(nowMins) : null;

  const activeJob = dragItem ? jobs.find(j => j.id === dragItem.jobId) : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col h-full overflow-hidden select-none">

        {/* ── Unassigned bar ──────────────────────────────────────────────── */}
        <UnassignedBar jobs={unassigned} />

        {/* ── Scrollable time grid ─────────────────────────────────────────── */}
        <div ref={scrollRef} className="flex-1 overflow-auto">
          <div style={{ width: TECH_COL_W + GRID_W }} className="relative">

            {/* Time header */}
            <div
              className="flex sticky top-0 z-20 bg-background border-b shadow-sm"
              style={{ height: HEADER_H }}
            >
              <div
                className="sticky left-0 z-30 bg-muted/60 border-r flex items-center px-3 flex-shrink-0"
                style={{ width: TECH_COL_W }}
              >
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Tech</span>
              </div>
              <div className="relative flex-shrink-0" style={{ width: GRID_W }}>
                {Array.from({ length: 16 }, (_, i) => {
                  const hour = GRID_START / 60 + i;
                  if (hour > GRID_END / 60) return null;
                  const label = hour === 12 ? "12 PM"
                    : hour < 12 ? `${hour} AM`
                    : `${hour - 12} PM`;
                  return (
                    <span
                      key={hour}
                      className="absolute top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
                      style={{ left: toX(hour * 60) + 4 }}
                    >
                      {label}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Tech rows */}
            {technicians.map((tech, idx) => (
              <GanttRow
                key={tech.id}
                tech={tech}
                jobs={assigned.filter(j => j.tech_id === tech.id)}
                preview={dropPreview?.techId === tech.id ? dropPreview : null}
                isEven={idx % 2 === 0}
                nowX={nowX}
                date={date}
              />
            ))}

            {/* Empty state */}
            {technicians.length === 0 && (
              <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                No active technicians found.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay dropAnimation={null}>
        {activeJob && (
          <div className="rounded-md border bg-blue-600 text-white text-xs px-2.5 py-1.5 shadow-xl pointer-events-none whitespace-nowrap opacity-90">
            <p className="font-semibold">{activeJob.customers?.name ?? "Job"}</p>
            <p className="opacity-80">{jobTypeLabel(activeJob.job_type)}</p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ─── Unassigned bar ────────────────────────────────────────────────────────────

function UnassignedBar({ jobs }: { jobs: JobWithRelations[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: "unassigned-bar" });
  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 border-b flex items-center gap-3 px-4 overflow-x-auto transition-colors ${
        isOver ? "bg-amber-100" : "bg-amber-50/70"
      }`}
      style={{ minHeight: UNASSIGNED_H }}
    >
      <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide flex-shrink-0">
        Unassigned&nbsp;({jobs.length})
      </span>
      {jobs.length === 0
        ? <span className="text-xs text-muted-foreground italic">All jobs scheduled</span>
        : jobs.map(j => <UnassignedChip key={j.id} job={j} />)
      }
    </div>
  );
}

function UnassignedChip({ job }: { job: JobWithRelations }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: job.id });
  const border = job.priority === "emergency"
    ? "border-red-400 bg-red-50"
    : job.priority === "high"
    ? "border-amber-400 bg-amber-50"
    : "border-slate-200 bg-white";

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex-shrink-0 rounded-lg border px-3 py-2 cursor-grab active:cursor-grabbing shadow-sm transition-opacity ${border} ${
        isDragging ? "opacity-25" : "opacity-100 hover:shadow-md"
      }`}
    >
      <p className="text-xs font-semibold leading-tight">{job.customers?.name ?? "—"}</p>
      <p className="text-xs text-muted-foreground leading-tight mt-0.5">{jobTypeLabel(job.job_type)}</p>
      {job.scheduled_start && (
        <p className="text-xs text-blue-600 leading-tight mt-0.5">
          {format(new Date(job.scheduled_start), "h:mm a")}
        </p>
      )}
    </div>
  );
}

// ─── Tech row ──────────────────────────────────────────────────────────────────

interface RowProps {
  tech:    Technician;
  jobs:    JobWithRelations[];
  preview: Preview | null;
  isEven:  boolean;
  nowX:    number | null;
  date:    Date;
}

function GanttRow({ tech, jobs, preview, isEven, nowX, date }: RowProps) {
  const { setNodeRef, isOver } = useDroppable({ id: tech.id });

  const rowBg  = isOver ? "bg-blue-50/80"  : isEven ? "bg-background" : "bg-slate-50/60";
  const nameBg = isOver ? "bg-blue-50/80"  : isEven ? "var(--background)" : "rgb(248,250,252,0.7)";

  return (
    <div className={`flex border-b transition-colors ${rowBg}`} style={{ height: ROW_H }}>

      {/* Sticky tech name */}
      <div
        className="sticky left-0 z-10 border-r flex items-center gap-2.5 px-3 flex-shrink-0"
        style={{ width: TECH_COL_W, background: nameBg }}
      >
        <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-700 flex-shrink-0">
          {tech.name.split(" ").map(n => n[0] ?? "").join("").slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold truncate">{tech.name}</p>
          <p className="text-xs text-muted-foreground">{jobs.length} job{jobs.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {/* Time grid */}
      <div
        ref={setNodeRef}
        className="relative flex-shrink-0"
        style={{ width: GRID_W, height: ROW_H }}
      >
        {/* Hour grid lines */}
        {Array.from({ length: 16 }, (_, i) => (
          <div
            key={i}
            className="absolute inset-y-0 border-l border-border/30"
            style={{ left: i * 60 * PX_PER_MIN }}
          />
        ))}
        {/* 30-min sub-lines */}
        {Array.from({ length: 30 }, (_, i) => (
          i % 2 === 1 ? (
            <div
              key={`half-${i}`}
              className="absolute inset-y-0 border-l border-border/15"
              style={{ left: i * 30 * PX_PER_MIN }}
            />
          ) : null
        ))}

        {/* "Now" indicator */}
        {nowX !== null && (
          <div
            className="absolute inset-y-0 w-0.5 bg-red-500 z-20 pointer-events-none"
            style={{ left: nowX }}
          />
        )}

        {/* Job blocks */}
        {jobs.map(job => (
          <GanttBlock key={job.id} job={job} />
        ))}

        {/* Drop ghost preview */}
        {preview && (
          <div
            className="absolute rounded border-2 border-dashed border-blue-500 bg-blue-100/60 z-30 pointer-events-none flex items-center px-2 gap-1"
            style={{
              left:   toX(preview.startMins),
              width:  Math.max(preview.durMins * PX_PER_MIN, MIN_BLOCK_W),
              top:    6,
              bottom: 6,
            }}
          >
            <span className="text-xs font-semibold text-blue-800 whitespace-nowrap">
              {format(minsToDate(preview.startMins, date), "h:mm a")}
            </span>
            <span className="text-xs text-blue-600 whitespace-nowrap">
              – {format(minsToDate(preview.startMins + preview.durMins, date), "h:mm a")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Job block ─────────────────────────────────────────────────────────────────

function GanttBlock({ job }: { job: JobWithRelations }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: job.id });

  if (!job.scheduled_start) return null;

  const startDate = new Date(job.scheduled_start);
  const startMins = startDate.getHours() * 60 + startDate.getMinutes();
  const durMins   = job.estimated_duration_minutes ?? 60;
  const endMins   = startMins + durMins;

  if (startMins >= GRID_END || endMins <= GRID_START) return null;

  const visStart  = Math.max(startMins, GRID_START);
  const visEnd    = Math.min(endMins,   GRID_END);
  const leftPx    = toX(visStart);
  const widthPx   = Math.max((visEnd - visStart) * PX_PER_MIN, MIN_BLOCK_W);

  const colors    = STATUS_COLOR[job.status] ?? "bg-slate-100 border-slate-300 text-slate-900";
  const dotColor  = PRIORITY_CHIP[job.priority ?? ""] ?? "";

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`absolute rounded border cursor-grab active:cursor-grabbing overflow-hidden transition-opacity ${colors} ${
        isDragging ? "opacity-25 z-10" : "opacity-100 hover:brightness-95 hover:shadow-sm z-10"
      }`}
      style={{ left: leftPx, width: widthPx, top: 6, bottom: 6 }}
      title={`${job.customers?.name} · ${jobTypeLabel(job.job_type)} · ${format(startDate, "h:mm a")} (${durMins} min)`}
    >
      <div className="px-1.5 py-1 h-full flex flex-col justify-center">
        <div className="flex items-center gap-1">
          {dotColor && <div className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${dotColor}`} />}
          <p className="text-xs font-semibold leading-tight truncate">{job.customers?.name ?? "—"}</p>
        </div>
        {widthPx > 72 && (
          <p className="text-xs opacity-70 leading-tight truncate mt-0.5">
            {jobTypeLabel(job.job_type)}
          </p>
        )}
        {widthPx > 120 && (
          <p className="text-xs opacity-60 leading-tight mt-0.5">
            {format(startDate, "h:mm")}–{format(new Date(startDate.getTime() + durMins * 60000), "h:mm a")}
          </p>
        )}
      </div>
    </div>
  );
}
