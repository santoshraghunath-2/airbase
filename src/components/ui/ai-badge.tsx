import { cn } from "@/lib/utils";

export type AIDecisionState = "proposed" | "approved" | "auto" | "flagged" | "reversed";

interface AIBadgeProps {
  state: AIDecisionState;
  confidence?: number;
  label?: string;
  className?: string;
}

const STATE_CONFIG: Record<AIDecisionState, {
  bg: string; text: string; border: string; glyph: string; defaultLabel: string;
}> = {
  proposed: {
    bg: "bg-ai-chip-bg", text: "text-ai-ink", border: "border-ai-tint-border",
    glyph: "✦", defaultLabel: "AI",
  },
  approved: {
    bg: "bg-confirmed-bg", text: "text-confirmed-text", border: "border-confirmed-border",
    glyph: "✓", defaultLabel: "Confirmed",
  },
  auto: {
    bg: "bg-ai", text: "text-white", border: "border-transparent",
    glyph: "✦", defaultLabel: "Auto",
  },
  flagged: {
    bg: "bg-waiting-bg", text: "text-waiting-text", border: "border-waiting-border",
    glyph: "⚠", defaultLabel: "Review",
  },
  reversed: {
    bg: "bg-muted", text: "text-muted-foreground", border: "border-border",
    glyph: "↩", defaultLabel: "Reversed",
  },
};

export function AIBadge({ state, confidence, label, className }: AIBadgeProps) {
  const cfg = STATE_CONFIG[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-semibold border tabular-nums leading-none",
        cfg.bg, cfg.text, cfg.border,
        className,
      )}
    >
      <span className="text-[10px]">{cfg.glyph}</span>
      {label ?? cfg.defaultLabel}
      {confidence !== undefined && state !== "approved" && state !== "reversed" && (
        <span className="opacity-70">· {confidence}%</span>
      )}
    </span>
  );
}

/* Inline AI provenance tag — smaller, used inside table rows */
export function AIProvenanceTag({
  label = "AI suggested",
  confidence,
  className,
}: {
  label?: string;
  confidence?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-[10px] font-medium",
        "bg-ai-chip-bg text-ai-ink border border-ai-tint-border tabular-nums",
        className,
      )}
    >
      <span>✦</span>
      {label}
      {confidence !== undefined && <span className="opacity-70">· {confidence}%</span>}
    </span>
  );
}
