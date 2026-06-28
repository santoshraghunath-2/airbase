import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Customer, ServiceLocation } from "@/types/database.types";

const schema = z.object({
  name:      z.string().min(1, "Name is required"),
  phone:     z.string().min(7, "Enter a valid phone number"),
  email:     z.string().email("Enter a valid email").optional().or(z.literal("")),
  phone_alt: z.string().optional(),
  notes:     z.string().optional(),
  address:   z.string().min(1, "Address is required"),
  city:      z.string().optional(),
  state:     z.string().optional(),
  zip:       z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open:             boolean;
  onClose:          () => void;
  onSaved:          () => void;
  editCustomer?:    Customer;
  editLocation?:    ServiceLocation | null;
}

export default function CustomerFormDialog({
  open, onClose, onSaved, editCustomer, editLocation,
}: Props) {
  const { tenant } = useAuth();
  const [saving, setSaving] = useState(false);
  const isEdit = !!editCustomer;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  // Prefill form when opening in edit mode
  useEffect(() => {
    if (open && isEdit && editCustomer) {
      reset({
        name:      editCustomer.name,
        phone:     editCustomer.phone,
        email:     editCustomer.email ?? "",
        phone_alt: editCustomer.phone_alt ?? "",
        notes:     editCustomer.notes ?? "",
        address:   editLocation?.address ?? "",
        city:      editLocation?.city ?? "",
        state:     editLocation?.state ?? "",
        zip:       editLocation?.zip ?? "",
      });
    } else if (open && !isEdit) {
      reset({});
    }
  }, [open, isEdit, editCustomer, editLocation, reset]);

  async function onSubmit(values: FormValues) {
    if (!tenant) return;
    setSaving(true);
    try {
      if (isEdit && editCustomer) {
        // Update existing customer
        const { error: custError } = await supabase
          .from("customers")
          .update({
            name:      values.name,
            phone:     values.phone,
            email:     values.email || null,
            phone_alt: values.phone_alt || null,
            notes:     values.notes || null,
          })
          .eq("id", editCustomer.id);
        if (custError) throw custError;

        // Update primary location if one exists
        if (editLocation) {
          const { error: locError } = await supabase
            .from("service_locations")
            .update({
              address: values.address,
              city:    values.city || null,
              state:   values.state || null,
              zip:     values.zip || null,
            })
            .eq("id", editLocation.id);
          if (locError) throw locError;
        }

        toast.success(`${values.name} updated`);
      } else {
        // Create new customer
        const { data: customer, error: custError } = await supabase
          .from("customers")
          .insert({
            tenant_id: tenant.id,
            name:      values.name,
            phone:     values.phone,
            email:     values.email || null,
            phone_alt: values.phone_alt || null,
            notes:     values.notes || null,
            source:    "manual",
          })
          .select("id")
          .single();
        if (custError) throw custError;

        const { error: locError } = await supabase.from("service_locations").insert({
          tenant_id:   tenant.id,
          customer_id: customer.id,
          address:     values.address,
          city:        values.city || null,
          state:       values.state || null,
          zip:         values.zip || null,
          is_primary:  true,
        });
        if (locError) throw locError;

        toast.success(`${values.name} added`);
      }

      reset();
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save customer");
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Customer" : "New Customer"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label>Full Name *</Label>
              <Input placeholder="John Smith" {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Phone *</Label>
              <Input placeholder="(415) 555-0100" type="tel" {...register("phone")} />
              {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Alt Phone</Label>
              <Input placeholder="(415) 555-0101" type="tel" {...register("phone_alt")} />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>Email</Label>
              <Input placeholder="john@example.com" type="email" {...register("email")} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>Notes</Label>
              <Textarea placeholder="Internal notes about this customer…" rows={2} {...register("notes")} />
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <p className="text-sm font-medium">Primary Service Location</p>
            <div className="space-y-1.5">
              <Label>Street Address *</Label>
              <Input placeholder="123 Main St" {...register("address")} />
              {errors.address && <p className="text-xs text-destructive">{errors.address.message}</p>}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1 space-y-1.5">
                <Label>City</Label>
                <Input placeholder="San Jose" {...register("city")} />
              </div>
              <div className="space-y-1.5">
                <Label>State</Label>
                <Input placeholder="CA" maxLength={2} {...register("state")} />
              </div>
              <div className="space-y-1.5">
                <Label>ZIP</Label>
                <Input placeholder="95101" {...register("zip")} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {isEdit ? "Save Changes" : "Save Customer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
