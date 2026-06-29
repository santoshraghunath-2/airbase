import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CheckCircle, ChevronLeft, ChevronRight, Loader2, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ─── Types ───────────────────────────────────────────────────────────────────

type StepKey = 0 | 1 | 2 | 3 | 4;

const STEPS = [
  { label: "Company",   short: "Company" },
  { label: "Phone",     short: "Phone" },
  { label: "Pricebook", short: "Pricebook" },
  { label: "Team",      short: "Team" },
  { label: "Go live",   short: "Go live" },
] as const;

const TRADES = ["Plumbing", "HVAC", "Electrical", "Drain Cleaning", "General"] as const;
type Trade = typeof TRADES[number];

interface TechRow { name: string; phone: string; email: string; }
interface PricebookPreviewRow { name: string; type: string; price: number; confidence: number; }

// ─── Step subcomponents ───────────────────────────────────────────────────────

function StepCompany({
  companyName, setCompanyName,
  trades, setTrades,
  timezone, setTimezone,
}: {
  companyName: string; setCompanyName: (v: string) => void;
  trades: Trade[]; setTrades: (v: Trade[]) => void;
  timezone: string; setTimezone: (v: string) => void;
}) {
  const TIMEZONES = [
    { value: "America/Los_Angeles", label: "Pacific (PT)" },
    { value: "America/Denver",      label: "Mountain (MT)" },
    { value: "America/Chicago",     label: "Central (CT)" },
    { value: "America/New_York",    label: "Eastern (ET)" },
    { value: "America/Phoenix",     label: "Arizona (no DST)" },
  ];

  function toggleTrade(t: Trade) {
    setTrades(trades.includes(t) ? trades.filter((x) => x !== t) : [...trades, t]);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Label className="text-[13px] font-medium text-ink">Company name</Label>
        <Input
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="Steward Home Services"
          className="text-[15px]"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-[13px] font-medium text-ink">Trades you offer</Label>
        <p className="text-xs text-ink-muted">Select all that apply — Jordan uses these to classify inbound jobs.</p>
        <div className="flex flex-wrap gap-2 mt-1">
          {TRADES.map((t) => (
            <button
              key={t}
              onClick={() => toggleTrade(t)}
              className={cn(
                "px-4 py-2 rounded-pill border text-[13px] font-medium transition-colors",
                trades.includes(t)
                  ? "bg-ink text-bone border-transparent"
                  : "bg-raised text-ink-2 border-line hover:bg-panel-warm"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[13px] font-medium text-ink">Timezone</Label>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full rounded-lg border border-field-border bg-raised px-3 py-2.5 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-ai/20 focus:border-ai"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>{tz.label}</option>
          ))}
        </select>
        <p className="text-xs text-ink-muted">Used for scheduling and AI notifications.</p>
      </div>
    </div>
  );
}

function StepPhone() {
  const [mode, setMode] = useState<"provision" | "port">("provision");
  const [portNumber, setPortNumber] = useState("");

  return (
    <div className="space-y-5">
      {/* AI booking line feature card */}
      <div className="rounded-xl border border-ai-tint-border bg-ai-tint px-5 py-4">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-ai text-sm">✦</span>
          <p className="text-[13px] font-semibold text-ai-ink">Jordan's booking line</p>
        </div>
        <p className="text-[13px] text-ai-ink/80 leading-snug">
          Customers call or text this number. Jordan answers, books jobs, and escalates to you only when needed.
          You get a dedicated local number — or port your existing one.
        </p>
      </div>

      {/* Mode selector */}
      <div className="flex gap-2">
        {(["provision", "port"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "flex-1 py-3 rounded-xl border text-[13px] font-medium transition-colors",
              mode === m ? "border-ink bg-paper text-ink shadow-sm" : "border-line bg-raised text-ink-muted hover:bg-paper"
            )}
          >
            {m === "provision" ? "Get a new number" : "Port my existing number"}
          </button>
        ))}
      </div>

      {mode === "provision" ? (
        <div className="rounded-xl border border-line bg-paper px-5 py-4">
          <p className="text-[13px] font-medium text-ink mb-1">Local number in your area</p>
          <p className="text-xs text-ink-muted mb-3">We'll provision a local number after you go live. You'll see it on your dashboard.</p>
          <div className="flex items-center gap-3">
            <div className="h-10 flex-1 rounded-lg bg-bone border border-line flex items-center px-3">
              <span className="text-sm text-ink-muted tabular-nums">(415) 555-XXXX — assigned at go-live</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Label className="text-[13px] font-medium text-ink">Existing number to port</Label>
          <Input
            type="tel"
            value={portNumber}
            onChange={(e) => setPortNumber(e.target.value)}
            placeholder="(408) 555-0100"
          />
          <p className="text-xs text-ink-muted">
            Porting takes 2–5 business days. Your current carrier may charge a fee. We'll guide you through the LOA form after sign-up.
          </p>
        </div>
      )}
    </div>
  );
}

function StepPricebook({ items, setItems }: {
  items: PricebookPreviewRow[];
  setItems: (v: PricebookPreviewRow[]) => void;
}) {
  // Demo-mode only: backend import handled in Settings > Pricebook import
  const DEMO_ITEMS: PricebookPreviewRow[] = [
    { name: "Service call / diagnostic",      type: "service",  price: 89,   confidence: 97 },
    { name: "Drain cleaning — standard",      type: "service",  price: 149,  confidence: 94 },
    { name: "Faucet replacement (supply only)",type: "labor",   price: 195,  confidence: 88 },
    { name: "Water heater — 40 gal install",   type: "service", price: 1650, confidence: 91 },
    { name: "Emergency after-hours fee",       type: "fee",     price: 125,  confidence: 96 },
  ];

  const displayItems = items.length > 0 ? items : DEMO_ITEMS;

  function confidenceClass(c: number) {
    if (c >= 95) return "bg-confirmed-bg text-confirmed-text border-confirmed-border";
    if (c >= 85) return "bg-ai-chip-bg text-ai-ink border-ai-tint-border";
    return "bg-waiting-bg text-waiting-text border-waiting-border";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-ai-tint-border bg-ai-tint">
        <span className="text-sm text-ai">✦</span>
        <p className="text-[13px] text-ai-ink">
          <span className="font-semibold">Skip for now</span> — you can import your full pricebook in Settings after go-live. We'll pre-populate common items for your trade.
        </p>
      </div>

      <div className="rounded-xl border border-line overflow-hidden">
        <div className="flex items-center px-4 py-2.5 bg-panel-warm border-b border-line">
          <span className="flex-1 text-[10px] font-semibold uppercase tracking-widest text-ink-muted">Item</span>
          <span className="w-20 text-right text-[10px] font-semibold uppercase tracking-widest text-ink-muted">Price</span>
          <span className="w-16 text-right text-[10px] font-semibold uppercase tracking-widest text-ink-muted">Confidence</span>
          <span className="w-8" />
        </div>
        {displayItems.map((item, idx) => (
          <div key={idx} className="flex items-center gap-3 px-4 py-3 border-b border-line-2 last:border-b-0 bg-paper hover:bg-raised transition-colors">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-ink font-medium truncate">{item.name}</p>
              <p className="text-[11px] text-ink-muted capitalize">{item.type}</p>
            </div>
            <span className="w-20 text-right text-[13px] font-medium text-ink tabular-nums">
              ${item.price.toLocaleString()}
            </span>
            <span className={cn("w-16 text-right text-[11px] font-semibold border rounded-pill px-1.5 py-0.5 tabular-nums text-right", confidenceClass(item.confidence))}>
              {item.confidence}%
            </span>
            <button
              onClick={() => setItems(displayItems.filter((_, i) => i !== idx))}
              className="w-8 flex justify-end text-ink-muted hover:text-blocked-text transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-muted text-center">
        {displayItems.length} items · Edit or remove any before importing
      </p>
    </div>
  );
}

function StepTeam({ techs, setTechs }: {
  techs: TechRow[];
  setTechs: (v: TechRow[]) => void;
}) {
  function addTech() {
    setTechs([...techs, { name: "", phone: "", email: "" }]);
  }
  function updateTech(idx: number, field: keyof TechRow, val: string) {
    setTechs(techs.map((t, i) => i === idx ? { ...t, [field]: val } : t));
  }
  function removeTech(idx: number) {
    setTechs(techs.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-ink-muted">
        Add your field technicians. They'll receive job assignments and get access to the tech app.
        You can add more from Settings → Team after go-live.
      </p>

      {techs.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-line px-6 py-8 text-center">
          <p className="text-sm text-ink-muted">No technicians added yet</p>
          <button onClick={addTech} className="mt-3 text-sm text-ai hover:text-ai-ink font-medium transition-colors">
            + Add first technician
          </button>
        </div>
      )}

      <div className="space-y-3">
        {techs.map((tech, idx) => (
          <div key={idx} className="rounded-xl border border-line bg-paper px-4 py-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
                Technician {idx + 1}
              </span>
              <button onClick={() => removeTech(idx)} className="text-ink-muted hover:text-blocked-text transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-ink-muted">Name</Label>
                <Input value={tech.name} onChange={(e) => updateTech(idx, "name", e.target.value)} placeholder="Jake Liu" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-ink-muted">Phone</Label>
                <Input type="tel" value={tech.phone} onChange={(e) => updateTech(idx, "phone", e.target.value)} placeholder="(408) 555-0101" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-ink-muted">Email (optional)</Label>
                <Input type="email" value={tech.email} onChange={(e) => updateTech(idx, "email", e.target.value)} placeholder="jake@example.com" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {techs.length > 0 && (
        <button onClick={addTech} className="text-sm text-ai hover:text-ai-ink font-medium transition-colors">
          + Add another technician
        </button>
      )}
    </div>
  );
}

function StepGoLive({ companyName, trades, techCount }: {
  companyName: string; trades: string[]; techCount: number;
}) {
  const checks = [
    { label: "Company profile", done: !!companyName },
    { label: `Trades: ${trades.join(", ") || "none selected"}`, done: trades.length > 0 },
    { label: "AI booking line",  done: true },
    { label: `${techCount} technician${techCount !== 1 ? "s" : ""} added`, done: techCount > 0 },
    { label: "Jordan is ready to handle inbound calls", done: true },
  ];

  return (
    <div className="space-y-5">
      <div className="text-center py-4">
        <div className="h-14 w-14 rounded-full bg-confirmed-bg border-2 border-confirmed-border flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="h-7 w-7 text-confirmed-dot" />
        </div>
        <h2 className="text-xl font-semibold text-ink">{companyName || "Your company"} is ready</h2>
        <p className="text-sm text-ink-muted mt-1">Review what's set up, then go live.</p>
      </div>

      <div className="rounded-xl border border-confirmed-border bg-confirmed-bg px-5 py-4 space-y-3">
        {checks.map(({ label, done }) => (
          <div key={label} className="flex items-center gap-3">
            <span className={cn("h-5 w-5 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0",
              done ? "bg-confirmed-dot text-white" : "bg-line text-ink-muted"
            )}>
              {done ? "✓" : "–"}
            </span>
            <span className={cn("text-[13px]", done ? "text-ink" : "text-ink-muted")}>
              {label}
            </span>
          </div>
        ))}
      </div>

      <p className="text-xs text-ink-muted text-center px-4">
        After going live, Jordan will immediately start handling inbound calls and texts.
        You can adjust AI autonomy anytime in <span className="text-ai">Settings → AI Settings</span>.
      </p>
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const { tenant, refreshTenant } = useAuth();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const navigate = useNavigate();

  const [step, setStep]           = useState<StepKey>(0);
  const [done, setDone]           = useState(false);
  const [saving, setSaving]       = useState(false);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  // Form state
  const [companyName, setCompanyName] = useState(tenant?.name ?? "");
  const [trades, setTrades]           = useState<Trade[]>([]);
  const [timezone, setTimezone]       = useState(tenant?.timezone ?? "America/Los_Angeles");
  const [techs, setTechs]             = useState<TechRow[]>([]);
  const [pricebookItems, setPricebookItems] = useState<PricebookPreviewRow[]>([]);

  function goNext() {
    setCompletedSteps((s) => new Set(s).add(step));
    if (step < 4) setStep((s) => (s + 1) as StepKey);
    else void handleGoLive();
  }

  function goBack() {
    if (step > 0) setStep((s) => (s - 1) as StepKey);
  }

  function jumpTo(s: number) {
    if (completedSteps.has(s) || s < step) setStep(s as StepKey);
  }

  async function handleGoLive() {
    if (!tenant) return;
    setSaving(true);
    try {
      // Save company profile
      await supabase.from("tenants").update({
        name: companyName || tenant.name,
        timezone,
      }).eq("id", tenant.id);

      // Create technicians (TODO backend: also send invite emails)
      for (const tech of techs.filter((t) => t.name.trim())) {
        await supabase.from("technicians").insert({
          tenant_id: tenant.id,
          name:      tech.name.trim(),
          phone:     tech.phone.trim(),
          email:     tech.email.trim() || null,
          is_active: true,
        });
      }

      await refreshTenant();
      setDone(true);
    } catch (err) {
      toast.error("Setup failed", { description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  // ── Done screen
  if (done) {
    return (
      <div className="min-h-screen bg-bone flex flex-col items-center justify-center px-8">
        <div className="max-w-[520px] w-full text-center">
          <div className="h-16 w-16 rounded-full bg-confirmed-bg border-2 border-confirmed-border flex items-center justify-center mx-auto mb-5">
            <CheckCircle className="h-8 w-8 text-confirmed-dot" />
          </div>
          <h1 className="text-2xl font-semibold text-ink">{companyName || tenant?.name} is live</h1>
          <p className="text-sm text-ink-muted mt-2 mb-8">
            Jordan is ready to handle inbound calls and texts. Head to the dashboard to see your first jobs roll in.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => navigate(`/${tenantSlug}/dashboard`)}
              className="px-6 py-3 rounded-xl bg-ink text-bone text-sm font-semibold hover:bg-ink-hover transition-colors"
            >
              Open dashboard
            </button>
            <button
              onClick={() => navigate(`/${tenantSlug}/booking`)}
              className="px-6 py-3 rounded-xl border border-line bg-raised text-ink text-sm font-medium hover:bg-panel-warm transition-colors"
            >
              View booking inbox
            </button>
          </div>
          <button
            onClick={() => { setDone(false); setStep(0); setCompletedSteps(new Set()); }}
            className="mt-4 text-xs text-ink-muted hover:text-ink transition-colors"
          >
            Run setup again
          </button>
        </div>
      </div>
    );
  }

  const isLastStep = step === 4;
  const canGoNext  =
    step === 0 ? companyName.trim().length > 0 && trades.length > 0 :
    step === 1 ? true :
    step === 2 ? true :
    step === 3 ? true :
                 true;

  return (
    <div className="min-h-screen bg-bone flex flex-col">
      {/* Top bar */}
      <div className="h-14 border-b border-line bg-paper flex items-center px-8">
        <div className="flex items-center gap-2">
          <span className="h-6 w-6 rounded flex items-center justify-center text-xs font-bold bg-ink text-bone">A</span>
          <span className="font-semibold text-sm text-ink">Airbase</span>
        </div>
        <span className="ml-auto text-xs text-ink-muted tabular-nums">
          Step {step + 1} of {STEPS.length}
        </span>
      </div>

      {/* Centered content */}
      <div className="flex-1 flex flex-col items-center py-10 px-8">
        <div className="w-full max-w-[680px]">

          {/* Stepper pills */}
          <div className="flex items-center gap-1.5 mb-8 justify-center flex-wrap">
            {STEPS.map((s, i) => {
              const isDone    = completedSteps.has(i);
              const isCurrent = step === i;
              const isPast    = i < step;
              const isClickable = isDone || isPast;

              return (
                <button
                  key={i}
                  onClick={() => jumpTo(i)}
                  disabled={!isClickable}
                  className={cn(
                    "flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill text-[12px] font-semibold transition-colors",
                    isCurrent ? "bg-ink text-bone" :
                    isDone    ? "bg-confirmed-bg text-confirmed-text border border-confirmed-border cursor-pointer hover:bg-confirmed-border" :
                    isPast    ? "bg-paper text-ink border border-line cursor-pointer hover:bg-panel-warm" :
                                "bg-raised text-ink-muted border border-line cursor-default opacity-50"
                  )}
                >
                  {isDone && <span className="text-[10px]">✓</span>}
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Card */}
          <div className="rounded-xl border border-line bg-paper px-8 py-8 min-h-[392px]">
            <h2 className="text-[19px] font-semibold text-ink mb-1">
              {step === 0 && "Tell us about your company"}
              {step === 1 && "Set up your AI booking line"}
              {step === 2 && "Import your pricebook"}
              {step === 3 && "Add your team"}
              {step === 4 && "Ready to go live"}
            </h2>
            <p className="text-sm text-ink-muted mb-6">
              {step === 0 && "Jordan uses this to introduce your company to customers."}
              {step === 1 && "One number for all AI-handled calls and texts."}
              {step === 2 && "Jordan uses these prices when building quotes and invoices."}
              {step === 3 && "Field techs receive job assignments and app access."}
              {step === 4 && "Review your setup before Jordan starts answering calls."}
            </p>

            {step === 0 && (
              <StepCompany
                companyName={companyName} setCompanyName={setCompanyName}
                trades={trades} setTrades={setTrades}
                timezone={timezone} setTimezone={setTimezone}
              />
            )}
            {step === 1 && <StepPhone />}
            {step === 2 && <StepPricebook items={pricebookItems} setItems={setPricebookItems} />}
            {step === 3 && <StepTeam techs={techs} setTechs={setTechs} />}
            {step === 4 && (
              <StepGoLive companyName={companyName} trades={trades} techCount={techs.filter((t) => t.name.trim()).length} />
            )}
          </div>

          {/* Footer nav */}
          <div className="flex items-center justify-between mt-5">
            <button
              onClick={goBack}
              disabled={step === 0}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-line bg-raised text-sm font-medium text-ink-2 hover:bg-panel-warm disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
            <span className="text-xs text-ink-muted tabular-nums">
              {step + 1} / {STEPS.length}
            </span>
            <button
              onClick={goNext}
              disabled={!canGoNext || saving}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-ink text-bone text-sm font-semibold hover:bg-ink-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isLastStep ? (saving ? "Saving…" : "Go live") : <>Continue <ChevronRight className="h-4 w-4" /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
