// Remodel tenant tool implementations for Retell voice and chat agents.
// All tools receive tenantId from the resolved Retell agent context — never from tool arguments.
// Tool schemas exposed to the LLM contain no tenant_id field.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// ─── Context ──────────────────────────────────────────────────────────────────

export interface RecastToolContext {
  tenantId: string;
  callerPhone: string;
  interactionId: string;    // retell call_id or chat_id
  interactionType: "voice" | "chat";
  supabase: SupabaseClient;
}

// ─── Tool schemas (Anthropic format; llm-router translates for other providers) ──

export const REMODEL_TOOL_DEFINITIONS = [
  {
    name: "lookup_customer",
    description: "Look up a customer by their phone number. Call this first on every inbound contact.",
    input_schema: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description: "Caller's phone number, E.164 or any common US format.",
        },
      },
      required: ["phone"],
    },
  },
  {
    name: "qualify_lead",
    description: "Save a qualified lead and open an opportunity. Call after collecting project details and confirming budget and service area.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Caller's full name." },
        email: { type: "string", description: "Caller's email address (optional)." },
        project_summary: { type: "string", description: "Brief description of the remodel project." },
        budget_range: {
          type: "string",
          enum: ["under_8k", "8k_12k", "12k_20k", "20k_plus"],
          description: "Budget range the caller indicated.",
        },
        timeline: {
          type: "string",
          enum: ["asap", "1_3_months", "3_6_months", "6_plus_months", "flexible"],
          description: "When the caller wants to start.",
        },
        service_area_zip: { type: "string", description: "ZIP code of the project address." },
      },
      required: ["name", "project_summary", "budget_range", "timeline", "service_area_zip"],
    },
  },
  {
    name: "check_consult_availability",
    description: "Check available in-home consultation slots for a given date.",
    input_schema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Date to check: 'today', 'tomorrow', or YYYY-MM-DD.",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "book_consultation",
    description: "Book an in-home consultation. Requires customer_id and opportunity_id from qualify_lead.",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "UUID from qualify_lead result." },
        opportunity_id: { type: "string", description: "UUID from qualify_lead result." },
        date: { type: "string", description: "YYYY-MM-DD date for the consultation." },
        time_window: {
          type: "string",
          enum: ["morning", "afternoon"],
          description: "Morning (9am–12pm) or afternoon (1pm–5pm).",
        },
        notes: { type: "string", description: "Any additional notes from the caller." },
      },
      required: ["customer_id", "opportunity_id", "date", "time_window"],
    },
  },
  {
    name: "save_lead",
    description: "Save a lead that cannot be booked right now — budget too low, out of service area, not ready, or caller hung up. Always call this instead of ending without saving.",
    input_schema: {
      type: "object",
      properties: {
        disqualify_reason: {
          type: "string",
          enum: ["budget_too_low", "out_of_service_area", "not_ready", "commercial_property", "caller_ended", "other"],
          description: "Why this lead cannot be booked.",
        },
        name: { type: "string", description: "Caller's name if collected." },
        email: { type: "string", description: "Caller's email if collected." },
        project_summary: { type: "string", description: "What they described if collected." },
        budget_range: { type: "string", description: "Budget range if collected." },
        service_area_zip: { type: "string", description: "ZIP if collected." },
        notes: { type: "string", description: "Any other context." },
      },
      required: ["disqualify_reason"],
    },
  },
  {
    name: "escalate_to_human",
    description: "Hand off to a human team member when the caller requests it or the conversation can't be handled by AI.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why escalation is needed." },
        summary: { type: "string", description: "Brief summary of the conversation so far." },
      },
      required: ["reason", "summary"],
    },
  },
] as const;

// ─── Service area check ───────────────────────────────────────────────────────

async function getServiceZips(supabase: SupabaseClient, tenantId: string): Promise<string[]> {
  const { data } = await supabase
    .from("tenants")
    .select("service_area_zips")
    .eq("id", tenantId)
    .single();
  return (data?.service_area_zips as string[]) ?? [];
}

function isInServiceArea(zip: string, serviceZips: string[]): boolean {
  if (serviceZips.length === 0) return true; // no restriction configured
  return serviceZips.includes(zip.trim());
}

// ─── Tool implementations ─────────────────────────────────────────────────────

export async function lookupCustomer(
  ctx: RecastToolContext,
  args: { phone: string },
): Promise<Record<string, unknown>> {
  const normalized = args.phone.replace(/\D/g, "");
  const { data: customer } = await ctx.supabase
    .from("customers")
    .select(`id, name, phone, email, notes,
      service_locations(id, address, city, state, zip),
      opportunities(id, status, project_summary, created_at)`)
    .eq("tenant_id", ctx.tenantId)
    .or(`phone.eq.${args.phone},phone.eq.+1${normalized},phone.eq.${normalized}`)
    .is("deleted_at", null)
    .order("created_at", { referencedTable: "opportunities", ascending: false })
    .limit(3, { referencedTable: "opportunities" })
    .single();

  if (!customer) {
    return { found: false, message: "New contact — no existing record." };
  }

  const location = (customer.service_locations as Array<Record<string, string>> | null)?.[0];
  const prevOpps = (customer.opportunities as Array<Record<string, unknown>> | null) ?? [];

  return {
    found: true,
    customer_id: customer.id,
    name: customer.name,
    email: customer.email,
    primary_address: location
      ? `${location.address}, ${location.city}, ${location.state} ${location.zip}`
      : null,
    previous_inquiries: prevOpps.length,
    latest_status: prevOpps[0]?.status ?? null,
  };
}

export async function qualifyLead(
  ctx: RecastToolContext,
  args: {
    name: string;
    email?: string;
    project_summary: string;
    budget_range: string;
    timeline: string;
    service_area_zip: string;
  },
): Promise<Record<string, unknown>> {
  // Budget gate: under_8k is below minimum project size
  if (args.budget_range === "under_8k") {
    return {
      qualified: false,
      disqualify_reason: "budget_too_low",
      message: "Project budget below our minimum. Saving as a lead for future reference.",
    };
  }

  // Service area gate
  const serviceZips = await getServiceZips(ctx.supabase, ctx.tenantId);
  if (!isInServiceArea(args.service_area_zip, serviceZips)) {
    return {
      qualified: false,
      disqualify_reason: "out_of_service_area",
      message: "ZIP code outside our current service area. Saving as a lead.",
    };
  }

  // Find or create customer
  const normalized = ctx.callerPhone.replace(/\D/g, "");
  let customerId: string;

  const { data: existing } = await ctx.supabase
    .from("customers")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .or(`phone.eq.${ctx.callerPhone},phone.eq.+1${normalized},phone.eq.${normalized}`)
    .is("deleted_at", null)
    .single();

  if (existing) {
    customerId = existing.id as string;
    await ctx.supabase
      .from("customers")
      .update({ name: args.name, email: args.email ?? null })
      .eq("id", customerId);
  } else {
    const { data: newCustomer, error } = await ctx.supabase
      .from("customers")
      .insert({
        tenant_id: ctx.tenantId,
        name: args.name,
        phone: ctx.callerPhone,
        email: args.email ?? null,
        source: ctx.interactionType === "voice" ? "voice" : "sms",
      })
      .select("id")
      .single();

    if (error || !newCustomer) {
      return { qualified: false, message: "Could not save contact. Please try again." };
    }
    customerId = (newCustomer as Record<string, string>).id;
  }

  // Create opportunity
  const source = ctx.interactionType === "voice" ? "inbound_call" : "retell_chat";
  const retellFields =
    ctx.interactionType === "voice"
      ? { retell_call_id: ctx.interactionId }
      : { retell_chat_id: ctx.interactionId };

  const { data: opp, error: oppError } = await ctx.supabase
    .from("opportunities")
    .insert({
      tenant_id: ctx.tenantId,
      customer_id: customerId,
      source,
      status: "contacted",
      lead_name: args.name,
      lead_phone: ctx.callerPhone,
      lead_email: args.email ?? null,
      project_summary: args.project_summary,
      budget_range: args.budget_range,
      timeline: args.timeline,
      service_area_zip: args.service_area_zip,
      ...retellFields,
    })
    .select("id")
    .single();

  if (oppError || !opp) {
    return { qualified: false, message: "Could not save lead. Please try again." };
  }

  return {
    qualified: true,
    customer_id: customerId,
    opportunity_id: (opp as Record<string, string>).id,
    message: "Lead saved. Ready to check availability and book a consultation.",
  };
}

export async function checkConsultAvailability(
  ctx: RecastToolContext,
  args: { date: string },
): Promise<Record<string, unknown>> {
  let targetDate: Date;
  const today = new Date();
  if (args.date === "today") {
    targetDate = today;
  } else if (args.date === "tomorrow") {
    targetDate = new Date(today);
    targetDate.setDate(today.getDate() + 1);
  } else {
    targetDate = new Date(args.date);
  }

  // Skip weekends
  const dow = targetDate.getDay();
  if (dow === 0 || dow === 6) {
    const next = new Date(targetDate);
    next.setDate(targetDate.getDate() + (dow === 6 ? 2 : 1));
    return {
      available: false,
      message: `We don't do consultations on weekends. The next available day is ${next.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}.`,
      suggested_date: next.toISOString().slice(0, 10),
    };
  }

  const dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(23, 59, 59, 999);

  // Count remodel_consult jobs already scheduled that day for this tenant
  const { data: scheduled } = await ctx.supabase
    .from("jobs")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("job_type", "remodel_consult")
    .gte("scheduled_start", dayStart.toISOString())
    .lte("scheduled_start", dayEnd.toISOString())
    .not("status", "in", "(cancelled,no_show)");

  const bookedCount = (scheduled ?? []).length;
  const dateLabel = targetDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // Allow up to 4 consults per day (2 morning + 2 afternoon)
  if (bookedCount >= 4) {
    const nextDay = new Date(targetDate);
    nextDay.setDate(targetDate.getDate() + 1);
    while (nextDay.getDay() === 0 || nextDay.getDay() === 6) {
      nextDay.setDate(nextDay.getDate() + 1);
    }
    return {
      available: false,
      message: `We're fully booked on ${dateLabel}. How about ${nextDay.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}?`,
      suggested_date: nextDay.toISOString().slice(0, 10),
    };
  }

  const morningBooked = (scheduled ?? []).length >= 2;
  const afternoonBooked = (scheduled ?? []).length >= 4;
  const slots: Array<{ label: string; value: string }> = [];
  if (!morningBooked) slots.push({ label: "morning (9am–12pm)", value: "morning" });
  if (!afternoonBooked) slots.push({ label: "afternoon (1pm–5pm)", value: "afternoon" });

  return {
    available: true,
    date: dateLabel,
    date_iso: targetDate.toISOString().slice(0, 10),
    slots,
    message: `We have ${slots.map((s) => s.label).join(" or ")} available on ${dateLabel}.`,
  };
}

export async function bookConsultation(
  ctx: RecastToolContext,
  args: {
    customer_id: string;
    opportunity_id: string;
    date: string;
    time_window: "morning" | "afternoon";
    notes?: string;
  },
): Promise<Record<string, unknown>> {
  // Verify these IDs belong to this tenant (security: prevent cross-tenant booking)
  const { data: opp } = await ctx.supabase
    .from("opportunities")
    .select("id, customer_id")
    .eq("id", args.opportunity_id)
    .eq("tenant_id", ctx.tenantId)
    .is("deleted_at", null)
    .single();

  if (!opp) return { success: false, message: "Opportunity not found. Please try again." };

  const { data: customer } = await ctx.supabase
    .from("customers")
    .select("id")
    .eq("id", args.customer_id)
    .eq("tenant_id", ctx.tenantId)
    .is("deleted_at", null)
    .single();

  if (!customer) return { success: false, message: "Customer not found. Please try again." };

  const timeMap = { morning: "09:00:00", afternoon: "13:00:00" };
  const scheduledStart = `${args.date}T${timeMap[args.time_window]}`;

  const { data: job, error: jobError } = await ctx.supabase
    .from("jobs")
    .insert({
      tenant_id: ctx.tenantId,
      customer_id: args.customer_id,
      job_type: "remodel_consult",
      status: "scheduled",
      priority: "normal",
      scheduled_start: scheduledStart,
      description: args.notes ?? null,
      source: ctx.interactionType === "voice" ? "voice" : "sms",
    })
    .select("id")
    .single();

  if (jobError || !job) {
    return { success: false, message: "Could not create booking. Please call back to confirm." };
  }

  const jobId = (job as Record<string, string>).id;

  // Update opportunity
  await ctx.supabase
    .from("opportunities")
    .update({
      status: "visit_scheduled",
      visit_job_id: jobId,
    })
    .eq("id", args.opportunity_id)
    .eq("tenant_id", ctx.tenantId);

  // Log to booking_conversations
  const retellField =
    ctx.interactionType === "voice"
      ? { retell_call_id: ctx.interactionId }
      : { retell_chat_id: ctx.interactionId };

  void ctx.supabase.from("booking_conversations").upsert(
    {
      tenant_id: ctx.tenantId,
      customer_id: args.customer_id,
      phone: ctx.callerPhone,
      channel: ctx.interactionType === "voice" ? "voice" : "sms",
      status: "resolved",
      job_id: jobId,
      messages: [],
      context: {
        job_type: "remodel_consult",
        scheduled_date: args.date,
        time_window: args.time_window,
        opportunity_id: args.opportunity_id,
      },
      ...retellField,
    },
    {
      onConflict:
        ctx.interactionType === "voice" ? "tenant_id,retell_call_id" : "tenant_id,retell_chat_id",
    },
  );

  const dateLabel = new Date(args.date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return {
    success: true,
    job_id: jobId,
    message: `Booked! Your in-home consultation is confirmed for ${dateLabel} in the ${args.time_window}. You'll receive a confirmation shortly.`,
    confirmation: {
      job_id: jobId,
      date: dateLabel,
      time_window: args.time_window,
    },
  };
}

export async function saveLead(
  ctx: RecastToolContext,
  args: {
    disqualify_reason: string;
    name?: string;
    email?: string;
    project_summary?: string;
    budget_range?: string;
    service_area_zip?: string;
    notes?: string;
  },
): Promise<Record<string, unknown>> {
  // Find or create customer
  const normalized = ctx.callerPhone.replace(/\D/g, "");
  const { data: existing } = await ctx.supabase
    .from("customers")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .or(`phone.eq.${ctx.callerPhone},phone.eq.+1${normalized},phone.eq.${normalized}`)
    .is("deleted_at", null)
    .maybeSingle();

  let customerId = existing?.id as string | undefined;

  if (!customerId) {
    const { data: newCust } = await ctx.supabase
      .from("customers")
      .insert({
        tenant_id: ctx.tenantId,
        name: args.name ?? "Unknown",
        phone: ctx.callerPhone,
        email: args.email ?? null,
        source: ctx.interactionType === "voice" ? "voice" : "sms",
      })
      .select("id")
      .single();
    customerId = (newCust as Record<string, string> | null)?.id;
  }

  if (customerId) {
    const retellFields =
      ctx.interactionType === "voice"
        ? { retell_call_id: ctx.interactionId }
        : { retell_chat_id: ctx.interactionId };

    await ctx.supabase.from("opportunities").insert({
      tenant_id: ctx.tenantId,
      customer_id: customerId,
      source: ctx.interactionType === "voice" ? "inbound_call" : "retell_chat",
      status: "lost",
      lead_name: args.name ?? null,
      lead_phone: ctx.callerPhone,
      lead_email: args.email ?? null,
      project_summary: args.project_summary ?? null,
      budget_range: args.budget_range ?? null,
      service_area_zip: args.service_area_zip ?? null,
      disqualify_reason: args.disqualify_reason,
      ai_notes: args.notes ?? null,
      ...retellFields,
    });
  }

  return {
    saved: true,
    message: "Got it — I've saved your information. We'll keep you in mind for future projects.",
  };
}

export async function escalateToHuman(
  ctx: RecastToolContext,
  args: { reason: string; summary: string },
): Promise<Record<string, unknown>> {
  const retellField =
    ctx.interactionType === "voice"
      ? { retell_call_id: ctx.interactionId }
      : { retell_chat_id: ctx.interactionId };

  await ctx.supabase
    .from("booking_conversations")
    .upsert(
      {
        tenant_id: ctx.tenantId,
        customer_id: null,
        phone: ctx.callerPhone,
        channel: ctx.interactionType === "voice" ? "voice" : "sms",
        status: "escalated",
        messages: [],
        context: { escalation_reason: args.reason, summary: args.summary },
        ...retellField,
      },
      {
        onConflict:
          ctx.interactionType === "voice"
            ? "tenant_id,retell_call_id"
            : "tenant_id,retell_chat_id",
      },
    )
    .catch(() => {});

  return {
    escalated: true,
    message:
      ctx.interactionType === "voice"
        ? "I'm connecting you with one of our team members right now. Please hold."
        : "I'm going to have one of our team members reach out to you shortly.",
  };
}

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

export async function dispatchRemodelTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  ctx: RecastToolContext,
): Promise<unknown> {
  switch (toolName) {
    case "lookup_customer":
      return lookupCustomer(ctx, toolArgs as Parameters<typeof lookupCustomer>[1]);
    case "qualify_lead":
      return qualifyLead(ctx, toolArgs as Parameters<typeof qualifyLead>[1]);
    case "check_consult_availability":
      return checkConsultAvailability(ctx, toolArgs as Parameters<typeof checkConsultAvailability>[1]);
    case "book_consultation":
      return bookConsultation(ctx, toolArgs as Parameters<typeof bookConsultation>[1]);
    case "save_lead":
      return saveLead(ctx, toolArgs as Parameters<typeof saveLead>[1]);
    case "escalate_to_human":
      return escalateToHuman(ctx, toolArgs as Parameters<typeof escalateToHuman>[1]);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
