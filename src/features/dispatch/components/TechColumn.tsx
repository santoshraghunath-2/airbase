import { useDroppable } from "@dnd-kit/core";
import { cn, initials } from "@/lib/utils";
import JobCard from "./JobCard";
import type { JobWithRelations } from "@/types/database.types";

interface Props {
  techId: string;
  techName: string;
  jobs: JobWithRelations[];
  isUnassigned?: boolean;
}

export default function TechColumn({ techId, techName, jobs, isUnassigned }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: techId });

  return (
    <div className="flex flex-col min-w-[270px] max-w-[270px] border-r bg-slate-50/50 dark:bg-slate-900/20">
      {/* Column header */}
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-3 border-b sticky top-0 bg-background z-10",
          isUnassigned && "bg-amber-50"
        )}
      >
        {!isUnassigned && (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white text-xs font-bold flex-shrink-0">
            {initials(techName)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className={cn("font-semibold text-sm truncate", isUnassigned && "text-amber-700")}>
            {techName}
          </p>
          <p className="text-xs text-muted-foreground">
            {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
          </p>
        </div>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 p-3 space-y-2 min-h-[200px] transition-colors",
          isOver && "bg-blue-50 ring-2 ring-inset ring-blue-200"
        )}
      >
        {jobs.length === 0 && (
          <div className="flex items-center justify-center h-20 rounded-lg border-2 border-dashed border-muted text-xs text-muted-foreground">
            Drop job here
          </div>
        )}
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
    </div>
  );
}
