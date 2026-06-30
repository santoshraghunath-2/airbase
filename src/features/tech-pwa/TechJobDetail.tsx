import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Phone, ChevronLeft, Camera, Loader2, Navigation, CheckCircle2, Calculator,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { jobStatusLabel, jobStatusColor, jobTypeLabel, cn } from "@/lib/utils";
import type { JobWithRelations, JobStatus } from "@/types/database.types";

const STATUS_FLOW: { from: JobStatus; to: JobStatus; label: string }[] = [
  { from: "dispatched", to: "en_route", label: "Start Driving" },
  { from: "en_route", to: "arrived", label: "I've Arrived" },
  { from: "arrived", to: "in_progress", label: "Start Work" },
  { from: "in_progress", to: "completed", label: "Complete Job" },
];

export default function TechJobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const { tenant } = useAuth();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobWithRelations | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [updating, setUpdating] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);

  useEffect(() => {
    if (!jobId || !tenant) return;
    void loadJob();
  }, [jobId, tenant]);

  async function loadJob() {
    if (!jobId || !tenant) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("jobs")
        .select("*, customers(id, name, phone, email), service_locations(id, address, city, state, zip, location_notes), technicians(id, name, phone)")
        .eq("id", jobId)
        .eq("tenant_id", tenant.id)
        .single();
      if (error) throw error;
      setJob(data as JobWithRelations);
      setNotes(data.internal_notes ?? "");
    } catch {
      toast.error("Failed to load job");
    } finally {
      setLoading(false);
    }
  }

  async function advanceStatus() {
    if (!job) return;
    const transition = STATUS_FLOW.find((t) => t.from === job.status);
    if (!transition) return;

    setUpdating(true);
    try {
      const updates: Record<string, string | null> = {
        status: transition.to,
        internal_notes: notes || null,
      };

      if (transition.to === "in_progress") updates.actual_start = new Date().toISOString();
      if (transition.to === "completed") {
        updates.actual_end = new Date().toISOString();

        // Trigger close-job Edge Function for SMS + duration calc
        await supabase.functions.invoke("close-job", {
          body: { job_id: job.id, notes: notes || null },
        });
      } else {
        const { error } = await supabase
          .from("jobs")
          .update(updates)
          .eq("id", job.id);
        if (error) throw error;

        // Notify customer when tech is on the way
        if (transition.to === "en_route" && job.customers?.phone) {
          void supabase.functions.invoke("send-sms", {
            body: {
              to: job.customers.phone,
              tenantId: tenant!.id,
              template: "tech_on_way",
              variables: {
                customerName: job.customers.name,
                techName: job.technicians?.name ?? "your technician",
                eta: "30",
              },
            },
          });
        }
      }

      toast.success(`Status updated to ${jobStatusLabel(transition.to)}`);
      await loadJob();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setUpdating(false);
    }
  }

  async function uploadPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !job || !tenant) return;
    setPhotoUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${tenant.id}/jobs/${job.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("job-photos").upload(path, file);
      if (error) throw error;
      toast.success("Photo uploaded");
    } catch (err) {
      toast.error("Photo upload failed");
    } finally {
      setPhotoUploading(false);
      e.target.value = "";
    }
  }

  async function saveNotes() {
    if (!job) return;
    const { error } = await supabase
      .from("jobs")
      .update({ internal_notes: notes || null })
      .eq("id", job.id);
    if (error) toast.error("Failed to save notes");
    else toast.success("Notes saved");
  }

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!job) {
    return <div className="p-4 text-sm text-muted-foreground">Job not found.</div>;
  }

  const nextTransition = STATUS_FLOW.find((t) => t.from === job.status);
  const isComplete = job.status === "completed" || job.status === "invoiced";

  return (
    <div className="p-4 space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/tech"><ChevronLeft className="h-4 w-4" /> Back</Link>
        </Button>
        <Badge className={cn("ml-auto text-xs border", jobStatusColor(job.status))} variant="outline">
          {jobStatusLabel(job.status)}
        </Badge>
      </div>

      {/* Job header */}
      <div className="rounded-xl border bg-white p-4 space-y-3">
        <div>
          <p className="text-xs text-muted-foreground">{jobTypeLabel(job.job_type)}</p>
          <h2 className="text-xl font-bold">{job.customers?.name ?? "—"}</h2>
        </div>

        {job.scheduled_start && (
          <p className="text-sm text-muted-foreground">
            {format(new Date(job.scheduled_start), "EEE MMM d 'at' h:mm a")}
          </p>
        )}

        {job.description && (
          <p className="text-sm bg-muted rounded-lg p-3">{job.description}</p>
        )}

        {/* Location */}
        {job.service_locations && (
          <a
            href={`https://maps.apple.com/?q=${encodeURIComponent(
              `${job.service_locations.address} ${job.service_locations.city ?? ""}`
            )}`}
            className="flex items-start gap-2 text-sm text-blue-600"
          >
            <Navigation className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">{job.service_locations.address}</p>
              <p className="text-xs text-muted-foreground">
                {[job.service_locations.city, job.service_locations.state, job.service_locations.zip]
                  .filter(Boolean).join(", ")}
              </p>
            </div>
          </a>
        )}

        {job.service_locations?.location_notes && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
            <strong>Location note:</strong> {job.service_locations.location_notes}
          </div>
        )}

        {/* Customer phone */}
        {job.customers?.phone && (
          <a
            href={`tel:${job.customers.phone}`}
            className="flex items-center gap-2 text-sm text-blue-600"
          >
            <Phone className="h-4 w-4" />
            {job.customers.phone}
          </a>
        )}
      </div>

      {/* Notes */}
      <div className="rounded-xl border bg-white p-4 space-y-3">
        <p className="font-semibold text-sm">Job Notes</p>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What did you find? What work was done?"
          rows={4}
          className="text-base"
        />
        <Button variant="outline" size="sm" onClick={saveNotes}>Save Notes</Button>
      </div>

      {/* Create estimate — visible once arrived or in progress */}
      {(job.status === "arrived" || job.status === "in_progress") && (
        <button
          onClick={() => navigate(`/tech/estimates/new?jobId=${job.id}`)}
          className="w-full flex items-center gap-3 rounded-xl border bg-white p-4 active:bg-muted transition-colors"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
            <Calculator className="h-5 w-5 text-blue-600" />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium">Build Estimate</p>
            <p className="text-xs text-muted-foreground">Good / Better / Best — present on-site</p>
          </div>
        </button>
      )}

      {/* Photo upload */}
      <div className="rounded-xl border bg-white p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            {photoUploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Camera className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div>
            <p className="text-sm font-medium">Add Photo</p>
            <p className="text-xs text-muted-foreground">Before / after, nameplate, issue</p>
          </div>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={uploadPhoto}
            disabled={photoUploading}
          />
        </label>
      </div>

      {/* Status advance button — sticky at bottom */}
      {!isComplete && nextTransition && (
        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto p-4 bg-background border-t">
          <Button
            className="w-full h-14 text-base"
            onClick={advanceStatus}
            disabled={updating}
          >
            {updating ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : nextTransition.to === "completed" ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : null}
            {nextTransition.label}
          </Button>
        </div>
      )}

      {isComplete && (
        <div className="flex items-center justify-center gap-2 py-4 text-green-700 bg-green-50 rounded-xl border border-green-200">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-medium">Job Complete</span>
        </div>
      )}
    </div>
  );
}
