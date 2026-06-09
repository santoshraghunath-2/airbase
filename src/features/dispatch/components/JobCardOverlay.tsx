import { jobTypeLabel, priorityColor, cn } from "@/lib/utils";
import type { JobWithRelations } from "@/types/database.types";

export default function JobCardOverlay({ job }: { job: JobWithRelations }) {
  return (
    <div className="rounded-lg border-2 border-blue-400 bg-white p-3 shadow-xl w-[250px] rotate-2 cursor-grabbing">
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full flex-shrink-0", priorityColor(job.priority))} />
        <span className="text-xs font-semibold truncate">{jobTypeLabel(job.job_type)}</span>
      </div>
      <p className="text-sm font-medium mt-1 truncate">{job.customers?.name ?? "—"}</p>
    </div>
  );
}
