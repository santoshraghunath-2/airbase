// Retell AI voice webhook
// Handles mid-call function calls and call lifecycle events.
// Server-to-server endpoint: no CORS, OPTIONS → 405.
//
// In Retell dashboard:
//   - Custom Function webhook URL → this function
//   - Call events webhook → same URL
//   - field_service agent functions: lookup_customer, check_availability, create_booking, escalate_to_human
//   - remodel agent functions: lookup_customer, qualify_lead, check_consult_availability, book_consultation, save_lead, escalate_to_human

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { format, addDays, startOfDay, endOfDay } from "npm:date-fns";
import { verifyRetellSignature } from "../_shared/retell-auth.ts";
import { dispatchRemodelTool } from "../_shared/remodel-tools.ts";
import type { RecastToolContext } from "../_shared/remodel-tools.ts";

// ─── Supabase (lazy) ──────────────────────────────────────────────────────────

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

// ─── Tenant resolution ────────────────────────────────────────────────────────

interface TenantContext {
  tenantId: string;
  companyName: string;
  timezone: string;
  trade: "field_service" | "remodel";
}

async function resolveTenant(agentId: string): Promise<TenantContext | null> {
  const supabase = getSupabase();

  // Check both field_service (booking_voice) and remodel (remodel_voice) agent types
  const { data: configRow } = await supabase
    .from("agent_config")
    .select("tenant_id, agent_type, tenants(name, timezone, trade)")
    .in("agent_type", ["booking_voice", "remodel_voice"])
    .filter("settings->>'retell_agent_id'", "eq", agentId)
    .single();

  if (configRow) {
    const tenant = configRow.tenants as {
      name: string;
      timezone: string;
      trade: string;
    } | null;
    return {
      tenantId: configRow.tenant_id as string,
      companyName: tenant?.name ?? "Home Services",
      timezone: tenant?.timezone ?? "America/Los_Angeles",
      trade: (tenant?.trade as "field_service" | "remodel") ?? "field_service",
    };
  }

  // Emergency fallback: single-tenant deploys
  const fallbackId = Deno.env.get("RETELL_TENANT_DEFAULT");
  if (fallbackId) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("name, timezone, trade")
      .eq("id", fallbackId)
      .single();
    return {
      tenantId: fallbackId,
      companyName: tenant?.name ?? "Home Services",
      timezone: tenant?.timezone ?? "America/Los_Angeles",
      trade: (tenant?.trade as "field_service" | "remodel") ?? "field_service",
    };
  }

  return null;
}

// ─── Field service tool implementations ──────────────────────────────────────

async function lookupCustomerFS(args: { phone: string; tenant_id: string }) {
  const supabase = getSupabase();
  const normalized = args.phone.replace(/\D/g, "");

  const { data: customer } = await supabase
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

  const membership = (
    customer.memberships as Array<{
      status: string;
      membership_plans: { name: string } | null;
    }> | null
  )?.[0];
  const location = (
    customer.service_locations as Array<{
      address: string;
      city: string;
      state: string;
    }> | null
  )?.[0];

  const { data: recentJobs } = await supabase
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
    primary_address: location
      ? `${location.address}, ${location.city}, ${location.state}`
      : null,
    is_member: membership?.status === "active",
    membership_plan:
      membership?.status === "active"
        ? (membership.membership_plans as { name: string } | null)?.name
        : null,
    recent_jobs: (recentJobs ?? []).map((j) => ({
      type: j.job_type,
      status: j.status,
      date: j.scheduled_start ? format(new Date(j.scheduled_start), "MMM d") : null,
    })),
  };
}

async function checkAvailabilityFS(args: {
  tenant_id: string;
  date: string;
  job_type: string;
  duration_minutes?: number;
}) {
  const supabase = getSupabase();
  let targetDate: Date;
  if (args.date === "today") targetDate = new Date();
  else if (args.date === "tomorrow") targetDate = addDays(new Date(), 1);
  else targetDate = new Date(args.date);

  const dayStart = startOfDay(targetDate).toISOString();
  const dayEnd = endOfDay(targetDate).toISOString();

  const { data: scheduledJobs } = await supabase
    .from("jobs")
    .select("tech_id")
    .eq("tenant_id", args.tenant_id)
    .gte("scheduled_start", dayStart)
    .lte("scheduled_start", dayEnd)
    .not("status", "in", "(cancelled,no_show)");

  const { data: techs } = await supabase
    .from("technicians")
    .select("id, name")
    .eq("tenant_id", args.tenant_id)
    .eq("is_active", true);

  const techCount = (techs ?? []).length;
  const bookedCount = (scheduledJobs ?? []).length;
  const hasAvailability = bookedCount < techCount * 4 * 0.85;

  const dateLabel =
    args.date === "today"
      ? "today"
      : args.date === "tomorrow"
        ? "tomorrow"
        : format(targetDate, "EEEE, MMMM d");

  if (!hasAvailability) {
    return {
      available: false,
      message: `We're fully booked on ${dateLabel}. We have openings on ${format(addDays(targetDate, 1), "EEEE, MMMM d")} — would that work?`,
      suggested_date: addDays(targetDate, 1).toISOString().split("T")[0],
    };
  }

  return {
    available: true,
    date: dateLabel,
    slots: [
      { label: "morning (8am–12pm)", start: "08:00", end: "12:00" },
      { label: "afternoon (12pm–5pm)", start: "12:00", end: "17:00" },
    ],
    message: `We have openings ${dateLabel} in the morning (8am–12pm) or afternoon (12pm–5pm). Which works better?`,
  };
}

async function createBookingFS(
  args: {
    tenant_id: string;
    caller_phone: string;
    customer_id?: string;
    customer_name?: string;
    customer_email?: string;
    service_address: string;
    service_city?: string;
    service_state?: string;
    service_zip?: string;
    job_type: string;
    scheduled_date: string;
    time_window: "morning" | "afternoon" | "evening";
    description?: string;
  },
  _timezone: string,
  callId: string,
) {
  const supabase = getSupabase();
  let customerId = args.customer_id;

  if (!customerId) {
    const { data: newCustomer, error } = await supabase
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
      return {
        success: false,
        message: "Unable to create your record. Please call back to complete your booking.",
      };
    }
    customerId = (newCustomer as Record<string, string>).id;

    await supabase.from("service_locations").insert({
      tenant_id: args.tenant_id,
      customer_id: customerId,
      address: args.service_address,
      city: args.service_city ?? null,
      state: args.service_state ?? null,
      zip: args.service_zip ?? null,
      is_primary: true,
    });
  }

  const { data: location } = await supabase
    .from("service_locations")
    .select("id")
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .order("is_primary", { ascending: false })
    .limit(1)
    .single();

  if (!location) {
    return {
      success: false,
      message: "No service address on file. Please call back so we can confirm your address.",
    };
  }

  const timeMap = { morning: "09:00:00", afternoon: "13:00:00", evening: "17:00:00" };
  const scheduledStart = `${args.scheduled_date}T${timeMap[args.time_window]}`;

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      tenant_id: args.tenant_id,
      customer_id: customerId,
      location_id: (location as Record<string, string>).id,
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
    return {
      success: false,
      message: "Booking failed on our end. Please call back and we'll get you taken care of.",
    };
  }

  void fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/dispatch-agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ job_id: (job as Record<string, string>).id }),
  });

  void supabase.from("booking_conversations").insert({
    tenant_id: args.tenant_id,
    customer_id: customerId,
    phone: args.caller_phone,
    channel: "voice",
    status: "resolved",
    job_id: (job as Record<string, string>).id,
    retell_call_id: callId,
    messages: [],
    context: {
      job_type: args.job_type,
      scheduled_date: args.scheduled_date,
      time_window: args.time_window,
    },
  });

  const dateLabel = format(new Date(args.scheduled_date), "EEEE, MMMM d");
  return {
    success: true,
    job_id: (job as Record<string, string>).id,
    message: `Booked! You're scheduled for ${dateLabel} in the ${args.time_window}. You'll receive a confirmation text shortly.`,
  };
}

async function escalateToHumanFS(args: {
  tenant_id: string;
  caller_phone: string;
  call_id: string;
  reason: string;
  summary: string;
}) {
  const supabase = getSupabase();
  await supabase
    .from("booking_conversations")
    .insert({
      tenant_id: args.tenant_id,
      customer_id: null,
      phone: args.caller_phone,
      channel: "voice",
      status: "escalated",
      retell_call_id: args.call_id,
      messages: [],
      context: { escalation_reason: args.reason, summary: args.summary },
    })
    .catch(() => {});

  return {
    escalated: true,
    message: "I'm connecting you with one of our team members right now. Please hold.",
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 405 });
  }

  const rawBody = await req.text();

  const apiKey = Deno.env.get("RETELL_API_KEY");
  if (!apiKey) {
    console.error("retell-voice-webhook: RETELL_API_KEY secret not set — rejecting all requests");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      headers: { "Content-Type": "application/json" },
      status: 401,
    });
  }

  const signature = req.headers.get("x-retell-signature");
  const valid = await verifyRetellSignature(rawBody, signature, apiKey);
  if (!valid) {
    console.warn("retell-voice-webhook: invalid signature");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      headers: { "Content-Type": "application/json" },
      status: 401,
    });
  }

  try {
    const event = JSON.parse(rawBody) as RetellEvent;

    if (event.event === "call_started") {
      const ctx = await resolveTenant(event.agent_id);
      const dynamicVars = ctx
        ? { company_name: ctx.companyName }
        : { company_name: "Home Services" };

      console.log(`call_started: ${event.call_id} → ${dynamicVars.company_name}`);
      return new Response(JSON.stringify({ dynamic_variables: dynamicVars }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (event.event === "call_ended" || event.event === "call_analyzed") {
      console.log(`${event.event}: ${event.call_id}`);
      return new Response(JSON.stringify({ received: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (event.event === "function_call") {
      const fnEvent = event as RetellFunctionCallEvent;
      const ctx = await resolveTenant(fnEvent.agent_id);

      if (!ctx) {
        return new Response(
          JSON.stringify({ result: "Configuration error: unknown agent. Please call back." }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }

      const callerPhone = fnEvent.from_number ?? "unknown";
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(fnEvent.arguments) as Record<string, unknown>;
      } catch {
        args = {};
      }

      let result: unknown;

      if (ctx.trade === "remodel") {
        // Route to remodel tools — tenantId comes from resolved context, not tool args
        const remodelCtx: RecastToolContext = {
          tenantId: ctx.tenantId,
          callerPhone,
          interactionId: fnEvent.call_id,
          interactionType: "voice",
          supabase: getSupabase(),
        };
        result = await dispatchRemodelTool(fnEvent.name, args, remodelCtx);
      } else {
        // Field service tools (Steward unchanged)
        switch (fnEvent.name) {
          case "lookup_customer":
            result = await lookupCustomerFS({
              phone: (args.phone as string) ?? callerPhone,
              tenant_id: ctx.tenantId,
            });
            break;
          case "check_availability":
            result = await checkAvailabilityFS({
              tenant_id: ctx.tenantId,
              date: (args.date as string) ?? "tomorrow",
              job_type: (args.job_type as string) ?? "plumbing_service",
              duration_minutes: (args.duration_minutes as number) ?? 90,
            });
            break;
          case "create_booking":
            result = await createBookingFS(
              {
                tenant_id: ctx.tenantId,
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
                time_window:
                  (args.time_window as "morning" | "afternoon" | "evening") ?? "morning",
                description: args.description as string | undefined,
              },
              ctx.timezone,
              fnEvent.call_id,
            );
            break;
          case "escalate_to_human":
            result = await escalateToHumanFS({
              tenant_id: ctx.tenantId,
              caller_phone: callerPhone,
              call_id: fnEvent.call_id,
              reason: (args.reason as string) ?? "customer request",
              summary: (args.summary as string) ?? "",
            });
            break;
          default:
            result = { error: `Unknown function: ${fnEvent.name}` };
        }
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
    // Always 200 to Retell so it doesn't retry indefinitely
    return new Response(
      JSON.stringify({
        result: "System error. Please hold while I connect you with our team.",
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 },
    );
  }
}

serve(handler);
