import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { format } from "date-fns";
import { BadgeCheck } from "lucide-react";
import { cn, jobStatusColor, jobStatusLabel, priorityColor, jobTypeLabel } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { JobWithRelations } from "@/types/database.types";

interface Props {
  job: JobWithRelations;
}

export default function JobCard({ job }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: job.id,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "rounded-lg border bg-white p-3 shadow-sm cursor-grab select-none space-y-2 transition-shadow",
        isDragging && "opacity-50 shadow-lg",
        job.priority === "emergency" && "border-red-300 bg-red-50/50",
        job.priority === "high" && "border-orange-200"
      )}
    >
      {/* Priority dot + job type + member indicator */}
      <div className="flex items-center gap-2">
        <span
          className={cn("h-2 w-2 rounded-full flex-shrink-0", priorityColor(job.priority))}
        />
        <span className="text-xs font-semibold text-foreground truncate flex-1">
          {jobTypeLabel(job.job_type)}
        </span>
        {job.membership_id && (
          <BadgeCheck className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" aria-label="Membership customer" />
        )}
      </div>

      {/* Customer name */}
      <p className="text-sm font-medium truncate">{job.customers?.name ?? "—"}</p>

      {/* Address */}
      {job.service_locations && (
        <p className="text-xs text-muted-foreground truncate">
          {job.service_locations.address}, {job.service_locations.city}
        </p>
      )}

      {/* Time + status */}
      <div className="flex items-center justify-between gap-2">
        {job.scheduled_start ? (
          <span className="text-xs text-muted-foreground">
            {format(new Date(job.scheduled_start), "h:mm a")}
          </span>
        ) : (
          <span className="text-xs text-amber-600">No time set</span>
        )}
        <Badge className={cn("text-xs border", jobStatusColor(job.status))} variant="outline">
          {jobStatusLabel(job.status)}
        </Badge>
      </div>
    </div>
  );
}
