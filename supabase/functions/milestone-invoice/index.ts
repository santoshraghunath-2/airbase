/**
 * milestone-invoice
 *
 * Creates an invoice for a remodel project payment schedule item once its
 * trigger event has been recorded.
 *
 * Hard guard: refuses if the trigger condition has not been met. This protects
 * against premature invoicing.
 *
 * Idempotent: returns the existing invoice_id if already created.
 *
 * POST body: { payment_schedule_item_id: string }
 * Auth: Bearer <user JWT> — tenantId derived from JWT, never trusted from body
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
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

// ─── Trigger verification ─────────────────────────────────────────────────────

type TriggerType = "contract_signed" | "materials_delivered" | "phase_closed" | "completion";

async function verifyTrigger(
  triggerType: TriggerType,
  triggerReference: string | null,
  contractId: string,
  projectId: string,
): Promise<{ ok: boolean; reason?: string }> {
  switch (triggerType) {
    case "contract_signed": {
      const { data } = await supabase
        .from("contracts")
        .select("signed_at")
        .eq("id", contractId)
        .single();
      if (!data?.signed_at) {
        return { ok: false, reason: "Contract has not been signed yet." };
      }
      return { ok: true };
    }

    case "materials_delivered": {
      const { data } = await supabase
        .from("material_orders")
        .select("id")
        .eq("project_id", projectId)
        .eq("status", "received")
        .limit(1);
      if (!data?.length) {
        return { ok: false, reason: "No material orders marked received for this project." };
      }
      return { ok: true };
    }

    case "phase_closed": {
      if (!triggerReference) {
        return { ok: false, reason: "trigger_reference (phase_id) is not set for this milestone." };
      }
      const { data } = await supabase
        .from("project_phases")
        .select("status")
        .eq("id", triggerReference)
        .single();
      if (data?.status !== "complete") {
        return { ok: false, reason: `Phase has not been closed (status: ${data?.status ?? "unknown"}).` };
      }
      return { ok: true };
    }

    case "completion": {
      const { data } = await supabase
        .from("projects")
        .select("status")
        .eq("id", projectId)
        .single();
      if (data?.status !== "complete") {
        return { ok: false, reason: `Project is not yet complete (status: ${data?.status ?? "unknown"}).` };
      }
      return { ok: true };
    }

    default:
      return { ok: false, reason: `Unknown trigger type: ${triggerType as string}` };
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // Derive tenantId from JWT — never from request body.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: userRow } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("auth_id", user.id)
      .single();
    if (!userRow) return json({ error: "User not found" }, 403);

    const tenantId = (userRow as { tenant_id: string }).tenant_id;

    // ── Input ─────────────────────────────────────────────────────────────────
    const body = await req.json() as { payment_schedule_item_id?: string };
    const psiId = body.payment_schedule_item_id;
    if (!psiId) return json({ error: "payment_schedule_item_id required" }, 400);

    // ── Load PSI (tenant-scoped) ───────────────────────────────────────────────
    const { data: psi } = await supabase
      .from("payment_schedule_items")
      .select(`
        id, tenant_id, contract_id, milestone_name, trigger_type,
        trigger_reference, amount_cents, invoice_id, status
      `)
      .eq("id", psiId)
      .eq("tenant_id", tenantId)
      .single();

    if (!psi) return json({ error: "Payment schedule item not found" }, 404);

    // Idempotency: already invoiced
    if (psi.invoice_id) {
      return json({ invoice_id: psi.invoice_id, already_exists: true });
    }

    // ── Load contract ─────────────────────────────────────────────────────────
    const { data: contract } = await supabase
      .from("contracts")
      .select("id, customer_id, total_cents, signed_at")
      .eq("id", psi.contract_id)
      .eq("tenant_id", tenantId)
      .single();

    if (!contract) return json({ error: "Contract not found" }, 404);

    // ── Load project (via projects.contract_id) ───────────────────────────────
    const { data: project } = await supabase
      .from("projects")
      .select("id, name")
      .eq("contract_id", psi.contract_id)
      .eq("tenant_id", tenantId)
      .single();

    if (!project) return json({ error: "Project not found for this contract" }, 404);

    // ── Trigger verification (hard guard) ────────────────────────────────────
    const { ok, reason } = await verifyTrigger(
      psi.trigger_type as TriggerType,
      psi.trigger_reference as string | null,
      psi.contract_id as string,
      project.id,
    );
    if (!ok) {
      return json({ error: `Trigger not satisfied: ${reason}` }, 422);
    }

    // ── Create invoice ────────────────────────────────────────────────────────
    const amountDollars = (psi.amount_cents as number) / 100;

    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .insert({
        tenant_id:    tenantId,
        customer_id:  contract.customer_id,
        project_id:   project.id,
        contract_id:  psi.contract_id,
        status:       "draft",
        subtotal:     amountDollars,
        tax_amount:   0,
        total:        amountDollars,
        balance_due:  amountDollars,
        notes:        `${(project as { name: string }).name} — ${psi.milestone_name}`,
        ai_generated: false,
      })
      .select("id, invoice_number")
      .single();

    if (invErr || !invoice) {
      console.error("Invoice insert failed:", invErr);
      return json({ error: "Failed to create invoice" }, 500);
    }

    // Create line item
    await supabase.from("invoice_line_items").insert({
      invoice_id:  invoice.id,
      description: psi.milestone_name as string,
      quantity:    1,
      unit_price:  amountDollars,
      total:       amountDollars,
      taxable:     false, // construction: tax on labor varies by jurisdiction
      sort_order:  1,
    });

    // Update PSI status
    await supabase
      .from("payment_schedule_items")
      .update({ invoice_id: invoice.id, status: "invoiced" })
      .eq("id", psiId);

    // ── Queue in accounting outbox (if tenant has accounting target) ──────────
    const { data: tenant } = await supabase
      .from("tenants")
      .select("accounting_target")
      .eq("id", tenantId)
      .single();

    if ((tenant as { accounting_target: string | null } | null)?.accounting_target) {
      await supabase.from("accounting_outbox").upsert(
        {
          tenant_id:     tenantId,
          event_type:    "invoice_created",
          entity_type:   "invoice",
          entity_id:     (invoice as { id: string }).id,
          payload: {
            invoice_id:     invoice.id,
            invoice_number: (invoice as { invoice_number: string }).invoice_number,
            project_id:     project.id,
            project_name:   (project as { name: string }).name,
            milestone_name: psi.milestone_name,
            amount_cents:   psi.amount_cents,
            customer_id:    contract.customer_id,
            contract_id:    psi.contract_id,
          },
          target_system: (tenant as { accounting_target: string }).accounting_target,
          status:        "pending",
        },
        { onConflict: "tenant_id,entity_id,event_type,target_system", ignoreDuplicates: true },
      );
    }

    return json({
      invoice_id:     (invoice as { id: string }).id,
      invoice_number: (invoice as { invoice_number: string }).invoice_number,
    });
  } catch (err) {
    console.error("milestone-invoice error:", err);
    return json({ error: String(err) }, 500);
  }
});
