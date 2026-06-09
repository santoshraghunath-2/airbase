import { useEffect, useState, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Search, Pencil, Loader2, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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

const CATEGORIES = ["plumbing", "hvac", "electrical", "water_heater", "general"];
const ITEM_TYPES: PricebookItemType[] = ["service", "part", "material", "labor", "fee"];

const schema = z.object({
  name: z.string().min(1, "Name required"),
  item_type: z.string().min(1, "Type required"),
  category: z.string().optional(),
  unit_price: z.coerce.number().min(0, "Price must be 0 or more"),
  cost: z.coerce.number().optional(),
  sku: z.string().optional(),
  description: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function PricebookPage() {
  const { tenant } = useAuth();
  const [items, setItems] = useState<PricebookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editItem, setEditItem] = useState<PricebookItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const loadItems = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      let query = supabase
        .from("pricebook_items")
        .select("*")
        .eq("tenant_id", tenant.id)
        .eq("is_active", true)
        .order("name");

      if (search) query = query.ilike("name", `%${search}%`);
      if (categoryFilter !== "all") query = query.eq("category", categoryFilter);

      const { data } = await query;
      setItems(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [tenant, search, categoryFilter]);

  useEffect(() => { void loadItems(); }, [loadItems]);

  function openCreate() {
    reset({ item_type: "service", unit_price: 0 });
    setEditItem(null);
    setShowForm(true);
  }

  function openEdit(item: PricebookItem) {
    reset({
      name: item.name,
      item_type: item.item_type,
      category: item.category ?? "",
      unit_price: item.unit_price,
      cost: item.cost ?? undefined,
      sku: item.sku ?? "",
      description: item.description ?? "",
    });
    setEditItem(item);
    setShowForm(true);
  }

  async function onSubmit(values: FormValues) {
    if (!tenant) return;
    setSaving(true);
    try {
      const payload = {
        tenant_id: tenant.id,
        name: values.name,
        item_type: values.item_type as PricebookItemType,
        category: values.category || null,
        unit_price: values.unit_price,
        cost: values.cost ?? null,
        sku: values.sku || null,
        description: values.description || null,
      };

      if (editItem) {
        const { error } = await supabase.from("pricebook_items").update(payload).eq("id", editItem.id);
        if (error) throw error;
        toast.success("Item updated");
      } else {
        const { error } = await supabase.from("pricebook_items").insert(payload);
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

  async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !tenant) return;

    const text = await file.text();
    const lines = text.split("\n").filter(Boolean);
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const rows = lines.slice(1);

    const items = rows.map((row) => {
      const cols = row.split(",");
      const get = (key: string) => cols[headers.indexOf(key)]?.trim() ?? "";
      return {
        tenant_id: tenant.id,
        name: get("name"),
        item_type: (get("type") || "service") as PricebookItemType,
        category: get("category") || null,
        unit_price: parseFloat(get("price") || get("unit_price") || "0"),
        cost: parseFloat(get("cost") || "0") || null,
        sku: get("sku") || null,
        description: get("description") || null,
        is_active: true,
      };
    }).filter((i) => i.name);

    if (items.length === 0) {
      toast.error("No valid rows found. Columns needed: name, type, price");
      return;
    }

    const { error } = await supabase.from("pricebook_items").insert(items);
    if (error) {
      toast.error("Import failed: " + error.message);
    } else {
      toast.success(`Imported ${items.length} items`);
      void loadItems();
    }
    e.target.value = "";
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Pricebook</h1>
        <div className="flex gap-2">
          <label className="cursor-pointer">
            <Button variant="outline" size="sm" asChild>
              <span><Upload className="h-4 w-4 mr-1" /> Import CSV</span>
            </Button>
            <input type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />
          </label>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Item
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search items…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No items yet
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{item.item_type}</Badge>
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground text-sm">
                      {item.category ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(item.unit_price)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm">
                      {item.cost ? formatCurrency(item.cost) : "—"}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(item)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Form dialog */}
      <Dialog open={showForm} onOpenChange={(v) => !v && setShowForm(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editItem ? "Edit Item" : "New Pricebook Item"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input placeholder="Drain cleaning — standard" {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Type *</Label>
                <Controller name="item_type" control={control} render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ITEM_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Controller name="category" control={control} render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Unit Price *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input type="number" step="0.01" min="0" className="pl-7" {...register("unit_price")} />
                </div>
                {errors.unit_price && <p className="text-xs text-destructive">{errors.unit_price.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Cost (optional)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input type="number" step="0.01" min="0" className="pl-7" placeholder="0.00" {...register("cost")} />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>SKU</Label>
              <Input placeholder="PB-001" {...register("sku")} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editItem ? "Save Changes" : "Add Item"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
