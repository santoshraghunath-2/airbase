// Retell AI voice booking webhook
// Handles mid-call function calls and call lifecycle events from Retell.
//
// In Retell dashboard:
//   - Set Custom Function webhook URL → this function
//   - Call events webhook → same URL
//   - Functions to register: lookup_customer, check_availability, create_booking, escalate_to_human
//
// This endpoint is server-to-server only. CORS headers are intentionally absent.
// OPTIONS requests are rejected with 405.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";
import { format, addDays, startOfDay, endOfDay } from "npm:date-fns";
import { verifyRetellSignature } from "../_shared/retell-auth.ts";

// Lazy init so the module can be imported in tests without env vars present.
let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
  }
  return _supabase;
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// ─── Retell payload types ─────────────────────────────────────────────────────

interface RetellFunctionCallEvent {
  event: "function_call";
  call_id: string;
  agent_id: string;
  call_type: "phone_call" | "web_call";
  from_number?: string;
  to_number?: string;
  call_status: string;
  name: string;
  arguments: string; // JSON string
}

interface RetellCallEvent {
  event: "call_started" | "call_ended" | "call_analyzed";
  call_id: string;
  agent_id: string;
  call_type: "phone_call" | "web_call";
  from_number?: string;
  to_number?: string;
  call_status: string;
  transcript?: string;
  call_analysis?: {
    call_summary?: string;
    user_sentiment?: string;
    call_successful?: boolean;
  };
  duration_ms?: number;
}

type RetellEvent = RetellFunctionCallEvent | RetellCallEvent;

// ─── Tool implementations ─────────────────────────────────────────────────────

async function lookupCustomer(args: { phone: string; tenant_id: string }) {
  const normalized = args.phone.replace(/\D/g, "");

  const { data: customer } = await getSupabase()
    .from("customers")
    .select(`
      id, name, phone, email, notes,
      service_locations(id, address, city, state, zip),
      memberships(id, status, membership_plans(name))
    `)
    .eq("tenant_id", args.tenant_id)
    .or(`phone.eq.${args.phone},phone.eq.+1${normalized},phone.eq.${normalized}`)
    .is("deleted_at", null)
    .single();

  if (!customer) {
    return { found: false, message: "New customer — no existing record." };
  }

  const membership = (customer.memberships as Array<{ status: string; membership_plans: { name: string } | null }> | null)?.[0];
  const location = (customer.service_locations as Array<{ address: string; city: string; state: string }> | null)?.[0];

  // Last 3 jobs for context
  const { data: recentJobs } = await getSupabase()
    .from("jobs")
    .select("job_type, status, scheduled_start, description")
    .eq("tenant_id", args.tenant_id)
    .eq("customer_id", customer.id)
    .order("scheduled_start", { ascending: false })
    .limit(3);

  return {
    found: true,
    customer_id: customer.id,
    name: customer.name,
    email: customer.email,
    notes: customer.notes,
    primary_address: location ? `${location.address}, ${location.city}, ${location.state}` : null,
    is_member: membership?.status === "active",
    membership_plan: membership?.status === "active" ? (membership.membership_plans as { name: string } | null)?.name : null,
    recent_jobs: (recentJobs ?? []).map((j) => ({
      type: j.job_type,
      status: j.status,
      date: j.scheduled_start ? format(new Date(j.scheduled_start), "MMM d") : null,
    })),
  };
}

async function checkAvailability(args: {
  tenant_id: string;
  date: string; // "today" | "tomorrow" | "YYYY-MM-DD"
  job_type: string;
  duration_minutes?: number;
}) {
  // Resolve date
  let targetDate: Date;
  if (args.date === "today") targetDate = new Date();
  else if (args.date === "tomorrow") targetDate = addDays(new Date(), 1);
  else targetDate = new Date(args.date);

  const dayStart = startOfDay(targetDate).toISOString();
  const dayEnd = endOfDay(targetDate).toISOString();

  // Count jobs already scheduled that day
  const { data: scheduledJobs } = await getSupabase()
    .from("jobs")
    .select("tech_id, scheduled_start, scheduled_end, estimated_duration_minutes")
    .eq("tenant_id", args.tenant_id)
    .gte("scheduled_start", dayStart)
    .lte("scheduled_start", dayEnd)
    .not("status", "in", "(cancelled,no_show)");

  // Count active techs
  const { data: techs } = await getSupabase()
    .from("technicians")
    .select("id, name")
    .eq("tenant_id", args.tenant_id)
    .eq("is_active", true);

  const techCount = (techs ?? []).length;
  const bookedCount = (scheduledJobs ?? []).length;
  const approxCapacity = techCount * 4; // ~4 jobs/tech/day
  const hasAvailability = bookedCount < approxCapacity * 0.85;

  const dateLabel = args.date === "today" ? "today" : args.date === "tomorrow" ? "tomorrow" : format(targetDate, "EEEE, MMMM d");

  if (!hasAvailability) {
    const nextDay = format(addDays(targetDate, 1), "EEEE, MMMM d");
    return {
      available: false,
      message: `We're fully booked on ${dateLabel}. We have openings on ${nextDay} — would that work?`,
      suggested_date: addDays(targetDate, 1).toISOString().split("T")[0],
    };
  }

  // Suggest morning / afternoon / evening windows
  const slots = [
    { label: "morning (8am–12pm)", start: "08:00", end: "12:00" },
    { label: "afternoon (12pm–5pm)", start: "12:00", end: "17:00" },
  ];

  return {
    available: true,
    date: dateLabel,
    slots: slots.map((s) => ({ label: s.label, start: s.start, end: s.end })),
    message: `We have openings ${dateLabel} in the morning (8am–12pm) or afternoon (12pm–5pm). Which works better?`,
  };
}

async function createBooking(args: {
  tenant_id: string;
  caller_phone: string;
  customer_id?: string;
  // New customer fields — collected by voice agent before calling this tool
  customer_name?: string;
  customer_email?: string;
  service_address: string;  // required — agent must collect before booking
  service_city?: string;
  service_state?: string;
  service_zip?: string;
  job_type: string;
  scheduled_date: string; // YYYY-MM-DD
  time_window: "morning" | "afternoon" | "evening";
  description?: string;
}, timezone: string) {
  // Resolve or create customer
  let customerId = args.customer_id;

  if (!customerId) {
    const { data: newCustomer, error } = await getSupabase()
      .from("customers")
      .insert({
        tenant_id: args.tenant_id,
        name: args.customer_name ?? "Voice Caller",
        phone: args.caller_phone,
        email: args.customer_email ?? null,
        source: "voice",
      })
      .select("id")
      .single();

    if (error || !newCustomer) {
      return { success: false, message: "Unable to create your record. Please call back to complete your booking." };
    }
    customerId = newCustomer.id;

    // Always create a service location for new customers
    await getSupabase().from("service_locations").insert({
      tenant_id: args.tenant_id,
      customer_id: customerId,
      address: args.service_address,
      city: args.service_city ?? null,
      state: args.service_state ?? null,
      zip: args.service_zip ?? null,
      is_primary: true,
    });
  }

  // Get primary location
  const { data: location } = await getSupabase()
    .from("service_locations")
    .select("id")
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .order("is_primary", { ascending: false })
    .limit(1)
    .single();

  if (!location) {
    return { success: false, message: "No service address on file. Please call back so we can confirm your address." };
  }

  // Map time window to scheduled start using tenant timezone
  const timeMap = { morning: "09:00:00", afternoon: "13:00:00", evening: "17:00:00" };
  // Build ISO string; Supabase stores as UTC — using offset for now
  // TODO: use tenant timezone for proper conversion
  const scheduledStart = `${args.scheduled_date}T${timeMap[args.time_window]}`;

  const { data: job, error: jobError } = await getSupabase()
    .from("jobs")
    .insert({
      tenant_id: args.tenant_id,
      customer_id: customerId,
      location_id: location.id,
      job_type: args.job_type,
      status: "scheduled",
      priority: "normal",
      description: args.description ?? null,
      scheduled_start: scheduledStart,
      source: "voice",
      visit_reason: "new_request",
    })
    .select("id")
    .single();

  if (jobError || !job) {
    return { success: false, message: "Booking failed on our end. Please call back and we'll get you taken care of." };
  }

  // Fire dispatch agent — same pattern as create-job, fire-and-forget
  void fetch(
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/dispatch-agent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ job_id: job.id }),
    }
  );

  // Log to booking_conversations (non-critical)
  void getSupabase().from("booking_conversations").insert({
    tenant_id: args.tenant_id,
    customer_id: customerId,
    phone: args.caller_phone,
    channel: "voice",
    status: "resolved",
    job_id: job.id,
    messages: [],
    context: { job_type: args.job_type, scheduled_date: args.scheduled_date, time_window: args.time_window },
  });

  const dateLabel = format(new Date(args.scheduled_date), "EEEE, MMMM d");
  return {
    success: true,
    job_id: job.id,
    message: `Booked! You're scheduled for ${dateLabel} in the ${args.time_window}. You'll receive a confirmation text shortly.`,
    confirmation: {
      job_id: job.id,
      date: dateLabel,
      time_window: args.time_window,
      job_type: args.job_type,
    },
  };
}

async function escalateToHuman(args: {
  tenant_id: string;
  caller_phone: string;
  call_id: string;
  reason: string;
  summary: string;
}) {
  // Log escalated conversation. call_id is stored so the Command Center can
  // correlate this escalation to the live Retell call.
  // Live transfer is handled by Retell's agent configuration (transfer destination
  // set in the Retell dashboard for this agent). The webhook just needs to return
  // cleanly — Retell bridges the PSTN call after the function call completes.
  await getSupabase().from("booking_conversations").insert({
    tenant_id: args.tenant_id,
    customer_id: null,
    phone: args.caller_phone,
    channel: "voice",
    status: "escalated",
    messages: [],
    context: {
      escalation_reason: args.reason,
      summary: args.summary,
      call_id: args.call_id,
    },
  }).catch(() => {});

  return {
    escalated: true,
    message: "I'm connecting you with one of our team members right now. Please hold.",
  };
}

// ─── Tenant resolution ────────────────────────────────────────────────────────

interface TenantContext {
  tenantId: string;
  companyName: string;
  timezone: string;
}

async function resolveTenant(agentId: string): Promise<TenantContext | null> {
  // Primary: look up by retell_agent_id stored in agent_config.settings
  // Each tenant's booking_voice agent_config row stores their Retell agent ID.
  // To register a new tenant: INSERT into agent_config with
  //   agent_type='booking_voice', settings='{"retell_agent_id":"agent_xxx"}'
  const { data: configRow } = await getSupabase()
    .from("agent_config")
    .select("tenant_id, tenants(name, timezone)")
    .eq("agent_type", "booking_voice")
    .filter("settings->>'retell_agent_id'", "eq", agentId)
    .single();

  if (configRow) {
    const tenant = configRow.tenants as { name: string; timezone: string } | null;
    return {
      tenantId: configRow.tenant_id as string,
      companyName: tenant?.name ?? "Home Services",
      timezone: tenant?.timezone ?? "America/Los_Angeles",
    };
  }

  // Emergency fallback: env var RETELL_TENANT_DEFAULT=<tenant_uuid> for single-tenant deploys
  const fallbackId = Deno.env.get("RETELL_TENANT_DEFAULT");
  if (fallbackId) {
    const { data: tenant } = await getSupabase()
      .from("tenants")
      .select("name, timezone")
      .eq("id", fallbackId)
      .single();
    return {
      tenantId: fallbackId,
      companyName: tenant?.name ?? "Home Services",
      timezone: tenant?.timezone ?? "America/Los_Angeles",
    };
  }

  return null;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

// Exported for unit tests. `serve` calls it in production.
export async function handler(req: Request): Promise<Response> {
  // Server-to-server only — no CORS.
  if (req.method === "OPTIONS") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Read body once as text before any parsing.
  const rawBody = await req.text();

  // Hard-enforce signature verification. No bypass.
  const apiKey = Deno.env.get("RETELL_API_KEY");
  if (!apiKey) {
    console.error("retell-voice-webhook: RETELL_API_KEY secret is not set");
    return json({ error: "Unauthorized" }, 401);
  }

  const signature = req.headers.get("x-retell-signature");
  const valid = await verifyRetellSignature(rawBody, signature, apiKey);
  if (!valid) {
    console.warn("retell-voice-webhook: invalid or missing signature — request rejected");
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const event = JSON.parse(rawBody) as RetellEvent;

    // ── Call lifecycle events ──────────────────────────────────────────────────
    if (event.event === "call_started") {
      // Return dynamic variables so Retell fills {{company_name}} in the system prompt.
      // This is how multi-tenancy works with a shared agent template.
      const ctx = await resolveTenant(event.agent_id);
      const dynamicVars = ctx
        ? { company_name: ctx.companyName }
        : { company_name: "Home Services" };

      console.log(`Retell call started: ${event.call_id} → ${dynamicVars.company_name}`);
      return new Response(JSON.stringify({ dynamic_variables: dynamicVars }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (event.event === "call_ended" || event.event === "call_analyzed") {
      const callEvent = event as RetellCallEvent;
      console.log(`Retell call ${event.event}: ${event.call_id}, duration: ${callEvent.duration_ms}ms`);
      return new Response(JSON.stringify({ received: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Function call ──────────────────────────────────────────────────────────
    if (event.event === "function_call") {
      const fnEvent = event as RetellFunctionCallEvent;

      const ctx = await resolveTenant(fnEvent.agent_id);
      if (!ctx) {
        return new Response(JSON.stringify({ result: "Configuration error: unknown agent. Please call back." }), {
          headers: { "Content-Type": "application/json" },
          status: 200, // Always 200 to Retell — errors go in result string
        });
      }

      const { tenantId } = ctx;
      const callerPhone = fnEvent.from_number ?? "unknown";
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(fnEvent.arguments) as Record<string, unknown>;
      } catch {
        args = {};
      }

      let result: unknown;

      switch (fnEvent.name) {
        case "lookup_customer":
          result = await lookupCustomer({ phone: (args.phone as string) ?? callerPhone, tenant_id: tenantId });
          break;

        case "check_availability":
          result = await checkAvailability({
            tenant_id: tenantId,
            date: (args.date as string) ?? "tomorrow",
            job_type: (args.job_type as string) ?? "plumbing_service",
            duration_minutes: (args.duration_minutes as number) ?? 90,
          });
          break;

        case "create_booking":
          result = await createBooking({
            tenant_id: tenantId,
            caller_phone: callerPhone,
            customer_id: args.customer_id as string | undefined,
            customer_name: args.customer_name as string | undefined,
            customer_email: args.customer_email as string | undefined,
            service_address: (args.service_address as string) ?? "",
            service_city: args.service_city as string | undefined,
            service_state: args.service_state as string | undefined,
            service_zip: args.service_zip as string | undefined,
            job_type: (args.job_type as string) ?? "plumbing_service",
            scheduled_date: args.scheduled_date as string,
            time_window: (args.time_window as "morning" | "afternoon" | "evening") ?? "morning",
            description: args.description as string | undefined,
          }, ctx.timezone);
          break;

        case "escalate_to_human":
          result = await escalateToHuman({
            tenant_id: tenantId,
            caller_phone: callerPhone,
            call_id: fnEvent.call_id,
            reason: (args.reason as string) ?? "customer request",
            summary: (args.summary as string) ?? "",
          });
          break;

        default:
          result = { error: `Unknown function: ${fnEvent.name}` };
      }

      return new Response(JSON.stringify({ result: JSON.stringify(result) }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("retell-voice-webhook error:", message);
    // Always 200 to Retell so it doesn't retry
    return new Response(JSON.stringify({ result: "System error. Please hold while I connect you with our team." }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }
}

serve(handler);
