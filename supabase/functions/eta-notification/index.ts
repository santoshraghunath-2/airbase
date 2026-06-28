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

function formatTime(iso: string, timezone: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    });
  } catch {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
}

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();
    const job = payload.record as Record<string, unknown>;
    const oldJob = payload.old_record as Record<string, unknown>;

    // Guard: only fire when transitioning to en_route
    if (job.status !== "en_route" || oldJob?.status === "en_route") {
      return new Response("skip", { status: 200 });
    }

    const tenantId = job.tenant_id as string;
    const jobId    = job.id as string;
    const techId   = job.tech_id as string | null;

    // Load customer, tech, and tenant in parallel
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
        .select("name, twilio_phone_number, timezone")
        .eq("id", tenantId)
        .single(),
    ]);

    const customer = customerRes.data;
    const tech     = techRes.data;
    const tenant   = tenantRes.data;

    if (!customer?.phone) {
      console.warn(`eta-notification: no customer phone for job ${jobId}`);
      return new Response("no phone", { status: 200 });
    }
    if (!tenant?.twilio_phone_number) {
      console.warn(`eta-notification: no twilio_phone_number for tenant ${tenantId}`);
      return new Response("no from number", { status: 200 });
    }

    const techName     = tech?.name ? firstName(tech.name) : "Your technician";
    const customerName = firstName(customer.name);
    const companyName  = tenant.name;
    const timezone     = tenant.timezone ?? "America/Los_Angeles";

    // Build ETA text — use scheduled_start if available, otherwise omit specific time
    let etaClause = "";
    if (job.scheduled_start) {
      const etaTime = formatTime(job.scheduled_start as string, timezone);
      etaClause = ` — estimated arrival by ${etaTime}`;
    }

    const body =
      `Hi ${customerName}, ${techName} from ${companyName} is on the way to you${etaClause}. ` +
      `Reply STOP to opt out of texts.`;

    await sendSms(customer.phone, tenant.twilio_phone_number, body);

    await logAgentAction(supabase, {
      tenantId,
      agentType:      "eta_notification",
      triggerEvent:   `job:${jobId}:status_changed:en_route`,
      contextSnapshot: { job_id: jobId, customer_phone: customer.phone, tech_id: techId },
      reasoning:      `Job ${jobId} transitioned to en_route. SMS sent to customer notifying them ${techName} is on the way.`,
      proposedAction: { type: "sms", to: customer.phone, body },
      confidence:     1.0,
      autoExecute:    true,
    });

    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("eta-notification error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
