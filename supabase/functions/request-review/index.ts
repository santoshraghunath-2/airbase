// request-review — sends a Google/Yelp review solicitation SMS to the customer.
//
// POST { job_id, manual?: boolean }
//   manual = true  → send regardless of visit_reason (dispatcher-initiated)
//   manual = false → only send for new_request / parts_warranty (auto on job completion)
//
// Returns { sent: boolean, reason?: string }

import { createClient } from "npm:@supabase/supabase-js@2";

const serviceClient = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// visit_reason values that can be auto-sent (no manual approval needed)
const AUTO_ELIGIBLE: string[] = ["new_request", "parts_warranty"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const { data: { user }, error: authError } = await serviceClient.auth.getUser(jwt);
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: userRow } = await serviceClient
      .from("users")
      .select("id, tenant_id")
      .eq("auth_id", user.id)
      .single();
    if (!userRow) return json({ error: "User not found" }, 404);

    const { id: sentBy, tenant_id } = userRow as { id: string; tenant_id: string };

    const body = await req.json() as { job_id: string; manual?: boolean };
    const { job_id, manual = false } = body;
    if (!job_id) return json({ error: "job_id required" }, 400);

    // ── Fetch job with customer + technician ─────────────────────────────────
    const { data: job, error: jobErr } = await serviceClient
      .from("jobs")
      .select("id, tenant_id, customer_id, visit_reason, status, customers(id, name, phone, sms_opt_out), technicians(name)")
      .eq("id", job_id)
      .eq("tenant_id", tenant_id)
      .single();

    if (jobErr || !job) return json({ sent: false, reason: "Job not found" }, 404);

    type JobData = {
      id: string; tenant_id: string; customer_id: string;
      visit_reason: string; status: string;
      customers: { id: string; name: string; phone: string | null; sms_opt_out: boolean } | null;
      technicians: { name: string } | null;
    };
    const j = job as JobData;

    // ── Gate: job must be completed or invoiced ───────────────────────────────
    if (!["completed", "invoiced"].includes(j.status)) {
      return json({ sent: false, reason: "Job not yet completed" });
    }

    // ── Gate: auto-send only for eligible visit reasons ───────────────────────
    if (!manual && !AUTO_ELIGIBLE.includes(j.visit_reason)) {
      return json({ sent: false, reason: `visit_reason '${j.visit_reason}' requires manual send` });
    }

    // ── Gate: customer must have a phone and not opted out ────────────────────
    const customer = j.customers;
    if (!customer?.phone) {
      return json({ sent: false, reason: "Customer has no phone number" });
    }
    if (customer.sms_opt_out) {
      return json({ sent: false, reason: "Customer has opted out of SMS" });
    }

    // ── Gate: no duplicate review request for this job ────────────────────────
    const { data: existing } = await serviceClient
      .from("review_requests")
      .select("id")
      .eq("job_id", job_id)
      .maybeSingle();
    if (existing) {
      return json({ sent: false, reason: "Review request already sent for this job" });
    }

    // ── Fetch tenant for review URLs ──────────────────────────────────────────
    const { data: tenant } = await serviceClient
      .from("tenants")
      .select("name, google_review_url, yelp_review_url, sms_sender_name")
      .eq("id", tenant_id)
      .single();

    if (!tenant) return json({ sent: false, reason: "Tenant not found" }, 500);

    type TenantData = { name: string; google_review_url: string | null; yelp_review_url: string | null; sms_sender_name: string | null };
    const t = tenant as TenantData;

    const reviewUrl = t.google_review_url ?? t.yelp_review_url;
    if (!reviewUrl) {
      return json({ sent: false, reason: "No review URL configured — add Google or Yelp review URL in Settings" });
    }

    // ── Build SMS message ─────────────────────────────────────────────────────
    const firstName = customer.name.split(" ")[0];
    const companyName = t.sms_sender_name ?? t.name;
    const techName = j.technicians?.name;
    const serviceClause = techName
      ? `your service with ${techName}`
      : `your service today`;

    const message =
      `Hi ${firstName}, thank you for choosing ${companyName}! ` +
      `We hope you were happy with ${serviceClause}. ` +
      `If you have a moment, we'd really appreciate a review: ${reviewUrl}\n\n` +
      `Reply STOP to opt out.`;

    // ── Send SMS ──────────────────────────────────────────────────────────────
    const { error: smsErr } = await serviceClient.functions.invoke("send-sms", {
      body: { to: customer.phone, tenantId: tenant_id, message },
    });

    const status = smsErr ? "failed" : "sent";

    // ── Log to review_requests ────────────────────────────────────────────────
    await serviceClient.from("review_requests").insert({
      tenant_id,
      job_id,
      customer_id: customer.id,
      sent_by: manual ? sentBy : null,
      channel: "sms",
      review_url: reviewUrl,
      status,
      error: smsErr ? String(smsErr) : null,
    });

    if (smsErr) {
      return json({ sent: false, reason: "SMS delivery failed", error: String(smsErr) });
    }

    return json({ sent: true });
  } catch (e) {
    console.error("request-review error:", e);
    return json({ error: String(e) }, 500);
  }
});
