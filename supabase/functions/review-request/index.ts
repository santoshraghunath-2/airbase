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

    const [customerRes, techRes, tenantRes] = await Promise.all([
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
        .select("name, twilio_phone_number, google_review_url, yelp_review_url")
        .eq("id", tenantId)
        .single(),
    ]);

    const customer = customerRes.data;
    const tech     = techRes.data;
    const tenant   = tenantRes.data;

    if (!customer?.phone) {
      console.warn(`review-request: no customer phone for job ${jobId}`);
      return new Response("no phone", { status: 200 });
    }
    if (!tenant?.twilio_phone_number) {
      console.warn(`review-request: no twilio_phone_number for tenant ${tenantId}`);
      return new Response("no from number", { status: 200 });
    }

    const reviewUrl = tenant.google_review_url ?? tenant.yelp_review_url;
    if (!reviewUrl) {
      console.warn(`review-request: no review URL configured for tenant ${tenantId} — skipping`);
      // Log so operator knows to configure this
      await logAgentAction(supabase, {
        tenantId,
        agentType:      "review_request",
        triggerEvent:   `job:${jobId}:status_changed:completed`,
        contextSnapshot: { job_id: jobId },
        reasoning:      "Review request skipped — no google_review_url or yelp_review_url configured for this tenant.",
        proposedAction: { type: "skipped", reason: "no_review_url" },
        confidence:     1.0,
        autoExecute:    false,
      });
      return new Response("no review url", { status: 200 });
    }

    const customerName = firstName(customer.name);
    const techName     = tech?.name ? firstName(tech.name) : null;
    const companyName  = tenant.name;

    const techClause = techName
      ? `If ${techName} took great care of you`
      : "If we took great care of you";

    const body =
      `Hi ${customerName} — thanks for choosing ${companyName} today! ` +
      `${techClause}, a quick review means the world to our small team: ${reviewUrl} ` +
      `Reply STOP to opt out.`;

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
