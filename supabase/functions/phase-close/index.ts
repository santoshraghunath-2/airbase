// phase-close — closes a project phase with evidence verification.
//
// Called from the tech app when a crew lead taps "Close phase".
// Refuses if required evidence (photos) is missing.
// Sets phase status = complete, advances the project, sends customer progress SMS.
//
// POST { phase_id: string, notes?: string }
// Authorization: Bearer <user JWT> (must be a technician or owner for this tenant)

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const { data: { user }, error: authErr } = await serviceClient.auth.getUser(jwt);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: userRow } = await serviceClient
      .from("users")
      .select("tenant_id, role, id")
      .eq("auth_id", user.id)
      .single();
    if (!userRow) return json({ error: "User not found" }, 404);

    const tenantId = (userRow as { tenant_id: string }).tenant_id;
    const userId   = (userRow as { id: string }).id;

    // ── Input ─────────────────────────────────────────────────────────────────
    const body = await req.json() as { phase_id?: string; notes?: string; evidence_urls?: string[] };
    const { phase_id: phaseId, notes, evidence_urls: evidenceUrls = [] } = body;
    if (!phaseId) return json({ error: "phase_id required" }, 400);

    // ── Load phase (tenant-scoped) ────────────────────────────────────────────
    const { data: phase } = await serviceClient
      .from("project_phases")
      .select("id, tenant_id, project_id, name, status, required_evidence, sort_order")
      .eq("id", phaseId)
      .eq("tenant_id", tenantId)
      .single();

    if (!phase) return json({ error: "Phase not found" }, 404);
    if (phase.status === "complete") return json({ error: "Phase is already closed" }, 400);
    if (phase.status === "skipped")  return json({ error: "Phase is skipped" }, 400);

    // ── Evidence gate ─────────────────────────────────────────────────────────
    const required = (phase.required_evidence as string[]) ?? [];
    if (required.length > 0 && evidenceUrls.length === 0) {
      return json({
        error: `Phase '${phase.name}' requires evidence before closing: ${required.join(", ")}. Upload photos first.`,
        required_evidence: required,
      }, 422);
    }

    const now = new Date().toISOString();

    // ── Close the phase ───────────────────────────────────────────────────────
    await serviceClient
      .from("project_phases")
      .update({
        status:    "complete",
        actual_end: now,
        closed_by:  userId,
        closed_at:  now,
        notes:      notes ?? null,
      })
      .eq("id", phaseId)
      .eq("tenant_id", tenantId);

    // ── Advance project to in_progress if still pending_start ─────────────────
    const { data: project } = await serviceClient
      .from("projects")
      .select("id, status, customer_id, opportunity_id")
      .eq("id", phase.project_id as string)
      .eq("tenant_id", tenantId)
      .single();

    if (project?.status === "pending_start" || project?.status === "scheduled") {
      await serviceClient
        .from("projects")
        .update({ status: "in_progress", actual_start: now })
        .eq("id", project.id as string)
        .eq("tenant_id", tenantId);
    }

    // Check if all phases complete → move to punch_list or complete
    const { data: allPhases } = await serviceClient
      .from("project_phases")
      .select("status")
      .eq("project_id", phase.project_id as string)
      .eq("tenant_id", tenantId);

    const incomplete = (allPhases ?? []).filter(
      (p) => !["complete", "skipped"].includes(p.status as string),
    );

    if (incomplete.length === 0 && project) {
      await serviceClient
        .from("projects")
        .update({ status: "complete", actual_completion: now })
        .eq("id", project.id as string)
        .eq("tenant_id", tenantId);
    }

    // ── Send customer progress SMS (if sms_enabled) ───────────────────────────
    try {
      const { data: tenant } = await serviceClient
        .from("tenants")
        .select("sms_enabled, retell_phone_number, timezone")
        .eq("id", tenantId)
        .single();

      if (tenant?.sms_enabled && project?.customer_id) {
        const { data: customer } = await serviceClient
          .from("customers")
          .select("name, phone")
          .eq("id", project.customer_id as string)
          .single();

        if (customer?.phone) {
          const firstName = (customer.name as string).split(" ")[0];
          const photoNote = evidenceUrls.length > 0 ? " We've attached a photo for your records." : "";
          const smsBody = `Hi ${firstName}, great news — the ${phase.name} phase of your project is complete!${photoNote} We'll keep you posted on next steps. – ${(tenant as { name?: string }).name ?? "Your team"}`;

          // Call retell-send (best-effort: don't fail phase-close if SMS fails)
          await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/retell-send`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization:  `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({
                tenant_id:    tenantId,
                to_phone:     customer.phone,
                message_body: smsBody,
                channel:      "sms",
              }),
            },
          ).catch((e) => console.error("phase-close: SMS send failed (non-fatal):", e));
        }
      }
    } catch (smsErr) {
      console.error("phase-close: SMS notification failed (non-fatal):", smsErr);
    }

    return json({ closed: true, phase_id: phaseId, project_id: phase.project_id });

  } catch (e) {
    console.error("phase-close error:", e);
    return json({ error: String(e) }, 500);
  }
});
