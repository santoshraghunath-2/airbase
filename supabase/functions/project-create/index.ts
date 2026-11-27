// project-create — runs when a contract becomes effective.
//
// Creates the project, expands the package's phase template into project_phases,
// generates a draft material order from package_components, and creates a permit
// row based on jurisdiction_rules for the service location's city.
//
// Idempotent on contract_id: if a project already exists for the contract, returns it.
//
// Trigger: called by esign-webhook and stripe-webhook after checkAndSetContractEffective.
// Also callable manually (service-role) for recovery.
//
// POST { contract_id: string }
// Authorization: service-role key (via validateServiceRoleAuth) OR user JWT

import { createClient } from "npm:@supabase/supabase-js@2";
import { validateServiceRoleAuth, ok, err } from "../_shared/agent-base.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(start);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

function businessDayOffset(start: Date, offset: number): Date {
  // offset is 1-based: offset=1 → start date itself (day 1 of the project)
  if (offset <= 1) return new Date(start);
  return addBusinessDays(start, offset - 1);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return err("Method not allowed", 405);

  try {
    // Auth: service-role or user JWT
    const isServiceRole = validateServiceRoleAuth(req);
    if (!isServiceRole) {
      // Fall back to user JWT (operator triggering manually)
      const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
      if (!jwt) return err("Unauthorized", 401);
      const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
      if (authErr || !user) return err("Unauthorized", 401);
    }

    const body = await req.json() as { contract_id?: string };
    const contractId = body.contract_id;
    if (!contractId) return err("contract_id required", 400);

    // ── Idempotency: check if project already exists ──────────────────────────
    const { data: existing } = await supabase
      .from("projects")
      .select("id, status")
      .eq("contract_id", contractId)
      .maybeSingle();

    if (existing) {
      return ok({ project_id: existing.id, created: false, status: existing.status });
    }

    // ── Load contract + related data ──────────────────────────────────────────
    const { data: contract } = await supabase
      .from("contracts")
      .select(`
        id, tenant_id, customer_id, opportunity_id, total_cents, status,
        estimates!inner(
          id, title, selected_option,
          estimate_line_items(pricebook_item_id, unit_price_cents, quantity, description)
        )
      `)
      .eq("id", contractId)
      .single();

    if (!contract) return err("Contract not found", 404);
    if (contract.status !== "effective") {
      return err(`Contract is not effective (status: ${contract.status})`, 400);
    }

    const tenantId   = contract.tenant_id as string;
    const customerId = contract.customer_id as string;
    const estimate   = (contract.estimates as Record<string, unknown> | null);

    // Find the main package line item (highest-value line or the one with a phase template)
    const lineItems = (estimate?.estimate_line_items as Array<{
      pricebook_item_id: string | null;
      unit_price_cents: number;
      quantity: number;
      description: string;
    }>) ?? [];

    // Find the pricebook item with a phase template
    let packagePricebookItemId: string | null = null;
    for (const line of lineItems) {
      if (!line.pricebook_item_id) continue;
      const { data: template } = await supabase
        .from("phase_templates")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("pricebook_item_id", line.pricebook_item_id)
        .maybeSingle();
      if (template) {
        packagePricebookItemId = line.pricebook_item_id;
        break;
      }
    }

    // ── Load service location ─────────────────────────────────────────────────
    let serviceLocationId: string | null = null;
    let city = "";
    if (contract.opportunity_id) {
      const { data: opp } = await supabase
        .from("opportunities")
        .select("service_location_id, service_locations(city, state)")
        .eq("id", contract.opportunity_id as string)
        .single();
      if (opp?.service_location_id) {
        serviceLocationId = opp.service_location_id as string;
        city = (opp.service_locations as { city?: string } | null)?.city ?? "";
      }
    }

    // ── Create project ────────────────────────────────────────────────────────
    const projectName = `${(estimate?.title as string) ?? "Remodel"} — TBD`;

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .insert({
        tenant_id:                tenantId,
        customer_id:              customerId,
        service_location_id:      serviceLocationId,
        opportunity_id:           contract.opportunity_id ?? null,
        estimate_id:              estimate?.id as string ?? null,
        contract_id:              contractId,
        name:                     projectName,
        package_pricebook_item_id: packagePricebookItemId,
        status:                   "pending_start",
      })
      .select("id")
      .single();

    if (projErr || !project) throw projErr ?? new Error("Failed to create project");
    const projectId = (project as { id: string }).id;

    // ── Expand phase template → project_phases ────────────────────────────────
    if (packagePricebookItemId) {
      const { data: template } = await supabase
        .from("phase_templates")
        .select(`
          id, total_commitment_days,
          phase_template_items(id, sort_order, name, day_offset, duration_days, crew_size, job_type, required_evidence)
        `)
        .eq("tenant_id", tenantId)
        .eq("pricebook_item_id", packagePricebookItemId)
        .order("name")
        .limit(1)
        .single();

      if (template) {
        const items = (template.phase_template_items as Array<{
          id: string;
          sort_order: number;
          name: string;
          day_offset: number;
          duration_days: number;
          crew_size: number;
          job_type: string;
          required_evidence: string[] | null;
        }>) ?? [];

        const phaseRows = items.map((item) => ({
          tenant_id:          tenantId,
          project_id:         projectId,
          template_item_id:   item.id,
          sort_order:         item.sort_order,
          name:               item.name,
          crew_size:          item.crew_size,
          job_type:           item.job_type,
          required_evidence:  item.required_evidence ?? [],
          status:             "not_started",
          // planned dates computed after scheduling; left null until project-schedule runs
        }));

        if (phaseRows.length > 0) {
          const { error: phaseErr } = await supabase
            .from("project_phases")
            .insert(phaseRows);
          if (phaseErr) throw phaseErr;
        }

        // Store commitment_days on project
        await supabase
          .from("projects")
          .update({ commitment_days: template.total_commitment_days })
          .eq("id", projectId);
      }
    }

    // ── Draft material order from package_components ──────────────────────────
    if (packagePricebookItemId) {
      const selectedOption = (estimate?.selected_option as string) ?? "good";

      const { data: components } = await supabase
        .from("package_components")
        .select("id, option, material_description, quantity, unit, expected_cost_cents")
        .eq("tenant_id", tenantId)
        .eq("pricebook_item_id", packagePricebookItemId)
        .in("option", ["base", selectedOption]);

      if (components && components.length > 0) {
        const totalCost = components.reduce((sum, c) => sum + (c as { expected_cost_cents: number }).expected_cost_cents, 0);

        const { data: order, error: orderErr } = await supabase
          .from("material_orders")
          .insert({
            tenant_id:        tenantId,
            project_id:       projectId,
            vendor:           "PLACEHOLDER_VENDOR",
            status:           "draft",
            total_cost_cents: totalCost,
          })
          .select("id")
          .single();

        if (orderErr || !order) throw orderErr ?? new Error("Failed to create material order");

        const lineRows = components.map((c) => ({
          tenant_id:            tenantId,
          material_order_id:    (order as { id: string }).id,
          package_component_id: (c as { id: string }).id,
          description:          (c as { material_description: string }).material_description,
          quantity:             (c as { quantity: number }).quantity,
          unit:                 (c as { unit: string }).unit,
          unit_cost_cents:      (c as { expected_cost_cents: number }).expected_cost_cents,
          total_cost_cents:     Math.round((c as { expected_cost_cents: number }).expected_cost_cents * (c as { quantity: number }).quantity),
          status:               "pending",
        }));

        const { error: linesErr } = await supabase.from("material_order_lines").insert(lineRows);
        if (linesErr) throw linesErr;
      }
    }

    // ── Determine permit requirement from jurisdiction_rules ──────────────────
    const workType = "bathroom_remodel";
    let permitStatus: "not_required" | "needs_review" | "pending" = "needs_review";

    if (city) {
      const { data: rule } = await supabase
        .from("jurisdiction_rules")
        .select("permit_required")
        .eq("tenant_id", tenantId)
        .eq("jurisdiction", city)
        .eq("work_type", workType)
        .maybeSingle();

      if (rule) {
        const req = (rule as { permit_required: string }).permit_required;
        if (req === "no") permitStatus = "not_required";
        else if (req === "yes") permitStatus = "pending";
        else permitStatus = "needs_review";
      }
    }

    // Create permit row (not_required still stored for audit trail)
    const { error: permitErr } = await supabase.from("permits").insert({
      tenant_id:    tenantId,
      project_id:   projectId,
      jurisdiction: city || "UNKNOWN",
      permit_type:  "building",
      status:       permitStatus,
    });
    if (permitErr) throw permitErr;

    // ── Notify office if permit needs review ──────────────────────────────────
    if (permitStatus === "needs_review") {
      console.log(`project-create: permit needs review for project ${projectId} in ${city || "unknown city"}`);
      // Phase 4 will add push notifications; log for now
    }

    console.log(`project-create: created project ${projectId} for contract ${contractId}`);
    return ok({ project_id: projectId, created: true, permit_status: permitStatus });

  } catch (e) {
    console.error("project-create error:", e);
    return err(String(e));
  }
});
