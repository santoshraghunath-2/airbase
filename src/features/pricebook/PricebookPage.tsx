import { useEffect, useState, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Search, Pencil, Loader2, Upload, ToggleLeft, ToggleRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import type { PricebookItem, PricebookItemType } from "@/types/database.types";

// ─── Taxonomy ─────────────────────────────────────────────────────────────────

export const TRADE_LABELS: Record<string, string> = {
  plumbing:   "Plumbing",
  hvac:       "HVAC",
  electrical: "Electrical",
  general:    "General",
};

export const TRADE_CATEGORIES: Record<string, string[]> = {
  plumbing: [
    "Drain Services", "Water Heater", "Leak Detection & Repair",
    "Fixture Repair & Install", "Pipe Repair & Repipe", "Sewer",
    "Water Filtration", "General Plumbing",
  ],
  hvac: [
    "Cooling", "Heating", "Preventive Maintenance",
    "Indoor Air Quality", "Ductwork", "Thermostats & Controls", "General HVAC",
  ],
  electrical: [
    "Panel & Service Upgrade", "Outlets & Circuits", "Lighting",
    "EV Charging", "Ceiling Fans", "Smoke & CO Detectors", "General Electrical",
  ],
  general: ["Estimates & Inspections", "Preventive Maintenance", "Other"],
};

const UOM_OPTIONS = ["each", "hour", "ft", "lb", "gal", "ton", "box", "pair", "set", "sq ft"];

// ─── Tab config ───────────────────────────────────────────────────────────────

type FormGroup = "service-labor" | "fee" | "part-material";

interface TabDef {
  type:      PricebookItemType;
  label:     string;
  addLabel:  string;
  formGroup: FormGroup;
}

const TABS: TabDef[] = [
  { type: "service",  label: "Services",  addLabel: "Add Service",  formGroup: "service-labor"  },
  { type: "labor",    label: "Labor",     addLabel: "Add Labor",    formGroup: "service-labor"  },
  { type: "fee",      label: "Fees",      addLabel: "Add Fee",      formGroup: "fee"            },
  { type: "part",     label: "Parts",     addLabel: "Add Part",     formGroup: "part-material"  },
  { type: "material", label: "Materials", addLabel: "Add Material", formGroup: "part-material"  },
];

const TYPE_LABELS: Record<PricebookItemType, string> = {
  service:  "Service",
  labor:    "Labor",
  fee:      "Fee",
  part:     "Part",
  material: "Material",
};

function groupOf(type: PricebookItemType): FormGroup {
  if (type === "fee") return "fee";
  if (type === "part" || type === "material") return "part-material";
  return "service-labor";
}

// Types selectable within each form group
const GROUP_TYPES: Record<FormGroup, PricebookItemType[]> = {
  "service-labor":  ["service", "labor"],
  "fee":            ["fee"],
  "part-material":  ["part", "material"],
};

// ─── Form schema ──────────────────────────────────────────────────────────────

const schema = z.object({
  name:                 z.string().min(1, "Name required"),
  item_type:            z.string().min(1),
  trade:                z.string().optional(),
  category:             z.string().optional(),
  unit_price:           z.coerce.number().min(0, "Price must be ≥ 0"),
  cost:                 z.coerce.number().optional(),
  sku:                  z.string().optional(),
  description:          z.string().optional(),
  estimated_hours:      z.coerce.number().min(0).max(24).optional(),
  unit_of_measure:      z.string().optional(),
  vendor:               z.string().optional(),
  taxable:              z.boolean().optional(),
});
type FormValues = z.infer<typeof schema>;

// ─── Page ─────────────────────────────────────────────────────────────────────

type ItemsByType = Record<PricebookItemType, PricebookItem[]>;

const EMPTY_BY_TYPE: ItemsByType = {
  service: [], labor: [], fee: [], part: [], material: [],
};

export default function PricebookPage() {
  const { tenant } = useAuth();
  const [byType,       setByType]       = useState<ItemsByType>(EMPTY_BY_TYPE);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState("");
  const [tradeFilter,  setTradeFilter]  = useState("all");
  const [showInactive, setShowInactive] = useState(false);
  const [editItem,     setEditItem]     = useState<PricebookItem | null>(null);
  const [showForm,     setShowForm]     = useState(false);
  const [formGroup,    setFormGroup]    = useState<FormGroup>("service-labor");
  const [saving,       setSaving]       = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const watchTrade = watch("trade");

  // ── Load ───────────────────────────────────────────────────────────────────

  const loadItems = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      let q = supabase
        .from("pricebook_items")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("name");

      if (!showInactive)       q = q.eq("is_active", true);
      if (search)              q = q.ilike("name", `%${search}%`);
      if (tradeFilter !== "all") q = q.eq("trade", tradeFilter);

      const { data } = await q;
      const all = (data ?? []) as PricebookItem[];

      setByType({
        service:  all.filter(i => i.item_type === "service"),
        labor:    all.filter(i => i.item_type === "labor"),
        fee:      all.filter(i => i.item_type === "fee"),
        part:     all.filter(i => i.item_type === "part"),
        material: all.filter(i => i.item_type === "material"),
      });
    } finally {
      setLoading(false);
    }
  }, [tenant, search, tradeFilter, showInactive]);

  useEffect(() => { void loadItems(); }, [loadItems]);

  // ── Form open ──────────────────────────────────────────────────────────────

  function openCreate(type: PricebookItemType) {
    setFormGroup(groupOf(type));
    setEditItem(null);
    reset({
      item_type:       type,
      unit_price:      0,
      taxable:         true,
      unit_of_measure: "each",
    });
    setShowForm(true);
  }

  function openEdit(item: PricebookItem) {
    setFormGroup(groupOf(item.item_type));
    setEditItem(item);
    reset({
      name:            item.name,
      item_type:       item.item_type,
      trade:           item.trade ?? "",
      category:        item.category ?? "",
      unit_price:      item.unit_price,
      cost:            item.cost ?? undefined,
      sku:             item.sku ?? "",
      description:     item.description ?? "",
      estimated_hours: item.estimated_hours ?? undefined,
      unit_of_measure: item.unit_of_measure ?? "each",
      vendor:          item.vendor ?? "",
      taxable:         item.taxable,
    });
    setShowForm(true);
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function onSubmit(values: FormValues) {
    if (!tenant) return;
    setSaving(true);
    try {
      const payload = {
        tenant_id:       tenant.id,
        name:            values.name,
        item_type:       values.item_type as PricebookItemType,
        trade:           values.trade    || null,
        category:        values.category || null,
        unit_price:      values.unit_price,
        cost:            values.cost            ?? null,
        sku:             values.sku             || null,
        description:     values.description     || null,
        estimated_hours: values.estimated_hours ?? null,
        unit_of_measure: values.unit_of_measure || null,
        vendor:          values.vendor          || null,
        taxable:         values.taxable         ?? true,
      };

      if (editItem) {
        const { error } = await supabase.from("pricebook_items").update(payload).eq("id", editItem.id);
        if (error) throw error;
        toast.success("Item updated");
      } else {
        const { error } = await supabase.from("pricebook_items").insert({ ...payload, is_active: true });
        if (error) throw error;
        toast.success("Item added");
      }

      setShowForm(false);
      void loadItems();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // ── Active toggle ──────────────────────────────────────────────────────────

  async function toggleActive(item: PricebookItem) {
    const { error } = await supabase
      .from("pricebook_items")
      .update({ is_active: !item.is_active })
      .eq("id", item.id);
    if (error) toast.error("Failed to update status");
    else void loadItems();
  }

  // ── CSV import ─────────────────────────────────────────────────────────────

  async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !tenant) return;
    const text    = await file.text();
    const lines   = text.split("\n").filter(Boolean);
    const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
    const get     = (cols: string[], key: string) => cols[headers.indexOf(key)]?.trim() ?? "";

    const items = lines.slice(1)
      .map(row => {
        const cols = row.split(",");
        return {
          tenant_id:       tenant.id,
          name:            get(cols, "name"),
          item_type:       (get(cols, "type") || "service") as PricebookItemType,
          trade:           get(cols, "trade")       || null,
          category:        get(cols, "category")    || null,
          unit_price:      parseFloat(get(cols, "price") || get(cols, "unit_price") || "0"),
          cost:            parseFloat(get(cols, "cost") || "0") || null,
          sku:             get(cols, "sku")          || null,
          description:     get(cols, "description") || null,
          unit_of_measure: get(cols, "uom")         || "each",
          vendor:          get(cols, "vendor")       || null,
          is_active:       true,
        };
      })
      .filter(i => i.name);

    if (items.length === 0) {
      toast.error("No valid rows. Required columns: name, type, price");
      return;
    }
    const { error } = await supabase.from("pricebook_items").insert(items);
    if (error) toast.error("Import failed: " + error.message);
    else { toast.success(`Imported ${items.length} items`); void loadItems(); }
    e.target.value = "";
  }

  // ── Filters (shared across all tabs) ──────────────────────────────────────

  const totalCount = Object.values(byType).reduce((s, arr) => s + arr.length, 0);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pricebook</h1>
          <p className="text-sm text-muted-foreground">{totalCount} items</p>
        </div>
        <label className="cursor-pointer">
          <Button variant="outline" size="sm" asChild>
            <span><Upload className="h-4 w-4 mr-1" />Import CSV</span>
          </Button>
          <input type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />
        </label>
      </div>

      {/* Filter bar — sits above tabs, applies to all */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search items…"
            className="pl-9 h-9 text-sm"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={tradeFilter} onValueChange={setTradeFilter}>
          <SelectTrigger className="h-9 w-[140px] text-sm">
            <SelectValue placeholder="All Trades" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Trades</SelectItem>
            {Object.entries(TRADE_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 text-xs gap-1.5 text-muted-foreground"
          onClick={() => setShowInactive(s => !s)}
        >
          {showInactive
            ? <ToggleRight className="h-4 w-4 text-blue-500" />
            : <ToggleLeft  className="h-4 w-4" />}
          {showInactive ? "Showing all" : "Active only"}
        </Button>
      </div>

      {/* Five tabs */}
      <Tabs defaultValue="service">
        <TabsList>
          {TABS.map(tab => (
            <TabsTrigger key={tab.type} value={tab.type}>
              {tab.label}
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums">
                {byType[tab.type].length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map(tab => (
          <TabsContent key={tab.type} value={tab.type} className="mt-4 space-y-3">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => openCreate(tab.type)}>
                <Plus className="h-4 w-4" /> {tab.addLabel}
              </Button>
            </div>

            {loading ? (
              <SkeletonTable cols={tab.formGroup === "part-material" ? 7 : tab.formGroup === "fee" ? 4 : 5} />
            ) : (
              <ItemTable
                items={byType[tab.type]}
                formGroup={tab.formGroup}
                onEdit={openEdit}
                onToggleActive={toggleActive}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Form dialog */}
      <Dialog open={showForm} onOpenChange={v => !v && setShowForm(false)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editItem ? "Edit" : "New"} {TYPE_LABELS[watch("item_type") as PricebookItemType] ?? "Item"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

            {/* Name */}
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input
                placeholder={
                  formGroup === "part-material" ? "1/2\" SharkBite coupling"
                  : formGroup === "fee"          ? "Trip charge"
                  : "Drain cleaning — standard"
                }
                {...register("name")}
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            {/* Type (only show selector when group has >1 option) + Trade */}
            <div className="grid grid-cols-2 gap-3">
              {GROUP_TYPES[formGroup].length > 1 && (
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Controller name="item_type" control={control} render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {GROUP_TYPES[formGroup].map(t => (
                          <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )} />
                </div>
              )}
              <div className={GROUP_TYPES[formGroup].length > 1 ? "space-y-1.5" : "col-span-2 space-y-1.5"}>
                <Label>Trade</Label>
                <Controller name="trade" control={control} render={({ field }) => (
                  <Select
                    onValueChange={v => { field.onChange(v); setValue("category", ""); }}
                    value={field.value ?? ""}
                  >
                    <SelectTrigger><SelectValue placeholder="Select trade…" /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(TRADE_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </div>
            </div>

            {/* Category */}
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Controller name="category" control={control} render={({ field }) => (
                <Select
                  onValueChange={field.onChange}
                  value={field.value ?? ""}
                  disabled={!watchTrade}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={watchTrade ? "Select category…" : "Select a trade first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(TRADE_CATEGORIES[watchTrade ?? ""] ?? []).map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </div>

            {/* Price row — layout varies by group */}
            <div className="grid grid-cols-2 gap-3">
              {formGroup === "part-material" && (
                <div className="space-y-1.5">
                  <Label>Unit Cost</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input type="number" step="0.01" min="0" className="pl-7" placeholder="0.00" {...register("cost")} />
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>{formGroup === "part-material" ? "Sell Price *" : "Price *"}</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input type="number" step="0.01" min="0" className="pl-7" {...register("unit_price")} />
                </div>
                {errors.unit_price && <p className="text-xs text-destructive">{errors.unit_price.message}</p>}
              </div>

              {/* Est. hours (service/labor only) */}
              {formGroup === "service-labor" && (
                <div className="space-y-1.5">
                  <Label>Est. Hours</Label>
                  <Input type="number" step="0.25" min="0" max="24" placeholder="1.0" {...register("estimated_hours")} />
                </div>
              )}

              {/* UOM (parts/materials only) */}
              {formGroup === "part-material" && (
                <div className="space-y-1.5">
                  <Label>Unit of Measure</Label>
                  <Controller name="unit_of_measure" control={control} render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value ?? "each"}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {UOM_OPTIONS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )} />
                </div>
              )}
            </div>

            {/* SKU + Vendor */}
            <div className={`grid gap-3 ${formGroup === "part-material" ? "grid-cols-2" : "grid-cols-1"}`}>
              <div className="space-y-1.5">
                <Label>SKU</Label>
                <Input placeholder="PB-001" {...register("sku")} />
              </div>
              {formGroup === "part-material" && (
                <div className="space-y-1.5">
                  <Label>Vendor</Label>
                  <Input placeholder="Ferguson, Grainger…" {...register("vendor")} />
                </div>
              )}
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={2} placeholder="What's included…" {...register("description")} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                {editItem ? "Save Changes" : "Add Item"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

function ItemTable({
  items, formGroup, onEdit, onToggleActive,
}: {
  items:          PricebookItem[];
  formGroup:      FormGroup;
  onEdit:         (item: PricebookItem) => void;
  onToggleActive: (item: PricebookItem) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        No items yet. Click "Add" above to create your first one.
      </div>
    );
  }

  const isPartMaterial = formGroup === "part-material";
  const isServiceLabor = formGroup === "service-labor";

  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Trade</TableHead>
            <TableHead>Category</TableHead>
            {isPartMaterial && <TableHead className="text-right">Unit Cost</TableHead>}
            <TableHead className="text-right">{isPartMaterial ? "Sell Price" : "Price"}</TableHead>
            {isServiceLabor  && <TableHead className="text-right">Est. Hrs</TableHead>}
            {isPartMaterial  && <TableHead>UOM</TableHead>}
            {isPartMaterial  && <TableHead>Vendor</TableHead>}
            <TableHead className="text-right w-16">Active</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(item => (
            <TableRow key={item.id} className={item.is_active ? "" : "opacity-50"}>
              <TableCell>
                <p className="font-medium">{item.name}</p>
                {isPartMaterial && item.sku && (
                  <p className="text-xs text-muted-foreground font-mono">SKU {item.sku}</p>
                )}
                {!isPartMaterial && item.description && (
                  <p className="text-xs text-muted-foreground truncate max-w-[240px]">{item.description}</p>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {TRADE_LABELS[item.trade ?? ""] ?? item.trade ?? "—"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {item.category ?? "—"}
              </TableCell>
              {isPartMaterial && (
                <TableCell className="text-right text-sm text-muted-foreground">
                  {item.cost ? formatCurrency(item.cost) : "—"}
                </TableCell>
              )}
              <TableCell className="text-right font-medium">
                {formatCurrency(item.unit_price)}
              </TableCell>
              {isServiceLabor && (
                <TableCell className="text-right text-sm text-muted-foreground">
                  {item.estimated_hours != null ? `${item.estimated_hours}h` : "—"}
                </TableCell>
              )}
              {isPartMaterial && (
                <TableCell className="text-sm text-muted-foreground">
                  {item.unit_of_measure ?? "each"}
                </TableCell>
              )}
              {isPartMaterial && (
                <TableCell className="text-sm text-muted-foreground">
                  {item.vendor ?? "—"}
                </TableCell>
              )}
              <TableCell className="text-right">
                <button
                  onClick={() => onToggleActive(item)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title={item.is_active ? "Deactivate" : "Activate"}
                >
                  {item.is_active
                    ? <ToggleRight className="h-5 w-5 text-blue-500" />
                    : <ToggleLeft  className="h-5 w-5" />}
                </button>
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(item)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SkeletonTable({ cols }: { cols: number }) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            {Array.from({ length: cols }).map((_, i) => (
              <TableHead key={i}><Skeleton className="h-4 w-20" /></TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i}>
              {Array.from({ length: cols }).map((__, j) => (
                <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
