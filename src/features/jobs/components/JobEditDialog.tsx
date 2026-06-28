import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { JobWithRelations } from "@/types/database.types";

const schema = z.object({
  job_type:                   z.string().min(1, "Job type is required"),
  priority:                   z.string().min(1),
  description:                z.string().optional(),
  scheduled_start:            z.string().optional(),
  estimated_duration_minutes: z.coerce.number().min(15).max(480).optional(),
});

type FormValues = z.infer<typeof schema>;

const JOB_TYPES = [
  { value: "plumbing_service",    label: "Plumbing Service" },
  { value: "drain_cleaning",      label: "Drain Cleaning" },
  { value: "water_heater_repair", label: "Water Heater Repair" },
  { value: "water_heater_install",label: "Water Heater Install" },
  { value: "hvac_service",        label: "HVAC Service" },
  { value: "hvac_repair",         label: "HVAC Repair" },
  { value: "hvac_install",        label: "HVAC Install" },
  { value: "hvac_maintenance",    label: "HVAC Maintenance" },
  { value: "electrical_service",  label: "Electrical Service" },
  { value: "electrical_repair",   label: "Electrical Repair" },
  { value: "electrical_install",  label: "Electrical Install" },
  { value: "general_maintenance", label: "General Maintenance" },
  { value: "estimate_only",       label: "Estimate Only" },
  { value: "warranty_call",       label: "Warranty Call" },
  { value: "recall",              label: "Recall" },
];

interface Props {
  open:    boolean;
  job:     JobWithRelations | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function JobEditDialog({ open, job, onClose, onSaved }: Props) {
  const { tenant } = useAuth();
  const [saving, setSaving] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  // Prefill when job changes or dialog opens
  useEffect(() => {
    if (open && job) {
      reset({
        job_type:                   job.job_type,
        priority:                   job.priority ?? "normal",
        description:                job.description ?? "",
        scheduled_start:            job.scheduled_start
          ? format(new Date(job.scheduled_start), "yyyy-MM-dd'T'HH:mm")
          : "",
        estimated_duration_minutes: job.estimated_duration_minutes ?? 60,
      });
    }
  }, [open, job, reset]);

  async function onSubmit(values: FormValues) {
    if (!tenant || !job) return;
    setSaving(true);
    try {
      const scheduledStart = values.scheduled_start
        ? new Date(values.scheduled_start).toISOString()
        : null;

      const scheduledEnd = scheduledStart && values.estimated_duration_minutes
        ? new Date(
            new Date(scheduledStart).getTime() +
            values.estimated_duration_minutes * 60_000
          ).toISOString()
        : null;

      const { error } = await supabase
        .from("jobs")
        .update({
          job_type:                   values.job_type,
          priority:                   values.priority,
          description:                values.description || null,
          scheduled_start:            scheduledStart,
          scheduled_end:              scheduledEnd,
          estimated_duration_minutes: values.estimated_duration_minutes ?? null,
        })
        .eq("id", job.id);

      if (error) throw error;
      toast.success("Job updated");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update job");
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Job</DialogTitle>
          {job?.customers?.name && (
            <p className="text-sm text-muted-foreground">{job.customers.name}</p>
          )}
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Job type */}
          <div className="space-y-1.5">
            <Label>Job Type *</Label>
            <Select
              value={watch("job_type")}
              onValueChange={(v) => setValue("job_type", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select job type" />
              </SelectTrigger>
              <SelectContent>
                {JOB_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.job_type && (
              <p className="text-xs text-destructive">{errors.job_type.message}</p>
            )}
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select
              value={watch("priority")}
              onValueChange={(v) => setValue("priority", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="emergency">🔴 Emergency</SelectItem>
                <SelectItem value="high">🟠 High</SelectItem>
                <SelectItem value="normal">🟢 Normal</SelectItem>
                <SelectItem value="low">⚪ Low</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Scheduled start */}
          <div className="space-y-1.5">
            <Label>Scheduled Start</Label>
            <Input
              type="datetime-local"
              {...register("scheduled_start")}
              className="text-sm"
            />
          </div>

          {/* Duration */}
          <div className="space-y-1.5">
            <Label>Estimated Duration (minutes)</Label>
            <Input
              type="number"
              min={15}
              max={480}
              step={15}
              placeholder="60"
              {...register("estimated_duration_minutes")}
            />
            {errors.estimated_duration_minutes && (
              <p className="text-xs text-destructive">
                {errors.estimated_duration_minutes.message}
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label>Description / Notes</Label>
            <Textarea
              rows={3}
              placeholder="What needs to be done…"
              {...register("description")}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
