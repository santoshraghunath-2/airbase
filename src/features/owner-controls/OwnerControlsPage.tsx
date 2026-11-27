import { useEffect, useState } from "react";
import { Shield, BellOff, Users, Activity, ChevronDown, ChevronUp, Undo2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthorityTier = "act" | "act_and_report" | "ask_first" | "never";

interface AuthorityRule {
  id: string;
  action_type: string;
  tier: AuthorityTier;
  limit_cents: number | null;
  approver_role: string | null;
  updated_at: string;
}

interface AgentPauseState {
  agent_type: string;
  paused: boolean;
  enabled: boolean;
}

interface OnCallEntry {
  id: string;
  role: string;
  sort_order: number;
  start_at: string;
  end_at: string;
  users: { id: string; name: string; email: string }[] | null;
}

interface ActionLogEntry {
  id: string;
  agent_type: string;
  created_at: string;
  status: string;
  authority_tier: AuthorityTier | null;
  entity_type: string | null;
  entity_id: string | null;
  amount_cents: number | null;
  reasoning: string;
  reversal: Record<string, unknown> | null;
  proposed_action: Record<string, unknown>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tierBadge(tier: AuthorityTier | null) {
  if (!tier) return "bg-muted text-muted-foreground";
  if (tier === "act")            return "bg-confirmed-bg text-confirmed-text border-confirmed-border";
  if (tier === "act_and_report") return "bg-ai-chip-bg text-ai-ink border-ai-tint-border";
  if (tier === "ask_first")      return "bg-warned-bg text-warned-text border-warned-border";
  if (tier === "never")          return "bg-blocked-bg text-blocked-text border-blocked-border";
  return "bg-muted text-muted-foreground";
}

function tierLabel(tier: AuthorityTier | null) {
  if (!tier) return "—";
  const labels: Record<AuthorityTier, string> = {
    act:            "Act",
    act_and_report: "Act + report",
    ask_first:      "Ask first",
    never:          "Never",
  };
  return labels[tier] ?? tier;
}

function centsDisplay(c: number | null) {
  if (c == null) return "—";
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon className="h-4 w-4 text-ink-muted" />
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
    </div>
  );
}

// ─── Authority Rules Tab ─────────────────────────────────────────────────────

function AuthorityRulesTab({ rules, onReload }: { rules: AuthorityRule[]; onReload: () => void }) {
  const { tenant } = useAuth();
  const [saving, setSaving] = useState<string | null>(null);

  async function updateTier(rule: AuthorityRule, newTier: AuthorityTier) {
    if (!tenant) return;
    setSaving(rule.id);
    await supabase
      .from("authority_rules")
      .update({ tier: newTier, updated_at: new Date().toISOString() })
      .eq("id", rule.id);
    setSaving(null);
    onReload();
  }

  if (rules.length === 0) {
    return <p className="text-xs text-ink-muted py-4">No authority rules configured for this tenant.</p>;
  }

  return (
    <div className="flex flex-col divide-y divide-line">
      {rules.map((rule) => (
        <div key={rule.id} className="py-3 flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-ink capitalize">
              {rule.action_type.replace(/_/g, " ")}
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-ink-muted">
              {rule.limit_cents != null && (
                <span>Limit: {centsDisplay(rule.limit_cents)}</span>
              )}
              {rule.approver_role && (
                <span>Approver: {rule.approver_role}</span>
              )}
            </div>
          </div>
          <select
            disabled={saving === rule.id}
            value={rule.tier}
            onChange={(e) => updateTier(rule, e.target.value as AuthorityTier)}
            className={cn(
              "text-xs font-medium rounded-lg px-2 py-1 border cursor-pointer",
              tierBadge(rule.tier),
            )}
          >
            <option value="act">Act</option>
            <option value="act_and_report">Act + report</option>
            <option value="ask_first">Ask first</option>
            <option value="never">Never</option>
          </select>
        </div>
      ))}
    </div>
  );
}

// ─── Pause Switches Tab ───────────────────────────────────────────────────────

function PauseSwitchesTab({ agents, onReload }: { agents: AgentPauseState[]; onReload: () => void }) {
  const { tenant } = useAuth();
  const [saving, setSaving] = useState<string | null>(null);

  async function togglePause(agentType: string, currentPaused: boolean) {
    if (!tenant) return;
    setSaving(agentType);
    await supabase
      .from("agent_config")
      .update({ paused: !currentPaused })
      .eq("tenant_id", tenant.id)
      .eq("agent_type", agentType);
    setSaving(null);
    onReload();
  }

  if (agents.length === 0) {
    return <p className="text-xs text-ink-muted py-4">No agent configs found.</p>;
  }

  return (
    <div className="flex flex-col divide-y divide-line">
      {agents.map((agent) => (
        <div key={agent.agent_type} className="py-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-ink capitalize">
              {agent.agent_type.replace(/_/g, " ")}
            </div>
            <div className="text-xs text-ink-muted mt-0.5">
              {agent.enabled ? "Enabled" : "Disabled"}{agent.paused ? " · Paused" : ""}
            </div>
          </div>
          <button
            disabled={saving === agent.agent_type}
            onClick={() => togglePause(agent.agent_type, agent.paused)}
            className={cn(
              "relative inline-flex h-5 w-9 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none",
              agent.paused ? "bg-warned-text" : "bg-confirmed-text",
              saving === agent.agent_type && "opacity-50",
            )}
            title={agent.paused ? "Click to resume" : "Click to pause all autonomous actions"}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200",
                agent.paused ? "translate-x-4" : "translate-x-0",
              )}
            />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── On-Call Roster Tab ───────────────────────────────────────────────────────

function OnCallTab({ entries }: { entries: OnCallEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="py-8 text-center">
        <Users className="h-7 w-7 text-ink-muted mx-auto mb-2" />
        <p className="text-xs text-ink-muted">No on-call roster configured.</p>
        <p className="text-xs text-ink-muted mt-1">
          Configure via the Supabase dashboard or the mobile Command app.
        </p>
      </div>
    );
  }

  const grouped: Record<string, OnCallEntry[]> = {};
  for (const entry of entries) {
    grouped[entry.role] = [...(grouped[entry.role] ?? []), entry];
  }

  return (
    <div className="flex flex-col gap-4">
      {Object.entries(grouped).map(([role, roleEntries]) => (
        <div key={role}>
          <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2 capitalize">
            {role.replace(/_/g, " ")}
          </div>
          <div className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {roleEntries.map((entry, idx) => (
              <div key={entry.id} className="px-4 py-3 flex items-center gap-3">
                <span className="text-xs text-ink-muted w-5">#{idx + 1}</span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-ink">
                    {entry.users?.[0]?.name ?? "Unknown user"}
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    {new Date(entry.start_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} —{" "}
                    {new Date(entry.end_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Action Log Tab ───────────────────────────────────────────────────────────

function ActionLogTab({
  actions,
  onReverse,
}: {
  actions: ActionLogEntry[];
  onReverse: (actionId: string, reversal: Record<string, unknown>) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [reversing, setReversing] = useState<string | null>(null);

  if (actions.length === 0) {
    return <p className="text-xs text-ink-muted py-4">No recent agent actions.</p>;
  }

  return (
    <div className="flex flex-col divide-y divide-line">
      {actions.map((action) => (
        <div key={action.id} className="py-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-ink capitalize">
                  {((action.proposed_action?.type as string) ?? action.agent_type).replace(/_/g, " ")}
                </span>
                {action.authority_tier && (
                  <span className={cn(
                    "text-[10px] font-semibold uppercase tracking-wide rounded-pill px-2 py-0.5 border",
                    tierBadge(action.authority_tier),
                  )}>
                    {tierLabel(action.authority_tier)}
                  </span>
                )}
                <span className={cn(
                  "text-[10px] font-semibold uppercase tracking-wide rounded-pill px-2 py-0.5 border",
                  action.status === "auto_executed" ? "bg-confirmed-bg text-confirmed-text border-confirmed-border" :
                  action.status === "proposed" ? "bg-ai-chip-bg text-ai-ink border-ai-tint-border" :
                  "bg-muted text-muted-foreground border-border",
                )}>
                  {action.status.replace("_", " ")}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-ink-muted mt-0.5">
                <span>{action.agent_type}</span>
                {action.amount_cents != null && <span>· {centsDisplay(action.amount_cents)}</span>}
                <span>· {new Date(action.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {action.reversal && action.status === "auto_executed" && (
                <button
                  disabled={reversing === action.id}
                  onClick={async () => {
                    setReversing(action.id);
                    await onReverse(action.id, action.reversal!);
                    setReversing(null);
                  }}
                  className="flex items-center gap-1 text-xs text-ink-muted hover:text-blocked-text transition-colors"
                  title="Reverse this action"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Reverse
                </button>
              )}
              <button
                onClick={() => setExpanded((e) => ({ ...e, [action.id]: !e[action.id] }))}
                className="text-ink-muted hover:text-ink transition-colors"
              >
                {expanded[action.id] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {expanded[action.id] && (
            <div className="mt-2 ml-0 text-xs text-ink-muted bg-bone rounded-lg px-3 py-2">
              <p className="whitespace-pre-wrap">{action.reasoning}</p>
              {action.entity_type && (
                <p className="mt-1 font-mono">
                  {action.entity_type}: {action.entity_id?.slice(0, 8)}
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type TabKey = "rules" | "pause" | "oncall" | "log";

export default function OwnerControlsPage() {
  const { tenant, user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>("rules");
  const [loading, setLoading]     = useState(true);

  const [rules,   setRules]   = useState<AuthorityRule[]>([]);
  const [agents,  setAgents]  = useState<AgentPauseState[]>([]);
  const [onCall,  setOnCall]  = useState<OnCallEntry[]>([]);
  const [actions, setActions] = useState<ActionLogEntry[]>([]);

  const dbUser = user as unknown as { role?: string } | null;
  const isOwner = dbUser?.role === "owner";

  async function loadAll() {
    if (!tenant) return;
    setLoading(true);

    const [rulesRes, agentsRes, onCallRes, actionsRes] = await Promise.all([
      supabase
        .from("authority_rules")
        .select("id, action_type, tier, limit_cents, approver_role, updated_at")
        .eq("tenant_id", tenant.id)
        .order("action_type"),

      supabase
        .from("agent_config")
        .select("agent_type, paused, enabled")
        .eq("tenant_id", tenant.id),

      supabase
        .from("on_call")
        .select("id, role, sort_order, start_at, end_at, users(id, name, email)")
        .eq("tenant_id", tenant.id)
        .order("role")
        .order("sort_order"),

      supabase
        .from("agent_actions")
        .select("id, agent_type, created_at, status, authority_tier, entity_type, entity_id, amount_cents, reasoning, reversal, proposed_action")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    setRules((rulesRes.data ?? []) as AuthorityRule[]);
    setAgents((agentsRes.data ?? []) as AgentPauseState[]);
    setOnCall((onCallRes.data ?? []) as OnCallEntry[]);
    setActions((actionsRes.data ?? []) as ActionLogEntry[]);
    setLoading(false);
  }

  useEffect(() => { void loadAll(); }, [tenant]);

  async function handleReverse(actionId: string, reversal: Record<string, unknown>) {
    const action = reversal.action as string;

    // Simple reversals — more complex ones should be handled by the ops team
    if (action === "reschedule_job" && reversal.to) {
      await supabase.from("jobs").update({ scheduled_start: reversal.to }).eq("id", reversal.job_id as string);
    } else if (action === "reassign_crew" && reversal.to !== undefined) {
      await supabase.from("jobs").update({ tech_id: reversal.to }).eq("id", reversal.job_id as string);
    } else if (action === "update_opportunity_status" && reversal.to) {
      await supabase.from("opportunities").update({ status: reversal.to }).eq("id", reversal.opportunity_id as string);
    }

    // Mark the action as reversed
    await supabase
      .from("agent_actions")
      .update({ status: "reversed" })
      .eq("id", actionId);

    await loadAll();
  }

  if (!isOwner) {
    return (
      <div className="min-h-full bg-bone flex items-center justify-center">
        <p className="text-sm text-ink-muted">Owner access required.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-full bg-bone p-8">
        <Skeleton className="h-8 w-48 mb-6" />
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl mb-3" />)}
      </div>
    );
  }

  const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: "rules",  label: "Authority rules", icon: Shield },
    { key: "pause",  label: "Pause switches",  icon: BellOff },
    { key: "oncall", label: "On-call roster",  icon: Users },
    { key: "log",    label: "Action log",      icon: Activity },
  ];

  return (
    <div className="min-h-full bg-bone">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-xl font-semibold text-ink mb-6">Owner Controls</h1>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 border-b border-line">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px",
                activeTab === key
                  ? "border-ink text-ink"
                  : "border-transparent text-ink-muted hover:text-ink",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-line bg-paper px-6 py-5">
          {activeTab === "rules" && (
            <>
              <SectionHeader icon={Shield} title="Authority rules" />
              <p className="text-xs text-ink-muted mb-4">
                Control what the operator agent can do without asking. Changing a rule takes effect on the next action.
              </p>
              <AuthorityRulesTab rules={rules} onReload={loadAll} />
            </>
          )}

          {activeTab === "pause" && (
            <>
              <SectionHeader icon={BellOff} title="Pause autonomous actions" />
              <p className="text-xs text-ink-muted mb-4">
                Pausing an agent stops it from auto-executing actions. Proposed actions will still appear for review.
              </p>
              <PauseSwitchesTab agents={agents} onReload={loadAll} />
            </>
          )}

          {activeTab === "oncall" && (
            <>
              <SectionHeader icon={Users} title="On-call roster" />
              <p className="text-xs text-ink-muted mb-4">
                Who gets paged for critical issues. Unacknowledged pages roll to the next person after 10 minutes.
              </p>
              <OnCallTab entries={onCall} />
            </>
          )}

          {activeTab === "log" && (
            <>
              <SectionHeader icon={Activity} title="Action log" />
              <p className="text-xs text-ink-muted mb-4">
                Recent agent actions. Reversible actions show an undo button.
              </p>
              <ActionLogTab actions={actions} onReverse={handleReverse} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
