// Dispatch Agent — assigns technicians to unassigned jobs.
//
// Trigger: set up these pg_net triggers in Supabase SQL editor (run once):
//
//   CREATE OR REPLACE FUNCTION trg_jobs_dispatch_agent()
//   RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
//   BEGIN
//     IF (NEW.status = 'unassigned') AND
//        (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'unassigned') THEN
//       PERFORM _call_edge_function(
//         'dispatch-agent',
//         jsonb_build_object('type', TG_OP, 'table', 'jobs', 'schema', 'public',
//                            'record', row_to_json(NEW), 'old_record', row_to_json(OLD))
//       );
//     END IF;
//     RETURN NEW;
//   END;
//   $$;
//
//   CREATE TRIGGER jobs_dispatch_agent
//     AFTER INSERT OR UPDATE ON jobs
//     FOR EACH ROW EXECUTE FUNCTION trg_jobs_dispatch_agent();
//
// Note: _call_edge_function is created by migration 012_notification_agents.sql.
//
// Required secret: HERE_API_KEY (HERE Maps platform key with Matrix Routing + Geocoding enabled)
// Add via: supabase secrets set HERE_API_KEY=<your-key>

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

// ─── Job-type → skill mapping ─────────────────────────────────────────────────
// Primary skill first — used to find the tech's best matching skill level.

const JOB_SKILL_MAP: Record<string, string[]> = {
  drain_cleaning:       ["drain_cleaning", "plumbing_drain", "plumbing_service"],
  plumbing_service:     ["plumbing_service"],
  water_heater_repair:  ["water_heater_repair", "plumbing_service"],
  water_heater_install: ["water_heater_install", "water_heater_repair", "plumbing_service"],
  hvac_service:         ["hvac_service"],
  hvac_repair:          ["hvac_repair", "hvac_service"],
  hvac_install:         ["hvac_install", "hvac_service"],
  hvac_maintenance:     ["hvac_maintenance", "hvac_service"],
  electrical_service:   ["electrical_service"],
  electrical_repair:    ["electrical_repair", "electrical_service"],
  electrical_install:   ["electrical_install", "electrical_service"],
  general_maintenance:  ["general_maintenance", "plumbing_service"],
  warranty_call:        [],
  recall:               [],
  estimate_only:        [],
  leak_detection:       ["leak_detection", "plumbing_service"],
};

const SKILL_LEVEL_SCORE: Record<string, number> = {
  expert: 1.0,
  proficient: 0.7,
  learning: 0.3,
};

// ─── HERE Maps Drive-Time Scoring ────────────────────────────────────────────

interface DriveTimeResult {
  techId: string;
  minutes: number | null;
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const url =
    `https://geocode.search.hereapi.com/v1/geocode` +
    `?q=${encodeURIComponent(address)}&apikey=${HERE_API_KEY}`;
  try {
    const res  = await fetch(url);
    const data = await res.json() as { items?: Array<{ position: { lat: number; lng: number } }> };
    const pos  = data.items?.[0]?.position;
    return pos ?? null;
  } catch {
    return null;
  }
}

async function getDriveTimes(
  techLocations: Array<{ techId: string; lat: number; lng: number }>,
  destCoords: { lat: number; lng: number } | null,
  destAddress: string,
): Promise<DriveTimeResult[]> {
  if (!HERE_API_KEY || techLocations.length === 0) {
    return techLocations.map((t) => ({ techId: t.techId, minutes: null }));
  }

  // Use stored coordinates if available, otherwise geocode the address.
  const dest = destCoords ?? await geocodeAddress(destAddress);
  if (!dest) return techLocations.map((t) => ({ techId: t.techId, minutes: null }));

  const body = {
    origins:       techLocations.map((t) => ({ lat: t.lat, lng: t.lng })),
    destinations:  [{ lat: dest.lat, lng: dest.lng }],
    transportMode: "car",
    routingMode:   "fast",
  };

  try {
    const res  = await fetch(
      `https://matrix.router.hereapi.com/v8/matrix?async=false&apikey=${HERE_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    const data = await res.json() as {
      matrix?: { travelTimes: number[]; errorCodes: number[] };
    };

    const matrix = data.matrix;
    if (!matrix) return techLocations.map((t) => ({ techId: t.techId, minutes: null }));

    return techLocations.map((t, i) => {
      if (matrix.errorCodes[i] !== 0) return { techId: t.techId, minutes: null };
      return { techId: t.techId, minutes: Math.round(matrix.travelTimes[i] / 60) };
    });
  } catch {
    return techLocations.map((t) => ({ techId: t.techId, minutes: null }));
  }
}

function driveTimeScore(minutes: number | null): number {
  if (minutes === null) return 0.5; // neutral when unknown
  if (minutes <= 15) return 1.0;
  if (minutes <= 30) return 0.8;
  if (minutes <= 45) return 0.5;
  if (minutes <= 60) return 0.2;
  return 0.0;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function skillScore(
  techSkills: Array<{ skill: string; level: string }>,
  jobType: string,
): number {
  const relevant = JOB_SKILL_MAP[jobType] ?? [];
  if (relevant.length === 0) return 0.5; // warranty/recall — any tech
  for (const skillName of relevant) {
    const match = techSkills.find((s) => s.skill === skillName);
    if (match) return SKILL_LEVEL_SCORE[match.level] ?? 0;
  }
  return 0;
}

function availabilityScore(
  jobsToday: number,
  hasActiveJob: boolean,
): number {
  if (hasActiveJob) return 0.0;
  if (jobsToday === 0) return 1.0;
  if (jobsToday <= 2) return 0.7;
  return 0.3;
}

// ─── Tool definition ──────────────────────────────────────────────────────────

const PROPOSE_ASSIGNMENT_TOOL: NormalisedTool = {
  name: "propose_assignment",
  description: "Propose a technician assignment for this job.",
  input_schema: {
    type: "object",
    properties: {
      tech_id: {
        type: "string",
        description: "UUID of the selected technician.",
      },
      confidence: {
        type: "number",
        description: "Confidence score 0–1. Use 0.95+ only when the choice is clearly best on all dimensions.",
      },
      reasoning: {
        type: "string",
        description: "Full internal reasoning — skill scores, drive time comparison, workload considerations.",
      },
      operator_rationale: {
        type: "string",
        description: "1–2 plain-English sentences for the dispatcher explaining why this tech was selected.",
      },
    },
    required: ["tech_id", "confidence", "reasoning", "operator_rationale"],
  },
};

// ─── Push notification helper ─────────────────────────────────────────────────

async function notifyDispatch(
  tenantId: string,
  techId: string,
  jobId: string,
  jobType: string,
  autoExecuted: boolean,
): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return;

  // Resolve the tech's users.id from technicians.user_id (they are different tables)
  const { data: techRecord } = await supabase
    .from("technicians")
    .select("user_id")
    .eq("id", techId)
    .single();

  const techUserId = techRecord?.user_id as string | null;

  const payload = autoExecuted && techUserId
    ? {
        tenant_id: tenantId,
        user_ids:  [techUserId],
        title:     "New job assigned",
        body:      `You've been assigned a ${jobType} job. Tap to view details.`,
        data:      { screen: "JobDetail", job_id: jobId },
      }
    : autoExecuted ? null  // tech has no user account — skip push
    : {
        tenant_id: tenantId,
        roles:     ["admin", "dispatcher"],
        title:     "Dispatch needs approval",
        body:      `AI suggested a tech for a ${jobType} job — tap to review.`,
        data:      { screen: "ApprovalQueue", job_id: jobId },
      };

  if (!payload) return;

  await fetch(`${supabaseUrl}/functions/v1/push-notification`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body:    JSON.stringify(payload),
  }).catch((e) => console.warn("push-notification call failed (non-fatal):", e));
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (!validateServiceRoleAuth(req)) {
    return err("Unauthorized", 401);
  }

  try {
    const payload = await req.json();
    const job = payload.record as Record<string, unknown>;

    if (job.status !== "unassigned") return ok({ skip: true });
    if (job.deleted_at) return ok({ skip: true });

    const tenantId = job.tenant_id as string;
    const jobId    = job.id as string;
    const jobType  = job.job_type as string;

    // ── Load agent context + config ──────────────────────────────────────────
    const ctx = await loadAgentContext(supabase, tenantId, "dispatch");
    if (!ctx.config.enabled) return ok({ skip: "agent disabled" });

    // ── Load job details ─────────────────────────────────────────────────────
    const { data: jobDetail } = await supabase
      .from("jobs")
      .select("*, service_locations(address, city, state, zip, latitude, longitude), customers(name)")
      .eq("id", jobId)
      .single();

    if (!jobDetail) return err(`Job ${jobId} not found`);

    const location    = jobDetail.service_locations as Record<string, unknown>;
    const destAddress = `${location.address}, ${location.city}, ${location.state} ${location.zip}`;
    const destCoords  =
      location.latitude && location.longitude
        ? { lat: location.latitude as number, lng: location.longitude as number }
        : null;

    // ── Load technicians + skills ────────────────────────────────────────────
    const { data: techs } = await supabase
      .from("technicians")
      .select("id, name, current_latitude, current_longitude, tech_skills(skill, level)")
      .eq("tenant_id", tenantId)
      .eq("is_active", true);

    if (!techs || techs.length === 0) return ok({ skip: "no active technicians" });

    // ── Load today's job counts per tech ─────────────────────────────────────
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
      .not("status", "in", "(cancelled,no_show,unassigned)");

    const jobCountByTech: Record<string, number> = {};
    const activeJobByTech: Record<string, boolean> = {};
    for (const j of todayJobs ?? []) {
      if (!j.tech_id) continue;
      jobCountByTech[j.tech_id] = (jobCountByTech[j.tech_id] ?? 0) + 1;
      if (j.status === "in_progress") activeJobByTech[j.tech_id] = true;
    }

    // ── Drive times via Google Maps ───────────────────────────────────────────
    const techsWithGps = techs
      .filter((t) => t.current_latitude && t.current_longitude)
      .map((t) => ({ techId: t.id, lat: t.current_latitude!, lng: t.current_longitude! }));

    const driveTimes = await getDriveTimes(techsWithGps, destCoords, destAddress);
    const driveByTech: Record<string, number | null> = {};
    for (const d of driveTimes) driveByTech[d.techId] = d.minutes;

    // ── Score each technician ────────────────────────────────────────────────
    interface ScoredTech {
      id: string;
      name: string;
      skills: Array<{ skill: string; level: string }>;
      driveMinutes: number | null;
      jobsToday: number;
      isActive: boolean;
      skillScore: number;
      driveScore: number;
      availScore: number;
      totalScore: number;
    }

    const scored: ScoredTech[] = techs.map((tech) => {
      const skills   = (tech.tech_skills ?? []) as Array<{ skill: string; level: string }>;
      const drive    = driveByTech[tech.id] ?? null;
      const jobs     = jobCountByTech[tech.id] ?? 0;
      const active   = activeJobByTech[tech.id] ?? false;

      const ss = skillScore(skills, jobType);
      const ds = driveTimeScore(drive);
      const as_ = availabilityScore(jobs, active);

      // Weighting: skill 50%, drive 30%, availability 20%
      const total = ss * 0.5 + ds * 0.3 + as_ * 0.2;

      return {
        id: tech.id,
        name: tech.name,
        skills,
        driveMinutes: drive,
        jobsToday: jobs,
        isActive: active,
        skillScore: ss,
        driveScore: ds,
        availScore: as_,
        totalScore: total,
      };
    });

    scored.sort((a, b) => b.totalScore - a.totalScore);

    // ── Build context for Claude ─────────────────────────────────────────────
    const priority    = (jobDetail.priority as string) ?? "normal";
    const description = (jobDetail.description as string) ?? "No description provided";
    const custName    = (jobDetail.customers as Record<string, unknown>)?.name ?? "Unknown";
    const schedStart  = jobDetail.scheduled_start
      ? new Date(jobDetail.scheduled_start as string).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
      : "ASAP";

    const techLines = scored
      .map((t, i) => {
        const skillList = t.skills.length
          ? t.skills.map((s) => `${s.skill} (${s.level})`).join(", ")
          : "none on record";
        const driveStr = t.driveMinutes !== null ? `${t.driveMinutes} min away` : "location unknown";
        const loadStr  = t.isActive
          ? `currently in progress on another job`
          : t.jobsToday === 0
          ? "no other jobs today"
          : `${t.jobsToday} job${t.jobsToday > 1 ? "s" : ""} today`;
        return (
          `${i + 1}. ${t.name}\n` +
          `   Skills: ${skillList}\n` +
          `   Drive time: ${driveStr}\n` +
          `   Today's load: ${loadStr}\n` +
          `   Score: ${Math.round(t.totalScore * 100)}/100`
        );
      })
      .join("\n\n");

    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .single();

    const systemPrompt = (await Deno.readTextFile(
      new URL("../../prompts/dispatch-agent.md", import.meta.url),
    ).catch(() => null)) ??
      "You are a dispatch agent. Pick the best technician for this job and call propose_assignment.";

    const filledSystem = systemPrompt
      .replace("{{company_name}}", tenantRow?.name ?? "the company")
      .replace("{{trade}}", "home services");

    const userMessage =
      `NEW UNASSIGNED JOB\n\n` +
      `Job ID: ${jobId}\n` +
      `Type: ${jobType}\n` +
      `Priority: ${priority}\n` +
      `Customer: ${custName}\n` +
      `Location: ${destAddress}\n` +
      `Scheduled: ${schedStart}\n` +
      `Description: ${description}\n\n` +
      `AVAILABLE TECHNICIANS (pre-scored, highest first):\n\n${techLines}\n\n` +
      `Select the best technician. Call propose_assignment with your recommendation.`;

    // ── Call Claude ──────────────────────────────────────────────────────────
    const result = await callAgent({
      systemPrompt: filledSystem,
      userMessage,
      tools: [PROPOSE_ASSIGNMENT_TOOL],
      model: ctx.resolvedModelId,
      temperature: 0.2,
      maxTokens: 1024,
    });

    const toolCall = result.toolUses.find((t) => t.name === "propose_assignment");
    if (!toolCall) return err("Dispatch agent did not call propose_assignment");

    const proposal = toolCall.input as {
      tech_id: string;
      confidence: number;
      reasoning: string;
      operator_rationale: string;
    };

    // Validate the proposed tech exists in our scored list
    const proposedTech = scored.find((t) => t.id === proposal.tech_id);
    if (!proposedTech) return err(`Proposed tech_id ${proposal.tech_id} not in technician list`);

    // ── Finalize: auto-execute or propose ────────────────────────────────────
    const { actionId, autoExecuted } = await finalizeAction(supabase, {
      tenantId,
      agentType:       "dispatch",
      triggerEvent:    `job:${jobId}:status:unassigned`,
      contextSnapshot: {
        job_id:    jobId,
        job_type:  jobType,
        priority,
        scored_techs: scored.map((t) => ({ id: t.id, name: t.name, score: t.totalScore })),
      },
      reasoning:      proposal.reasoning,
      proposedAction: {
        type:               "assign_tech",
        job_id:             jobId,
        tech_id:            proposal.tech_id,
        tech_name:          proposedTech.name,
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
          .from("jobs")
          .update({ tech_id: proposal.tech_id, status: "dispatched" })
          .eq("id", jobId)
          .eq("tenant_id", tenantId);
        if (error) throw error;
      },
    });

    // Push notification: tech gets alerted when auto-dispatched; admins when held for approval
    void notifyDispatch(tenantId, proposal.tech_id, jobId, jobType, autoExecuted);

    return ok({ actionId, autoExecuted, proposedTechId: proposal.tech_id, confidence: proposal.confidence });
  } catch (e) {
    console.error("dispatch-agent error:", e);
    return err(String(e));
  }
});
