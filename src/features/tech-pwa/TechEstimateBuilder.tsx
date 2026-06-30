import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import { ChevronLeft, Plus, Trash2, Search, Loader2, Presentation } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { EstimateOption, EstimatePresentationMode, PricebookItemRow } from "@/types/database.types";

// ─── Types ────────────────────────────────────────────────────────────────────

type DraftItem = {
  _id: string;
  option: EstimateOption;
  description: string;
  quantity: number;
  unit_price_cents: number;
  pricebook_item_id: string | null;
  is_upsell: boolean;
};

type EstimateMeta = {
  id: string;
  title: string;
  customer_id: string;
  customer_name: string;
  job_id: string | null;
  tech_id: string | null;
  presentation_mode: EstimatePresentationMode;
  status: string;
};

const OPTIONS: EstimateOption[] = ["good", "better", "best"];
const LABELS: Record<EstimateOption, string> = { good: "Good", better: "Better", best: "Best", base: "Option" };

function cents(n: number) {
  return `$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

let _idCounter = 0;
const nextId = () => `_${++_idCounter}`;

// ─── Pricebook search sheet ───────────────────────────────────────────────────

function PricebookSheet({
  items,
  onSelect,
  onClose,
}: {
  items: PricebookItemRow[];
  onSelect: (item: PricebookItemRow) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const filtered = q
    ? items.filter(
        (i) =>
          i.name.toLowerCase().includes(q.toLowerCase()) ||
          (i.description ?? "").toLowerCase().includes(q.toLowerCase()),
      )
    : items;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/40"
      onClick={onClose}
    >
      <div
        className="mt-auto rounded-t-2xl bg-white max-h-[75vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <input
            autoFocus
            className="flex-1 text-base outline-none placeholder:text-muted-foreground"
            placeholder="Search pricebook…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button onClick={onClose} className="text-sm text-muted-foreground">Cancel</button>
        </div>
        <div className="overflow-y-auto flex-1 pb-safe">
          {filtered.slice(0, 40).map((item) => (
            <button
              key={item.id}
              className="w-full flex items-center justify-between px-4 py-3 border-b last:border-b-0 active:bg-muted text-left"
              onClick={() => onSelect(item)}
            >
              <div>
                <p className="text-sm font-medium text-foreground">{item.name}</p>
                {item.description && (
                  <p className="text-xs text-muted-foreground line-clamp-1">{item.description}</p>
                )}
              </div>
              <span className="text-sm font-semibold text-foreground ml-4 flex-shrink-0">
                {cents(item.price_cents)}
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No items found</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Line item row (mobile) ───────────────────────────────────────────────────

function ItemRow({
  item,
  onChange,
  onRemove,
  onPricebook,
}: {
  item: DraftItem;
  onChange: (patch: Partial<DraftItem>) => void;
  onRemove: () => void;
  onPricebook: () => void;
}) {
  return (
    <div className="border border-muted rounded-xl p-3 space-y-2 bg-white">
      <div className="flex items-start gap-2">
        <input
          className="flex-1 text-sm font-medium text-foreground bg-transparent outline-none border-b border-muted focus:border-blue-500 pb-1"
          placeholder="Description…"
          value={item.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
        <button
          onClick={onPricebook}
          className="p-1.5 rounded-lg bg-blue-50 text-blue-600 flex-shrink-0"
          title="Search pricebook"
        >
          <Search className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onRemove}
          className="p-1.5 rounded-lg bg-red-50 text-red-500 flex-shrink-0"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Qty</span>
          <input
            className="w-12 text-center text-sm font-medium text-foreground bg-transparent border border-muted rounded-lg px-1 py-0.5 outline-none focus:border-blue-500"
            value={item.quantity}
            onChange={(e) => onChange({ quantity: parseFloat(e.target.value) || 1 })}
            inputMode="decimal"
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Price</span>
          <input
            className="w-20 text-right text-sm font-medium text-foreground bg-transparent border border-muted rounded-lg px-2 py-0.5 outline-none focus:border-blue-500"
            value={item.unit_price_cents === 0 ? "" : (item.unit_price_cents / 100).toFixed(2)}
            placeholder="0.00"
            onChange={(e) => {
              const v = parseFloat(e.target.value.replace(/[^0-9.]/g, ""));
              onChange({ unit_price_cents: isNaN(v) ? 0 : Math.round(v * 100) });
            }}
            inputMode="decimal"
          />
        </div>
        <span className="ml-auto text-sm font-semibold text-foreground tabular-nums">
          {cents(Math.round(item.quantity * item.unit_price_cents))}
        </span>
      </div>
    </div>
  );
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export default function TechEstimateBuilder() {
  const { estimateId } = useParams<{ estimateId: string }>();
  const [searchParams] = useSearchParams();
  const jobIdParam = searchParams.get("jobId");

  const { tenant, user } = useAuth();
  const navigate = useNavigate();
  const isNew = !estimateId || estimateId === "new";

  const [loading,   setLoading]   = useState(!isNew);
  const [saving,    setSaving]    = useState(false);
  const [title,     setTitle]     = useState("On-site Estimate");
  const [mode,      setMode]      = useState<EstimatePresentationMode>("good_better_best");
  const [activeTab, setActiveTab] = useState<EstimateOption>("good");
  const [items,     setItems]     = useState<DraftItem[]>([]);
  const [meta,      setMeta]      = useState<EstimateMeta | null>(null);
  const [pricebook, setPricebook] = useState<PricebookItemRow[]>([]);
  const [pbTarget,  setPbTarget]  = useState<EstimateOption | null>(null);
  const techIdRef = useRef<string | null>(null);

  // load pricebook
  useEffect(() => {
    if (!tenant) return;
    void supabase
      .from("pricebook_items")
      .select("*")
      .eq("tenant_id", tenant.id)
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setPricebook((data ?? []) as PricebookItemRow[]));
  }, [tenant]);

  // resolve tech id
  useEffect(() => {
    if (!tenant || !user) return;
    void supabase
      .from("technicians")
      .select("id")
      .eq("user_id", user.id)
      .eq("tenant_id", tenant.id)
      .maybeSingle()
      .then(({ data }) => { techIdRef.current = data?.id ?? null; });
  }, [tenant, user]);

  // load existing estimate
  useEffect(() => {
    if (isNew || !tenant) return;
    void (async () => {
      const { data: est } = await supabase
        .from("estimates")
        .select("*, customers(name)")
        .eq("id", estimateId!)
        .single();
      if (!est) { navigate("/tech/estimates"); return; }

      setTitle(est.title);
      setMode(est.presentation_mode as EstimatePresentationMode);
      setMeta({
        id: est.id,
        title: est.title,
        customer_id: est.customer_id,
        // @ts-expect-error — joined
        customer_name: est.customers?.name ?? "Customer",
        job_id: est.job_id,
        tech_id: est.tech_id,
        presentation_mode: est.presentation_mode as EstimatePresentationMode,
        status: est.status,
      });

      const { data: lineItems } = await supabase
        .from("estimate_line_items")
        .select("*")
        .eq("estimate_id", estimateId!)
        .order("sort_order");
      setItems(
        (lineItems ?? []).map((li) => ({
          _id: nextId(),
          option: li.option as EstimateOption,
          description: li.description,
          quantity: li.quantity,
          unit_price_cents: li.unit_price_cents,
          pricebook_item_id: li.pricebook_item_id,
          is_upsell: li.is_upsell,
        })),
      );
      setLoading(false);
    })();
  }, [isNew, estimateId, tenant, navigate]);

  // pre-fill from job when creating new from job detail
  useEffect(() => {
    if (!isNew || !jobIdParam || !tenant) return;
    void (async () => {
      const { data: job } = await supabase
        .from("jobs")
        .select("id, title, customer_id, customers(name)")
        .eq("id", jobIdParam)
        .single();
      if (!job) return;
      setMeta({
        id: "",
        // @ts-expect-error — joined
        customer_name: job.customers?.name ?? "Customer",
        customer_id: job.customer_id,
        job_id: job.id,
        tech_id: techIdRef.current,
        title: `Estimate — ${job.title ?? "On-site"}`,
        presentation_mode: "good_better_best",
        status: "draft",
      });
      // @ts-expect-error — joined
      setTitle(`Estimate — ${job.customers?.name ?? "On-site"}`);
    })();
  }, [isNew, jobIdParam, tenant]);

  const addItem = (option: EstimateOption) => {
    setItems((prev) => [
      ...prev,
      { _id: nextId(), option, description: "", quantity: 1, unit_price_cents: 0, pricebook_item_id: null, is_upsell: false },
    ]);
  };

  const updateItem = (id: string, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((i) => (i._id === id ? { ...i, ...patch } : i)));
  };

  const removeItem = (id: string) => setItems((prev) => prev.filter((i) => i._id !== id));

  const selectPricebookItem = (pb: PricebookItemRow) => {
    if (!pbTarget) return;
    setItems((prev) => [
      ...prev,
      { _id: nextId(), option: pbTarget, description: pb.name, quantity: 1, unit_price_cents: pb.price_cents, pricebook_item_id: pb.id, is_upsell: false },
    ]);
    setPbTarget(null);
  };

  const tabTotal = (opt: EstimateOption) =>
    items.filter((i) => i.option === opt).reduce((s, i) => s + Math.round(i.quantity * i.unit_price_cents), 0);

  const save = useCallback(async (): Promise<string | null> => {
    if (!tenant) return null;
    if (!meta?.customer_id) {
      toast.error("No customer linked — open estimate from a job.");
      return null;
    }
    setSaving(true);
    try {
      const payload = {
        tenant_id: tenant.id,
        customer_id: meta.customer_id,
        job_id: meta.job_id ?? null,
        tech_id: techIdRef.current,
        title,
        presentation_mode: mode,
        status: "draft",
        valid_until: (() => {
          const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().split("T")[0];
        })(),
        ai_upsell_suggestions: [],
      };

      let estId = !isNew && estimateId ? estimateId : null;
      if (estId) {
        await supabase.from("estimates").update({ title, presentation_mode: mode }).eq("id", estId);
      } else {
        const { data } = await supabase.from("estimates").insert(payload).select("id").single();
        estId = data?.id ?? null;
      }
      if (!estId) throw new Error("No estimate ID");

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
      if (isNew) navigate(`/tech/estimates/${estId}`, { replace: true });
      return estId;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  }, [tenant, meta, title, mode, items, isNew, estimateId, navigate]);

  const saveAndPresent = async () => {
    const id = await save();
    if (id) navigate(`/tech/estimates/${id}/present`);
  };

  const activeItems = items.filter((i) => i.option === activeTab);
  const activeOptions = mode === "good_better_best" ? OPTIONS : (["base"] as EstimateOption[]);

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col pb-40">
        {/* Header */}
        <div className="bg-slate-900 text-white px-4 py-3 flex items-center gap-2">
          <button onClick={() => navigate(-1)}>
            <ChevronLeft className="h-5 w-5 text-slate-400" />
          </button>
          <div className="flex-1 min-w-0">
            <input
              className="w-full bg-transparent text-sm font-semibold text-white outline-none truncate"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            {meta?.customer_name && (
              <p className="text-xs text-slate-400">{meta.customer_name}</p>
            )}
          </div>
          <button
            onClick={() => save().then((id) => id && toast.success("Saved"))}
            disabled={saving}
            className="text-xs text-blue-400 font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 px-4 pt-3 pb-2">
          {(["good_better_best", "single"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "flex-1 py-2 rounded-xl text-xs font-medium border transition-colors",
                mode === m
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200",
              )}
            >
              {m === "good_better_best" ? "Good / Better / Best" : "Single option"}
            </button>
          ))}
        </div>

        {/* Option tabs */}
        {mode === "good_better_best" && (
          <div className="flex px-4 gap-2 pb-3">
            {OPTIONS.map((opt) => {
              const total = tabTotal(opt);
              return (
                <button
                  key={opt}
                  onClick={() => setActiveTab(opt)}
                  className={cn(
                    "flex-1 rounded-xl border py-2.5 transition-colors text-center",
                    activeTab === opt
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-700 border-slate-200",
                  )}
                >
                  <p className="text-[11px] font-medium">{LABELS[opt]}</p>
                  <p className={cn("text-sm font-bold tabular-nums", activeTab === opt ? "text-white" : "text-slate-900")}>
                    {cents(total)}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {/* Line items */}
        <div className="px-4 space-y-2">
          {activeItems.map((item) => (
            <ItemRow
              key={item._id}
              item={item}
              onChange={(patch) => updateItem(item._id, patch)}
              onRemove={() => removeItem(item._id)}
              onPricebook={() => setPbTarget(activeTab)}
            />
          ))}

          <button
            onClick={() => addItem(mode === "good_better_best" ? activeTab : "base")}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-slate-200 text-sm text-slate-500 active:bg-slate-50"
          >
            <Plus className="h-4 w-4" />
            Add line item
          </button>

          <button
            onClick={() => setPbTarget(mode === "good_better_best" ? activeTab : "base")}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-blue-200 bg-blue-50 text-sm text-blue-700 active:bg-blue-100"
          >
            <Search className="h-4 w-4" />
            Add from pricebook
          </button>
        </div>

        {/* Per-option subtotals (GBB only) */}
        {mode === "good_better_best" && (
          <div className="mx-4 mt-4 rounded-xl border border-slate-200 bg-white divide-y">
            {OPTIONS.map((opt) => (
              <div key={opt} className="flex justify-between items-center px-4 py-2.5">
                <span className="text-sm text-slate-600">{LABELS[opt]}</span>
                <span className="text-sm font-semibold text-slate-900 tabular-nums">{cents(tabTotal(opt))}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sticky present button */}
      <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto p-4 bg-white border-t space-y-2">
        <button
          onClick={saveAndPresent}
          disabled={saving || items.filter((i) => i.description.trim()).length === 0}
          className="w-full flex items-center justify-center gap-2 h-14 rounded-xl bg-blue-600 text-white text-base font-semibold disabled:opacity-40 active:bg-blue-700 transition-colors"
        >
          {saving ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Presentation className="h-5 w-5" />
          )}
          Present to Customer
        </button>
        <p className="text-center text-xs text-muted-foreground">
          Saves and opens customer presentation mode
        </p>
      </div>

      {/* Pricebook sheet */}
      {pbTarget && (
        <PricebookSheet
          items={pricebook}
          onSelect={selectPricebookItem}
          onClose={() => setPbTarget(null)}
        />
      )}
    </>
  );
}
