import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Plus, Trash2, Sparkles, Save, Send,
  CheckCircle2, XCircle, ArrowRight, Loader2, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type {
  CustomerRow, EstimateRow, EstimateLineItemRow, PricebookItemRow,
  EstimateOption, EstimatePresentationMode,
} from "@/types/database.types";

// ─── Local types ──────────────────────────────────────────────────────────────

type DraftLineItem = Omit<EstimateLineItemRow, "id" | "total_cents" | "created_at"> & {
  _tempId: string;
  id?: string;
};

type AiSuggestion = {
  description: string;
  reason: string;
  price_cents: number;
};

function centsToDisplay(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

function displayToCents(s: string): number {
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

function totalFor(items: DraftLineItem[], option: EstimateOption) {
  return items
    .filter((i) => i.option === option)
    .reduce((s, i) => s + Math.round(i.quantity * i.unit_price_cents), 0);
}

const OPTION_LABELS: Record<EstimateOption, string> = {
  good: "Good",
  better: "Better",
  best: "Best",
  base: "Option",
};

const OPTION_COLORS: Record<EstimateOption, string> = {
  good:   "border-line",
  better: "border-ai-tint-border bg-ai-chip-bg/20",
  best:   "border-confirmed-border bg-confirmed-bg/20",
  base:   "border-line",
};

// ─── LineItemRow ──────────────────────────────────────────────────────────────

function LineItemRow({
  item,
  onChange,
  onRemove,
  pricebookItems,
}: {
  item: DraftLineItem;
  onChange: (patch: Partial<DraftLineItem>) => void;
  onRemove: () => void;
  pricebookItems: PricebookItemRow[];
}) {
  const [pbOpen, setPbOpen] = useState(false);
  const [pbSearch, setPbSearch] = useState("");

  const filtered = pricebookItems.filter(
    (p) =>
      p.name.toLowerCase().includes(pbSearch.toLowerCase()) ||
      (p.description ?? "").toLowerCase().includes(pbSearch.toLowerCase()),
  );

  return (
    <div className="flex items-start gap-1.5 group">
      <div className="flex-1 relative">
        <input
          className="w-full text-xs text-ink bg-transparent border-b border-line-2 focus:border-ai outline-none py-1 px-0"
          placeholder="Description…"
          value={item.description}
          onChange={(e) => onChange({ description: e.target.value })}
          onFocus={() => setPbOpen(true)}
          onBlur={() => setTimeout(() => setPbOpen(false), 150)}
        />
        {pbOpen && filtered.length > 0 && (
          <div className="absolute z-20 top-full left-0 mt-0.5 w-72 bg-paper border border-line rounded-xl shadow-md overflow-hidden">
            <div className="px-2 pt-2 pb-1">
              <Input
                className="text-xs h-7"
                placeholder="Search pricebook…"
                value={pbSearch}
                onChange={(e) => setPbSearch(e.target.value)}
                onMouseDown={(e) => e.preventDefault()}
              />
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filtered.slice(0, 20).map((p) => (
                <button
                  key={p.id}
                  className="w-full text-left px-3 py-2 hover:bg-raised flex items-center justify-between"
                  onMouseDown={() => {
                    onChange({
                      description: p.name,
                      unit_price_cents: Math.round(p.unit_price * 100),
                      pricebook_item_id: p.id,
                    });
                    setPbOpen(false);
                    setPbSearch("");
                  }}
                >
                  <span className="text-xs text-ink">{p.name}</span>
                  <span className="text-xs text-ink-muted">{centsToDisplay(Math.round(p.unit_price * 100))}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Qty */}
      <input
        className="w-10 text-xs text-ink text-center bg-transparent border-b border-line-2 focus:border-ai outline-none py-1"
        value={item.quantity}
        onChange={(e) => onChange({ quantity: parseFloat(e.target.value) || 1 })}
      />

      {/* Unit price */}
      <input
        className="w-20 text-xs text-ink text-right bg-transparent border-b border-line-2 focus:border-ai outline-none py-1"
        value={item.unit_price_cents === 0 ? "" : (item.unit_price_cents / 100).toFixed(2)}
        placeholder="0.00"
        onChange={(e) => onChange({ unit_price_cents: displayToCents(e.target.value) })}
      />

      {/* Total */}
      <span className="w-16 text-xs text-ink text-right py-1 tabular-nums">
        {centsToDisplay(Math.round(item.quantity * item.unit_price_cents))}
      </span>

      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-ink-muted hover:text-blocked-text"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─── OptionColumn ─────────────────────────────────────────────────────────────

function OptionColumn({
  option,
  items,
  onChange,
  onAdd,
  onRemove,
  pricebookItems,
  suggestions,
  onAddSuggestion,
}: {
  option: EstimateOption;
  items: DraftLineItem[];
  onChange: (tempId: string, patch: Partial<DraftLineItem>) => void;
  onAdd: (option: EstimateOption) => void;
  onRemove: (tempId: string) => void;
  pricebookItems: PricebookItemRow[];
  suggestions: AiSuggestion[];
  onAddSuggestion: (s: AiSuggestion, option: EstimateOption) => void;
}) {
  const colItems = items.filter((i) => i.option === option);
  const total = totalFor(items, option);

  return (
    <div className={cn("flex-1 rounded-xl border p-4 flex flex-col gap-3", OPTION_COLORS[option])}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
          {OPTION_LABELS[option]}
        </span>
        <span className="text-sm font-semibold text-ink tabular-nums">{centsToDisplay(total)}</span>
      </div>

      {/* Column header */}
      <div className="flex items-center gap-1.5 text-[10px] text-ink-muted border-b border-line pb-1">
        <span className="flex-1">Description</span>
        <span className="w-10 text-center">Qty</span>
        <span className="w-20 text-right">Unit</span>
        <span className="w-16 text-right">Total</span>
        <span className="w-5" />
      </div>

      {/* Line items */}
      <div className="flex flex-col gap-2">
        {colItems.map((item) => (
          <LineItemRow
            key={item._tempId}
            item={item}
            onChange={(patch) => onChange(item._tempId, patch)}
            onRemove={() => onRemove(item._tempId)}
            pricebookItems={pricebookItems}
          />
        ))}
      </div>

      <button
        onClick={() => onAdd(option)}
        className="flex items-center gap-1 text-[11px] text-ai hover:text-ai-ink transition-colors mt-1"
      >
        <Plus className="h-3 w-3" />
        Add line item
      </button>

      {/* AI suggestion chips for this column */}
      {suggestions.length > 0 && (
        <div className="mt-2 pt-2 border-t border-line">
          <p className="text-[10px] font-medium text-ai mb-1.5 flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> AI suggestions
          </p>
          <div className="flex flex-col gap-1">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => onAddSuggestion(s, option)}
                className="flex items-center justify-between w-full text-left text-[11px] rounded-lg border border-ai-tint-border bg-ai-chip-bg px-2 py-1 hover:bg-ai-chip-bg/70 transition-colors group"
              >
                <span className="text-ai-ink">{s.description}</span>
                <span className="text-ai font-medium tabular-nums flex items-center gap-1">
                  {centsToDisplay(s.price_cents)}
                  <Plus className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EstimateBuilderPage() {
  const { tenantSlug, estimateId } = useParams<{ tenantSlug: string; estimateId: string }>();
  const { tenant } = useAuth();
  const navigate = useNavigate();

  const isNew = !estimateId || estimateId === "new";
  const isRemodel = tenant?.trade === "remodel";

  // ── Metadata state ──
  const [loading, setLoading]     = useState(!isNew);
  const [saving,  setSaving]      = useState(false);
  // Remodel tenants default to good_better_best; can still switch to single
  const [mode,    setMode]        = useState<EstimatePresentationMode>(
    isRemodel ? "good_better_best" : "good_better_best",
  );
  const [title,   setTitle]       = useState("Estimate");
  const [notes,   setNotes]       = useState("");
  const [validDays, setValidDays] = useState("30");
  const [status,  setStatus]      = useState<EstimateRow["status"]>("draft");

  // ── Customer ──
  const [customer,      setCustomer]      = useState<CustomerRow | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerHits,  setCustomerHits]  = useState<CustomerRow[]>([]);
  const [custOpen,      setCustOpen]      = useState(false);
  const custDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Line items ──
  const [items, setItems] = useState<DraftLineItem[]>([]);
  let tempCounter = useRef(0);

  // ── Pricebook ──
  const [pricebookItems, setPricebookItems] = useState<PricebookItemRow[]>([]);

  // ── AI suggestions ──
  const [suggestions,   setSuggestions]   = useState<AiSuggestion[]>([]);
  const [aiLoading,     setAiLoading]     = useState(false);
  const [aiJobType,     setAiJobType]     = useState("");

  // ── Remodel: approval gate ──
  // Any line without a pricebook_item_id (off-book) or any discount line requires owner approval.
  const needsApproval = isRemodel && items.some(
    (i) => i.description.trim() && (!i.pricebook_item_id || i.unit_price_cents < 0),
  );

  // ── Remodel: commitment date preview (uses package's commitment_days if available) ──
  // Simple estimate: total commitment_days is the max across all packages in the selected option.
  // Actual value comes from package_components; default shown here is informational.
  const commitmentDaysByOption = useCallback((_opt: typeof options[0]) => {
    // TODO Phase 3: query package_components for the selected pricebook items
    // For now surface the placeholder value from the pricebook item name
    return null as number | null;
  }, []);

  // ────────────────────────────────────────────────────────────────────────────

  const newTempId = () => `_${++tempCounter.current}`;

  const addItem = (option: EstimateOption) => {
    setItems((prev) => [
      ...prev,
      {
        _tempId: newTempId(),
        estimate_id: estimateId ?? "",
        option,
        pricebook_item_id: null,
        description: "",
        quantity: 1,
        unit_price_cents: 0,
        is_upsell: false,
        sort_order: prev.filter((i) => i.option === option).length,
      },
    ]);
  };

  const updateItem = (tempId: string, patch: Partial<DraftLineItem>) => {
    setItems((prev) => prev.map((i) => (i._tempId === tempId ? { ...i, ...patch } : i)));
  };

  const removeItem = (tempId: string) => {
    setItems((prev) => prev.filter((i) => i._tempId !== tempId));
  };

  const addSuggestion = (s: AiSuggestion, option: EstimateOption) => {
    setItems((prev) => [
      ...prev,
      {
        _tempId: newTempId(),
        estimate_id: estimateId ?? "",
        option,
        pricebook_item_id: null,
        description: s.description,
        quantity: 1,
        unit_price_cents: s.price_cents,
        is_upsell: true,
        sort_order: prev.filter((i) => i.option === option).length,
      },
    ]);
  };

  // ── Load pricebook on mount ──
  useEffect(() => {
    if (!tenant) return;
    void supabase
      .from("pricebook_items")
      .select("*")
      .eq("tenant_id", tenant.id)
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setPricebookItems((data ?? []) as PricebookItemRow[]));
  }, [tenant]);

  // ── Load existing estimate ──
  useEffect(() => {
    if (isNew || !tenant) return;
    void (async () => {
      const { data: est } = await supabase
        .from("estimates")
        .select("*, customers(*)")
        .eq("id", estimateId!)
        .eq("tenant_id", tenant.id)
        .single();
      if (!est) { navigate(`/${tenantSlug}/estimates`); return; }

      setTitle(est.title);
      setMode(est.presentation_mode as EstimatePresentationMode);
      setNotes(est.notes ?? "");
      setStatus(est.status as EstimateRow["status"]);
      setValidDays(
        est.valid_until
          ? String(Math.max(1, Math.round((new Date(est.valid_until).getTime() - Date.now()) / 86400000)))
          : "30",
      );
      if (est.customers) setCustomer(est.customers as unknown as CustomerRow);
      setSuggestions(
        Array.isArray(est.ai_upsell_suggestions) ? est.ai_upsell_suggestions as AiSuggestion[] : [],
      );

      const { data: lineItems } = await supabase
        .from("estimate_line_items")
        .select("*")
        .eq("estimate_id", estimateId!)
        .order("sort_order");
      setItems(
        (lineItems ?? []).map((li) => ({ ...li, _tempId: newTempId() })) as DraftLineItem[],
      );
      setLoading(false);
    })();
  }, [isNew, estimateId, tenant, navigate, tenantSlug]);

  // ── Customer search ──
  useEffect(() => {
    if (custDebounce.current) clearTimeout(custDebounce.current);
    if (!customerQuery.trim() || !tenant) { setCustomerHits([]); return; }
    custDebounce.current = setTimeout(async () => {
      const { data } = await supabase
        .from("customers")
        .select("id,name,phone,email")
        .eq("tenant_id", tenant.id)
        .or(`name.ilike.%${customerQuery}%,phone.ilike.%${customerQuery}%`)
        .is("deleted_at", null)
        .limit(8);
      setCustomerHits((data ?? []) as CustomerRow[]);
    }, 280);
  }, [customerQuery, tenant]);

  // ── AI upsell suggestions ──
  const fetchSuggestions = useCallback(async () => {
    if (!tenant || !customer) {
      toast.error("Select a customer before requesting AI suggestions.");
      return;
    }
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("estimate-upsell-agent", {
        body: {
          tenant_id: tenant.id,
          customer_id: customer.id,
          job_type: aiJobType || null,
          existing_items: items.map((i) => i.description),
        },
      });
      if (error) throw error;
      const raw = (data as { suggestions?: AiSuggestion[] })?.suggestions ?? [];
      setSuggestions(raw);
      if (raw.length === 0) toast.info("No new upsell suggestions for this customer.");
    } catch {
      toast.error("AI suggestions unavailable — the agent function may not be deployed yet.");
    } finally {
      setAiLoading(false);
    }
  }, [tenant, customer, items, aiJobType]);

  // ── Save ──
  const save = useCallback(
    async (nextStatus?: EstimateRow["status"]) => {
      if (!tenant || !customer) {
        toast.error("Select a customer before saving.");
        return null;
      }
      setSaving(true);
      try {
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + parseInt(validDays || "30", 10));

        // If off-book lines exist for remodel, downgrade to needs_approval before sending
        const resolvedStatus = (() => {
          const target = nextStatus ?? status;
          if (isRemodel && needsApproval && target === "sent") return "needs_approval" as typeof status;
          return target;
        })();

        const payload = {
          tenant_id: tenant.id,
          customer_id: customer.id,
          title,
          presentation_mode: mode,
          notes: notes || null,
          valid_until: validUntil.toISOString().split("T")[0],
          status: resolvedStatus,
          ai_upsell_suggestions: suggestions,
          ...(resolvedStatus === "sent" ? { sent_at: new Date().toISOString() } : {}),
          ...(resolvedStatus === "accepted" ? { accepted_at: new Date().toISOString() } : {}),
          ...(nextStatus === "declined" ? { declined_at: new Date().toISOString() } : {}),
        };

        let estId = estimateId && estimateId !== "new" ? estimateId : null;

        if (estId) {
          await supabase.from("estimates").update(payload).eq("id", estId);
        } else {
          const { data } = await supabase.from("estimates").insert(payload).select("id").single();
          estId = data?.id ?? null;
        }

        if (!estId) throw new Error("Failed to get estimate ID");

        // Upsert line items
        const validItems = items.filter((i) => i.description.trim());
        await supabase.from("estimate_line_items").delete().eq("estimate_id", estId);
        if (validItems.length > 0) {
          await supabase.from("estimate_line_items").insert(
            validItems.map((li, idx) => ({
              estimate_id: estId,
              option: li.option,
              pricebook_item_id: li.pricebook_item_id,
              description: li.description,
              quantity: li.quantity,
              unit_price_cents: li.unit_price_cents,
              is_upsell: li.is_upsell,
              sort_order: idx,
            })),
          );
        }

        if (resolvedStatus) setStatus(resolvedStatus);
        if (isRemodel && needsApproval && nextStatus === "sent") {
          toast.warning("Off-book line items require owner approval before this estimate can be sent.");
        } else {
          toast.success(resolvedStatus === "sent" ? "Estimate sent!" : "Estimate saved.");
        }
        if (isNew) navigate(`/${tenantSlug}/estimates/${estId}`, { replace: true });
        return estId;
      } catch (e) {
        toast.error((e as Error).message);
        return null;
      } finally {
        setSaving(false);
      }
    },
    [
      tenant, customer, title, mode, notes, validDays, status, items,
      suggestions, estimateId, isNew, navigate, tenantSlug,
    ],
  );

  // ── Convert to job ──
  const convertToJob = useCallback(async () => {
    const estId = await save("accepted");
    if (!estId || !tenant || !customer) return;
    // Create a placeholder job linked to this estimate
    const { data: job } = await supabase
      .from("jobs")
      .insert({
        tenant_id: tenant.id,
        customer_id: customer.id,
        title,
        status: "unassigned",
        priority: "normal",
        job_type: "estimate_only",
        source: "estimate",
      })
      .select("id")
      .single();
    if (job) {
      await supabase.from("estimates").update({ converted_job_id: job.id }).eq("id", estId);
      toast.success("Job created from estimate.");
      navigate(`/${tenantSlug}/jobs`);
    }
  }, [save, tenant, customer, title, navigate, tenantSlug]);

  const options: EstimateOption[] = mode === "good_better_best" ? ["good", "better", "best"] : ["base"];

  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-full bg-bone p-8">
        <Skeleton className="h-8 w-64 mb-4" />
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-bone">
      <div className="max-w-[1200px] mx-auto px-8 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs text-ink-muted mb-6">
          <button onClick={() => navigate(`/${tenantSlug}/estimates`)} className="hover:text-ink">
            Estimates
          </button>
          <span>›</span>
          <span className="text-ink">{isNew ? "New estimate" : title}</span>
        </div>

        {/* Top bar */}
        <div className="flex items-start gap-4 mb-6">
          <div className="flex-1 flex flex-col gap-3">
            {/* Title */}
            <input
              className="text-[22px] font-semibold text-ink bg-transparent outline-none border-b border-transparent hover:border-line focus:border-ai transition-colors"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <div className="flex flex-wrap items-center gap-3">
              {/* Customer picker */}
              <div className="relative">
                {customer ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-raised border border-line text-sm">
                    <span className="font-medium text-ink">{customer.name}</span>
                    <span className="text-ink-muted">{customer.phone}</span>
                    {status === "draft" && (
                      <button
                        onClick={() => { setCustomer(null); setCustomerQuery(""); }}
                        className="text-ink-muted hover:text-blocked-text"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="relative">
                    <Input
                      className="w-56"
                      placeholder="Search customer…"
                      value={customerQuery}
                      onChange={(e) => { setCustomerQuery(e.target.value); setCustOpen(true); }}
                      onFocus={() => setCustOpen(true)}
                      onBlur={() => setTimeout(() => setCustOpen(false), 150)}
                    />
                    {custOpen && customerHits.length > 0 && (
                      <div className="absolute z-20 top-full left-0 mt-1 w-72 bg-paper border border-line rounded-xl shadow-md overflow-hidden">
                        {customerHits.map((c) => (
                          <button
                            key={c.id}
                            onMouseDown={() => { setCustomer(c); setCustomerQuery(""); setCustOpen(false); }}
                            className="w-full text-left px-3 py-2 hover:bg-raised flex justify-between"
                          >
                            <span className="text-sm text-ink">{c.name}</span>
                            <span className="text-xs text-ink-muted">{c.phone}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Presentation mode */}
              <div className="flex gap-1 bg-raised rounded-xl p-1 border border-line">
                {(["good_better_best", "single"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "px-3 py-1 rounded-lg text-[11px] font-medium transition-colors",
                      mode === m ? "bg-paper text-ink shadow-sm border border-line" : "text-ink-muted hover:text-ink",
                    )}
                  >
                    {m === "good_better_best" ? "Good / Better / Best" : "Single option"}
                  </button>
                ))}
              </div>

              {/* Valid days */}
              <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                <span>Valid for</span>
                <input
                  className="w-10 text-center border-b border-line focus:border-ai bg-transparent outline-none text-ink"
                  value={validDays}
                  onChange={(e) => setValidDays(e.target.value)}
                />
                <span>days</span>
              </div>

              {/* Status badge */}
              {!isNew && (
                <span className={cn(
                  "inline-flex items-center gap-1 text-[11px] font-medium rounded-pill px-2 py-0.5 border capitalize",
                  status === "draft"     ? "bg-muted text-muted-foreground border-border" :
                  status === "sent"      ? "bg-ai-chip-bg text-ai-ink border-ai-tint-border" :
                  status === "accepted"  ? "bg-confirmed-bg text-confirmed-text border-confirmed-border" :
                  status === "converted" ? "bg-confirmed-bg text-confirmed-text border-confirmed-border" :
                                           "bg-muted text-muted-foreground border-border",
                )}>
                  {status}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* AI upsell */}
            <div className="flex items-center gap-1.5">
              <input
                className="w-36 text-xs border border-line rounded-xl px-2 py-1.5 focus:border-ai outline-none text-ink placeholder:text-ink-muted"
                placeholder="Job type (optional)"
                value={aiJobType}
                onChange={(e) => setAiJobType(e.target.value)}
              />
              <button
                onClick={fetchSuggestions}
                disabled={aiLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-ai-tint-border bg-ai-chip-bg text-ai-ink text-xs font-medium hover:bg-ai-chip-bg/70 transition-colors disabled:opacity-50"
              >
                {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                AI upsells
              </button>
            </div>

            <button
              onClick={() => save()}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line bg-paper text-ink text-xs font-medium hover:bg-raised transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save draft
            </button>

            {(status === "draft" || isNew) && (
              <button
                onClick={() => save("sent")}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-ai-tint-border bg-ai text-white text-xs font-medium hover:bg-ai-hover transition-colors disabled:opacity-50"
              >
                <Send className="h-3 w-3" />
                Send to customer
              </button>
            )}

            {status === "sent" && (
              <>
                <button
                  onClick={convertToJob}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-confirmed-border bg-confirmed-bg text-confirmed-text text-xs font-medium hover:opacity-80 transition-opacity disabled:opacity-50"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Accept → job
                </button>
                <button
                  onClick={() => save("declined")}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-blocked-border bg-blocked-bg text-blocked-text text-xs font-medium hover:opacity-80 transition-opacity disabled:opacity-50"
                >
                  <XCircle className="h-3 w-3" />
                  Decline
                </button>
              </>
            )}

            {/* Remodel: "Accept → contract" replaces the job conversion flow */}
            {isRemodel && status === "sent" && (
              <button
                onClick={async () => {
                  const estId = await save("accepted");
                  if (!estId) return;
                  navigate(`/${tenantSlug}/contracts/new?estimate_id=${estId}`);
                }}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-confirmed-border bg-confirmed-bg text-confirmed-text text-xs font-medium hover:opacity-80 transition-opacity disabled:opacity-50"
              >
                <CheckCircle2 className="h-3 w-3" />
                Accept → contract
              </button>
            )}

            {!isRemodel && (status === "accepted" || status === "converted") && (
              <button
                onClick={() => navigate(`/${tenantSlug}/jobs`)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line text-ink text-xs font-medium hover:bg-raised transition-colors"
              >
                <ArrowRight className="h-3 w-3" />
                View jobs
              </button>
            )}

            {isRemodel && (status === "accepted" || status === "converted") && (
              <button
                onClick={() => navigate(`/${tenantSlug}/contracts`)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line text-ink text-xs font-medium hover:bg-raised transition-colors"
              >
                <ArrowRight className="h-3 w-3" />
                View contracts
              </button>
            )}
          </div>
        </div>

        {/* Remodel: needs-approval banner */}
        {isRemodel && needsApproval && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-warned-border bg-warned-bg px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-warned-text mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-warned-text">Owner approval required</p>
              <p className="text-xs text-warned-text/80 mt-0.5">
                This estimate contains off-pricebook lines or discounts. It cannot be sent to the
                customer until an owner approves it.
              </p>
            </div>
          </div>
        )}

        {/* Columns */}
        <div className="flex gap-4 mb-6">
          {options.map((opt) => (
            <OptionColumn
              key={opt}
              option={opt}
              items={items}
              onChange={updateItem}
              onAdd={addItem}
              onRemove={removeItem}
              pricebookItems={pricebookItems}
              suggestions={suggestions}
              onAddSuggestion={addSuggestion}
            />
          ))}
        </div>

        {/* Totals comparison row */}
        {mode === "good_better_best" && (
          <div className="flex gap-4 mb-6">
            {options.map((opt) => {
              const t = totalFor(items, opt);
              return (
                <div key={opt} className="flex-1 rounded-xl border border-line bg-paper px-4 py-3 flex justify-between items-center">
                  <span className="text-xs text-ink-muted">{OPTION_LABELS[opt]} total</span>
                  <span className="text-base font-semibold text-ink tabular-nums">{centsToDisplay(t)}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Notes */}
        <div className="rounded-xl border border-line bg-paper p-4">
          <label className="text-xs font-medium text-ink-muted mb-1.5 block">Notes for customer</label>
          <textarea
            className="w-full text-sm text-ink bg-transparent outline-none resize-none min-h-[80px] placeholder:text-ink-muted"
            placeholder="Any additional notes to include on the estimate…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
