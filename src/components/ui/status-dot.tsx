import { cn } from "@/lib/utils";

const DOT_COLORS: Record<string, string> = {
  unassigned:  "bg-waiting-dot",
  scheduled:   "bg-[#8A7F9E]",
  dispatched:  "bg-[#8A7F9E]",
  en_route:    "bg-[#7C8A66]",
  arrived:     "bg-confirmed-dot",
  in_progress: "bg-confirmed-dot",
  on_site:     "bg-confirmed-dot",
  completed:   "bg-ink",
  invoiced:    "bg-ink-muted",
  cancelled:   "bg-line",
  no_show:     "bg-blocked-dot",
};

interface StatusDotProps {
  status: string;
  size?: "sm" | "md";
  className?: string;
}

export function StatusDot({ status, size = "sm", className }: StatusDotProps) {
  const color = DOT_COLORS[status] ?? "bg-line";
  const dim   = size === "md" ? "h-2.5 w-2.5" : "h-2 w-2";
  const isPulsing = status === "in_progress" || status === "on_site" || status === "arrived";

  if (isPulsing) {
    return (
      <span className={cn("relative inline-flex", dim, className)}>
        <span
          className={cn(
            "absolute inset-0 rounded-full opacity-75",
            color,
            "[animation:abpulse_2.4s_ease-in-out_infinite]",
          )}
        />
        <span className={cn("relative inline-flex rounded-full", dim, color)} />
      </span>
    );
  }

  return <span className={cn("inline-flex rounded-full", dim, color, className)} />;
}
