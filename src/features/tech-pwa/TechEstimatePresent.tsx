import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, ChevronLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import type { EstimateOption } from "@/types/database.types";

type LineItem = {
  option: EstimateOption;
  description: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
};

type EstimateData = {
  id: string;
  title: string;
  customer_name: string;
  presentation_mode: string;
  status: string;
  notes: string | null;
  valid_until: string | null;
  selected_option: EstimateOption | null;
};

const OPTIONS: EstimateOption[] = ["good", "better", "best"];

const OPTION_CONFIG = {
  good: {
    label: "Good",
    sublabel: "Essential fix",
    border: "border-slate-200",
    header: "bg-slate-50",
    badge: "bg-slate-100 text-slate-700",
    button: "bg-slate-900 text-white active:bg-slate-700",
    ring: "ring-2 ring-slate-400",
  },
  better: {
    label: "Better",
    sublabel: "Most popular",
    border: "border-blue-300",
    header: "bg-blue-600",
    badge: "bg-blue-100 text-blue-700",
    button: "bg-blue-600 text-white active:bg-blue-700",
    ring: "ring-2 ring-blue-500",
    popular: true,
  },
  best: {
    label: "Best",
    sublabel: "Full protection",
    border: "border-amber-300",
    header: "bg-amber-500",
    badge: "bg-amber-100 text-amber-700",
    button: "bg-amber-500 text-white active:bg-amber-600",
    ring: "ring-2 ring-amber-400",
  },
  base: {
    label: "Option",
    sublabel: "",
    border: "border-slate-200",
    header: "bg-slate-50",
    badge: "bg-slate-100 text-slate-700",
    button: "bg-slate-900 text-white active:bg-slate-700",
    ring: "ring-2 ring-slate-400",
  },
};

function cents(n: number) {
  return `$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function OptionCard({
  option,
  items,
  selected,
  accepted,
  onSelect,
}: {
  option: EstimateOption;
  items: LineItem[];
  selected: EstimateOption | null;
  accepted: boolean;
  onSelect: (opt: EstimateOption) => void;
}) {
  const cfg = OPTION_CONFIG[option];
  const total = items.reduce((s, i) => s + i.total_cents, 0);
  const isSelected = selected === option;

  return (
    <div
      className={cn(
        "rounded-2xl border-2 overflow-hidden transition-all duration-200",
        cfg.border,
        isSelected && cfg.ring,
        "popular" in cfg && cfg.popular && !selected ? "scale-[1.02]" : "",
      )}
    >
      {/* Card header */}
      <div className={cn("px-5 py-4 relative", cfg.header)}>
        {"popular" in cfg && cfg.popular && (
          <div className="absolute top-0 right-4 transform -translate-y-1/2">
            <span className="text-[10px] font-bold uppercase tracking-wide bg-blue-600 text-white px-2.5 py-1 rounded-full border-2 border-white">
              Most Popular
            </span>
          </div>
        )}
        <div className="flex items-end justify-between">
          <div>
            <p className={cn("text-xs font-medium mb-0.5", option === "better" ? "text-blue-100" : "text-slate-500")}>
              {cfg.sublabel}
            </p>
            <p className={cn("text-2xl font-bold", option === "better" ? "text-white" : "text-slate-900")}>
              {cfg.label}
            </p>
          </div>
          <div className="text-right">
            <p className={cn("text-3xl font-bold tabular-nums", option === "better" ? "text-white" : "text-slate-900")}>
              {cents(total)}
            </p>
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="px-5 py-4 bg-white space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="text-sm text-slate-700">{item.description}</span>
              {item.quantity !== 1 && (
                <span className="text-xs text-slate-400 ml-1">×{item.quantity}</span>
              )}
            </div>
            <span className="text-sm font-medium text-slate-900 tabular-nums flex-shrink-0">
              {cents(item.total_cents)}
            </span>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-sm text-slate-400 italic">No items added</p>
        )}
      </div>

      {/* CTA */}
      <div className="px-4 pb-4 bg-white">
        {accepted && isSelected ? (
          <div className="flex items-center justify-center gap-2 h-12 rounded-xl bg-green-50 border border-green-200 text-green-700 font-medium">
            <CheckCircle2 className="h-5 w-5" />
            Selected
          </div>
        ) : (
          <button
            onClick={() => !accepted && onSelect(option)}
            disabled={accepted}
            className={cn(
              "w-full h-12 rounded-xl text-base font-semibold transition-all disabled:opacity-40",
              isSelected ? cfg.button : "bg-slate-100 text-slate-700 active:bg-slate-200",
              !accepted && "active:scale-95",
            )}
          >
            {isSelected ? "✓ Choose this option" : `Choose ${cfg.label}`}
          </button>
        )}
      </div>
    </div>
  );
}

export default function TechEstimatePresent() {
  const { estimateId } = useParams<{ estimateId: string }>();
  const { tenant } = useAuth();
  const navigate = useNavigate();

  const [estimate, setEstimate] = useState<EstimateData | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EstimateOption | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!estimateId || !tenant) return;
    void (async () => {
      const { data: est } = await supabase
        .from("estimates")
        .select("id, title, presentation_mode, status, notes, valid_until, selected_option, customers(name)")
        .eq("id", estimateId)
        .single();
      if (!est) { navigate("/tech/estimates"); return; }

      setEstimate({
        id: est.id,
        title: est.title,
        // @ts-expect-error — joined
        customer_name: est.customers?.name ?? "Customer",
        presentation_mode: est.presentation_mode,
        status: est.status,
        notes: est.notes,
        valid_until: est.valid_until,
        selected_option: est.selected_option as EstimateOption | null,
      });

      if (est.status === "accepted" && est.selected_option) {
        setSelected(est.selected_option as EstimateOption);
        setAccepted(true);
      }

      const { data: items } = await supabase
        .from("estimate_line_items")
        .select("option, description, quantity, unit_price_cents, total_cents")
        .eq("estimate_id", estimateId)
        .order("sort_order");
      setLineItems((items ?? []) as LineItem[]);
      setLoading(false);
    })();
  }, [estimateId, tenant, navigate]);

  const confirmSelection = async () => {
    if (!selected || !estimate || !tenant) return;
    setConfirming(true);
    try {
      await supabase
        .from("estimates")
        .update({
          selected_option: selected,
          status: "accepted",
          accepted_at: new Date().toISOString(),
        })
        .eq("id", estimate.id);
      setAccepted(true);
      toast.success("Option selected — great choice!");
    } catch {
      toast.error("Failed to save selection.");
    } finally {
      setConfirming(false);
    }
  };

  const displayOptions: EstimateOption[] =
    estimate?.presentation_mode === "good_better_best" ? OPTIONS : ["base"];

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  // ── Accepted thank-you screen ─────────────────────────────────────────────
  if (accepted && selected) {
    const cfg = OPTION_CONFIG[selected];
    const selectedItems = lineItems.filter((i) => i.option === selected || i.option === "base");
    const total = selectedItems.reduce((s, i) => s + i.total_cents, 0);

    return (
      <div className="min-h-screen bg-white flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mb-6">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            {estimate?.customer_name?.split(" ")[0] ?? "Thank you"}!
          </h1>
          <p className="text-slate-500 mb-6">
            You've selected the <strong className="text-slate-900">{cfg.label}</strong> option for {cents(total)}.
          </p>
          <div className="w-full max-w-xs rounded-xl border border-slate-200 divide-y text-left mb-8">
            {selectedItems.map((item, i) => (
              <div key={i} className="flex items-center gap-2 px-4 py-2.5">
                <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                <span className="text-sm text-slate-700 flex-1">{item.description}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400">Your technician will proceed with this option.</p>
        </div>

        <div className="p-6 border-t">
          <button
            onClick={() => navigate(-1)}
            className="w-full flex items-center justify-center gap-2 h-12 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium active:bg-slate-50"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to job
          </button>
        </div>
      </div>
    );
  }

  // ── Presentation screen ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 pb-32">
      {/* Top bar — minimal, customer-facing */}
      <div className="bg-white border-b px-4 py-4 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-1 -ml-1 text-slate-500"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-base font-bold text-slate-900">{estimate?.title}</h1>
          <p className="text-xs text-slate-500">
            {estimate?.customer_name} · Choose the option that works best for you
          </p>
        </div>
      </div>

      {/* Cards */}
      <div className="px-4 pt-5 space-y-4">
        {displayOptions.map((opt) => (
          <OptionCard
            key={opt}
            option={opt}
            items={lineItems.filter((i) => i.option === opt)}
            selected={selected}
            accepted={accepted}
            onSelect={setSelected}
          />
        ))}

        {estimate?.notes && (
          <div className="rounded-xl bg-white border border-slate-200 px-4 py-3">
            <p className="text-xs font-medium text-slate-500 mb-1">Notes</p>
            <p className="text-sm text-slate-700">{estimate.notes}</p>
          </div>
        )}

        {estimate?.valid_until && (
          <p className="text-center text-xs text-slate-400">
            Estimate valid until{" "}
            {new Date(estimate.valid_until).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </p>
        )}
      </div>

      {/* Sticky confirm bar */}
      {selected && !accepted && (
        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto p-4 bg-white border-t">
          <button
            onClick={confirmSelection}
            disabled={confirming}
            className="w-full h-14 rounded-xl bg-green-600 text-white text-lg font-bold active:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {confirming ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <CheckCircle2 className="h-5 w-5" />
                Confirm — {OPTION_CONFIG[selected].label} ({cents(lineItems.filter(i => i.option === selected).reduce((s,i) => s+i.total_cents,0))})
              </>
            )}
          </button>
          <button
            onClick={() => setSelected(null)}
            className="w-full text-center text-sm text-slate-500 mt-2"
          >
            Cancel selection
          </button>
        </div>
      )}
    </div>
  );
}
