// CA Dispatch Agent — assigns a comfort advisor or selling tech to a new opportunity.
//
// Trigger: install the DB trigger documented in 025_opportunities.sql.
// It fires when opportunities.status = 'new' AND assigned_to IS NULL.
//
// Required secret: HERE_API_KEY (optional — scoring degrades gracefully without it)

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

const HERE_API_KEY = Deno.env.get("HERE_API_KEY");

// ─── Drive-time helpers (shared pattern with dispatch-agent) ──────────────────

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!HERE_API_KEY) return null;
  const url = `https://geocode.search.hereapi.com/v1/geocode?q=${encodeURIComponent(address)}&apikey=${HERE_API_KEY}`;
  try {
    const res  = await fetch(url);
    const data = await res.json() as { items?: Array<{ position: { lat: number; lng: number } }> };
    return data.items?.[0]?.position ?? null;
  } catch { return null; }
}

async function getDriveMinutes(
  origins: Array<{ id: string; lat: number; lng: number }>,
  dest: { lat: number; lng: number } | null,
): Promise<Record<string, number | null>> {
  const result: Record<string, number | null> = {};
  for (const o of origins) result[o.id] = null;
  if (!HERE_API_KEY || !dest || origins.length === 0) return result;

  try {
    const body = {
      origins:      origins.map((o) => ({ lat: o.lat, lng: o.lng })),
      destinations: [{ lat: dest.lat, lng: dest.lng }],
      transportMode: "car",
      routingMode:   "fast",
    };
    const res  = await fetch(
      `https://matrix.router.hereapi.com/v8/matrix?async=false&apikey=${HERE_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    const data = await res.json() as { matrix?: { travelTimes: number[]; errorCodes: number[] } };
    const m    = data.matrix;
    if (m) {
      origins.forEach((o, i) => {
        result[o.id] = m.errorCodes[i] === 0 ? Math.round(m.travelTimes[i] / 60) : null;
      });
    }
  } catch { /* fall through with nulls */ }
  return result;
}

function driveScore(minutes: number | null): number {
  if (minutes === null) return 0.5;
  if (minutes <= 15) return 1.0;
  if (minutes <= 30) return 0.8;
  if (minutes <= 45) return 0.5;
  if (minutes <= 60) return 0.2;
  return 0.0;
}

function loadScore(visitCount: number, hasActiveVisit: boolean): number {
  if (hasActiveVisit) return 0.1;
  if (visitCount === 0) return 1.0;
  if (visitCount <= 2) return 0.7;
  if (visitCount <= 4) return 0.4;
  return 0.1;
}

// ─── Tool definition ──────────────────────────────────────────────────────────

const PROPOSE_CA_TOOL: NormalisedTool = {
  name: "propose_ca_assignment",
  description: "Assign a comfort advisor or selling tech to this opportunity.",
  input_schema: {
    type: "object",
    properties: {
      assigned_to: {
        type: "string",
        description: "UUID of the selected CA or selling tech.",
      },
      confidence: {
        type: "number",
        description: "Confidence score 0–1.",
      },
      reasoning: {
        type: "string",
        description: "Full internal reasoning — scores, tradeoffs, urgency consideration.",
      },
      operator_rationale: {
        type: "string",
        description: "1–2 plain-English sentences for the dispatcher: who, why.",
      },
    },
    required: ["assigned_to", "confidence", "reasoning", "operator_rationale"],
  },
};

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (!validateServiceRoleAuth(req)) return err("Unauthorized", 401);

  try {
    const payload = await req.json();
    const opp     = payload.record as Record<string, unknown>;

    if (opp.status !== "new" || opp.assigned_to) return ok({ skip: true });
    if (opp.deleted_at) return ok({ skip: true });

    const tenantId = opp.tenant_id as string;
    const oppId    = opp.id as string;

    // ── Agent config ─────────────────────────────────────────────────────────
    const ctx = await loadAgentContext(supabase, tenantId, "dispatch");
    if (!ctx.config.enabled) return ok({ skip: "agent disabled" });

    // ── Load opportunity + customer + location ────────────────────────────────
    const { data: oppDetail } = await supabase
      .from("opportunities")
      .select(`
        *,
        customers(name, phone),
        service_locations(address, city, state, zip, latitude, longitude),
        source_tech:source_tech_id(name),
        source_job:source_job_id(job_type, description)
      `)
      .eq("id", oppId)
      .single();

    if (!oppDetail) return err(`Opportunity ${oppId} not found`);

    const location = oppDetail.service_locations as Record<string, unknown> | null;
    const custAddr = location
      ? `${location.address}, ${location.city}, ${location.state} ${location.zip}`
      : null;
    const destCoords = location?.latitude && location?.longitude
      ? { lat: location.latitude as number, lng: location.longitude as number }
      : custAddr
      ? await geocodeAddress(custAddr)
      : null;

    // ── Load available CAs and selling techs ──────────────────────────────────
    const { data: candidates } = await supabase
      .from("technicians")
      .select("id, name, tech_type, can_sell, current_latitude, current_longitude")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .or("tech_type.eq.comfort_advisor,and(can_sell.eq.true,tech_type.eq.service)");

    if (!candidates || candidates.length === 0) return ok({ skip: "no CAs or selling techs available" });

    // ── Count today's visit-type jobs per CA ──────────────────────────────────
    const now      = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const dayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

    const { data: todayJobs } = await supabase
      .from("jobs")
      .select("tech_id, status")
      .eq("tenant_id", tenantId)
      .not("tech_id", "is", null)
      .gte("scheduled_start", dayStart)
      .lt("scheduled_start", dayEnd)
      .in("tech_id", candidates.map((c) => c.id))
      .not("status", "in", "(cancelled,no_show)");

    const visitCount: Record<string, number>  = {};
    const activeVisit: Record<string, boolean> = {};
    for (const j of todayJobs ?? []) {
      if (!j.tech_id) continue;
      visitCount[j.tech_id] = (visitCount[j.tech_id] ?? 0) + 1;
      if (j.status === "in_progress") activeVisit[j.tech_id] = true;
    }

    // ── Drive times ───────────────────────────────────────────────────────────
    const withGps = candidates
      .filter((c) => c.current_latitude && c.current_longitude)
      .map((c) => ({ id: c.id, lat: c.current_latitude as number, lng: c.current_longitude as number }));

    const driveMins = await getDriveMinutes(withGps, destCoords);

    // ── Score each candidate ──────────────────────────────────────────────────
    interface ScoredCA {
      id: string;
      name: string;
      techType: string;
      canSell: boolean;
      driveMinutes: number | null;
      visitsToday: number;
      isActive: boolean;
      driveScoreVal: number;
      loadScoreVal: number;
      totalScore: number;
    }

    const scored: ScoredCA[] = candidates.map((c) => {
      const drive  = driveMins[c.id] ?? null;
      const visits = visitCount[c.id] ?? 0;
      const active = activeVisit[c.id] ?? false;
      const ds     = driveScore(drive);
      const ls     = loadScore(visits, active);
      // Weighting: proximity 40%, availability 60%
      const total  = ds * 0.4 + ls * 0.6;
      return {
        id: c.id,
        name: c.name,
        techType: c.tech_type as string,
        canSell: c.can_sell as boolean,
        driveMinutes: drive,
        visitsToday: visits,
        isActive: active,
        driveScoreVal: ds,
        loadScoreVal: ls,
        totalScore: total,
      };
    });

    scored.sort((a, b) => b.totalScore - a.totalScore);

    // ── Build LLM context ────────────────────────────────────────────────────
    const customer    = oppDetail.customers as Record<string, string> | null;
    const sourceTech  = oppDetail.source_tech as Record<string, string> | null;
    const sourceJob   = oppDetail.source_job as Record<string, string> | null;

    const caLines = scored
      .map((c, i) => {
        const driveStr = c.driveMinutes !== null ? `${c.driveMinutes} min away` : "location unknown";
        const loadStr  = c.isActive
          ? "currently in a visit"
          : c.visitsToday === 0
          ? "free today"
          : `${c.visitsToday} visit${c.visitsToday > 1 ? "s" : ""} today`;
        const roleStr = c.techType === "comfort_advisor" ? "Comfort Advisor" : "Selling Tech";
        return (
          `${i + 1}. ${c.name} (${roleStr})\n` +
          `   Drive: ${driveStr}\n` +
          `   Load: ${loadStr}\n` +
          `   Score: ${Math.round(c.totalScore * 100)}/100`
        );
      })
      .join("\n\n");

    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .single();

    const systemPrompt = (await Deno.readTextFile(
      new URL("../../prompts/ca-dispatch-agent.md", import.meta.url),
    ).catch(() => null)) ??
      "You are a CA dispatch agent. Assign the best comfort advisor and call propose_ca_assignment.";

    const filledSystem = systemPrompt
      .replace("{{company_name}}", tenantRow?.name ?? "the company")
      .replace("{{trade}}", "home services");

    const userMessage =
      `NEW OPPORTUNITY\n\n` +
      `Opportunity ID: ${oppId}\n` +
      `Customer: ${customer?.name ?? "Unknown"}\n` +
      `Address: ${custAddr ?? "Unknown"}\n` +
      `Equipment notes: ${(oppDetail.equipment_notes as string) || "None provided"}\n` +
      `Source: ${(opp.source as string).replace("_", " ")}\n` +
      (sourceTech ? `Flagged by: ${sourceTech.name}\n` : "") +
      (sourceJob ? `From job type: ${sourceJob.job_type}\n` : "") +
      `\nAVAILABLE COMFORT ADVISORS / SELLING TECHS (pre-scored):\n\n${caLines}\n\n` +
      `Select the best person. Call propose_ca_assignment.`;

    // ── Call Claude ──────────────────────────────────────────────────────────
    const result = await callAgent({
      systemPrompt: filledSystem,
      userMessage,
      tools: [PROPOSE_CA_TOOL],
      model: ctx.resolvedModelId,
      temperature: 0.2,
      maxTokens: 1024,
    });

    const toolCall = result.toolUses.find((t) => t.name === "propose_ca_assignment");
    if (!toolCall) return err("CA dispatch agent did not call propose_ca_assignment");

    const proposal = toolCall.input as {
      assigned_to: string;
      confidence: number;
      reasoning: string;
      operator_rationale: string;
    };

    const selectedCA = scored.find((c) => c.id === proposal.assigned_to);
    if (!selectedCA) return err(`Proposed CA ${proposal.assigned_to} not in candidate list`);

    // ── Finalize ─────────────────────────────────────────────────────────────
    const { actionId, autoExecuted } = await finalizeAction(supabase, {
      tenantId,
      agentType:       "dispatch",
      triggerEvent:    `opportunity:${oppId}:status:new`,
      contextSnapshot: {
        opp_id:    oppId,
        source:    opp.source,
        scored_cas: scored.map((c) => ({ id: c.id, name: c.name, score: c.totalScore })),
      },
      reasoning:      proposal.reasoning,
      proposedAction: {
        type:               "assign_ca",
        opp_id:             oppId,
        assigned_to:        proposal.assigned_to,
        ca_name:            selectedCA.name,
        operator_rationale: proposal.operator_rationale,
      },
      confidence:    proposal.confidence,
      config:        ctx.config,
      modelUsed:     result.modelUsed,
      providerUsed:  result.providerUsed,
      inputTokens:   result.usage.inputTokens,
      outputTokens:  result.usage.outputTokens,
      onAutoExecute: async () => {
        const { error } = await supabase
          .from("opportunities")
          .update({ assigned_to: proposal.assigned_to, status: "assigned" })
          .eq("id", oppId)
          .eq("tenant_id", tenantId);
        if (error) throw error;
      },
    });

    return ok({ actionId, autoExecuted, assignedTo: proposal.assigned_to, confidence: proposal.confidence });
  } catch (e) {
    console.error("ca-dispatch-agent error:", e);
    return err(String(e));
  }
});
