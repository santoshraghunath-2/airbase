import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2, Clock, Map, MessageSquare, Users, CreditCard, Link as LinkIcon,
  Loader2, CheckCircle2, Trash2, ExternalLink, ChevronRight,
  ToggleLeft, ToggleRight, Phone, BookOpen,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PricebookItem { name: string; description: string; unit_price: number; category: string; unit: string; }

const TIMEZONES = [
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Denver",      label: "Mountain (MT)" },
  { value: "America/Phoenix",     label: "Arizona (no DST)" },
  { value: "America/Chicago",     label: "Central (CT)" },
  { value: "America/New_York",    label: "Eastern (ET)" },
  { value: "America/Anchorage",   label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu",    label: "Hawaii (HT)" },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
type Day = typeof DAYS[number];

interface DayHours { open: boolean; from: string; to: string; }
type WeekHours = Record<Day, DayHours>;

const DEFAULT_HOURS: WeekHours = Object.fromEntries(
  DAYS.map((d) => [d, { open: ["Mon","Tue","Wed","Thu","Fri"].includes(d), from: "08:00", to: "17:00" }])
) as WeekHours;

type AfterHours = "message" | "emergency" | "anytime";
type AreaMode   = "radius" | "zips";
type SaveState  = "idle" | "saving" | "saved";

// ─── Auto-save hook ──────────────────────────────────────────────────────────

function useAutoSave<T extends Record<string, unknown>>(
  initialData: T | null,
  saveFn: (data: T) => Promise<void>,
  delay = 650,
): { data: T | null; set: (patch: Partial<T>) => void; saveState: SaveState } {
  const [data, setData] = useState<T | null>(initialData);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialData && !initialized.current) {
      setData(initialData);
      initialized.current = true;
    }
  }, [initialData]);

  const set = useCallback((patch: Partial<T>) => {
    setData((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      setSaveState("saving");
      clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        try { await saveFn(next); setSaveState("saved"); }
        catch { setSaveState("idle"); }
        setTimeout(() => setSaveState("idle"), 3000);
      }, delay);
      return next;
    });
  }, [saveFn, delay]);

  return { data, set, saveState };
}

// ─── Save indicator ──────────────────────────────────────────────────────────

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return <span className="text-xs text-ink-muted">All changes saved</span>;
  if (state === "saving") return (
    <span className="flex items-center gap-1.5 text-xs text-ink-muted">
      <Loader2 className="h-3 w-3 animate-spin" /> Saving…
    </span>
  );
  return (
    <span className="flex items-center gap-1.5 text-xs text-confirmed-text">
      <CheckCircle2 className="h-3 w-3" /> Saved just now
    </span>
  );
}

// ─── Helper: field group ─────────────────────────────────────────────────────

function Field({ label, helper, children }: { label: string; helper?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[13px] font-medium text-ink">{label}</Label>
      {children}
      {helper && <p className="text-xs text-ink-muted">{helper}</p>}
    </div>
  );
}

// ─── Section components ──────────────────────────────────────────────────────

function CompanyProfileSection({ isOwner }: { isOwner: boolean }) {
  const { tenant, refreshTenant } = useAuth();

  const saveFn = useCallback(async (d: typeof form) => {
    if (!tenant) return;
    const { error } = await supabase.from("tenants").update({
      name: d.name || tenant.name,
      phone: d.phone || null,
      address: d.address || null,
      timezone: d.timezone,
    }).eq("id", tenant.id);
    if (error) throw error;
    await refreshTenant();
  }, [tenant]);

  const form = { name: tenant?.name ?? "", phone: tenant?.phone ?? "", address: tenant?.address ?? "", timezone: tenant?.timezone ?? "America/Los_Angeles" };
  const { data, set, saveState } = useAutoSave(tenant ? form : null, saveFn);

  if (!data) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-5">
      <Field label="Company name" helper="Shown to customers in all AI messages.">
        <Input value={data.name} onChange={(e) => set({ name: e.target.value })} disabled={!isOwner} placeholder="Steward Home Services" />
      </Field>
      <Field label="Business phone" helper="Used as the main callback number.">
        <Input type="tel" value={data.phone} onChange={(e) => set({ phone: e.target.value })} disabled={!isOwner} placeholder="(408) 555-0100" />
      </Field>
      <Field label="Address" helper="Used for drive-time calculations.">
        <Input value={data.address} onChange={(e) => set({ address: e.target.value })} disabled={!isOwner} placeholder="1234 Tech Blvd, San Jose, CA 95101" />
      </Field>
      <Field label="Timezone" helper="Used for scheduling, job times, and AI notifications.">
        <Select value={data.timezone} onValueChange={(v) => set({ timezone: v })} disabled={!isOwner}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((tz) => <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <div className="flex justify-end pt-1">
        <SaveIndicator state={saveState} />
      </div>
    </div>
  );
}

function HoursSection({ isOwner }: { isOwner: boolean }) {
  // TODO (backend): tenant_hours table not yet created. Currently local state only.
  const [hours, setHours] = useState<WeekHours>(DEFAULT_HOURS);
  const [afterHours, setAfterHours] = useState<AfterHours>("message");

  function toggleDay(day: Day) {
    setHours((h) => ({ ...h, [day]: { ...h[day], open: !h[day].open } }));
    toast.success("Hours updated (pending backend save)");
  }
  function setTime(day: Day, field: "from" | "to", val: string) {
    setHours((h) => ({ ...h, [day]: { ...h[day], [field]: val } }));
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line overflow-hidden">
        {DAYS.map((day) => {
          const dh = hours[day];
          return (
            <div key={day} className="flex items-center gap-4 px-5 py-3.5 border-b border-line-2 last:border-b-0 bg-paper hover:bg-raised transition-colors">
              <span className="w-8 text-sm font-medium text-ink">{day}</span>
              <button
                onClick={() => isOwner && toggleDay(day)}
                className="flex items-center gap-1.5 text-xs font-medium transition-colors"
                disabled={!isOwner}
              >
                {dh.open
                  ? <><ToggleRight className="h-5 w-5 text-confirmed-dot" /><span className="text-confirmed-text">Open</span></>
                  : <><ToggleLeft className="h-5 w-5 text-ink-muted" /><span className="text-ink-muted">Closed</span></>
                }
              </button>
              {dh.open && (
                <div className="flex items-center gap-2 ml-auto">
                  <input
                    type="time" value={dh.from} disabled={!isOwner}
                    onChange={(e) => setTime(day, "from", e.target.value)}
                    className="text-sm text-ink bg-raised border border-field-border rounded-lg px-2 py-1.5 tabular-nums"
                  />
                  <span className="text-ink-muted text-xs">to</span>
                  <input
                    type="time" value={dh.to} disabled={!isOwner}
                    onChange={(e) => setTime(day, "to", e.target.value)}
                    className="text-sm text-ink bg-raised border border-field-border rounded-lg px-2 py-1.5 tabular-nums"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <Label className="text-[13px] font-medium text-ink">After-hours calls</Label>
        {(["message", "emergency", "anytime"] as const).map((opt) => {
          const labels = {
            message:   { title: "Take a message", sub: "Jordan greets callers and collects info. No jobs booked." },
            emergency: { title: "Book emergencies only", sub: "Jordan books urgent jobs outside hours, holds the rest." },
            anytime:   { title: "Book anytime", sub: "Jordan books jobs 24 / 7 just like business hours." },
          };
          const { title, sub } = labels[opt];
          return (
            <label key={opt} className={cn(
              "flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors",
              afterHours === opt ? "border-ink bg-paper" : "border-line bg-raised hover:bg-paper",
            )}>
              <input
                type="radio" value={opt} checked={afterHours === opt}
                onChange={() => setAfterHours(opt)} disabled={!isOwner}
                className="mt-0.5 accent-ink"
              />
              <div>
                <p className="text-sm font-medium text-ink">{title}</p>
                <p className="text-xs text-ink-muted mt-0.5">{sub}</p>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function ServiceAreaSection({ isOwner }: { isOwner: boolean }) {
  // TODO (backend): service_area columns not yet on tenants table.
  const [mode, setMode] = useState<AreaMode>("radius");
  const [radius, setRadius] = useState(25);
  const [zips, setZips] = useState<string[]>(["94103", "94110", "94115", "94117", "94118"]);
  const [zipInput, setZipInput] = useState("");

  function addZip() {
    const z = zipInput.trim();
    if (z && !zips.includes(z)) { setZips((s) => [...s, z]); setZipInput(""); }
  }

  return (
    <div className="space-y-5">
      {/* Mode selector */}
      <div className="flex gap-2">
        {(["radius", "zips"] as const).map((m) => (
          <button
            key={m}
            onClick={() => isOwner && setMode(m)}
            className={cn(
              "flex-1 py-2.5 rounded-lg border text-sm font-medium transition-colors",
              mode === m ? "border-ink bg-paper text-ink" : "border-line bg-raised text-ink-muted hover:bg-paper"
            )}
          >
            {m === "radius" ? "Distance from base" : "Specific ZIP codes"}
          </button>
        ))}
      </div>

      {mode === "radius" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-[13px] font-medium text-ink">Service radius</Label>
            <span className="text-sm font-semibold text-ink tabular-nums">{radius} mi</span>
          </div>
          <input
            type="range" min={5} max={60} step={5} value={radius}
            onChange={(e) => setRadius(Number(e.target.value))} disabled={!isOwner}
            className="w-full accent-ink"
          />
          {/* Visual circle representation */}
          <div className="flex items-center justify-center py-2">
            <div className="relative" style={{ width: 120, height: 120 }}>
              <div className="absolute inset-0 rounded-full border-2 border-ai-tint-border bg-ai-tint opacity-40" />
              <div
                className="absolute rounded-full border-2 border-ai bg-ai-tint"
                style={{
                  width: `${Math.round((radius / 60) * 100)}%`,
                  height: `${Math.round((radius / 60) * 100)}%`,
                  top: "50%", left: "50%",
                  transform: "translate(-50%, -50%)",
                  opacity: 0.6,
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-semibold text-ai tabular-nums">{radius} mi</span>
              </div>
            </div>
          </div>
          <p className="text-xs text-ink-muted text-center">
            Approx. {Math.round(Math.PI * radius * radius * 0.8)} sq mi coverage
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Add ZIP code"
              value={zipInput}
              onChange={(e) => setZipInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addZip()}
              disabled={!isOwner}
            />
            <button
              onClick={addZip} disabled={!isOwner}
              className="px-4 py-2 rounded-lg bg-ink text-bone text-sm font-medium hover:bg-ink-hover transition-colors disabled:opacity-40"
            >
              Add
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {zips.map((z) => (
              <span key={z} className="flex items-center gap-1 px-2.5 py-1 rounded-pill bg-paper border border-line text-sm font-medium text-ink">
                {z}
                {isOwner && (
                  <button onClick={() => setZips((s) => s.filter((x) => x !== z))} className="text-ink-muted hover:text-blocked-text ml-0.5">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
          {zips.length > 0 && (
            <p className="text-xs text-ink-muted">{zips.length} ZIP codes · AI won't book outside these areas</p>
          )}
        </div>
      )}
    </div>
  );
}

function CustomerIdentitySection({ isOwner }: { isOwner: boolean }) {
  // TODO (backend): sms_sender_name, reply_to_email, brand_color not yet on tenants table.
  const { tenant } = useAuth();
  const [smsName, setSmsName]     = useState("Steward Home");
  const [replyEmail, setReplyEmail] = useState("");
  const [reviewLink, setReviewLink] = useState((tenant as unknown as Record<string, string>)?.google_review_url ?? "");
  const [accentColor, setAccentColor] = useState("#5B6B9E");

  const ACCENT_SWATCHES = ["#5B6B9E", "#4C6749", "#8A6A22", "#A85A40", "#292420"];

  return (
    <div className="space-y-5">
      <Field label="SMS sender name" helper="Max 11 chars. Shown as the sender name in text messages.">
        <Input value={smsName} onChange={(e) => setSmsName(e.target.value.slice(0, 11))} disabled={!isOwner} maxLength={11} />
        <div className="mt-1.5 rounded-xl border border-field-border bg-raised px-4 py-3 flex items-start gap-3">
          <div className="flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-muted mb-1">Preview</p>
            <p className="text-xs text-ink-muted mb-0.5 font-medium">{smsName || "Your Company"}</p>
            <div className="rounded-xl bg-paper border border-line px-3 py-2 text-sm text-ink max-w-[220px]">
              Hi! Your tech is 10 min away. — Jordan
            </div>
          </div>
        </div>
      </Field>
      <Field label="Reply-to email" helper="Customer replies to AI emails go here.">
        <Input type="email" value={replyEmail} onChange={(e) => setReplyEmail(e.target.value)} disabled={!isOwner} placeholder="hello@yourcompany.com" />
      </Field>
      <Field label="Google review link" helper="Sent to customers after job completion.">
        <div className="flex gap-2">
          <Input type="url" value={reviewLink} onChange={(e) => setReviewLink(e.target.value)} disabled={!isOwner} placeholder="https://g.page/r/.../review" />
          {reviewLink && (
            <a href={reviewLink} target="_blank" rel="noreferrer" className="h-10 w-10 flex items-center justify-center rounded-lg border border-line bg-raised hover:bg-panel-warm transition-colors">
              <ExternalLink className="h-4 w-4 text-ink-muted" />
            </a>
          )}
        </div>
      </Field>
      <div className="space-y-1.5">
        <Label className="text-[13px] font-medium text-ink">Brand accent</Label>
        <p className="text-xs text-ink-muted">Used in email headers and customer-facing materials.</p>
        <div className="flex gap-2 mt-1">
          {ACCENT_SWATCHES.map((c) => (
            <button
              key={c}
              onClick={() => setAccentColor(c)}
              className={cn("h-8 w-8 rounded-lg border-2 transition-all", accentColor === c ? "border-ink scale-110" : "border-transparent")}
              style={{ background: c }}
            />
          ))}
          <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="h-8 w-8 rounded-lg cursor-pointer border border-line" />
        </div>
      </div>
    </div>
  );
}

function TeamSection({ isOwner: _isOwner }: { isOwner: boolean }) {
  const { tenant } = useAuth();
  const [users, setUsers]       = useState<Array<{ id: string; name: string; email: string; role: string; is_active: boolean }>>([]);
  const [techs, setTechs]       = useState<Array<{ id: string; name: string; phone: string; is_active: boolean }>>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!tenant) return;
    void (async () => {
      const [uRes, tRes] = await Promise.all([
        supabase.from("users").select("id,name,email,role,is_active").eq("tenant_id", tenant.id).order("name"),
        supabase.from("technicians").select("id,name,phone,is_active").eq("tenant_id", tenant.id).order("name"),
      ]);
      setUsers((uRes.data ?? []) as typeof users);
      setTechs((tRes.data ?? []) as typeof techs);
      setLoading(false);
    })();
  }, [tenant]);

  const ROLE_LABELS: Record<string, string> = {
    owner: "Owner", office_manager: "Office Manager", dispatcher: "Dispatcher", technician: "Technician",
  };

  if (loading) return <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>;

  return (
    <div className="space-y-6">
      {/* Office staff */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted mb-2">Office & operations</p>
        <div className="rounded-xl border border-line overflow-hidden">
          {users.length === 0 ? (
            <p className="text-sm text-ink-muted p-4 text-center">No users found</p>
          ) : users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-3 border-b border-line-2 last:border-b-0 bg-paper hover:bg-raised transition-colors">
              <div className="h-8 w-8 rounded-full bg-panel-warm border border-line flex items-center justify-center text-xs font-semibold text-ink-2 flex-shrink-0">
                {u.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">{u.name}</p>
                <p className="text-xs text-ink-muted truncate">{u.email}</p>
              </div>
              <span className={cn(
                "text-[11px] font-medium rounded-pill px-2 py-0.5",
                u.is_active ? "bg-confirmed-bg text-confirmed-text" : "bg-muted text-muted-foreground"
              )}>
                {u.is_active ? "Active" : "Inactive"}
              </span>
              <span className="text-xs text-ink-muted">{ROLE_LABELS[u.role] ?? u.role}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Field techs */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted mb-2">Field technicians</p>
        <div className="grid grid-cols-2 gap-3">
          {techs.length === 0 ? (
            <p className="text-sm text-ink-muted col-span-2 text-center py-4">No technicians found</p>
          ) : techs.map((t) => (
            <div key={t.id} className="rounded-xl border border-line bg-paper px-4 py-3.5 hover:bg-raised transition-colors">
              <div className="flex items-center gap-3 mb-1">
                <div className="h-8 w-8 rounded-full bg-panel-warm border border-line flex items-center justify-center text-xs font-semibold text-ink-2 flex-shrink-0">
                  {t.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{t.name}</p>
                  <p className="text-xs text-ink-muted">{t.phone}</p>
                </div>
                <span className={cn(
                  "text-[10px] font-semibold rounded-pill px-1.5 py-0.5",
                  t.is_active ? "bg-confirmed-bg text-confirmed-text" : "bg-muted text-muted-foreground"
                )}>
                  {t.is_active ? "Active" : "Off"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlanSection() {
  const { tenant } = useAuth();
  const tier = (tenant as unknown as Record<string, string>)?.subscription_tier ?? "starter";
  const TIER_LABELS: Record<string, string> = { starter: "Starter", growth: "Growth", enterprise: "Enterprise" };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-ai-tint-border bg-ai-tint px-5 py-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-ai-ink mb-1">Current plan</p>
            <p className="text-xl font-semibold text-ai">{TIER_LABELS[tier] ?? tier}</p>
            <p className="text-sm text-ai-ink mt-1">$499 / location / month · month-to-month</p>
          </div>
          <span className="text-[11px] font-semibold bg-confirmed-bg text-confirmed-text border border-confirmed-border rounded-pill px-2 py-0.5">Active</span>
        </div>
      </div>
      <div className="rounded-xl border border-line bg-paper">
        <div className="px-5 py-3.5 border-b border-line-2 flex items-center gap-3">
          <span className="text-sm text-ink-muted">1 location · San Jose, CA</span>
          <span className="ml-auto text-sm font-medium tabular-nums text-ink">$499 / mo</span>
        </div>
        <div className="px-5 py-4 text-center">
          <p className="text-xs text-ink-muted">
            Billing history and invoices — contact{" "}
            <span className="text-ai">support@useairbase.com</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function ConnectionsSection() {
  const { tenant } = useAuth();
  const hasStripe = !!(tenant as unknown as Record<string, string>)?.stripe_customer_id;
  const hasQBO    = !!(tenant as unknown as Record<string, string>)?.qbo_access_token;

  function ConnectionRow({ icon, name, description, connected }: {
    icon: React.ReactNode; name: string; description: string; connected: boolean;
  }) {
    return (
      <div className="flex items-center gap-4 px-5 py-4 border-b border-line-2 last:border-b-0 bg-paper hover:bg-raised transition-colors">
        <div className="h-9 w-9 rounded-lg bg-panel-warm border border-line flex items-center justify-center flex-shrink-0 text-ink-muted">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink">{name}</p>
          <p className="text-xs text-ink-muted">{description}</p>
        </div>
        {connected ? (
          <span className="text-[11px] font-semibold bg-confirmed-bg text-confirmed-text border border-confirmed-border rounded-pill px-2 py-0.5">
            Connected
          </span>
        ) : (
          <button className="text-xs font-semibold text-ai hover:text-ai-ink border border-ai-tint-border bg-ai-tint px-3 py-1.5 rounded-lg transition-colors">
            Connect
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line overflow-hidden">
      <ConnectionRow icon={<Phone className="h-4 w-4" />} name="Phone & SMS" description="Twilio — AI booking line and SMS notifications" connected={true} />
      <ConnectionRow icon={<CreditCard className="h-4 w-4" />} name="Payments" description="Stripe — card payments and Stripe Terminal" connected={hasStripe} />
      <ConnectionRow icon={<LinkIcon className="h-4 w-4" />} name="Accounting" description="QuickBooks Online — invoice and payment sync" connected={hasQBO} />
    </div>
  );
}

function PricebookImportSection({ isOwner }: { isOwner: boolean }) {
  const fileRef                         = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting]     = useState(false);
  const [importing, setImporting]       = useState(false);
  const [items, setItems]               = useState<PricebookItem[]>([]);
  const [fileName, setFileName]         = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setItems([]);
    setExtracting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", "extract");
      const { data, error } = await supabase.functions.invoke("pricebook-import", { body: form });
      if (error) throw error;
      const result = data as { items: PricebookItem[]; count: number };
      setItems(result.items ?? []);
      toast.success(`Extracted ${result.count} items — review before importing`);
    } catch (err) {
      toast.error("Extraction failed", { description: (err as Error).message });
    } finally {
      setExtracting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function updateItem(idx: number, field: keyof PricebookItem, value: string | number) {
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  async function commitImport() {
    if (!items.length) return;
    setImporting(true);
    try {
      const form = new FormData();
      form.append("mode", "commit");
      form.append("items", JSON.stringify(items));
      const { data, error } = await supabase.functions.invoke("pricebook-import", { body: form });
      if (error) throw error;
      const result = data as { inserted: number };
      toast.success(`${result.inserted} items added to pricebook`);
      setItems([]);
      setFileName(null);
    } catch (err) {
      toast.error("Import failed", { description: (err as Error).message });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl border-2 border-dashed border-line p-8 text-center cursor-pointer hover:border-ai-tint-border hover:bg-ai-tint transition-colors"
        onClick={() => isOwner && fileRef.current?.click()}
      >
        {extracting ? (
          <div className="flex flex-col items-center gap-2 text-ink-muted">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm font-medium">Extracting items with Claude…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-ink-muted">
            <span className="text-2xl">✦</span>
            <p className="text-sm font-medium text-ink">{fileName ?? "Drop a PDF or CSV here, or click to browse"}</p>
            <p className="text-xs">Claude extracts line items for your review before anything is saved</p>
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept=".pdf,.csv,.txt" className="hidden" onChange={handleFileChange} disabled={!isOwner || extracting} />

      {items.length > 0 && (
        <div className="rounded-xl border border-ai-tint-border bg-ai-tint px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm text-ai">✦</span>
            <p className="text-sm font-semibold text-ai-ink">{items.length} items extracted — review and confirm</p>
          </div>
          <div className="rounded-lg border border-ai-tint-border bg-paper overflow-auto max-h-72">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-panel-warm/80 backdrop-blur">
                <tr>
                  {["Name", "Category", "Price", "Unit", ""].map((h) => (
                    <th key={h} className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-ink-muted ${h === "Price" ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="border-t border-line-2 hover:bg-raised">
                    <td className="px-3 py-2">
                      <input className="w-full bg-transparent outline-none text-ink" value={item.name} onChange={(e) => updateItem(idx, "name", e.target.value)} />
                    </td>
                    <td className="px-3 py-2">
                      <select className="bg-transparent outline-none text-sm text-ink" value={item.category} onChange={(e) => updateItem(idx, "category", e.target.value)}>
                        {["labor", "parts", "equipment", "service"].map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">
                      <input className="w-20 bg-transparent outline-none text-right" type="number" step="0.01" value={item.unit_price} onChange={(e) => updateItem(idx, "unit_price", parseFloat(e.target.value) || 0)} />
                    </td>
                    <td className="px-3 py-2">
                      <select className="bg-transparent outline-none text-sm text-ink" value={item.unit} onChange={(e) => updateItem(idx, "unit", e.target.value)}>
                        {["each", "hour", "flat", "foot", "lb"].map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <button onClick={() => setItems((p) => p.filter((_, i) => i !== idx))} className="text-ink-muted hover:text-blocked-text transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => { setItems([]); setFileName(null); }} className="px-4 py-2 rounded-lg border border-line bg-raised text-sm font-medium text-ink-2 hover:bg-panel-warm transition-colors">
              Cancel
            </button>
            <button onClick={commitImport} disabled={importing || items.length === 0} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-ink text-bone text-sm font-medium hover:bg-ink-hover transition-colors disabled:opacity-50">
              {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {importing ? "Importing…" : `Import ${items.length} items`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Nav item ────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "profile",     label: "Company profile",       icon: Building2 },
  { id: "hours",       label: "Hours & availability",   icon: Clock },
  { id: "area",        label: "Service area",           icon: Map },
  { id: "identity",    label: "Customer-facing identity", icon: MessageSquare },
  { id: "team",        label: "Team & access",          icon: Users },
  { id: "plan",        label: "Plan & billing",         icon: CreditCard },
  { id: "connections", label: "Connections",            icon: LinkIcon },
  { id: "pricebook",   label: "Pricebook import",      icon: BookOpen },
] as const;

type SectionId = typeof SECTIONS[number]["id"];

// ─── Main ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { tenant, user } = useAuth();
  const [activeSection, setActiveSection] = useState<SectionId>("profile");
  const isOwner = user?.role === "owner";

  const section = SECTIONS.find((s) => s.id === activeSection)!;

  if (!tenant) {
    return (
      <div className="p-8 max-w-2xl space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex h-full bg-bone">
      {/* Left sub-nav */}
      <div className="w-[240px] flex-shrink-0 border-r border-line bg-panel-warm px-3 py-5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted px-3 mb-3">Settings</p>
        <nav className="space-y-0.5">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors text-left",
                activeSection === id
                  ? "bg-paper text-ink border border-line shadow-sm"
                  : "text-ink-2 hover:text-ink hover:bg-paper/60"
              )}
            >
              <Icon className="h-4 w-4 flex-shrink-0" style={{ color: activeSection === id ? "#292420" : "#9A9082" }} />
              {label}
              {activeSection === id && <ChevronRight className="h-3.5 w-3.5 ml-auto text-ink-muted" />}
            </button>
          ))}
        </nav>
      </div>

      {/* Content panel */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[680px] px-10 py-8">
          {/* Section header */}
          <div className="flex items-center justify-between mb-7">
            <div>
              <h1 className="text-[22px] font-semibold text-ink">{section.label}</h1>
              {!isOwner && (
                <p className="text-xs text-ink-muted mt-1">View only — contact your account owner to make changes.</p>
              )}
            </div>
            <SaveIndicator state="idle" />
          </div>

          {/* Section body */}
          {activeSection === "profile"     && <CompanyProfileSection isOwner={isOwner} />}
          {activeSection === "hours"       && <HoursSection isOwner={isOwner} />}
          {activeSection === "area"        && <ServiceAreaSection isOwner={isOwner} />}
          {activeSection === "identity"    && <CustomerIdentitySection isOwner={isOwner} />}
          {activeSection === "team"        && <TeamSection isOwner={isOwner} />}
          {activeSection === "plan"        && <PlanSection />}
          {activeSection === "connections" && <ConnectionsSection />}
          {activeSection === "pricebook"   && <PricebookImportSection isOwner={isOwner} />}
        </div>
      </div>
    </div>
  );
}
