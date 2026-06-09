import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  ChevronLeft, Plus, Trash2, Send, Loader2, Search,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/utils";
import type { Invoice, PricebookItem, Job } from "@/types/database.types";

const lineItemSchema = z.object({
  description: z.string().min(1, "Description required"),
  quantity: z.coerce.number().min(0.01),
  unit_price: z.coerce.number().min(0),
  taxable: z.boolean().default(true),
  pricebook_item_id: z.string().optional(),
});

const schema = z.object({
  job_id: z.string().min(1, "Select a job"),
  notes: z.string().optional(),
  line_items: z.array(lineItemSchema).min(1, "Add at least one line item"),
  tax_rate: z.coerce.number().min(0).max(100).default(8.5),
  discount_amount: z.coerce.number().min(0).default(0),
});

type FormValues = z.infer<typeof schema>;

export default function InvoiceBuilderPage() {
  const { tenant } = useAuth();
  const { tenantSlug, invoiceId } = useParams<{ tenantSlug: string; invoiceId: string }>();
  const navigate = useNavigate();
  const isNew = !invoiceId;

  const [existingInvoice, setExistingInvoice] = useState<Invoice | null>(null);
  const [jobs, setJobs] = useState<(Job & { customers: { name: string } | null })[]>([]);
  const [pricebookItems, setPricebookItems] = useState<PricebookItem[]>([]);
  const [pbSearch, setPbSearch] = useState("");
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const { register, handleSubmit, control, watch, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      line_items: [{ description: "", quantity: 1, unit_price: 0, taxable: true }],
      tax_rate: 8.5,
      discount_amount: 0,
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "line_items" });
  const lineItems = watch("line_items");
  const taxRate = watch("tax_rate");
  const discountAmount = watch("discount_amount");

  const subtotal = lineItems.reduce((sum, li) => sum + (li.quantity || 0) * (li.unit_price || 0), 0);
  const taxableSubtotal = lineItems
    .filter((li) => li.taxable)
    .reduce((sum, li) => sum + (li.quantity || 0) * (li.unit_price || 0), 0);
  const taxAmount = (taxableSubtotal * (taxRate || 0)) / 100;
  const total = subtotal + taxAmount - (discountAmount || 0);

  useEffect(() => {
    if (!tenant) return;
    void Promise.all([loadJobs(), loadPricebook()]);
    if (!isNew) void loadInvoice();
  }, [tenant]);

  async function loadJobs() {
    if (!tenant) return;
    const { data } = await supabase
      .from("jobs")
      .select("*, customers(name)")
      .eq("tenant_id", tenant.id)
      .eq("status", "completed")
      .is("deleted_at", null)
      .order("actual_end", { ascending: false })
      .limit(50);
    setJobs((data ?? []) as typeof jobs);
  }

  async function loadPricebook() {
    if (!tenant) return;
    const { data } = await supabase
      .from("pricebook_items")
      .select("*")
      .eq("tenant_id", tenant.id)
      .eq("is_active", true)
      .order("name");
    setPricebookItems(data ?? []);
  }

  async function loadInvoice() {
    if (!invoiceId || !tenant) return;
    setLoading(true);
    try {
      const { data: inv } = await supabase
        .from("invoices")
        .select("*")
        .eq("id", invoiceId)
        .eq("tenant_id", tenant.id)
        .single();
      if (!inv) return;
      setExistingInvoice(inv);

      const { data: lines } = await supabase
        .from("invoice_line_items")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("sort_order");

      setValue("job_id", inv.job_id);
      setValue("notes", inv.notes ?? "");
      setValue("discount_amount", inv.discount_amount);
      if (lines) {
        setValue("line_items", lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          taxable: l.taxable,
          pricebook_item_id: l.pricebook_item_id ?? undefined,
        })));
      }
    } finally {
      setLoading(false);
    }
  }

  function addPricebookItem(item: PricebookItem) {
    append({
      description: item.name,
      quantity: 1,
      unit_price: item.unit_price,
      taxable: item.taxable,
      pricebook_item_id: item.id,
    });
    setPbSearch("");
  }

  const filteredPb = pricebookItems.filter((i) =>
    !pbSearch || i.name.toLowerCase().includes(pbSearch.toLowerCase())
  );

  async function saveInvoice(values: FormValues, send = false): Promise<string | null> {
    if (!tenant) return null;
    setSaving(true);
    try {
      const job = jobs.find((j) => j.id === values.job_id);
      if (!job) throw new Error("Job not found");

      const invoicePayload = {
        tenant_id: tenant.id,
        job_id: values.job_id,
        customer_id: job.customer_id,
        status: send ? "sent" as const : "draft" as const,
        subtotal,
        tax_amount: taxAmount,
        discount_amount: values.discount_amount,
        total,
        balance_due: total,
        notes: values.notes || null,
        sent_at: send ? new Date().toISOString() : null,
      };

      let savedId: string;

      if (existingInvoice) {
        const { error } = await supabase
          .from("invoices")
          .update(invoicePayload)
          .eq("id", existingInvoice.id);
        if (error) throw error;

        // Replace line items
        await supabase.from("invoice_line_items").delete().eq("invoice_id", existingInvoice.id);
        savedId = existingInvoice.id;
      } else {
        const { data, error } = await supabase
          .from("invoices")
          .insert(invoicePayload)
          .select("id")
          .single();
        if (error) throw error;
        savedId = data.id;
      }

      // Insert line items
      const lineItemsPayload = values.line_items.map((li, idx) => ({
        invoice_id: savedId,
        description: li.description,
        quantity: li.quantity,
        unit_price: li.unit_price,
        total: li.quantity * li.unit_price,
        taxable: li.taxable,
        sort_order: idx,
        pricebook_item_id: li.pricebook_item_id ?? null,
      }));

      const { error: liError } = await supabase.from("invoice_line_items").insert(lineItemsPayload);
      if (liError) throw liError;

      return savedId;
    } finally {
      setSaving(false);
    }
  }

  async function onSave(values: FormValues) {
    try {
      const id = await saveInvoice(values);
      if (id) {
        toast.success("Invoice saved");
        navigate(`/${tenantSlug}/invoices/${id}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function onSend(values: FormValues) {
    setSending(true);
    try {
      const id = await saveInvoice(values, true);
      if (id) {
        toast.success("Invoice sent");
        navigate(`/${tenantSlug}/invoices`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/${tenantSlug}/invoices`}><ChevronLeft className="h-4 w-4" /> Invoices</Link>
        </Button>
        <h1 className="text-2xl font-bold">
          {isNew ? "New Invoice" : existingInvoice?.invoice_number ?? "Edit Invoice"}
        </h1>
      </div>

      <form className="space-y-6">
        {/* Job selector */}
        <Card>
          <CardContent className="pt-5 space-y-3">
            <Label>Completed Job *</Label>
            <select
              className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
              {...register("job_id")}
            >
              <option value="">Select a completed job…</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.customers?.name ?? "—"} — {j.job_type.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            {errors.job_id && <p className="text-xs text-destructive">{errors.job_id.message}</p>}
          </CardContent>
        </Card>

        {/* Pricebook quick-add */}
        <Card>
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-sm">Line Items</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ description: "", quantity: 1, unit_price: 0, taxable: true })}
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Line
              </Button>
            </div>

            {/* Pricebook search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search pricebook to add item…"
                className="pl-9"
                value={pbSearch}
                onChange={(e) => setPbSearch(e.target.value)}
              />
              {pbSearch && filteredPb.length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-h-40 overflow-auto rounded-md border bg-background shadow-lg">
                  {filteredPb.slice(0, 8).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="w-full text-left px-4 py-2 hover:bg-muted text-sm flex justify-between"
                      onClick={() => addPricebookItem(item)}
                    >
                      <span>{item.name}</span>
                      <span className="text-muted-foreground">{formatCurrency(item.unit_price)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Line items */}
            <div className="space-y-3">
              {fields.map((field, idx) => (
                <div key={field.id} className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-6">
                    <Input
                      placeholder="Description"
                      {...register(`line_items.${idx}.description`)}
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Qty"
                      {...register(`line_items.${idx}.quantity`)}
                    />
                  </div>
                  <div className="col-span-3 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      className="pl-7"
                      {...register(`line_items.${idx}.unit_price`)}
                    />
                  </div>
                  <div className="col-span-1 flex items-center justify-center pt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => remove(idx)}
                      disabled={fields.length === 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <Separator />

            {/* Totals */}
            <div className="space-y-2 text-sm max-w-xs ml-auto">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Tax (%)</span>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  className="w-20 h-7 text-right text-sm"
                  {...register("tax_rate")}
                />
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Tax amount</span>
                <span>{formatCurrency(taxAmount)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Discount ($)</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-24 h-7 text-right text-sm"
                  {...register("discount_amount")}
                />
              </div>
              <Separator />
              <div className="flex justify-between font-semibold text-base">
                <span>Total</span>
                <span>{formatCurrency(total)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardContent className="pt-5 space-y-2">
            <Label>Customer-Visible Notes</Label>
            <Textarea placeholder="Thank you for your business…" rows={2} {...register("notes")} />
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" asChild>
            <Link to={`/${tenantSlug}/invoices`}>Cancel</Link>
          </Button>
          <Button type="button" variant="outline" onClick={handleSubmit(onSave)} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Draft
          </Button>
          <Button type="button" onClick={handleSubmit(onSend)} disabled={sending || saving}>
            {sending && <Loader2 className="h-4 w-4 animate-spin" />}
            <Send className="h-4 w-4" />
            Send Invoice
          </Button>
        </div>
      </form>
    </div>
  );
}
