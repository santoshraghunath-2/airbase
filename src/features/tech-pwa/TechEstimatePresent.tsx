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
    border: "border-line",
    header: "bg-raised",
    badge: "bg-bone text-ink-muted",
    button: "bg-ink text-paper active:bg-ink-hover",
    ring: "ring-2 ring-ink",
    headerText: false,
  },
  better: {
    label: "Better",
    sublabel: "Most popular",
    border: "border-ai-tint-border",
    header: "bg-ai",
    badge: "bg-ai-chip-bg text-ai-ink",
    button: "bg-ai text-paper active:bg-ai-ink",
    ring: "ring-2 ring-ai",
    popular: true,
    headerText: true,
  },
  best: {
    label: "Best",
    sublabel: "Full protection",
    border: "border-waiting-border",
    header: "bg-waiting-dot",
    badge: "bg-waiting-bg text-waiting-text",
    button: "bg-waiting-dot text-paper active:opacity-90",
    ring: "ring-2 ring-waiting-dot",
    headerText: true,
  },
  base: {
    label: "Option",
    sublabel: "",
    border: "border-line",
    header: "bg-raised",
    badge: "bg-bone text-ink-muted",
    button: "bg-ink text-paper active:bg-ink-hover",
    ring: "ring-2 ring-ink",
    headerText: false,
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
            <span className="text-[10px] font-bold uppercase tracking-wide bg-ai text-paper px-2.5 py-1 rounded-full border-2 border-paper">
              Most Popular
            </span>
          </div>
        )}
        <div className="flex items-end justify-between">
          <div>
            <p className={cn("text-xs font-medium mb-0.5", cfg.headerText ? "text-white/70" : "text-ink-muted")}>
              {cfg.sublabel}
            </p>
            <p className={cn("text-2xl font-bold", cfg.headerText ? "text-white" : "text-ink")}>
              {cfg.label}
            </p>
          </div>
          <div className="text-right">
            <p className={cn("text-3xl font-bold tabular-nums", cfg.headerText ? "text-white" : "text-ink")}>
              {cents(total)}
            </p>
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="px-5 py-4 bg-paper space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-confirmed-text flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="text-sm text-ink">{item.description}</span>
              {item.quantity !== 1 && (
                <span className="text-xs text-ink-muted ml-1">×{item.quantity}</span>
              )}
            </div>
            <span className="text-sm font-medium text-ink tabular-nums flex-shrink-0">
              {cents(item.total_cents)}
            </span>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-sm text-ink-muted italic">No items added</p>
        )}
      </div>

      {/* CTA */}
      <div className="px-4 pb-4 bg-paper">
        {accepted && isSelected ? (
          <div className="flex items-center justify-center gap-2 h-12 rounded-xl bg-confirmed-bg border border-confirmed-border text-confirmed-text font-medium">
            <CheckCircle2 className="h-5 w-5" />
            Selected
          </div>
        ) : (
          <button
            onClick={() => !accepted && onSelect(option)}
            disabled={accepted}
            className={cn(
              "w-full h-12 rounded-xl text-base font-semibold transition-all disabled:opacity-40",
              isSelected ? cfg.button : "bg-raised text-ink border border-line active:bg-bone",
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
      <div className="min-h-screen bg-bone flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
      </div>
    );
  }

  // ── Accepted thank-you screen ─────────────────────────────────────────────
  if (accepted && selected) {
    const cfg = OPTION_CONFIG[selected];
    const selectedItems = lineItems.filter((i) => i.option === selected || i.option === "base");
    const total = selectedItems.reduce((s, i) => s + i.total_cents, 0);

    return (
      <div className="min-h-screen bg-bone flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="w-20 h-20 rounded-full bg-confirmed-bg border border-confirmed-border flex items-center justify-center mb-6">
            <CheckCircle2 className="h-10 w-10 text-confirmed-text" />
          </div>
          <h1 className="text-2xl font-bold text-ink mb-2">
            {estimate?.customer_name?.split(" ")[0] ?? "Thank you"}!
          </h1>
          <p className="text-ink-muted mb-6">
            You've selected the <strong className="text-ink">{cfg.label}</strong> option for {cents(total)}.
          </p>
          <div className="w-full max-w-xs rounded-xl border border-line bg-paper divide-y divide-line text-left mb-8">
            {selectedItems.map((item, i) => (
              <div key={i} className="flex items-center gap-2 px-4 py-2.5">
                <CheckCircle2 className="h-4 w-4 text-confirmed-text flex-shrink-0" />
                <span className="text-sm text-ink flex-1">{item.description}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-faint">Your technician will proceed with this option.</p>
        </div>

        <div className="p-6 border-t border-line bg-paper">
          <button
            onClick={() => navigate(-1)}
            className="w-full flex items-center justify-center gap-2 h-12 rounded-xl border border-line text-ink text-sm font-medium active:bg-raised"
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
    <div className="min-h-screen bg-bone pb-32">
      {/* Top bar — minimal, customer-facing */}
      <div className="bg-paper border-b border-line px-4 py-4 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-1 -ml-1 text-ink-muted"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-base font-bold text-ink">{estimate?.title}</h1>
          <p className="text-xs text-ink-muted">
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
          <div className="rounded-xl bg-paper border border-line px-4 py-3">
            <p className="text-xs font-medium text-ink-muted mb-1">Notes</p>
            <p className="text-sm text-ink">{estimate.notes}</p>
          </div>
        )}

        {estimate?.valid_until && (
          <p className="text-center text-xs text-faint">
            Estimate valid until{" "}
            {new Date(estimate.valid_until).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </p>
        )}
      </div>

      {/* Sticky confirm bar */}
      {selected && !accepted && (
        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto p-4 bg-paper border-t border-line">
          <button
            onClick={confirmSelection}
            disabled={confirming}
            className="w-full h-14 rounded-xl bg-confirmed-dot text-paper text-lg font-bold active:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
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
            className="w-full text-center text-sm text-ink-muted mt-2"
          >
            Cancel selection
          </button>
        </div>
      )}
    </div>
  );
}
