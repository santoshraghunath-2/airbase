import { createClient } from "npm:@supabase/supabase-js@2";
import { logAgentAction } from "../_shared/agent-logger.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Job types grouped by service category.
// Two jobs are "related" if they share a category — a callback on the same system.
const JOB_TYPE_CATEGORY: Record<string, string> = {
  plumbing_service:       "plumbing",
  drain_cleaning:         "plumbing",
  water_heater_repair:    "plumbing",
  water_heater_install:   "plumbing",
  hvac_service:           "hvac",
  hvac_repair:            "hvac",
  hvac_install:           "hvac",
  hvac_maintenance:       "hvac",
  electrical_service:     "electrical",
  electrical_repair:      "electrical",
  electrical_install:     "electrical",
  general_maintenance:    "general",
};

const WARRANTY_WINDOW_DAYS = 30;

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();
    const job = payload.record as Record<string, unknown>;

    const jobId     = job.id as string;
    const tenantId  = job.tenant_id as string;
    const customerId = job.customer_id as string;
    const jobType   = job.job_type as string;
    const createdAt = job.created_at as string;

    // Already classified as warranty/recall — skip
    if (jobType === "warranty_call" || jobType === "recall") {
      return new Response("skip: already warranty type", { status: 200 });
    }

    const newCategory = JOB_TYPE_CATEGORY[jobType];
    if (!newCategory) {
      // Unknown type (e.g. estimate_only) — nothing to match against
      return new Response("skip: uncategorized job type", { status: 200 });
    }

    // All job types that share the same category
    const relatedTypes = Object.entries(JOB_TYPE_CATEGORY)
      .filter(([, cat]) => cat === newCategory)
      .map(([type]) => type);

    const windowStart = new Date(new Date(createdAt).getTime() - WARRANTY_WINDOW_DAYS * 86_400_000).toISOString();

    // Find any completed or invoiced job for this customer in the same category within the window
    const { data: priorJobs, error } = await supabase
      .from("jobs")
      .select("id, job_type, status, actual_end, completed_at:updated_at, tech_id, description")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .in("status", ["completed", "invoiced"])
      .in("job_type", relatedTypes)
      .gte("updated_at", windowStart)
      .neq("id", jobId)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) throw error;

    if (!priorJobs || priorJobs.length === 0) {
      // No match — ordinary new job
      return new Response(JSON.stringify({ match: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const matchedJob = priorJobs[0];
    const daysSince  = Math.round(
      (new Date(createdAt).getTime() - new Date(matchedJob.completed_at).getTime()) / 86_400_000
    );

    // Build proposed action — operator sees this and decides whether to waive service call
    const proposedAction = {
      type:                  "flag_warranty_callback",
      new_job_id:            jobId,
      prior_job_id:          matchedJob.id,
      prior_job_type:        matchedJob.job_type,
      days_since_prior_job:  daysSince,
      suggested_tech_id:     matchedJob.tech_id ?? null,
      suggested_actions: [
        "Waive service call fee ($99)",
        "Assign same tech who did prior job",
        "Review prior job notes before dispatch",
      ],
    };

    const reasoning =
      `New ${jobType} job (${jobId}) was booked for customer ${customerId} only ` +
      `${daysSince} day${daysSince === 1 ? "" : "s"} after a completed ` +
      `${matchedJob.job_type} job (${matchedJob.id}). ` +
      `This may be a callback or warranty issue. ` +
      `Recommend waiving the service call fee and assigning the same tech if available.`;

    await logAgentAction(supabase, {
      tenantId,
      agentType:       "warranty_detector",
      triggerEvent:    `job:${jobId}:created`,
      contextSnapshot: {
        new_job_id:     jobId,
        new_job_type:   jobType,
        customer_id:    customerId,
        prior_job_id:   matchedJob.id,
        days_since:     daysSince,
        window_days:    WARRANTY_WINDOW_DAYS,
      },
      reasoning,
      proposedAction,
      confidence:   0.85,
      autoExecute:  false, // always surfaces for operator review
    });

    return new Response(JSON.stringify({ match: true, prior_job_id: matchedJob.id, days_since: daysSince }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("warranty-detector error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
