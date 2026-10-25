import { createClient } from "npm:@supabase/supabase-js@2";
import { logAgentAction } from "../_shared/agent-logger.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN  = Deno.env.get("TWILIO_AUTH_TOKEN")!;

async function sendSms(to: string, from: string, body: string): Promise<void> {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio SMS failed: ${res.status} ${text}`);
  }
}

function firstName(fullName: string): string {
  return fullName?.split(" ")[0] ?? fullName;
}

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();
    const job    = payload.record as Record<string, unknown>;
    const oldJob = payload.old_record as Record<string, unknown>;

    // Guard: only fire when transitioning to completed
    if (job.status !== "completed" || oldJob?.status === "completed") {
      return new Response("skip", { status: 200 });
    }

    // Skip warranty calls and recalls — inappropriate to ask for a review
    const skipTypes = new Set(["warranty_call", "recall", "estimate_only"]);
    if (skipTypes.has(job.job_type as string)) {
      return new Response("skip: job type excluded", { status: 200 });
    }

    const tenantId = job.tenant_id as string;
    const jobId    = job.id as string;
    const techId   = job.tech_id as string | null;

    const [customerRes, techRes, tenantRes, jobTokenRes] = await Promise.all([
      supabase
        .from("customers")
        .select("name, phone")
        .eq("id", job.customer_id as string)
        .single(),
      techId
        ? supabase
            .from("technicians")
            .select("name")
            .eq("id", techId)
            .single()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("tenants")
        .select("name, twilio_phone_number, google_review_url, yelp_review_url, satisfaction_threshold")
        .eq("id", tenantId)
        .single(),
      supabase
        .from("jobs")
        .select("satisfaction_token")
        .eq("id", jobId)
        .single(),
    ]);

    const customer  = customerRes.data;
    const tech      = techRes.data;
    const tenant    = tenantRes.data;
    const jobToken  = jobTokenRes.data?.satisfaction_token as string | null;

    if (!customer?.phone) {
      console.warn(`review-request: no customer phone for job ${jobId}`);
      return new Response("no phone", { status: 200 });
    }
    if (!tenant?.twilio_phone_number) {
      console.warn(`review-request: no twilio_phone_number for tenant ${tenantId}`);
      return new Response("no from number", { status: 200 });
    }

    const hasReviewUrl = !!(tenant.google_review_url ?? tenant.yelp_review_url);
    const customerName = firstName(customer.name);
    const techName     = tech?.name ? firstName(tech.name) : null;
    const companyName  = tenant.name;

    // Build the rating URL — the rate-job function handles routing based on score.
    // If no token (shouldn't happen post-migration-042) or no review URL, fall back
    // to a direct review link or skip.
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const ratingUrl   = jobToken
      ? `${supabaseUrl}/functions/v1/rate-job?token=${jobToken}`
      : null;

    let body: string;
    if (ratingUrl) {
      const techClause = techName ? `, and ${techName} was your tech` : "";
      body =
        `Hi ${customerName} — thanks for choosing ${companyName} today${techClause}! ` +
        `How did we do? Tap to rate your experience (takes 5 seconds): ${ratingUrl} ` +
        `Reply STOP to opt out.`;
    } else if (hasReviewUrl) {
      // Fallback: direct link if no token available
      const reviewUrl = (tenant.google_review_url ?? tenant.yelp_review_url)!;
      const techClause = techName ? `If ${techName} took great care of you` : "If we took great care of you";
      body =
        `Hi ${customerName} — thanks for choosing ${companyName} today! ` +
        `${techClause}, a quick review means the world to our small team: ${reviewUrl} ` +
        `Reply STOP to opt out.`;
    } else {
      console.warn(`review-request: no review URL or token for job ${jobId} — skipping`);
      await logAgentAction(supabase, {
        tenantId,
        agentType:      "review_request",
        triggerEvent:   `job:${jobId}:status_changed:completed`,
        contextSnapshot: { job_id: jobId },
        reasoning:      "Review request skipped — no google_review_url, yelp_review_url, or satisfaction token configured.",
        proposedAction: { type: "skipped", reason: "no_review_url" },
        confidence:     1.0,
        autoExecute:    false,
      });
      return new Response("no review url", { status: 200 });
    }

    await sendSms(customer.phone, tenant.twilio_phone_number, body);

    await logAgentAction(supabase, {
      tenantId,
      agentType:      "review_request",
      triggerEvent:   `job:${jobId}:status_changed:completed`,
      contextSnapshot: { job_id: jobId, customer_phone: customer.phone, tech_id: techId },
      reasoning:      `Job ${jobId} completed. SMS review request sent to customer${techName ? ` mentioning ${techName}` : ""}.`,
      proposedAction: { type: "sms", to: customer.phone, body },
      confidence:     1.0,
      autoExecute:    true,
    });

    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("review-request error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
