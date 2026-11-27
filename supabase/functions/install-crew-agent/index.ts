// Install Crew Agent — schedules a crew for an install job when an opportunity is won.
//
// Trigger: install the DB trigger documented in 025_opportunities.sql.
// It fires when opportunities.status transitions to 'won' AND install_job_id IS NULL.
//
// On execution:
//   - Creates an install job
//   - Populates job_crew (lead + crew members)
//   - Links opportunity.install_job_id to the new job

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  loadAgentContext,
  finalizeAction,
  validateServiceRoleAuth,
  ok,
  err,
} from "../_shared/agent-base.ts";
import { callAgent } from "../_shared/llm-router.ts";
import type { NormalisedTool } from "../_shared/llm-router.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

// ─── Crew size by job/equipment type ─────────────────────────────────────────

function crewSizeNeeded(equipmentNotes: string): number {
  const notes = equipmentNotes.toLowerCase();
  if (notes.includes("panel") || notes.includes("electrical")) return 2;
  if (notes.includes("hvac") || notes.includes("furnace") || notes.includes("ac")) {
    return notes.includes("ductwork") || notes.includes("full") ? 3 : 2;
  }
  return 2; // default: 1 lead + 1 crew
}

// ─── Tool definition ──────────────────────────────────────────────────────────

const PROPOSE_INSTALL_TOOL: NormalisedTool = {
  name: "propose_install_schedule",
  description: "Propose an install date and crew assignment for this won opportunity.",
  input_schema: {
    type: "object",
    properties: {
      install_date: {
        type: "string",
        description: "ISO date string (YYYY-MM-DD) for the install day.",
      },
      lead_tech_id: {
        type: "string",
        description: "UUID of the install lead.",
      },
      crew_tech_ids: {
        type: "array",
        items: { type: "string" },
        description: "UUIDs of crew member(s) (not including the lead).",
      },
      scheduled_start_time: {
        type: "string",
        description: "Preferred start time on install day, e.g. '08:00'.",
      },
      confidence: {
        type: "number",
        description: "Confidence score 0–1.",
      },
      reasoning: {
        type: "string",
        description: "Full reasoning — why this date, why this crew.",
      },
      operator_rationale: {
        type: "string",
        description: "2–3 plain-English sentences for the dispatcher: date, who, and the key reason.",
      },
    },
    required: ["install_date", "lead_tech_id", "crew_tech_ids", "scheduled_start_time", "confidence", "reasoning", "operator_rationale"],
  },
};

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (!validateServiceRoleAuth(req)) return err("Unauthorized", 401);

  try {
    const payload = await req.json();
    const opp     = payload.record as Record<string, unknown>;

    if (opp.status !== "won" || opp.install_job_id) return ok({ skip: true });
    if (opp.deleted_at) return ok({ skip: true });

    const tenantId = opp.tenant_id as string;
    const oppId    = opp.id as string;

    // ── Remodel tenants: delegate to project-based scheduling path ───────────
    // project-create creates the project + phases; install-crew-agent is called
    // by project-create for remodel tenants to schedule the phase jobs.
    // For remodel, the payload has project_id set (not an opportunity trigger).
    const isProjectSchedule = !!(payload.record as Record<string, unknown>).project_id;

    if (!isProjectSchedule) {
      // This is an opportunity-won trigger. Check if it's a remodel tenant.
      const { data: tenant } = await supabase
        .from("tenants")
        .select("trade")
        .eq("id", tenantId)
        .single();
      if (tenant?.trade === "remodel") {
        // Remodel: opportunity won alone does not trigger scheduling.
        // project-create will call us with a project_id once gates are clear.
        console.log(`install-crew-agent: remodel opp ${oppId} won — waiting for project gates`);
        return ok({ skip: "remodel tenant — scheduling deferred to project gates" });
      }
    }

    // ── Agent config ─────────────────────────────────────────────────────────
    const ctx = await loadAgentContext(supabase, tenantId, "dispatch");
    if (!ctx.config.enabled) return ok({ skip: "agent disabled" });

    // ── Load opportunity detail ───────────────────────────────────────────────
    const { data: oppDetail } = await supabase
      .from("opportunities")
      .select(`*, customers(name, phone), service_locations(address, city, state, zip)`)
      .eq("id", oppId)
      .single();

    if (!oppDetail) return err(`Opportunity ${oppId} not found`);

    const equipNotes  = (oppDetail.equipment_notes as string) || "";
    const crewNeeded  = crewSizeNeeded(equipNotes);
    const totalNeeded = crewNeeded; // lead + (crewNeeded-1) crew = crewNeeded total

    const customer = oppDetail.customers as Record<string, string> | null;
    const location = oppDetail.service_locations as Record<string, string> | null;
    const address  = location
      ? `${location.address}, ${location.city}, ${location.state} ${location.zip}`
      : "Unknown address";

    // ── Load install techs ────────────────────────────────────────────────────
    const { data: installTechs } = await supabase
      .from("technicians")
      .select("id, name, tech_type")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .in("tech_type", ["install", "install_lead"]);

    if (!installTechs || installTechs.length === 0) {
      return ok({ skip: "no install technicians configured" });
    }

    const leads = installTechs.filter((t) => t.tech_type === "install_lead");
    const crew  = installTechs.filter((t) => t.tech_type === "install");

    if (leads.length === 0) return ok({ skip: "no install lead configured" });

    // ── Find viable install dates (next 20 business days) ────────────────────
    const now  = new Date();
    const days: string[] = [];
    let cursor = addDays(now, 1);
    while (days.length < 20) {
      if (!isWeekend(cursor)) days.push(startOfDay(cursor).toISOString().slice(0, 10));
      cursor = addDays(cursor, 1);
    }

    // Load existing install jobs per tech for those days
    const windowStart = startOfDay(addDays(now, 1)).toISOString();
    const windowEnd   = endOfDay(addDays(now, 22)).toISOString();

    const { data: scheduled } = await supabase
      .from("jobs")
      .select("tech_id, scheduled_start")
      .eq("tenant_id", tenantId)
      .not("tech_id", "is", null)
      .gte("scheduled_start", windowStart)
      .lte("scheduled_start", windowEnd)
      .in("tech_id", installTechs.map((t) => t.id))
      .not("status", "in", "(cancelled,no_show)");

    // Also check job_crew for crew-based installs
    const { data: crewScheduled } = await supabase
      .from("job_crew")
      .select("tech_id, jobs!inner(scheduled_start)")
      .in("tech_id", installTechs.map((t) => t.id))
      .gte("jobs.scheduled_start", windowStart)
      .lte("jobs.scheduled_start", windowEnd);

    const bookedDates: Record<string, Set<string>> = {};
    for (const j of [...(scheduled ?? []), ...(crewScheduled ?? [])]) {
      const techId = j.tech_id as string;
      const start  = (j.scheduled_start ?? (j as Record<string, unknown>).jobs as Record<string, string>)?.scheduled_start as string | undefined;
      if (!techId || !start) continue;
      const dateStr = start.slice(0, 10);
      if (!bookedDates[techId]) bookedDates[techId] = new Set();
      bookedDates[techId].add(dateStr);
    }

    // Find days where we can staff the required crew
    interface ViableSlot {
      date: string;
      availableLeads: string[];
      availableCrew: string[];
    }

    const viableSlots: ViableSlot[] = [];
    for (const date of days) {
      const freeleads = leads.filter((t) => !bookedDates[t.id]?.has(date)).map((t) => t.id);
      const freeCrew  = crew.filter((t) => !bookedDates[t.id]?.has(date)).map((t) => t.id);
      if (freeleads.length > 0 && freeCrew.length >= totalNeeded - 1) {
        viableSlots.push({ date, availableLeads: freeleads, availableCrew: freeCrew });
      }
      if (viableSlots.length >= 5) break;
    }

    if (viableSlots.length === 0) return ok({ skip: "no viable install slot in next 20 business days" });

    // ── Build LLM context ────────────────────────────────────────────────────
    const techName = (id: string) =>
      installTechs.find((t) => t.id === id)?.name ?? id;

    const slotLines = viableSlots
      .map((s, i) => {
        const leadNames = s.availableLeads.map(techName).join(", ");
        const crewNames = s.availableCrew.map(techName).join(", ");
        return `${i + 1}. ${s.date}\n   Available leads: ${leadNames}\n   Available crew: ${crewNames}`;
      })
      .join("\n\n");

    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .single();

    const systemPrompt = (await Deno.readTextFile(
      new URL("../../prompts/install-crew-agent.md", import.meta.url),
    ).catch(() => null)) ??
      "You are an install crew scheduling agent. Propose the best date and crew.";

    const filledSystem = systemPrompt
      .replace("{{company_name}}", tenantRow?.name ?? "the company")
      .replace("{{trade}}", "home services");

    const userMessage =
      `WON OPPORTUNITY — READY TO SCHEDULE INSTALL\n\n` +
      `Opportunity ID: ${oppId}\n` +
      `Customer: ${customer?.name ?? "Unknown"}\n` +
      `Address: ${address}\n` +
      `Equipment: ${equipNotes || "Not specified"}\n` +
      `Crew needed: ${totalNeeded} total (1 lead + ${totalNeeded - 1} crew)\n\n` +
      `VIABLE DATE SLOTS (next 20 business days, earliest first):\n\n${slotLines}\n\n` +
      `Lead IDs for reference:\n` +
      leads.map((l) => `  ${l.id} = ${l.name}`).join("\n") + "\n\n" +
      `Crew IDs for reference:\n` +
      crew.map((c) => `  ${c.id} = ${c.name}`).join("\n") + "\n\n" +
      `Select the best date and crew. Call propose_install_schedule.`;

    // ── Call Claude ──────────────────────────────────────────────────────────
    const result = await callAgent({
      systemPrompt: filledSystem,
      userMessage,
      tools: [PROPOSE_INSTALL_TOOL],
      model: ctx.resolvedModelId,
      temperature: 0.2,
      maxTokens: 1024,
    });

    const toolCall = result.toolUses.find((t) => t.name === "propose_install_schedule");
    if (!toolCall) return err("Install crew agent did not call propose_install_schedule");

    const proposal = toolCall.input as {
      install_date: string;
      lead_tech_id: string;
      crew_tech_ids: string[];
      scheduled_start_time: string;
      confidence: number;
      reasoning: string;
      operator_rationale: string;
    };

    // Validate
    if (!leads.find((l) => l.id === proposal.lead_tech_id)) {
      return err(`Proposed lead ${proposal.lead_tech_id} not in install_lead list`);
    }

    const scheduledISO = `${proposal.install_date}T${proposal.scheduled_start_time}:00`;

    // ── Finalize ─────────────────────────────────────────────────────────────
    const { actionId, autoExecuted } = await finalizeAction(supabase, {
      tenantId,
      agentType:       "dispatch",
      triggerEvent:    `opportunity:${oppId}:status:won`,
      contextSnapshot: {
        opp_id:        oppId,
        crew_needed:   totalNeeded,
        viable_slots:  viableSlots.length,
      },
      reasoning:      proposal.reasoning,
      proposedAction: {
        type:               "schedule_install",
        opp_id:             oppId,
        install_date:       proposal.install_date,
        lead_tech_id:       proposal.lead_tech_id,
        lead_name:          techName(proposal.lead_tech_id),
        crew_tech_ids:      proposal.crew_tech_ids,
        crew_names:         proposal.crew_tech_ids.map(techName),
        operator_rationale: proposal.operator_rationale,
      },
      confidence:    proposal.confidence,
      config:        ctx.config,
      modelUsed:     result.modelUsed,
      providerUsed:  result.providerUsed,
      inputTokens:   result.usage.inputTokens,
      outputTokens:  result.usage.outputTokens,
      onAutoExecute: async () => {
        // Create the install job
        const { data: newJob, error: jobErr } = await supabase
          .from("jobs")
          .insert({
            tenant_id:       tenantId,
            customer_id:     oppDetail.customer_id as string,
            service_location_id: oppDetail.service_location_id as string | null,
            tech_id:         proposal.lead_tech_id,
            job_type:        "install",
            status:          "scheduled",
            scheduled_start: scheduledISO,
            description:     `Install — ${equipNotes || "system replacement"}`,
            priority:        "normal",
          })
          .select("id")
          .single();

        if (jobErr || !newJob) throw jobErr ?? new Error("Failed to create install job");

        const jobId = (newJob as Record<string, string>).id;

        // Populate job_crew
        const crewRows = [
          { job_id: jobId, tech_id: proposal.lead_tech_id, role: "lead", confirmed: false },
          ...proposal.crew_tech_ids.map((id) => ({
            job_id: jobId, tech_id: id, role: "crew", confirmed: false,
          })),
        ];

        const { error: crewErr } = await supabase.from("job_crew").insert(crewRows);
        if (crewErr) throw crewErr;

        // Link back to opportunity
        const { error: oppErr } = await supabase
          .from("opportunities")
          .update({ install_job_id: jobId })
          .eq("id", oppId)
          .eq("tenant_id", tenantId);
        if (oppErr) throw oppErr;
      },
    });

    return ok({ actionId, autoExecuted, installDate: proposal.install_date, confidence: proposal.confidence });
  } catch (e) {
    console.error("install-crew-agent error:", e);
    return err(String(e));
  }
});
