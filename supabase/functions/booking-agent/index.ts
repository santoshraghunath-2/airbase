// Booking Agent — handles inbound SMS from Twilio.
//
// Configure in Twilio Console:
//   Phone Number → Messaging → "A message comes in" → Webhook →
//   https://<project-ref>.supabase.co/functions/v1/booking-agent
//   HTTP POST, application/x-www-form-urlencoded
//
// Required secrets:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WEBHOOK_URL
//   (TWILIO_WEBHOOK_URL must match the exact URL configured in Twilio exactly)

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  loadAgentContext,
  finalizeAction,
  ok,
  err,
} from "../_shared/agent-base.ts";
import { runAgentLoop } from "../_shared/llm-router.ts";
import type { NormalisedTool } from "../_shared/llm-router.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const TWILIO_SID    = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_TOKEN  = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const WEBHOOK_URL   = Deno.env.get("TWILIO_WEBHOOK_URL") ?? "";

// ─── Twilio helpers ───────────────────────────────────────────────────────────

async function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  if (!TWILIO_TOKEN) return false;
  const sorted = Object.keys(params).sort().map((k) => k + params[k]).join("");
  const str = url + sorted;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TWILIO_TOKEN),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const raw = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(str));
  const computed = btoa(String.fromCharCode(...new Uint8Array(raw)));
  return computed === signature;
}

function twimlReply(message: string): Response {
  const body = message.length > 1600 ? message.slice(0, 1597) + "…" : message;
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(body)}</Message></Response>`,
    { status: 200, headers: { "Content-Type": "text/xml" } },
  );
}

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendSms(to: string, body: string, fromNumber: string): Promise<void> {
  const auth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: fromNumber, Body: body }),
    },
  );
}

// ─── Date parsing (simple heuristic for availability checks) ─────────────────

function parseDateHeuristic(description: string): string {
  const d = description.toLowerCase().trim();
  const today = new Date();
  const addDays = (n: number) => {
    const r = new Date(today);
    r.setDate(r.getDate() + n);
    return r.toISOString().slice(0, 10);
  };
  const dayNames = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];

  if (d === "today") return addDays(0);
  if (d.includes("tomorrow")) return addDays(1);
  if (d.includes("day after tomorrow")) return addDays(2);
  if (d.includes("this week")) return addDays(1);
  if (d.includes("next week")) return addDays(7);

  for (let i = 0; i < dayNames.length; i++) {
    if (d.includes(dayNames[i])) {
      const diff = (i - today.getDay() + 7) % 7 || 7;
      return addDays(diff);
    }
  }
  // Try direct date parse
  const parsed = new Date(description);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  return addDays(1); // Default: tomorrow
}

// ─── Tools ───────────────────────────────────────────────────────────────────

const BOOKING_TOOLS: NormalisedTool[] = [
  {
    name: "check_availability",
    description: "Check tech availability for a given date and job type.",
    input_schema: {
      type: "object",
      properties: {
        preferred_date: { type: "string", description: "Plain English date (e.g. 'tomorrow', 'Monday', 'this Friday')." },
        job_type:       { type: "string", description: "Classified job type (e.g. drain_cleaning, plumbing_service)." },
      },
      required: ["preferred_date", "job_type"],
    },
  },
  {
    name: "create_booking",
    description: "Create a service appointment. Call only when you have all required fields.",
    input_schema: {
      type: "object",
      properties: {
        customer_name:  { type: "string", description: "Customer's full name." },
        address:        { type: "string", description: "Street address." },
        city:           { type: "string", description: "City." },
        state:          { type: "string", description: "State abbreviation." },
        zip:            { type: "string", description: "ZIP code." },
        job_type:       { type: "string", description: "Classified job type." },
        priority:       { type: "string", enum: ["low","normal","high","emergency"], description: "Job priority." },
        preferred_date: { type: "string", description: "YYYY-MM-DD." },
        preferred_time: { type: "string", enum: ["morning","afternoon","anytime"], description: "Time of day preference." },
        notes:          { type: "string", description: "Any additional details from the customer." },
      },
      required: ["customer_name","address","job_type","preferred_date","preferred_time"],
    },
  },
  {
    name: "escalate_to_human",
    description: "Hand the conversation off to a human CSR.",
    input_schema: {
      type: "object",
      properties: {
        reason:  { type: "string", description: "Why you are escalating (for internal log)." },
        summary: { type: "string", description: "1–2 sentence summary for the CSR to read at a glance." },
      },
      required: ["reason","summary"],
    },
  },
];

// ─── Tool handlers ────────────────────────────────────────────────────────────

function makeToolHandlers(
  tenantId: string,
  tenantPhone: string,
  conversation: Record<string, unknown>,
  customerPhone: string,
  existingCustomer: Record<string, unknown> | null,
) {
  return {
    check_availability: async (input: unknown) => {
      const { preferred_date, job_type } = input as { preferred_date: string; job_type: string };
      const date = parseDateHeuristic(preferred_date);
      const dayStart = date + "T00:00:00.000Z";
      const dayEnd   = date + "T23:59:59.999Z";

      // Count active techs with matching skill
      const skillsForType: Record<string, string[]> = {
        drain_cleaning:       ["drain_cleaning","plumbing_drain","plumbing_service"],
        plumbing_service:     ["plumbing_service"],
        water_heater_repair:  ["water_heater_repair","plumbing_service"],
        water_heater_install: ["water_heater_install","water_heater_repair"],
        hvac_service:         ["hvac_service","hvac_repair"],
        hvac_repair:          ["hvac_repair","hvac_service"],
        electrical_service:   ["electrical_service","electrical_repair"],
        general_maintenance:  ["general_maintenance","plumbing_service"],
      };
      const relevantSkills = skillsForType[job_type] ?? [];

      const { data: techSkills } = await supabase
        .from("tech_skills")
        .select("technician_id")
        .in("skill", relevantSkills.length ? relevantSkills : ["general_maintenance"])
        .eq("tenant_id" as string, tenantId);

      const qualifiedTechIds = [...new Set((techSkills ?? []).map((r: Record<string, string>) => r.technician_id))];

      if (qualifiedTechIds.length === 0) {
        return { available: false, note: "No qualified technicians for this service type." };
      }

      // Count jobs per tech for that day
      const { data: jobsOnDay } = await supabase
        .from("jobs")
        .select("tech_id")
        .eq("tenant_id", tenantId)
        .in("tech_id", qualifiedTechIds)
        .gte("scheduled_start", dayStart)
        .lte("scheduled_start", dayEnd)
        .not("status", "in", "(cancelled,no_show)");

      const busyTechs = new Set((jobsOnDay ?? []).map((j: Record<string, string>) => j.tech_id));
      const availableCount = qualifiedTechIds.filter((id) => !busyTechs.has(id)).length;

      const morningSlots  = availableCount > 0;
      const afternoonSlots = availableCount > 0;

      return {
        date,
        morning_available:   morningSlots,
        afternoon_available: afternoonSlots,
        tech_count:          availableCount,
        note: availableCount > 0
          ? `We have ${availableCount} technician${availableCount > 1 ? "s" : ""} available on ${date}.`
          : `No availability on ${date} — try the next business day.`,
      };
    },

    create_booking: async (input: unknown) => {
      const booking = input as {
        customer_name: string; address: string; city?: string; state?: string; zip?: string;
        job_type: string; priority?: string; preferred_date: string; preferred_time: string; notes?: string;
      };

      // Resolve or create customer
      let customerId: string = existingCustomer?.id as string ?? "";
      if (!customerId) {
        const { data: newCust } = await supabase
          .from("customers")
          .insert({ tenant_id: tenantId, name: booking.customer_name, phone: customerPhone, source: "booking_agent" })
          .select("id")
          .single();
        customerId = newCust?.id ?? "";
      }

      // Resolve or create service location
      let locationId: string | null = null;
      if (customerId && booking.address) {
        const { data: existingLoc } = await supabase
          .from("service_locations")
          .select("id")
          .eq("customer_id", customerId)
          .ilike("address", `%${booking.address.split(" ")[0]}%`)
          .limit(1)
          .single();

        if (existingLoc) {
          locationId = existingLoc.id as string;
        } else {
          const { data: newLoc } = await supabase
            .from("service_locations")
            .insert({
              tenant_id: tenantId, customer_id: customerId,
              address: booking.address,
              city: booking.city ?? existingCustomer?.city ?? "",
              state: booking.state ?? existingCustomer?.state ?? "CA",
              zip: booking.zip ?? existingCustomer?.zip ?? "",
            })
            .select("id")
            .single();
          locationId = newLoc?.id ?? null;
        }
      }

      // Scheduled time: convert morning/afternoon to a time on the preferred date
      const timeMap: Record<string, string> = { morning: "09:00:00", afternoon: "13:00:00", anytime: "09:00:00" };
      const timeStr = timeMap[booking.preferred_time] ?? "09:00:00";
      const scheduledStart = `${booking.preferred_date}T${timeStr}`;

      // Create the job (unassigned → dispatch agent fires automatically)
      const { data: job } = await supabase
        .from("jobs")
        .insert({
          tenant_id:   tenantId,
          customer_id: customerId,
          location_id: locationId,
          job_type:            booking.job_type,
          priority:            booking.priority ?? "normal",
          status:              "unassigned",
          scheduled_start:     scheduledStart,
          description:         booking.notes ?? `Booked via SMS from ${customerPhone}`,
          source:              "booking_agent",
        })
        .select("id")
        .single();

      // Mark conversation resolved and link job
      await supabase
        .from("booking_conversations")
        .update({ status: "resolved", job_id: job?.id ?? null })
        .eq("id", conversation.id as string);

      const timeLabel = booking.preferred_time === "afternoon" ? "afternoon" : "morning";
      return {
        success: true,
        job_id: job?.id,
        confirmation: `Appointment booked for ${booking.preferred_date} ${timeLabel}. We'll send a reminder when your technician is on the way.`,
      };
    },

    escalate_to_human: async (input: unknown) => {
      const { reason, summary } = input as { reason: string; summary: string };
      await supabase
        .from("booking_conversations")
        .update({ status: "escalated", context: { ...(conversation.context as object), escalation_reason: reason, escalation_summary: summary } })
        .eq("id", conversation.id as string);

      return {
        escalated: true,
        handoff_message: "I'm connecting you with our team now — someone will reach out to you shortly.",
      };
    },
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return err("Method not allowed", 405);

  const body   = await req.text();
  const params = Object.fromEntries(new URLSearchParams(body));

  // Validate Twilio signature (skip in dev if TWILIO_WEBHOOK_URL not set)
  if (WEBHOOK_URL) {
    const sig = req.headers.get("X-Twilio-Signature") ?? "";
    const valid = await validateTwilioSignature(sig, WEBHOOK_URL, params);
    if (!valid) return err("Invalid Twilio signature", 403);
  }

  const fromPhone  = params.From ?? "";
  const toPhone    = params.To   ?? "";
  const messageText = (params.Body ?? "").trim();
  const messageSid  = params.MessageSid ?? "";

  if (!fromPhone || !messageText) return twimlReply("");

  try {
    // ── Find tenant by Twilio phone number ──────────────────────────────────
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, name, phone, timezone, default_model_id")
      .eq("phone", toPhone)
      .is("deleted_at", null)
      .single();

    if (!tenant) return twimlReply(""); // unknown number, ignore

    const tenantId = tenant.id as string;

    // ── Find or create conversation (active within 8 hours) ─────────────────
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();

    const { data: existing } = await supabase
      .from("booking_conversations")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("phone", fromPhone)
      .in("status", ["active", "escalated"])
      .gte("last_message_at", eightHoursAgo)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .single();

    let conversation = existing as Record<string, unknown>;

    if (!conversation) {
      const { data: created } = await supabase
        .from("booking_conversations")
        .insert({ tenant_id: tenantId, phone: fromPhone, channel: "sms", status: "active", messages: [] })
        .select("*")
        .single();
      conversation = created as Record<string, unknown>;
    }

    if (!conversation) return twimlReply("Sorry, something went wrong. Please call us directly.");

    // ── Idempotency check ───────────────────────────────────────────────────
    const messages = (conversation.messages as Array<Record<string, string>>) ?? [];
    if (messages.some((m) => m.message_sid === messageSid)) {
      const lastAgentMsg = [...messages].reverse().find((m) => m.role === "agent");
      return twimlReply(lastAgentMsg?.content ?? "");
    }

    // ── Append customer message ─────────────────────────────────────────────
    const newMessages = [
      ...messages,
      { role: "customer", content: messageText, message_sid: messageSid, timestamp: new Date().toISOString() },
    ];
    await supabase
      .from("booking_conversations")
      .update({ messages: newMessages, last_message_at: new Date().toISOString() })
      .eq("id", conversation.id as string);

    // ── Look up customer by phone ───────────────────────────────────────────
    const { data: customer } = await supabase
      .from("customers")
      .select("id, name, phone")
      .eq("tenant_id", tenantId)
      .eq("phone", fromPhone)
      .is("deleted_at", null)
      .single();

    // ── Recent job history for context ──────────────────────────────────────
    let recentJobsLine = "No prior visits on record.";
    if (customer?.id) {
      const { data: recentJobs } = await supabase
        .from("jobs")
        .select("job_type, created_at")
        .eq("tenant_id", tenantId)
        .eq("customer_id", customer.id)
        .not("status", "in", "(cancelled,no_show)")
        .order("created_at", { ascending: false })
        .limit(3);

      if (recentJobs?.length) {
        recentJobsLine = recentJobs
          .map((j: Record<string, string>) => `${j.job_type} (${j.created_at.slice(0, 10)})`)
          .join(", ");
      }
    }

    // ── Load agent config ───────────────────────────────────────────────────
    const ctx = await loadAgentContext(supabase, tenantId, "booking_sms");

    // ── Build system prompt ─────────────────────────────────────────────────
    const now = new Date().toLocaleString("en-US", {
      timeZone: (tenant.timezone as string) ?? "America/Los_Angeles",
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    const systemPromptRaw = await Deno.readTextFile(
      new URL("../../prompts/booking-agent.md", import.meta.url),
    ).catch(() => null) ?? "You are a booking assistant. Help the customer book a service appointment.";

    const systemPrompt = systemPromptRaw
      .replace("{{company_name}}", tenant.name as string)
      .replace("{{trade}}", "home services")
      .replace("{{service_area}}", "the Bay Area")
      .replace("{{current_date}}", now)
      .replace("{{company_hours}}", "Monday–Saturday 8am–6pm");

    // ── Format conversation history as user message ─────────────────────────
    const historyLines = messages
      .map((m) => `[${m.role}]: ${m.content}`)
      .join("\n");

    const customerProfile = customer
      ? `Name: ${customer.name} (existing customer)\nRecent visits: ${recentJobsLine}`
      : `Unknown customer (first contact)\nPhone: ${fromPhone}`;

    const userMessage =
      `CONTEXT\nCompany: ${tenant.name}\nDate: ${now}\n\n` +
      `CUSTOMER PROFILE\n${customerProfile}\n\n` +
      (messages.length > 1 ? `CONVERSATION HISTORY\n${historyLines}\n\n` : "") +
      `NEW MESSAGE FROM CUSTOMER\n${messageText}`;

    // ── Run booking agent ───────────────────────────────────────────────────
    const { finalText } = await runAgentLoop({
      systemPrompt,
      userMessage,
      tools: BOOKING_TOOLS,
      toolHandlers: makeToolHandlers(tenantId, toPhone, conversation, fromPhone, customer as Record<string, unknown> | null),
      model: ctx.resolvedModelId,
      temperature: 0.7,
      maxTokens: 512,
      maxIterations: 5,
    });

    const agentReply = finalText.trim() || "I'm sorry, I didn't understand that. Could you rephrase?";

    // ── Append agent reply and update conversation ──────────────────────────
    const updatedMessages = [
      ...newMessages,
      { role: "agent", content: agentReply, timestamp: new Date().toISOString() },
    ];
    await supabase
      .from("booking_conversations")
      .update({ messages: updatedMessages, last_message_at: new Date().toISOString() })
      .eq("id", conversation.id as string);

    // ── Log agent action ────────────────────────────────────────────────────
    await finalizeAction(supabase, {
      tenantId,
      agentType:       "booking_sms",
      triggerEvent:    `sms:${fromPhone}:${messageSid}`,
      contextSnapshot: { conversation_id: conversation.id, customer_id: customer?.id ?? null, message: messageText },
      reasoning:       `Responded to inbound SMS: "${messageText}"`,
      proposedAction:  { type: "sms_reply", content: agentReply },
      confidence:      1.0,
      config:          ctx.config,
      onAutoExecute:   async () => {},
    });

    return twimlReply(agentReply);
  } catch (e) {
    console.error("booking-agent error:", e);
    return twimlReply("Sorry, I'm having trouble right now. Please call us directly.");
  }
});
