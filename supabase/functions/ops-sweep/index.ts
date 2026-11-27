// Ops Sweep — hourly check across all tenants for issues nobody reported.
// Triggered by pg_cron (see migration 066 for the SQL).
// Each check is a module function returning SweepFinding[].
// Results are upserted to sweep_findings; a daily digest goes to owner-role users.

import { createClient } from "npm:@supabase/supabase-js@2";
import { validateServiceRoleAuth } from "../_shared/agent-base.ts";
import { finalizeWithAuthority } from "../_shared/authority.ts";
import { loadAgentContext } from "../_shared/agent-base.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase     = createClient(SUPABASE_URL, SERVICE_KEY);

// ─── Types ────────────────────────────────────────────────────────────────────

interface SweepFinding {
  checkName:  string;
  entityType: string | null;
  entityId:   string | null;
  severity:   "critical" | "warning" | "info";
  summary:    string;
  actionType: string;
  actionPayload: Record<string, unknown>;
  amountCents?: number;
}

interface TenantRow { id: string; name: string; trade: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function minsAgo(n: number) {
  return new Date(Date.now() - n * 60 * 1000).toISOString();
}
function hoursAgo(n: number) {
  return new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
}

// ─── Individual checks ────────────────────────────────────────────────────────

async function checkLeadNoResponse(tenantId: string): Promise<SweepFinding[]> {
  const { data } = await supabase
    .from("opportunities")
    .select("id, source, created_at, customers(name)")
    .eq("tenant_id", tenantId)
    .eq("status", "new")
    .lt("created_at", minsAgo(5));

  return (data ?? []).map((opp: Record<string, unknown>) => ({
    checkName:   "lead_no_response",
    entityType:  "opportunity",
    entityId:    opp.id as string,
    severity:    "warning" as const,
    summary:     `Lead from ${(opp.customers as { name: string } | null)?.name ?? "unknown"} has not received a response in >5 minutes`,
    actionType:  "escalate",
    actionPayload: { reason: "lead_no_response", opportunity_id: opp.id },
  }));
}

async function checkConsultTomorrowUnconfirmed(tenantId: string): Promise<SweepFinding[]> {
  const tomorrow      = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStart = tomorrow.toISOString().slice(0, 10) + "T00:00:00";
  const tomorrowEnd   = tomorrow.toISOString().slice(0, 10) + "T23:59:59";

  const { data } = await supabase
    .from("jobs")
    .select("id, customers(name)")
    .eq("tenant_id", tenantId)
    .eq("job_type", "remodel_consultation")
    .eq("status", "scheduled")
    .gte("scheduled_start", tomorrowStart)
    .lte("scheduled_start", tomorrowEnd)
    .is("deleted_at", null);

  return (data ?? []).map((job: Record<string, unknown>) => ({
    checkName:   "consult_unconfirmed",
    entityType:  "job",
    entityId:    job.id as string,
    severity:    "warning" as const,
    summary:     `Consultation tomorrow for ${(job.customers as { name: string } | null)?.name ?? "customer"} not confirmed`,
    actionType:  "send_customer_message",
    actionPayload: { job_id: job.id, type: "confirmation" },
  }));
}

async function checkEstimateNoResponse(tenantId: string): Promise<SweepFinding[]> {
  const { data } = await supabase
    .from("estimates")
    .select("id, title, customers(name)")
    .eq("tenant_id", tenantId)
    .eq("status", "sent")
    .lt("created_at", hoursAgo(48));

  return (data ?? []).map((est: Record<string, unknown>) => ({
    checkName:   "estimate_no_response",
    entityType:  "estimate",
    entityId:    est.id as string,
    severity:    "warning" as const,
    summary:     `Estimate "${est.title}" sent >48h ago with no response from ${(est.customers as { name: string } | null)?.name ?? "customer"}`,
    actionType:  "send_customer_message",
    actionPayload: { estimate_id: est.id, type: "follow_up" },
  }));
}

async function checkContractNoDeposit(tenantId: string): Promise<SweepFinding[]> {
  const { data } = await supabase
    .from("contracts")
    .select("id, customers(name)")
    .eq("tenant_id", tenantId)
    .eq("status", "signed")
    .lt("signed_at", hoursAgo(24));

  return (data ?? []).map((c: Record<string, unknown>) => ({
    checkName:   "contract_no_deposit",
    entityType:  "contract",
    entityId:    c.id as string,
    severity:    "warning" as const,
    summary:     `Contract signed >24h ago but no deposit received from ${(c.customers as { name: string } | null)?.name ?? "customer"}`,
    actionType:  "send_customer_message",
    actionPayload: { contract_id: c.id, type: "deposit_reminder" },
  }));
}

async function checkProjectStartAtRisk(tenantId: string): Promise<SweepFinding[]> {
  const findings: SweepFinding[] = [];
  const { data: projects } = await supabase
    .from("projects")
    .select(`
      id, name, target_start,
      permits(status),
      material_orders(status, promised_date)
    `)
    .eq("tenant_id", tenantId)
    .in("status", ["pending_start", "scheduled"])
    .is("deleted_at", null);

  for (const p of projects ?? []) {
    const project = p as Record<string, unknown>;
    const targetStart = project.target_start as string | null;
    if (!targetStart) continue;

    const permits = (project.permits as { status: string }[] | null) ?? [];
    const orders  = (project.material_orders as { status: string; promised_date: string | null }[] | null) ?? [];

    const hasBlockingPermit = permits.some((pm) =>
      ["needs_review", "pending"].includes(pm.status)
    );
    const hasLateOrder = orders.some((mo) => {
      if (!mo.promised_date || mo.status === "received") return false;
      return new Date(mo.promised_date) >= new Date(targetStart);
    });

    if (hasBlockingPermit || hasLateOrder) {
      findings.push({
        checkName:   "project_start_at_risk",
        entityType:  "project",
        entityId:    project.id as string,
        severity:    "critical",
        summary:     `Project "${project.name}" start may be blocked by ${hasBlockingPermit ? "permit" : "material delivery"}`,
        actionType:  "escalate",
        actionPayload: { project_id: project.id, reason: "start_at_risk" },
      });
    }
  }

  return findings;
}

async function checkPhaseOverdue(tenantId: string): Promise<SweepFinding[]> {
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayEnd = yesterday.toISOString().slice(0, 10) + "T23:59:59";

  const { data } = await supabase
    .from("project_phases")
    .select("id, name, project_id, projects(name, tenant_id)")
    .eq("status", "in_progress")
    .lt("planned_end", yesterdayEnd);

  const findings: SweepFinding[] = [];
  for (const phase of data ?? []) {
    const ph = phase as Record<string, unknown>;
    const proj = ph.projects as Record<string, unknown> | null;
    if (!proj || proj.tenant_id !== tenantId) continue;

    findings.push({
      checkName:   "phase_overdue",
      entityType:  "project_phase",
      entityId:    ph.id as string,
      severity:    "warning",
      summary:     `Phase "${ph.name}" on project "${proj.name}" was due yesterday and is still in_progress`,
      actionType:  "escalate",
      actionPayload: { phase_id: ph.id, project_id: ph.project_id },
    });
  }
  return findings;
}

async function checkChangeOrderUnsigned(tenantId: string): Promise<SweepFinding[]> {
  const { data } = await supabase
    .from("change_orders")
    .select("id, title, amount_cents, project_id")
    .eq("tenant_id", tenantId)
    .eq("status", "sent")
    .lt("created_at", hoursAgo(24));

  return (data ?? []).map((co: Record<string, unknown>) => ({
    checkName:   "change_order_unsigned",
    entityType:  "change_order",
    entityId:    co.id as string,
    severity:    "warning" as const,
    summary:     `Change order "${co.title}" ($${((co.amount_cents as number) / 100).toFixed(0)}) sent >24h ago and still unsigned`,
    actionType:  "send_customer_message",
    actionPayload: { change_order_id: co.id, type: "signature_reminder" },
    amountCents: co.amount_cents as number,
  }));
}

async function checkInvoicePastDue(tenantId: string): Promise<SweepFinding[]> {
  const { data } = await supabase
    .from("invoices")
    .select("id, invoice_number, total")
    .eq("tenant_id", tenantId)
    .eq("status", "overdue");

  return (data ?? []).map((inv: Record<string, unknown>) => ({
    checkName:   "invoice_past_due",
    entityType:  "invoice",
    entityId:    inv.id as string,
    severity:    "warning" as const,
    summary:     `Invoice ${inv.invoice_number} is overdue ($${Number(inv.total).toFixed(2)})`,
    actionType:  "escalate",
    actionPayload: { invoice_id: inv.id },
  }));
}

async function checkApprovalWaiting(tenantId: string): Promise<SweepFinding[]> {
  const { data } = await supabase
    .from("agent_actions")
    .select("id, agent_type, proposed_action")
    .eq("tenant_id", tenantId)
    .eq("status", "proposed")
    .lt("created_at", hoursAgo(2));

  return (data ?? []).map((action: Record<string, unknown>) => ({
    checkName:   "approval_waiting",
    entityType:  "agent_action",
    entityId:    action.id as string,
    severity:    "info" as const,
    summary:     `Agent action from ${action.agent_type} has been awaiting approval for >2 hours`,
    actionType:  "escalate",
    actionPayload: { action_id: action.id },
  }));
}

// ─── All checks ───────────────────────────────────────────────────────────────

const ALL_CHECKS = [
  checkLeadNoResponse,
  checkConsultTomorrowUnconfirmed,
  checkEstimateNoResponse,
  checkContractNoDeposit,
  checkProjectStartAtRisk,
  checkPhaseOverdue,
  checkChangeOrderUnsigned,
  checkInvoicePastDue,
  checkApprovalWaiting,
];

// ─── Process findings for one tenant ─────────────────────────────────────────

async function processTenantFindings(tenant: TenantRow): Promise<void> {
  const tenantId = tenant.id;

  // Run all checks
  const allFindingsArrays = await Promise.all(ALL_CHECKS.map((fn) => fn(tenantId).catch(() => [])));
  const allFindings = allFindingsArrays.flat();

  if (allFindings.length === 0) return;

  // Upsert findings (no duplicates across runs)
  for (const finding of allFindings) {
    await supabase
      .from("sweep_findings")
      .upsert(
        {
          tenant_id:  tenantId,
          check_name: finding.checkName,
          entity_type: finding.entityType,
          entity_id:  finding.entityId,
          severity:   finding.severity,
          last_seen:  new Date().toISOString(),
          resolved_at: null,
        },
        { onConflict: "tenant_id,check_name,entity_id" },
      );
  }

  // Load agent config for ops_sweep
  const ctx = await loadAgentContext(supabase, tenantId, "ops_sweep");
  if (!ctx.config.enabled) return;

  const thresholds = (ctx.config.settings as Record<string, unknown>) ?? {};

  // For each finding, create an authority-gated action
  for (const finding of allFindings) {
    await finalizeWithAuthority(supabase, {
      tenantId,
      agentType:       "ops_sweep",
      triggerEvent:    "hourly_sweep",
      contextSnapshot: { check: finding.checkName, entity: finding.entityId, ...thresholds },
      reasoning:       finding.summary,
      proposedAction:  { ...finding.actionPayload, action_type: finding.actionType },
      confidence:      0.9,
      config:          ctx.config,
      modelUsed:       ctx.resolvedModelId,
      actionType:      finding.actionType,
      entityType:      finding.entityType ?? undefined,
      entityId:        finding.entityId ?? undefined,
      amountCents:     finding.amountCents,
      onAutoExecute: async () => {
        // Auto-execute: escalate critical findings to on-call
        if (finding.severity === "critical") {
          await supabase.functions.invoke("page-on-call", {
            body: {
              tenantId,
              reason:  finding.checkName,
              urgency: "urgent",
              summary: finding.summary,
            },
          });
        }
      },
    });
  }

  // Daily digest: push to owner-role users
  const critical = allFindings.filter((f) => f.severity === "critical");
  const warnings = allFindings.filter((f) => f.severity === "warning");
  if (critical.length + warnings.length === 0) return;

  const digestBody = `${critical.length} critical, ${warnings.length} warnings found in ops sweep.`;

  const { data: owners } = await supabase
    .from("users")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("role", "owner");

  for (const owner of owners ?? []) {
    const { data: tokens } = await supabase
      .from("device_tokens")
      .select("token, platform")
      .eq("user_id", (owner as { id: string }).id);

    if (tokens?.length) {
      await supabase.functions.invoke("push-notification", {
        body: {
          tokens,
          title: `${tenant.name} — Ops sweep`,
          body:  digestBody,
          data:  { type: "ops_sweep_digest" },
        },
      }).catch(() => {});
    }
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (!validateServiceRoleAuth(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const { data: tenants } = await supabase
      .from("tenants")
      .select("id, name, trade")
      .is("deleted_at", null);

    const results: { tenantId: string; ok: boolean; error?: string }[] = [];

    for (const tenant of tenants ?? []) {
      try {
        await processTenantFindings(tenant as TenantRow);
        results.push({ tenantId: (tenant as TenantRow).id, ok: true });
      } catch (err) {
        console.error(`ops-sweep error for tenant ${(tenant as TenantRow).id}:`, err);
        results.push({ tenantId: (tenant as TenantRow).id, ok: false, error: String(err) });
      }
    }

    return new Response(JSON.stringify({ swept: results.length, results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ops-sweep top-level error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
