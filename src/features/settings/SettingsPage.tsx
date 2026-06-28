import { useEffect, useRef, useState } from "react";
import { Settings, Building2, Bell, ExternalLink, BookOpen, Upload, Loader2, Trash2, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

// ─── Pricebook types ──────────────────────────────────────────────────────────

interface PricebookItem {
  name:        string;
  description: string;
  unit_price:  number;
  category:    string;
  unit:        string;
}

// ─── Pricebook Import sub-component ──────────────────────────────────────────

function PricebookImportTab({ isOwner }: { isOwner: boolean }) {
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

      const { data, error } = await supabase.functions.invoke("pricebook-import", {
        body: form,
      });
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

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function commitImport() {
    if (!items.length) return;
    setImporting(true);
    try {
      const form = new FormData();
      form.append("mode", "commit");
      form.append("items", JSON.stringify(items));

      const { data, error } = await supabase.functions.invoke("pricebook-import", {
        body: form,
      });
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
      <Card>
        <CardHeader>
          <CardTitle>AI pricebook import</CardTitle>
          <CardDescription>
            Upload a PDF price sheet or CSV export. Claude extracts line items for you to review, edit, and confirm before they're added.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 transition-colors"
            onClick={() => isOwner && fileRef.current?.click()}
          >
            {extracting ? (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="text-sm">Extracting items with Claude…</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Upload className="h-8 w-8" />
                <p className="text-sm font-medium">
                  {fileName ?? "Drop a PDF or CSV here, or click to browse"}
                </p>
                <p className="text-xs">Supports PDF price sheets and CSV exports</p>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.csv,.txt"
            className="hidden"
            onChange={handleFileChange}
            disabled={!isOwner || extracting}
          />
          {!isOwner && (
            <p className="text-xs text-muted-foreground">Contact your account owner to import items.</p>
          )}
        </CardContent>
      </Card>

      {items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              {items.length} items extracted — review and confirm
            </CardTitle>
            <CardDescription>
              Edit any values, remove items you don't want, then click Import.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="rounded-md border overflow-auto max-h-[400px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/70 backdrop-blur">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Name</th>
                    <th className="text-left px-3 py-2 font-medium">Category</th>
                    <th className="text-right px-3 py-2 font-medium">Price</th>
                    <th className="text-left px-3 py-2 font-medium">Unit</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={idx} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-1.5">
                        <input
                          className="w-full bg-transparent outline-none"
                          value={item.name}
                          onChange={(e) => updateItem(idx, "name", e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <select
                          className="bg-transparent outline-none text-sm"
                          value={item.category}
                          onChange={(e) => updateItem(idx, "category", e.target.value)}
                        >
                          {["labor", "parts", "equipment", "service"].map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <input
                          className="w-20 bg-transparent outline-none text-right"
                          type="number"
                          step="0.01"
                          value={item.unit_price}
                          onChange={(e) => updateItem(idx, "unit_price", parseFloat(e.target.value) || 0)}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <select
                          className="bg-transparent outline-none text-sm"
                          value={item.unit}
                          onChange={(e) => updateItem(idx, "unit", e.target.value)}
                        >
                          {["each", "hour", "flat", "foot", "lb"].map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => removeItem(idx)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => { setItems([]); setFileName(null); }}>
                Cancel
              </Button>
              <Button onClick={commitImport} disabled={importing || items.length === 0}>
                {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {importing ? "Importing…" : `Import ${items.length} items`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const TIMEZONES = [
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Denver",      label: "Mountain (MT)" },
  { value: "America/Phoenix",     label: "Arizona (no DST)" },
  { value: "America/Chicago",     label: "Central (CT)" },
  { value: "America/New_York",    label: "Eastern (ET)" },
  { value: "America/Anchorage",   label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu",    label: "Hawaii (HT)" },
];

interface TenantForm {
  name: string;
  phone: string;
  address: string;
  timezone: string;
  google_review_url: string;
  yelp_review_url: string;
}

const EMPTY_FORM: TenantForm = {
  name:              "",
  phone:             "",
  address:           "",
  timezone:          "America/Los_Angeles",
  google_review_url: "",
  yelp_review_url:   "",
};

export default function SettingsPage() {
  const { tenant, user, refreshTenant } = useAuth();
  const [form, setForm]       = useState<TenantForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile]         = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);

  const isOwner = user?.role === "owner";

  useEffect(() => {
    if (!tenant) return;
    setForm({
      name:              tenant.name              ?? "",
      phone:             tenant.phone             ?? "",
      address:           tenant.address           ?? "",
      timezone:          tenant.timezone          ?? "America/Los_Angeles",
      google_review_url: (tenant as unknown as Record<string, unknown>).google_review_url as string ?? "",
      yelp_review_url:   (tenant as unknown as Record<string, unknown>).yelp_review_url   as string ?? "",
    });
    setLoading(false);
  }, [tenant]);

  const set = (field: keyof TenantForm, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  async function saveSection(
    fields: Partial<TenantForm>,
    setSaving: (v: boolean) => void,
  ) {
    if (!tenant) return;
    setSaving(true);
    try {
      const patch: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(fields)) {
        patch[k] = (v as string).trim() || null;
      }
      // name is required — keep empty string as-is
      if ("name" in fields) patch.name = (fields.name ?? "").trim() || tenant.name;

      const { error } = await supabase
        .from("tenants")
        .update(patch)
        .eq("id", tenant.id);

      if (error) throw error;

      await refreshTenant();
      toast.success("Settings saved");
    } catch (err) {
      toast.error("Save failed", { description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4 max-w-2xl">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          {!isOwner && (
            <p className="text-sm text-muted-foreground">
              View only — contact your account owner to make changes.
            </p>
          )}
        </div>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile" className="gap-2">
            <Building2 className="h-4 w-4" />
            Business profile
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="h-4 w-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="pricebook" className="gap-2">
            <BookOpen className="h-4 w-4" />
            Pricebook import
          </TabsTrigger>
        </TabsList>

        {/* ── Business profile ─────────────────────────────────────────────── */}
        <TabsContent value="profile" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Business profile</CardTitle>
              <CardDescription>
                Displayed to customers and used across all AI communications.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Company name</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  disabled={!isOwner}
                  placeholder="Steward Home Services"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="phone">Business phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  disabled={!isOwner}
                  placeholder="(408) 555-0100"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                  disabled={!isOwner}
                  placeholder="1234 Tech Blvd, San Jose, CA 95101"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="timezone">Timezone</Label>
                <Select
                  value={form.timezone}
                  onValueChange={(v) => set("timezone", v)}
                  disabled={!isOwner}
                >
                  <SelectTrigger id="timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Used for scheduling, job times, and AI notifications.
                </p>
              </div>

              {isOwner && (
                <Button
                  onClick={() =>
                    saveSection(
                      { name: form.name, phone: form.phone, address: form.address, timezone: form.timezone },
                      setSavingProfile,
                    )
                  }
                  disabled={savingProfile}
                >
                  {savingProfile ? "Saving…" : "Save profile"}
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Notifications ────────────────────────────────────────────────── */}
        <TabsContent value="notifications" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Review profiles</CardTitle>
              <CardDescription>
                Links sent to customers after job completion. The review request agent
                uses Google first, falling back to Yelp if Google is not set.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="google_review_url">Google review link</Label>
                <div className="flex gap-2">
                  <Input
                    id="google_review_url"
                    type="url"
                    value={form.google_review_url}
                    onChange={(e) => set("google_review_url", e.target.value)}
                    disabled={!isOwner}
                    placeholder="https://g.page/r/<your-place-id>/review"
                    className="font-mono text-sm"
                  />
                  {form.google_review_url && (
                    <Button variant="outline" size="icon" asChild>
                      <a href={form.google_review_url} target="_blank" rel="noreferrer" title="Open link">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Find yours: Google Maps → your business → Share → Copy link → click "Write a review"
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="yelp_review_url">Yelp review link</Label>
                <div className="flex gap-2">
                  <Input
                    id="yelp_review_url"
                    type="url"
                    value={form.yelp_review_url}
                    onChange={(e) => set("yelp_review_url", e.target.value)}
                    disabled={!isOwner}
                    placeholder="https://www.yelp.com/writeareview/biz/<your-biz-id>"
                    className="font-mono text-sm"
                  />
                  {form.yelp_review_url && (
                    <Button variant="outline" size="icon" asChild>
                      <a href={form.yelp_review_url} target="_blank" rel="noreferrer" title="Open link">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Used as fallback when no Google link is set.
                </p>
              </div>

              {!form.google_review_url && !form.yelp_review_url && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Review requests are active but will be skipped until at least one review link is added.
                </div>
              )}

              {isOwner && (
                <Button
                  onClick={() =>
                    saveSection(
                      { google_review_url: form.google_review_url, yelp_review_url: form.yelp_review_url },
                      setSavingNotifications,
                    )
                  }
                  disabled={savingNotifications}
                >
                  {savingNotifications ? "Saving…" : "Save notifications"}
                </Button>
              )}
            </CardContent>
          </Card>

          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base text-muted-foreground">Coming soon</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>• ETA notification customisation (message template, timing)</p>
              <p>• Warranty callback window (currently fixed at 30 days)</p>
              <p>• Collections agent — overdue invoice follow-up schedule</p>
              <p>• Membership renewal agent — outreach timing and tone</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Pricebook import ─────────────────────────────────────────────── */}
        <TabsContent value="pricebook" className="mt-4">
          <PricebookImportTab isOwner={isOwner} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
