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
  const { tenant } = useAuth();
  const [hours, setHours] = useState<WeekHours>(DEFAULT_HOURS);
  const [afterHours, setAfterHours] = useState<AfterHours>("message");
  const [loading, setLoading] = useState(true);
  const [savingDay, setSavingDay] = useState<Day | null>(null);
  const timeTimers = useRef<Partial<Record<Day, ReturnType<typeof setTimeout>>>>({});

  useEffect(() => {
    if (!tenant) return;
    void (async () => {
      const [hoursRes, tenantRes] = await Promise.all([
        supabase.from("tenant_hours").select("*").eq("tenant_id", tenant.id),
        supabase.from("tenants").select("after_hours_mode").eq("id", tenant.id).single(),
      ]);
      if (hoursRes.data?.length) {
        const updated = { ...DEFAULT_HOURS };
        (hoursRes.data as Array<{ day_of_week: number; is_open: boolean; open_time: string; close_time: string }>).forEach((row) => {
          const day = DAYS[row.day_of_week];
          if (day) updated[day] = { open: row.is_open, from: row.open_time.slice(0, 5), to: row.close_time.slice(0, 5) };
        });
        setHours(updated);
      }
      if (tenantRes.data?.after_hours_mode) setAfterHours(tenantRes.data.after_hours_mode as AfterHours);
      setLoading(false);
    })();
  }, [tenant]);

  async function upsertDay(day: Day, current: DayHours) {
    if (!tenant) return;
    setSavingDay(day);
    try {
      const { error } = await supabase.from("tenant_hours").upsert({
        tenant_id: tenant.id,
        day_of_week: DAYS.indexOf(day),
        is_open: current.open,
        open_time: current.from,
        close_time: current.to,
      }, { onConflict: "tenant_id,day_of_week" });
      if (error) throw error;
    } catch (err) {
      toast.error("Failed to save hours", { description: (err as Error).message });
    } finally {
      setSavingDay(null);
    }
  }

  function toggleDay(day: Day) {
    if (!isOwner) return;
    const next = { ...hours[day], open: !hours[day].open };
    setHours((h) => ({ ...h, [day]: next }));
    void upsertDay(day, next);
  }

  function setTime(day: Day, field: "from" | "to", val: string) {
    if (!isOwner) return;
    const next = { ...hours[day], [field]: val };
    setHours((h) => ({ ...h, [day]: next }));
    clearTimeout(timeTimers.current[day]);
    timeTimers.current[day] = setTimeout(() => void upsertDay(day, next), 800);
  }

  async function saveAfterHours(mode: AfterHours) {
    if (!tenant || !isOwner) return;
    setAfterHours(mode);
    const { error } = await supabase.from("tenants").update({ after_hours_mode: mode }).eq("id", tenant.id);
    if (error) toast.error("Failed to save after-hours setting");
  }

  if (loading) return <div className="space-y-2">{[...Array(7)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line overflow-hidden">
        {DAYS.map((day) => {
          const dh = hours[day];
          return (
            <div key={day} className="flex items-center gap-4 px-5 py-3.5 border-b border-line-2 last:border-b-0 bg-paper hover:bg-raised transition-colors">
              <span className="w-8 text-sm font-medium text-ink">{day}</span>
              <button
                onClick={() => toggleDay(day)}
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
                  {savingDay === day && <Loader2 className="h-3.5 w-3.5 text-ink-muted animate-spin flex-shrink-0" />}
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
                onChange={() => void saveAfterHours(opt)} disabled={!isOwner}
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
  const { tenant } = useAuth();
  const [mode, setMode] = useState<AreaMode>("radius");
  const [radius, setRadius] = useState(25);
  const [zips, setZips] = useState<string[]>([]);
  const [zipInput, setZipInput] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!tenant) return;
    void (async () => {
      const { data } = await supabase
        .from("tenants")
        .select("service_area_radius_miles, service_area_zips")
        .eq("id", tenant.id)
        .single();
      if (data) {
        const row = data as { service_area_radius_miles: number | null; service_area_zips: string[] | null };
        if (row.service_area_radius_miles) setRadius(row.service_area_radius_miles);
        if (row.service_area_zips?.length) { setZips(row.service_area_zips); setMode("zips"); }
      }
    })();
  }, [tenant]);

  async function save(patch: { radius?: number; zips?: string[] }) {
    if (!tenant) return;
    setSaveState("saving");
    const { error } = await supabase.from("tenants").update({
      service_area_radius_miles: patch.radius ?? radius,
      service_area_zips: patch.zips ?? zips,
    }).eq("id", tenant.id);
    setSaveState(error ? "idle" : "saved");
    setTimeout(() => setSaveState("idle"), 3000);
  }

  function handleRadiusChange(val: number) {
    setRadius(val);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save({ radius: val }), 650);
  }

  function addZip() {
    const z = zipInput.trim();
    if (!z || zips.includes(z)) return;
    const next = [...zips, z];
    setZips(next);
    setZipInput("");
    void save({ zips: next });
  }

  function removeZip(z: string) {
    const next = zips.filter((x) => x !== z);
    setZips(next);
    void save({ zips: next });
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
            onChange={(e) => handleRadiusChange(Number(e.target.value))} disabled={!isOwner}
            className="w-full accent-ink"
          />
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
                  <button onClick={() => removeZip(z)} className="text-ink-muted hover:text-blocked-text ml-0.5">
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

      <div className="flex justify-end">
        <SaveIndicator state={saveState} />
      </div>
    </div>
  );
}

function CustomerIdentitySection({ isOwner }: { isOwner: boolean }) {
  const { tenant } = useAuth();

  const saveFn = useCallback(async (d: typeof form) => {
    if (!tenant) return;
    const { error } = await supabase.from("tenants").update({
      sms_sender_name: d.smsName || null,
      reply_to_email: d.replyEmail || null,
      brand_color: d.accentColor,
      google_review_url: d.reviewLink || null,
    }).eq("id", tenant.id);
    if (error) throw error;
  }, [tenant]);

  const form = {
    smsName:     tenant?.sms_sender_name ?? "",
    replyEmail:  tenant?.reply_to_email ?? "",
    reviewLink:  tenant?.google_review_url ?? "",
    accentColor: tenant?.brand_color ?? "#5B6B9E",
  };
  const { data, set, saveState } = useAutoSave(tenant ? form : null, saveFn);

  const ACCENT_SWATCHES = ["#5B6B9E", "#4C6749", "#8A6A22", "#A85A40", "#292420"];

  if (!data) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-5">
      <Field label="SMS sender name" helper="Max 11 chars. Shown as the sender name in text messages.">
        <Input value={data.smsName} onChange={(e) => set({ smsName: e.target.value.slice(0, 11) })} disabled={!isOwner} maxLength={11} placeholder="Steward" />
        <div className="mt-1.5 rounded-xl border border-field-border bg-raised px-4 py-3 flex items-start gap-3">
          <div className="flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-muted mb-1">Preview</p>
            <p className="text-xs text-ink-muted mb-0.5 font-medium">{data.smsName || "Your Company"}</p>
            <div className="rounded-xl bg-paper border border-line px-3 py-2 text-sm text-ink max-w-[220px]">
              Hi! Your tech is 10 min away. — Jordan
            </div>
          </div>
        </div>
      </Field>
      <Field label="Reply-to email" helper="Customer replies to AI emails go here.">
        <Input type="email" value={data.replyEmail} onChange={(e) => set({ replyEmail: e.target.value })} disabled={!isOwner} placeholder="hello@yourcompany.com" />
      </Field>
      <Field label="Google review link" helper="Sent to customers after job completion.">
        <div className="flex gap-2">
          <Input type="url" value={data.reviewLink} onChange={(e) => set({ reviewLink: e.target.value })} disabled={!isOwner} placeholder="https://g.page/r/.../review" />
          {data.reviewLink && (
            <a href={data.reviewLink} target="_blank" rel="noreferrer" className="h-10 w-10 flex items-center justify-center rounded-lg border border-line bg-raised hover:bg-panel-warm transition-colors">
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
              onClick={() => isOwner && set({ accentColor: c })}
              className={cn("h-8 w-8 rounded-lg border-2 transition-all", data.accentColor === c ? "border-ink scale-110" : "border-transparent")}
              style={{ background: c }}
            />
          ))}
          <input type="color" value={data.accentColor} onChange={(e) => isOwner && set({ accentColor: e.target.value })} className="h-8 w-8 rounded-lg cursor-pointer border border-line" />
        </div>
      </div>
      <div className="flex justify-end pt-1">
        <SaveIndicator state={saveState} />
      </div>
    </div>
  );
}

type UserItem = { id: string; name: string; email: string | null; role: string; is_active: boolean };
type TechItem = { id: string; name: string; phone: string; email: string | null; is_active: boolean; tech_type: string; can_sell: boolean };

const USER_ROLES = [
  { value: "owner",          label: "Owner" },
  { value: "office_manager", label: "Office Manager" },
  { value: "dispatcher",     label: "Dispatcher" },
];

function TeamSection({ isOwner }: { isOwner: boolean }) {
  const { tenant } = useAuth();
  const [users, setUsers]         = useState<UserItem[]>([]);
  const [techs, setTechs]         = useState<TechItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState<string | null>(null);
  const [showAddTech, setShowAddTech] = useState(false);
  const [newTech, setNewTech]     = useState({ name: "", phone: "", email: "" });
  const [addingTech, setAddingTech] = useState(false);

  async function reload() {
    if (!tenant) return;
    const [uRes, tRes] = await Promise.all([
      supabase.from("users").select("id,name,email,role,is_active").eq("tenant_id", tenant.id).order("name"),
      supabase.from("technicians").select("id,name,phone,email,is_active,tech_type,can_sell").eq("tenant_id", tenant.id).order("name"),
    ]);
    setUsers((uRes.data ?? []) as UserItem[]);
    setTechs((tRes.data ?? []) as TechItem[]);
  }

  useEffect(() => {
    if (!tenant) return;
    void (async () => { await reload(); setLoading(false); })();
  }, [tenant]);

  async function toggleUserActive(u: UserItem) {
    setSaving(u.id);
    const { error } = await supabase.from("users").update({ is_active: !u.is_active }).eq("id", u.id);
    if (error) toast.error("Failed to update user");
    else setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, is_active: !u.is_active } : x));
    setSaving(null);
  }

  async function changeRole(u: UserItem, role: string) {
    setSaving(u.id);
    const { error } = await supabase.from("users").update({ role }).eq("id", u.id);
    if (error) toast.error("Failed to update role");
    else setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, role } : x));
    setSaving(null);
  }

  async function toggleTechActive(t: TechItem) {
    setSaving(t.id);
    const { error } = await supabase.from("technicians").update({ is_active: !t.is_active }).eq("id", t.id);
    if (error) toast.error("Failed to update technician");
    else setTechs((prev) => prev.map((x) => x.id === t.id ? { ...x, is_active: !t.is_active } : x));
    setSaving(null);
  }

  async function changeTechType(t: TechItem, tech_type: string) {
    setSaving(t.id);
    const { error } = await supabase.from("technicians").update({ tech_type }).eq("id", t.id);
    if (error) toast.error("Failed to update tech type");
    else setTechs((prev) => prev.map((x) => x.id === t.id ? { ...x, tech_type } : x));
    setSaving(null);
  }

  async function toggleCanSell(t: TechItem) {
    setSaving(t.id);
    const { error } = await supabase.from("technicians").update({ can_sell: !t.can_sell }).eq("id", t.id);
    if (error) toast.error("Failed to update can_sell");
    else setTechs((prev) => prev.map((x) => x.id === t.id ? { ...x, can_sell: !t.can_sell } : x));
    setSaving(null);
  }

  async function addTechnician() {
    if (!tenant || !newTech.name.trim() || !newTech.phone.trim()) return;
    setAddingTech(true);
    const { error } = await supabase.from("technicians").insert({
      tenant_id: tenant.id,
      name: newTech.name.trim(),
      phone: newTech.phone.trim(),
      email: newTech.email.trim() || null,
      tech_type: "service",
    });
    if (error) {
      toast.error("Failed to add technician", { description: error.message });
    } else {
      toast.success(`${newTech.name} added`);
      setNewTech({ name: "", phone: "", email: "" });
      setShowAddTech(false);
      await reload();
    }
    setAddingTech(false);
  }

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
                <p className="text-xs text-ink-muted truncate">{u.email ?? "—"}</p>
              </div>
              {isOwner ? (
                <>
                  <Select
                    value={u.role}
                    onValueChange={(role) => void changeRole(u, role)}
                    disabled={saving === u.id}
                  >
                    <SelectTrigger className="h-7 text-xs w-36 border-line bg-raised">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {USER_ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    onClick={() => void toggleUserActive(u)}
                    disabled={saving === u.id || u.role === "owner"}
                    className={cn(
                      "text-[11px] font-medium rounded-pill px-2 py-1 border transition-colors",
                      u.is_active
                        ? "bg-confirmed-bg text-confirmed-text border-confirmed-border hover:bg-waiting-bg hover:text-waiting-text hover:border-waiting-border"
                        : "bg-muted text-muted-foreground border-border hover:bg-confirmed-bg hover:text-confirmed-text hover:border-confirmed-border",
                      (saving === u.id || u.role === "owner") && "opacity-50 cursor-not-allowed",
                    )}
                    title={u.role === "owner" ? "Cannot deactivate owner" : u.is_active ? "Click to deactivate" : "Click to activate"}
                  >
                    {saving === u.id ? <Loader2 className="h-3 w-3 animate-spin" /> : u.is_active ? "Active" : "Inactive"}
                  </button>
                </>
              ) : (
                <>
                  <span className="text-xs text-ink-muted">{USER_ROLES.find((r) => r.value === u.role)?.label ?? u.role}</span>
                  <span className={cn("text-[11px] font-medium rounded-pill px-2 py-0.5",
                    u.is_active ? "bg-confirmed-bg text-confirmed-text" : "bg-muted text-muted-foreground")}>
                    {u.is_active ? "Active" : "Inactive"}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Field techs */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">Field technicians</p>
          {isOwner && !showAddTech && (
            <button
              onClick={() => setShowAddTech(true)}
              className="text-xs font-medium text-ai hover:text-ai-ink transition-colors"
            >
              + Add technician
            </button>
          )}
        </div>

        {/* Inline add-tech form */}
        {showAddTech && (
          <div className="mb-4 rounded-xl border border-ai-tint-border bg-ai-tint px-4 py-4 space-y-3">
            <p className="text-xs font-semibold text-ai-ink">New technician</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Input
                  placeholder="Full name *"
                  value={newTech.name}
                  onChange={(e) => setNewTech((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div>
                <Input
                  placeholder="Mobile phone *"
                  type="tel"
                  value={newTech.phone}
                  onChange={(e) => setNewTech((p) => ({ ...p, phone: e.target.value }))}
                />
              </div>
              <div>
                <Input
                  placeholder="Email (optional)"
                  type="email"
                  value={newTech.email}
                  onChange={(e) => setNewTech((p) => ({ ...p, email: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => { setShowAddTech(false); setNewTech({ name: "", phone: "", email: "" }); }}
                className="text-xs text-ink-muted hover:text-ink transition-colors px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                onClick={() => void addTechnician()}
                disabled={!newTech.name.trim() || !newTech.phone.trim() || addingTech}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ink text-bone text-xs font-medium hover:bg-ink-hover transition-colors disabled:opacity-40"
              >
                {addingTech && <Loader2 className="h-3 w-3 animate-spin" />}
                Add technician
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {techs.length === 0 ? (
            <p className="text-sm text-ink-muted col-span-2 text-center py-4">No technicians found</p>
          ) : techs.map((t) => (
            <div key={t.id} className="rounded-xl border border-line bg-paper px-4 py-3.5 hover:bg-raised transition-colors">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-panel-warm border border-line flex items-center justify-center text-xs font-semibold text-ink-2 flex-shrink-0">
                  {t.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{t.name}</p>
                  <p className="text-xs text-ink-muted truncate">{t.phone}</p>
                </div>
                {isOwner ? (
                  <button
                    onClick={() => void toggleTechActive(t)}
                    disabled={saving === t.id}
                    className={cn(
                      "text-[10px] font-semibold rounded-pill px-1.5 py-0.5 border transition-colors",
                      t.is_active
                        ? "bg-confirmed-bg text-confirmed-text border-confirmed-border hover:bg-waiting-bg hover:text-waiting-text hover:border-waiting-border"
                        : "bg-muted text-muted-foreground border-border hover:bg-confirmed-bg hover:text-confirmed-text hover:border-confirmed-border",
                      saving === t.id && "opacity-50 cursor-not-allowed",
                    )}
                    title={t.is_active ? "Click to deactivate" : "Click to activate"}
                  >
                    {saving === t.id ? <Loader2 className="h-3 w-3 animate-spin inline" /> : t.is_active ? "Active" : "Off"}
                  </button>
                ) : (
                  <span className={cn("text-[10px] font-semibold rounded-pill px-1.5 py-0.5",
                    t.is_active ? "bg-confirmed-bg text-confirmed-text" : "bg-muted text-muted-foreground")}>
                    {t.is_active ? "Active" : "Off"}
                  </span>
                )}
              </div>
              {isOwner && (
                <div className="mt-3 pt-3 border-t border-line-2 flex items-center gap-2 flex-wrap">
                  <Select
                    value={t.tech_type ?? "service"}
                    onValueChange={(v) => void changeTechType(t, v)}
                    disabled={saving === t.id}
                  >
                    <SelectTrigger className="h-6 text-[11px] w-36 border-line bg-raised">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="service">Service Tech</SelectItem>
                      <SelectItem value="install">Install Crew</SelectItem>
                      <SelectItem value="install_lead">Install Lead</SelectItem>
                      <SelectItem value="comfort_advisor">Comfort Advisor</SelectItem>
                    </SelectContent>
                  </Select>
                  {(t.tech_type === "service" || t.tech_type === "install") && (
                    <button
                      onClick={() => void toggleCanSell(t)}
                      disabled={saving === t.id}
                      className={cn(
                        "text-[10px] font-medium rounded-pill px-1.5 py-0.5 border transition-colors",
                        t.can_sell
                          ? "bg-ai-tint text-ai-ink border-ai-tint-border"
                          : "bg-muted text-muted-foreground border-border hover:bg-ai-tint hover:text-ai-ink",
                      )}
                      title="Toggle selling permission"
                    >
                      {t.can_sell ? "Can sell" : "No sell"}
                    </button>
                  )}
                </div>
              )}
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
