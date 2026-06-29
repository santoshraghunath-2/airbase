import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Columns3, FileText, Bell, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

type AgentKey = "booking" | "dispatch" | "invoice" | "followup";

interface AgentConfig {
  agent_type: AgentKey;
  autonomy_level: 0 | 1 | 2 | 3;        // 0–3 slider
  model_tier: "balanced" | "capable" | "fast"; // never expose real names
  auto_execute: boolean;
  confidence_threshold: number;          // derived from autonomy
}

// ─── Autonomy ladder ─────────────────────────────────────────────────────────

const AUTONOMY_STOPS: Array<{
  label: string;
  description: string;
  threshold: number;
  badgeVariant: "neutral" | "ai" | "confirmed";
}> = [
  {
    label: "Suggests only",
    description: "Drafts every action and waits for your approval. Nothing runs without a human.",
    threshold: 1.0,
    badgeVariant: "neutral",
  },
  {
    label: "Acts when sure",
    description: "Handles actions alone when very confident (~95%). Brings everything else to you.",
    threshold: 0.95,
    badgeVariant: "ai",
  },
  {
    label: "Acts when fairly sure",
    description: "Handles most cases alone (~85%). Flags uncertain calls for your review.",
    threshold: 0.85,
    badgeVariant: "ai",
  },
  {
    label: "Acts almost always",
    description: "Runs end-to-end (~70% threshold). Flags only unusual or risky situations.",
    threshold: 0.70,
    badgeVariant: "confirmed",
  },
];

const MODEL_TIERS: Array<{ value: AgentConfig["model_tier"]; label: string; sub: string }> = [
  { value: "balanced",  label: "Balanced",      sub: "Fast, reliable, great for most tasks" },
  { value: "capable",   label: "Most capable",  sub: "Best reasoning, slower response" },
  { value: "fast",      label: "Fastest",       sub: "Low latency, high volume — simpler tasks" },
];

// ─── Agent definitions ───────────────────────────────────────────────────────

interface AgentDef {
  key: AgentKey;
  name: string;
  role: string;
  icon: React.ReactNode;
  financialLock: boolean;
}

const AGENTS: AgentDef[] = [
  {
    key: "booking",
    name: "Booking agent",
    role: "Handles inbound SMS and voice calls — customer lookup, job classification, availability check, new job creation.",
    icon: <MessageSquare className="h-5 w-5" />,
    financialLock: false,
  },
  {
    key: "dispatch",
    name: "Dispatch agent",
    role: "Scores and suggests technician assignments using skills, location, and availability. Proposes the schedule for the day.",
    icon: <Columns3 className="h-5 w-5" />,
    financialLock: false,
  },
  {
    key: "invoice",
    name: "Invoice agent",
    role: "Generates and sends invoices when jobs close. Flags anomalies compared to job-type baselines before sending.",
    icon: <FileText className="h-5 w-5" />,
    financialLock: true,
  },
  {
    key: "followup",
    name: "Follow-up agent",
    role: "Sends ETA notifications, review requests, and warranty callback alerts via SMS at the right moment.",
    icon: <Bell className="h-5 w-5" />,
    financialLock: false,
  },
];

const DEFAULT_CONFIG: Record<AgentKey, AgentConfig> = {
  booking:  { agent_type: "booking",  autonomy_level: 2, model_tier: "fast",    auto_execute: true,  confidence_threshold: 0.85 },
  dispatch: { agent_type: "dispatch", autonomy_level: 1, model_tier: "balanced", auto_execute: false, confidence_threshold: 0.95 },
  invoice:  { agent_type: "invoice",  autonomy_level: 0, model_tier: "fast",    auto_execute: false, confidence_threshold: 1.0  },
  followup: { agent_type: "followup", autonomy_level: 2, model_tier: "fast",    auto_execute: true,  confidence_threshold: 0.85 },
};

// ─── Single agent card ───────────────────────────────────────────────────────

function AgentCard({ def, config, onChange }: {
  def: AgentDef;
  config: AgentConfig;
  onChange: (patch: Partial<AgentConfig>) => void;
}) {
  const stop = AUTONOMY_STOPS[config.autonomy_level];

  const badgeClass =
    stop.badgeVariant === "confirmed" ? "bg-confirmed-bg text-confirmed-text border-confirmed-border" :
    stop.badgeVariant === "ai"        ? "bg-ai-chip-bg text-ai-ink border-ai-tint-border" :
                                        "bg-muted text-muted-foreground border-border";

  return (
    <div className="rounded-xl border border-line bg-paper">
      {/* Card header */}
      <div className="flex items-start gap-4 px-6 py-5 border-b border-line-2">
        <div className="h-10 w-10 rounded-xl bg-panel-warm border border-line flex items-center justify-center text-ink-muted flex-shrink-0">
          {def.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-[15px] font-semibold text-ink">{def.name}</h3>
            <span className={cn("text-[11px] font-semibold border rounded-pill px-2 py-0.5", badgeClass)}>
              {stop.label}
            </span>
          </div>
          <p className="text-[13px] text-ink-muted leading-snug">{def.role}</p>
        </div>
      </div>

      {/* Autonomy slider */}
      <div className="px-6 py-5 border-b border-line-2">
        <div className="rounded-xl border border-line bg-raised px-5 py-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px] font-semibold text-ink">Autonomy level</p>
            <span className="text-xs text-ink-muted tabular-nums">{Math.round((1 - stop.threshold) * 100)}% threshold</span>
          </div>

          {/* Slider */}
          <div className="relative mb-5">
            <input
              type="range" min={0} max={3} step={1}
              value={config.autonomy_level}
              onChange={(e) => {
                const level = Number(e.target.value) as 0 | 1 | 2 | 3;
                onChange({ autonomy_level: level, confidence_threshold: AUTONOMY_STOPS[level].threshold });
              }}
              disabled={def.financialLock}
              className="w-full accent-ink cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            />
            {/* Stop labels */}
            <div className="flex justify-between mt-1.5">
              {AUTONOMY_STOPS.map((_s, i) => (
                <span key={i} className={cn(
                  "text-[10px] font-medium text-center",
                  config.autonomy_level === i ? "text-ink" : "text-ink-muted",
                )} style={{ width: "25%" }}>
                  {i === 0 ? "Suggests" : i === 3 ? "Acts always" : ""}
                </span>
              ))}
            </div>
          </div>

          {/* Stop description */}
          <p className="text-[13px] text-ink-2 leading-snug">{stop.description}</p>

          {/* Financial lock notice */}
          {def.financialLock && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-waiting-bg border border-waiting-border">
              <Lock className="h-3.5 w-3.5 text-waiting-text flex-shrink-0" />
              <p className="text-xs text-waiting-text">
                Always asks you before sending invoices. Financial actions require explicit human approval.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Thinking style */}
      <div className="px-6 py-5">
        <p className="text-[13px] font-semibold text-ink mb-3">Thinking style</p>
        <div className="flex gap-2">
          {MODEL_TIERS.map(({ value, label, sub }) => (
            <button
              key={value}
              onClick={() => onChange({ model_tier: value })}
              className={cn(
                "flex-1 text-left px-3 py-2.5 rounded-lg border text-[13px] transition-colors",
                config.model_tier === value
                  ? "border-ink bg-paper text-ink shadow-sm"
                  : "border-line bg-raised text-ink-muted hover:bg-paper hover:text-ink",
              )}
            >
              <p className="font-medium text-[12px]">{label}</p>
              <p className="text-[11px] text-ink-muted mt-0.5 leading-snug">{sub}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AISettingsPage() {
  const { tenant, user } = useAuth();
  const [configs, setConfigs] = useState<Record<AgentKey, AgentConfig>>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState<AgentKey | null>(null);

  useEffect(() => {
    if (!tenant) return;
    void (async () => {
      const { data } = await supabase
        .from("agent_config")
        .select("agent_type, autonomy_level, model_tier, auto_execute, confidence_threshold")
        .eq("tenant_id", tenant.id);

      if (data?.length) {
        const merged = { ...DEFAULT_CONFIG };
        for (const row of data) {
          const key = row.agent_type as AgentKey;
          if (key in merged) {
            merged[key] = {
              agent_type:           key,
              autonomy_level:       (row.autonomy_level ?? 1) as 0 | 1 | 2 | 3,
              model_tier:           (row.model_tier ?? "balanced") as AgentConfig["model_tier"],
              auto_execute:         row.auto_execute ?? false,
              confidence_threshold: row.confidence_threshold ?? 0.85,
            };
          }
        }
        setConfigs(merged);
      }
      setLoading(false);
    })();
  }, [tenant]);

  const handleChange = useCallback(async (key: AgentKey, patch: Partial<AgentConfig>) => {
    if (!tenant) return;
    const updated = { ...configs[key], ...patch };
    setConfigs((prev) => ({ ...prev, [key]: updated }));
    setSaving(key);
    try {
      const { error } = await supabase.from("agent_config").upsert({
        tenant_id:            tenant.id,
        agent_type:           key,
        autonomy_level:       updated.autonomy_level,
        model_tier:           updated.model_tier,
        auto_execute:         updated.auto_execute,
        confidence_threshold: updated.confidence_threshold,
      }, { onConflict: "tenant_id,agent_type" });
      if (error) throw error;
    } catch (err) {
      toast.error("Failed to save", { description: (err as Error).message });
      setConfigs((prev) => ({ ...prev, [key]: configs[key] }));
    } finally {
      setSaving(null);
    }
  }, [tenant, configs]);

  const isOwner = user?.role === "owner";

  return (
    <div className="min-h-full bg-bone">
      <div className="max-w-[880px] mx-auto px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-1.5 text-xs text-ink-muted mb-2">
            <span>Settings</span>
            <span>›</span>
            <span className="text-ink">AI Settings</span>
          </div>
          <h1 className="text-[22px] font-semibold text-ink">AI Settings</h1>
          <p className="text-sm text-ink-muted mt-1 max-w-lg">
            Control how much each agent acts on its own. Higher autonomy means fewer interruptions — lower means more human check-ins.
          </p>
          {!isOwner && (
            <p className="mt-2 text-xs text-waiting-text bg-waiting-bg border border-waiting-border rounded-lg px-3 py-2 inline-block">
              View only — owner access required to change AI settings.
            </p>
          )}
        </div>

        {loading ? (
          <div className="space-y-5">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-[260px] w-full rounded-xl" />)}
          </div>
        ) : (
          <div className="space-y-5">
            {AGENTS.map((def) => (
              <div key={def.key} className="relative">
                <AgentCard
                  def={def}
                  config={configs[def.key]}
                  onChange={(patch) => isOwner && handleChange(def.key, patch)}
                />
                {saving === def.key && (
                  <div className="absolute top-4 right-4 flex items-center gap-1.5 text-xs text-ink-muted">
                    <div className="h-3 w-3 border border-ink-muted border-t-transparent rounded-full animate-spin" />
                    Saving…
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Footer note */}
        <p className="text-xs text-ink-muted mt-8 text-center">
          Changes take effect immediately. Every agent action is logged and reversible from the Dashboard.
        </p>
      </div>
    </div>
  );
}
