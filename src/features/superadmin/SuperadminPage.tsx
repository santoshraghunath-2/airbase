import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2, Search, ChevronRight, Save, Loader2,
  Shield, LogOut, RefreshCw, ToggleLeft, ToggleRight,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TenantRow, SubscriptionTier, SubscriptionStatus } from "@/types/database.types";

// ─── Constants ────────────────────────────────────────────────────────────────

const KNOWN_AGENT_TYPES = [
  { type: "dispatch",       label: "Dispatch",       hasRetell: false },
  { type: "booking_sms",    label: "Booking — SMS",  hasRetell: false },
  { type: "booking_voice",  label: "Booking — Voice", hasRetell: true },
  { type: "invoice",        label: "Invoice",        hasRetell: false },
  { type: "operator",       label: "Operator Chat",  hasRetell: false },
  { type: "membership",     label: "Membership",     hasRetell: false },
  { type: "tech_assistant", label: "Tech Assistant", hasRetell: false },
] as const;

const AVAILABLE_MODELS = [
  { id: "deepseek-flash",   label: "DeepSeek V4.1 Flash (default)" },
  { id: "deepseek-v4-pro",  label: "DeepSeek V4.1 Pro" },
  { id: "deepseek-chat",    label: "DeepSeek Chat (legacy)" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  { id: "claude-opus-4-5",  label: "Claude Opus 4.5" },
  { id: "gpt-4o",           label: "GPT-4o" },
];

const AUTONOMY_OPTIONS = [
  { value: "0", label: "0 — Propose only" },
  { value: "1", label: "1 — Auto-execute low-risk" },
  { value: "2", label: "2 — Auto-execute medium" },
  { value: "3", label: "3 — Fully autonomous" },
] as const;

const TIER_COLORS: Record<SubscriptionTier, string> = {
  starter:    "bg-gray-100 text-gray-700",
  growth:     "bg-blue-100 text-blue-700",
  enterprise: "bg-purple-100 text-purple-700",
};

const STATUS_COLORS: Record<SubscriptionStatus, string> = {
  trialing:   "bg-yellow-100 text-yellow-700",
  active:     "bg-green-100 text-green-700",
  past_due:   "bg-red-100 text-red-700",
  cancelled:  "bg-gray-100 text-gray-500",
  paused:     "bg-orange-100 text-orange-700",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentDraft = {
  id?: string;
  enabled: boolean;
  model_id: string;
  autonomy_level: 0 | 1 | 2 | 3;
  confidence_threshold: number;
  auto_execute: boolean;
  retell_agent_id: string;
};

type AgentDrafts = Record<string, AgentDraft>;

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SuperadminPage() {
  const { user, session, signOut, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<TenantRow | null>(null);
  const [agentDrafts, setAgentDrafts] = useState<AgentDrafts>({});
  const [tenantDraft, setTenantDraft] = useState<Partial<TenantRow>>({});

  const [search, setSearch] = useState("");
  const [loadingTenants, setLoadingTenants] = useState(true);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [savingTenant, setSavingTenant] = useState(false);
  const [savingAgents, setSavingAgents] = useState(false);

  // ── Auth gate ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    if (!session) { navigate("/login"); return; }
    if (user && user.role !== "platform_admin") {
      toast.error("Access denied — platform admin only");
      navigate("/");
    }
  }, [authLoading, session, user, navigate]);

  // ── Load tenants ─────────────────────────────────────────────────────────
  const loadTenants = useCallback(async () => {
    setLoadingTenants(true);
    try {
      const { data, error } = await supabase
        .from("tenants")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setTenants(data ?? []);
    } catch (err) {
      toast.error("Failed to load tenants");
      console.error(err);
    } finally {
      setLoadingTenants(false);
    }
  }, []);

  useEffect(() => { void loadTenants(); }, [loadTenants]);

  // ── Select tenant → load agent configs ───────────────────────────────────
  async function selectTenant(t: TenantRow) {
    setSelectedTenant(t);
    setTenantDraft({ subscription_tier: t.subscription_tier, default_model_id: t.default_model_id });
    setLoadingAgents(true);
    try {
      const { data, error } = await supabase
        .from("agent_config")
        .select("*")
        .eq("tenant_id", t.id);
      if (error) throw error;
      const configs = data ?? [];

      // Initialise drafts from DB rows, with defaults for missing agent types
      const drafts: AgentDrafts = {};
      for (const { type } of KNOWN_AGENT_TYPES) {
        const existing = configs.find((c) => c.agent_type === type);
        drafts[type] = {
          id: existing?.id,
          enabled: existing?.enabled ?? true,
          model_id: existing?.model_id ?? "",
          autonomy_level: existing?.autonomy_level ?? 1,
          confidence_threshold: existing?.confidence_threshold ?? 0.8,
          auto_execute: existing?.auto_execute ?? false,
          retell_agent_id: (existing?.settings as Record<string, string> | null)?.retell_agent_id ?? "",
        };
      }
      setAgentDrafts(drafts);
    } catch (err) {
      toast.error("Failed to load agent config");
      console.error(err);
    } finally {
      setLoadingAgents(false);
    }
  }

  // ── Save tenant overview ──────────────────────────────────────────────────
  async function saveTenantOverview() {
    if (!selectedTenant) return;
    setSavingTenant(true);
    try {
      const { error } = await supabase
        .from("tenants")
        .update({
          subscription_tier: tenantDraft.subscription_tier,
          default_model_id: tenantDraft.default_model_id,
        })
        .eq("id", selectedTenant.id);
      if (error) throw error;
      setSelectedTenant({ ...selectedTenant, ...tenantDraft });
      setTenants((prev) => prev.map((t) => t.id === selectedTenant.id ? { ...t, ...tenantDraft } : t));
      toast.success("Tenant saved");
    } catch (err) {
      toast.error("Failed to save tenant");
      console.error(err);
    } finally {
      setSavingTenant(false);
    }
  }

  // ── Save agent configs ────────────────────────────────────────────────────
  async function saveAgentConfigs() {
    if (!selectedTenant) return;
    setSavingAgents(true);
    try {
      for (const { type } of KNOWN_AGENT_TYPES) {
        const draft = agentDrafts[type];
        if (!draft) continue;

        const settings: Record<string, string> = {};
        if (draft.retell_agent_id) settings.retell_agent_id = draft.retell_agent_id;

        const row = {
          tenant_id: selectedTenant.id,
          agent_type: type,
          enabled: draft.enabled,
          model_id: draft.model_id || null,
          model_tier: "balanced" as const,
          autonomy_level: draft.autonomy_level,
          confidence_threshold: draft.confidence_threshold,
          auto_execute: draft.auto_execute,
          settings,
        };

        const { error } = await supabase
          .from("agent_config")
          .upsert({ ...row, ...(draft.id ? { id: draft.id } : {}) }, { onConflict: "tenant_id,agent_type" });
        if (error) throw error;
      }
      toast.success("Agent config saved");
    } catch (err) {
      toast.error("Failed to save agent config");
      console.error(err);
    } finally {
      setSavingAgents(false);
    }
  }

  // ── Filter ────────────────────────────────────────────────────────────────
  const filtered = tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.slug.toLowerCase().includes(search.toLowerCase()),
  );

  // ── Guard: show nothing while auth resolves ───────────────────────────────
  if (authLoading || (session && !user)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session || (user && user.role !== "platform_admin")) return null;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* ── Left panel: tenant list ── */}
      <div className="w-80 flex-shrink-0 border-r flex flex-col">
        {/* Header */}
        <div className="p-4 border-b">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="h-5 w-5 text-purple-600" />
            <h1 className="font-bold text-base">Superadmin</h1>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-8 text-sm"
              placeholder="Search tenants…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Tenant list */}
        <div className="flex-1 overflow-y-auto">
          {loadingTenants ? (
            <div className="p-3 space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No tenants found</p>
          ) : (
            filtered.map((t) => (
              <button
                key={t.id}
                onClick={() => void selectTenant(t)}
                className={`w-full text-left px-3 py-3 border-b hover:bg-muted/50 transition-colors flex items-center gap-2 ${
                  selectedTenant?.id === t.id ? "bg-muted" : ""
                }`}
              >
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{t.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{t.slug}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TIER_COLORS[t.subscription_tier]}`}>
                    {t.subscription_tier}
                  </span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{tenants.length} tenants</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void loadTenants()}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void signOut()}>
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* ── Right panel: tenant detail ── */}
      <div className="flex-1 overflow-y-auto">
        {!selectedTenant ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <Building2 className="h-10 w-10 mb-3 opacity-20" />
            <p className="text-sm font-medium">Select a tenant</p>
            <p className="text-xs mt-1">{tenants.length} tenants loaded</p>
          </div>
        ) : (
          <div className="p-6 max-w-3xl mx-auto">
            {/* Tenant header */}
            <div className="mb-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold">{selectedTenant.name}</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {selectedTenant.slug} · {selectedTenant.id}
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className={`text-xs px-2 py-1 rounded font-medium ${TIER_COLORS[selectedTenant.subscription_tier]}`}>
                    {selectedTenant.subscription_tier}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded font-medium ${STATUS_COLORS[selectedTenant.subscription_status]}`}>
                    {selectedTenant.subscription_status}
                  </span>
                </div>
              </div>
            </div>

            <Tabs defaultValue="overview">
              <TabsList className="mb-6">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="agents">Agent Config</TabsTrigger>
              </TabsList>

              {/* ── Overview tab ── */}
              <TabsContent value="overview" className="space-y-4">
                <Card className="p-5 space-y-4">
                  <h3 className="font-semibold text-sm">Subscription</h3>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Subscription tier</label>
                      <Select
                        value={tenantDraft.subscription_tier ?? selectedTenant.subscription_tier}
                        onValueChange={(v) => setTenantDraft((d) => ({ ...d, subscription_tier: v as SubscriptionTier }))}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="starter">Starter</SelectItem>
                          <SelectItem value="growth">Growth</SelectItem>
                          <SelectItem value="enterprise">Enterprise</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Default AI model</label>
                      <Select
                        value={tenantDraft.default_model_id ?? selectedTenant.default_model_id}
                        onValueChange={(v) => setTenantDraft((d) => ({ ...d, default_model_id: v }))}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {AVAILABLE_MODELS.map((m) => (
                            <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Button size="sm" onClick={() => void saveTenantOverview()} disabled={savingTenant}>
                    {savingTenant ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                    Save changes
                  </Button>
                </Card>

                <Card className="p-5">
                  <h3 className="font-semibold text-sm mb-3">Details</h3>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    {[
                      ["Phone", selectedTenant.phone ?? "—"],
                      ["Timezone", selectedTenant.timezone],
                      ["Created", format(new Date(selectedTenant.created_at), "MMM d, yyyy")],
                      ["Trial ends", selectedTenant.trial_ends_at ? format(new Date(selectedTenant.trial_ends_at), "MMM d, yyyy") : "—"],
                      ["Twilio number", selectedTenant.twilio_phone_number ?? "—"],
                      ["Billing email", selectedTenant.billing_email ?? "—"],
                      ["Stripe customer", selectedTenant.stripe_customer_id ? selectedTenant.stripe_customer_id.slice(0, 20) + "…" : "—"],
                    ].map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="font-medium truncate">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>
              </TabsContent>

              {/* ── Agent config tab ── */}
              <TabsContent value="agents" className="space-y-3">
                {loadingAgents ? (
                  [1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full" />)
                ) : (
                  <>
                    {KNOWN_AGENT_TYPES.map(({ type, label, hasRetell }) => {
                      const draft = agentDrafts[type];
                      if (!draft) return null;

                      return (
                        <Card key={type} className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <span className="font-medium text-sm">{label}</span>
                              {draft.id && (
                                <span className="ml-2 text-[10px] text-muted-foreground font-mono">
                                  {type}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() =>
                                setAgentDrafts((d) => ({
                                  ...d,
                                  [type]: { ...d[type], enabled: !d[type].enabled },
                                }))
                              }
                              className="flex items-center gap-1.5 text-xs"
                            >
                              {draft.enabled ? (
                                <>
                                  <ToggleRight className="h-5 w-5 text-green-600" />
                                  <span className="text-green-600 font-medium">Enabled</span>
                                </>
                              ) : (
                                <>
                                  <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                                  <span className="text-muted-foreground">Disabled</span>
                                </>
                              )}
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-muted-foreground">Model override</label>
                              <Select
                                value={draft.model_id || "__default__"}
                                onValueChange={(v) =>
                                  setAgentDrafts((d) => ({
                                    ...d,
                                    [type]: { ...d[type], model_id: v === "__default__" ? "" : v },
                                  }))
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Use tenant default" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__default__">Use tenant default</SelectItem>
                                  {AVAILABLE_MODELS.map((m) => (
                                    <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs font-medium text-muted-foreground">Autonomy level</label>
                              <Select
                                value={String(draft.autonomy_level)}
                                onValueChange={(v) =>
                                  setAgentDrafts((d) => ({
                                    ...d,
                                    [type]: { ...d[type], autonomy_level: Number(v) as 0 | 1 | 2 | 3 },
                                  }))
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {AUTONOMY_OPTIONS.map((o) => (
                                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs font-medium text-muted-foreground">
                                Confidence threshold ({draft.confidence_threshold})
                              </label>
                              <input
                                type="range"
                                min={0.5}
                                max={1}
                                step={0.05}
                                value={draft.confidence_threshold}
                                onChange={(e) =>
                                  setAgentDrafts((d) => ({
                                    ...d,
                                    [type]: { ...d[type], confidence_threshold: Number(e.target.value) },
                                  }))
                                }
                                className="w-full h-1.5 accent-primary"
                              />
                            </div>

                            <div className="space-y-1 flex items-center gap-2 pt-4">
                              <input
                                type="checkbox"
                                id={`auto-exec-${type}`}
                                checked={draft.auto_execute}
                                onChange={(e) =>
                                  setAgentDrafts((d) => ({
                                    ...d,
                                    [type]: { ...d[type], auto_execute: e.target.checked },
                                  }))
                                }
                                className="h-3.5 w-3.5"
                              />
                              <label htmlFor={`auto-exec-${type}`} className="text-xs font-medium text-muted-foreground cursor-pointer">
                                Auto-execute actions
                              </label>
                            </div>

                            {hasRetell && (
                              <div className="col-span-2 space-y-1">
                                <label className="text-xs font-medium text-muted-foreground">
                                  Retell agent ID
                                  <span className="ml-1 text-muted-foreground/60">(settings.retell_agent_id)</span>
                                </label>
                                <Input
                                  className="h-8 text-xs font-mono"
                                  placeholder="agent_xxxxxxxxxxxxxxxxxxxxxxxx"
                                  value={draft.retell_agent_id}
                                  onChange={(e) =>
                                    setAgentDrafts((d) => ({
                                      ...d,
                                      [type]: { ...d[type], retell_agent_id: e.target.value },
                                    }))
                                  }
                                />
                              </div>
                            )}
                          </div>
                        </Card>
                      );
                    })}

                    <div className="pt-2">
                      <Button onClick={() => void saveAgentConfigs()} disabled={savingAgents}>
                        {savingAgents ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                        Save all agent config
                      </Button>
                    </div>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}
