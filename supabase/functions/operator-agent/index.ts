// Operator Agent — natural language interface to live business data + write actions.
// Called from the browser with Supabase JWT auth (not pg_net).
// Write actions flow through finalizeWithAuthority for tier-based execution.

import { createClient } from "npm:@supabase/supabase-js@2";
import { loadAgentContext } from "../_shared/agent-base.ts";
import { runAgentLoop } from "../_shared/llm-router.ts";
import { finalizeWithAuthority, resolveTier } from "../_shared/authority.ts";
import type { NormalisedTool } from "../_shared/llm-router.ts";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY")!;

const adminSupabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ─── Tool definitions ─────────────────────────────────────────────────────────

const READ_TOOLS: NormalisedTool[] = [
  {
    name: "query_jobs",
    description: "Query jobs with optional filters. Returns a list of matching jobs.",
    input_schema: {
      type: "object",
      properties: {
        status:    { type: "string", description: "Filter by job status (e.g. unassigned, in_progress, completed)." },
        job_type:  { type: "string", description: "Filter by job type." },
        date:      { type: "string", description: "Filter by scheduled date: 'today', 'yesterday', or YYYY-MM-DD." },
        tech_name: { type: "string", description: "Filter by partial technician name." },
        limit:     { type: "number", description: "Max results (default 20)." },
      },
    },
  },
  {
    name: "query_customers",
    description: "Search customers by name, phone, or email.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term (name, phone, or email)." },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "query_projects",
    description: "Query remodel projects with optional status filter.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by project status (e.g. in_progress, scheduled, punch_list)." },
        limit:  { type: "number" },
      },
    },
  },
  {
    name: "summarize_revenue",
    description: "Calculate total revenue and job count for a time period.",
    input_schema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["today", "yesterday", "this_week", "this_month", "last_30_days"],
        },
      },
      required: ["period"],
    },
  },
  {
    name: "query_technicians",
    description: "Load all active technicians and their current job load for today.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "check_anomalies",
    description: "Sweep for business issues that need operator attention right now.",
    input_schema: { type: "object", properties: {} },
  },
];

// Write tools — each passes through finalizeWithAuthority.
// Never-tier actions are NOT in this list (hiring, pay, signing contracts/permits, changing authority rules).
const WRITE_TOOLS: NormalisedTool[] = [
  {
    name: "reschedule_job",
    description: "Reschedule a job to a new date/time. State the reason in your reasoning.",
    input_schema: {
      type: "object",
      properties: {
        job_id:        { type: "string", description: "Job UUID (or first 8 chars)." },
        new_start:     { type: "string", description: "New scheduled start (ISO 8601)." },
        reason:        { type: "string", description: "Brief reason for the reschedule." },
        confidence:    { type: "number", description: "0–1 confidence this is the right action." },
      },
      required: ["job_id", "new_start", "reason", "confidence"],
    },
  },
  {
    name: "reassign_crew",
    description: "Reassign a job to a different technician.",
    input_schema: {
      type: "object",
      properties: {
        job_id:     { type: "string" },
        tech_id:    { type: "string", description: "Technician UUID to assign." },
        reason:     { type: "string" },
        confidence: { type: "number" },
      },
      required: ["job_id", "tech_id", "reason", "confidence"],
    },
  },
  {
    name: "create_change_order_draft",
    description: "Draft a change order for a project. Does not send to customer.",
    input_schema: {
      type: "object",
      properties: {
        project_id:  { type: "string" },
        title:       { type: "string" },
        description: { type: "string" },
        amount_cents: { type: "number", description: "Estimated amount in cents." },
        confidence:  { type: "number" },
      },
      required: ["project_id", "title", "description", "amount_cents", "confidence"],
    },
  },
  {
    name: "send_change_order",
    description: "Send a drafted change order to the customer for signature.",
    input_schema: {
      type: "object",
      properties: {
        change_order_id: { type: "string" },
        reason:          { type: "string" },
        confidence:      { type: "number" },
      },
      required: ["change_order_id", "reason", "confidence"],
    },
  },
  {
    name: "send_customer_message",
    description: "Send a message to a customer via the configured channel (Retell SMS). Obeys the contact window.",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        message:     { type: "string", description: "Message text to send." },
        reason:      { type: "string" },
        confidence:  { type: "number" },
      },
      required: ["customer_id", "message", "reason", "confidence"],
    },
  },
  {
    name: "send_staff_message",
    description: "Send a message to a staff member (push notification or SMS if staff SMS enabled).",
    input_schema: {
      type: "object",
      properties: {
        user_id:    { type: "string", description: "User UUID of the staff member." },
        message:    { type: "string" },
        reason:     { type: "string" },
        confidence: { type: "number" },
      },
      required: ["user_id", "message", "reason", "confidence"],
    },
  },
  {
    name: "place_material_order",
    description: "Place or update a material order for a project.",
    input_schema: {
      type: "object",
      properties: {
        project_id:   { type: "string" },
        vendor:       { type: "string" },
        description:  { type: "string" },
        amount_cents: { type: "number", description: "Total order amount in cents." },
        confidence:   { type: "number" },
      },
      required: ["project_id", "vendor", "description", "amount_cents", "confidence"],
    },
  },
  {
    name: "create_invoice_for_milestone",
    description: "Create a milestone invoice for a project payment schedule item. Returns not_available until Phase 5 is built.",
    input_schema: {
      type: "object",
      properties: {
        project_id:              { type: "string" },
        payment_schedule_item_id: { type: "string" },
        confidence:              { type: "number" },
      },
      required: ["project_id", "payment_schedule_item_id", "confidence"],
    },
  },
  {
    name: "update_opportunity_status",
    description: "Update the status of an opportunity.",
    input_schema: {
      type: "object",
      properties: {
        opportunity_id: { type: "string" },
        new_status:     { type: "string", description: "New status value." },
        reason:         { type: "string" },
        confidence:     { type: "number" },
      },
      required: ["opportunity_id", "new_status", "reason", "confidence"],
    },
  },
  {
    name: "book_consultation",
    description: "Book an in-home consultation for a customer.",
    input_schema: {
      type: "object",
      properties: {
        customer_id:  { type: "string" },
        slot_start:   { type: "string", description: "ISO 8601 start time." },
        notes:        { type: "string" },
        confidence:   { type: "number" },
      },
      required: ["customer_id", "slot_start", "confidence"],
    },
  },
  {
    name: "escalate",
    description: "Escalate a situation to the on-call person or owner.",
    input_schema: {
      type: "object",
      properties: {
        reason:   { type: "string" },
        urgency:  { type: "string", enum: ["normal", "urgent"], description: "normal or urgent." },
        summary:  { type: "string", description: "Two-sentence summary of the issue." },
        confidence: { type: "number" },
      },
      required: ["reason", "urgency", "summary", "confidence"],
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateRange(period: string): { from: string; to: string } {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case "today":       return { from: today.toISOString(), to: now.toISOString() };
    case "yesterday": { const y = new Date(today); y.setDate(y.getDate() - 1); return { from: y.toISOString(), to: today.toISOString() }; }
    case "this_week":  { const w = new Date(today); w.setDate(w.getDate() - w.getDay()); return { from: w.toISOString(), to: now.toISOString() }; }
    case "this_month": { const m = new Date(today.getFullYear(), today.getMonth(), 1); return { from: m.toISOString(), to: now.toISOString() }; }
    default: { const d = new Date(now); d.setDate(d.getDate() - 30); return { from: d.toISOString(), to: now.toISOString() }; }
  }
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

function makeToolHandlers(
  tenantId: string,
  actorUserId: string,
  ctx: Awaited<ReturnType<typeof loadAgentContext>>,
) {
  const baseAuthorityOpts = {
    tenantId,
    agentType:       "operator",
    triggerEvent:    "operator_chat",
    contextSnapshot: { actor: actorUserId },
    config:          ctx.config,
    modelUsed:       ctx.resolvedModelId,
    onAutoExecute:   async () => {},  // overridden per tool
  };

  // ── Read tools ──

  const readHandlers: Record<string, (input: unknown) => Promise<unknown>> = {

    query_jobs: async (input: unknown) => {
      const { status, job_type, date, tech_name, limit = 20 } =
        input as { status?: string; job_type?: string; date?: string; tech_name?: string; limit?: number };

      let query = adminSupabase
        .from("jobs")
        .select("id, job_type, status, priority, scheduled_start, description, customers(name), technicians(name)")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("scheduled_start", { ascending: false })
        .limit(limit);

      if (status)   query = query.eq("status", status);
      if (job_type) query = query.eq("job_type", job_type);
      if (date) {
        const d = date === "today" ? new Date().toISOString().slice(0, 10)
          : date === "yesterday" ? new Date(Date.now() - 86400000).toISOString().slice(0, 10)
          : date;
        query = query.gte("scheduled_start", d + "T00:00:00").lte("scheduled_start", d + "T23:59:59");
      }

      const { data, error } = await query;
      if (error) return { error: error.message };

      const rows = (data ?? []).map((j: Record<string, unknown>) => ({
        id:        (j.id as string).slice(0, 8),
        type:      j.job_type,
        status:    j.status,
        priority:  j.priority,
        customer:  (j.customers as { name: string } | null)?.name ?? "—",
        tech:      (j.technicians as { name: string } | null)?.name ?? "Unassigned",
        scheduled: j.scheduled_start
          ? new Date(j.scheduled_start as string).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
          : "Not scheduled",
      }));

      const filtered = tech_name
        ? rows.filter((r) => r.tech.toLowerCase().includes(tech_name.toLowerCase()))
        : rows;

      return { count: filtered.length, jobs: filtered };
    },

    query_customers: async (input: unknown) => {
      const { query, limit = 10 } = input as { query: string; limit?: number };
      const { data } = await adminSupabase
        .from("customers")
        .select("id, name, phone, email, created_at")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .or(`name.ilike.%${query}%,phone.ilike.%${query}%,email.ilike.%${query}%`)
        .limit(limit);
      return { count: data?.length ?? 0, customers: data ?? [] };
    },

    query_projects: async (input: unknown) => {
      const { status, limit = 20 } = input as { status?: string; limit?: number };
      let q = adminSupabase
        .from("projects")
        .select("id, name, status, target_start, target_completion, commitment_days, customers(name)")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (status) q = q.eq("status", status);
      const { data } = await q;
      return { count: data?.length ?? 0, projects: data ?? [] };
    },

    summarize_revenue: async (input: unknown) => {
      const { period } = input as { period: string };
      const { from, to } = dateRange(period);
      const { data } = await adminSupabase
        .from("invoices")
        .select("total, status")
        .eq("tenant_id", tenantId)
        .in("status", ["sent", "viewed", "paid", "partial"])
        .gte("created_at", from)
        .lte("created_at", to);

      const invoices = data ?? [];
      const total  = invoices.reduce((s: number, inv: Record<string, unknown>) => s + (Number(inv.total) || 0), 0);
      const paid   = invoices.filter((inv: Record<string, unknown>) => inv.status === "paid")
        .reduce((s: number, inv: Record<string, unknown>) => s + (Number(inv.total) || 0), 0);

      return {
        period,
        invoice_count:   invoices.length,
        total_invoiced:  `$${total.toFixed(2)}`,
        total_paid:      `$${paid.toFixed(2)}`,
        outstanding:     `$${(total - paid).toFixed(2)}`,
      };
    },

    query_technicians: async (_input: unknown) => {
      const dayStart = new Date().toISOString().slice(0, 10) + "T00:00:00";
      const dayEnd   = new Date().toISOString().slice(0, 10) + "T23:59:59";
      const [{ data: techs }, { data: todayJobs }] = await Promise.all([
        adminSupabase.from("technicians").select("id, name, is_active").eq("tenant_id", tenantId).eq("is_active", true),
        adminSupabase.from("jobs").select("tech_id, status, job_type, customers(name)")
          .eq("tenant_id", tenantId)
          .gte("scheduled_start", dayStart)
          .lte("scheduled_start", dayEnd)
          .not("status", "in", "(cancelled,no_show)"),
      ]);
      return (techs ?? []).map((tech: Record<string, unknown>) => {
        const jobs   = (todayJobs ?? []).filter((j: Record<string, unknown>) => j.tech_id === tech.id);
        const active = jobs.find((j: Record<string, unknown>) => j.status === "in_progress");
        return {
          name:        tech.name,
          jobs_today:  jobs.length,
          current_job: active
            ? `in_progress: ${(active.customers as { name: string } | null)?.name ?? "—"} (${active.job_type})`
            : jobs.length === 0 ? "available" : "available (has scheduled jobs)",
        };
      });
    },

    check_anomalies: async (_input: unknown) => {
      const now        = new Date();
      const fourHrsAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();
      const twoHrsOut  = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

      const [stuckRes, urgentRes, escalatedRes, overdueRes] = await Promise.all([
        adminSupabase.from("jobs").select("id, job_type, actual_start, customers(name), technicians(name)")
          .eq("tenant_id", tenantId).eq("status", "in_progress").lt("actual_start", fourHrsAgo).is("deleted_at", null),
        adminSupabase.from("jobs").select("id, job_type, priority, scheduled_start, customers(name)")
          .eq("tenant_id", tenantId).eq("status", "unassigned").in("priority", ["emergency", "high"])
          .lte("scheduled_start", twoHrsOut).gte("scheduled_start", now.toISOString()),
        adminSupabase.from("booking_conversations").select("phone, last_message_at")
          .eq("tenant_id", tenantId).eq("status", "escalated"),
        adminSupabase.from("invoices").select("invoice_number, total")
          .eq("tenant_id", tenantId).eq("status", "overdue"),
      ]);

      const issues: string[] = [];
      for (const j of stuckRes.data ?? []) {
        const hours = Math.round((now.getTime() - new Date((j as Record<string, unknown>).actual_start as string).getTime()) / 3600000);
        const cust  = ((j as Record<string, unknown>).customers as { name: string } | null)?.name ?? "—";
        const tech  = ((j as Record<string, unknown>).technicians as { name: string } | null)?.name ?? "—";
        issues.push(`⚠️ ${tech} has been in_progress at ${cust} for ${hours}h — may need assistance`);
      }
      for (const j of urgentRes.data ?? []) {
        const cust  = ((j as Record<string, unknown>).customers as { name: string } | null)?.name ?? "—";
        const start = new Date((j as Record<string, unknown>).scheduled_start as string)
          .toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
        issues.push(`🚨 ${(j as Record<string, unknown>).priority} unassigned job for ${cust} starts at ${start} — needs dispatch now`);
      }
      if ((escalatedRes.data?.length ?? 0) > 0)
        issues.push(`📞 ${escalatedRes.data!.length} booking conversation(s) escalated`);
      if ((overdueRes.data?.length ?? 0) > 0) {
        const total = (overdueRes.data ?? []).reduce((s: number, inv: Record<string, unknown>) => s + (Number(inv.total) || 0), 0);
        issues.push(`💰 ${overdueRes.data!.length} overdue invoice(s) totaling $${total.toFixed(2)}`);
      }

      return issues.length === 0
        ? { status: "all_clear", message: "No issues detected." }
        : { status: "issues_found", count: issues.length, issues };
    },
  };

  // ── Write tools ──

  const writeHandlers: Record<string, (input: unknown) => Promise<unknown>> = {

    reschedule_job: async (input: unknown) => {
      const { job_id, new_start, reason, confidence } =
        input as { job_id: string; new_start: string; reason: string; confidence: number };

      const { data: job } = await adminSupabase.from("jobs").select("id, scheduled_start, tenant_id")
        .or(`id.eq.${job_id},id.ilike.${job_id}%`).eq("tenant_id", tenantId).single();
      if (!job) return { error: "Job not found" };

      const result = await finalizeWithAuthority(adminSupabase, {
        ...baseAuthorityOpts,
        reasoning:         `Reschedule job ${job_id} from ${(job as Record<string, unknown>).scheduled_start} to ${new_start}: ${reason}`,
        proposedAction:    { type: "reschedule_job", job_id, new_start, old_start: (job as Record<string, unknown>).scheduled_start },
        confidence,
        actionType:        "reschedule_job",
        entityType:        "job",
        entityId:          (job as { id: string }).id,
        reversalDescription: { action: "reschedule_job", to: (job as Record<string, unknown>).scheduled_start },
        onAutoExecute: async () => {
          await adminSupabase.from("jobs").update({ scheduled_start: new_start }).eq("id", (job as { id: string }).id);
        },
      });

      return result.refused
        ? { error: "Action refused by authority rules (never tier)" }
        : { success: true, tier: result.tier, auto_executed: result.autoExecuted, action_id: result.actionId };
    },

    reassign_crew: async (input: unknown) => {
      const { job_id, tech_id, reason, confidence } =
        input as { job_id: string; tech_id: string; reason: string; confidence: number };

      const { data: job } = await adminSupabase.from("jobs").select("id, tech_id")
        .or(`id.eq.${job_id},id.ilike.${job_id}%`).eq("tenant_id", tenantId).single();
      if (!job) return { error: "Job not found" };

      const { data: tech } = await adminSupabase.from("technicians").select("id, name")
        .eq("id", tech_id).eq("tenant_id", tenantId).single();
      if (!tech) return { error: "Technician not found" };

      const result = await finalizeWithAuthority(adminSupabase, {
        ...baseAuthorityOpts,
        reasoning:        `Reassign job ${job_id} to tech ${(tech as { name: string }).name}: ${reason}`,
        proposedAction:   { type: "reassign_crew", job_id, tech_id, old_tech_id: (job as Record<string, unknown>).tech_id },
        confidence,
        actionType:       "reassign_crew",
        entityType:       "job",
        entityId:         (job as { id: string }).id,
        reversalDescription: { action: "reassign_crew", to: (job as Record<string, unknown>).tech_id },
        onAutoExecute: async () => {
          await adminSupabase.from("jobs").update({ tech_id }).eq("id", (job as { id: string }).id);
        },
      });

      return result.refused
        ? { error: "Refused" }
        : { success: true, tier: result.tier, auto_executed: result.autoExecuted };
    },

    create_change_order_draft: async (input: unknown) => {
      const { project_id, title, description, amount_cents, confidence } =
        input as { project_id: string; title: string; description: string; amount_cents: number; confidence: number };

      const result = await finalizeWithAuthority(adminSupabase, {
        ...baseAuthorityOpts,
        reasoning:        `Create change order draft for project ${project_id}: ${title} ($${(amount_cents / 100).toFixed(0)})`,
        proposedAction:   { type: "create_change_order_draft", project_id, title, amount_cents },
        confidence,
        actionType:       "create_change_order_draft",
        entityType:       "project",
        entityId:         project_id,
        amountCents:      amount_cents,
        onAutoExecute: async () => {
          await adminSupabase.from("change_orders").insert({
            tenant_id:   tenantId,
            project_id,
            title,
            description,
            amount_cents,
            status:      "draft",
            reported_by: actorUserId,
          });
        },
      });

      return result.refused
        ? { error: "Refused" }
        : { success: true, tier: result.tier, auto_executed: result.autoExecuted };
    },

    send_change_order: async (input: unknown) => {
      const { change_order_id, reason, confidence } =
        input as { change_order_id: string; reason: string; confidence: number };

      const { data: co } = await adminSupabase.from("change_orders")
        .select("id, amount_cents, status").eq("id", change_order_id).eq("tenant_id", tenantId).single();
      if (!co) return { error: "Change order not found" };
      if ((co as Record<string, unknown>).status !== "draft") return { error: "Change order is not in draft status" };

      const result = await finalizeWithAuthority(adminSupabase, {
        ...baseAuthorityOpts,
        reasoning:        `Send change order ${change_order_id} to customer: ${reason}`,
        proposedAction:   { type: "send_change_order", change_order_id },
        confidence,
        actionType:       "send_change_order",
        entityType:       "change_order",
        entityId:         change_order_id,
        amountCents:      (co as Record<string, unknown>).amount_cents as number,
        onAutoExecute: async () => {
          await adminSupabase.from("change_orders").update({ status: "sent" }).eq("id", change_order_id);
        },
      });

      return result.refused
        ? { error: "Refused" }
        : { success: true, tier: result.tier, auto_executed: result.autoExecuted };
    },

    send_customer_message: async (input: unknown) => {
      const { customer_id, message, reason, confidence } =
        input as { customer_id: string; message: string; reason: string; confidence: number };

      const { data: customer } = await adminSupabase.from("customers")
        .select("id, name, phone").eq("id", customer_id).eq("tenant_id", tenantId).single();
      if (!customer) return { error: "Customer not found" };

      const result = await finalizeWithAuthority(adminSupabase, {
        ...baseAuthorityOpts,
        reasoning:        `Send message to ${(customer as { name: string }).name}: "${message}" — ${reason}`,
        proposedAction:   { type: "send_customer_message", customer_id, message },
        confidence,
        actionType:       "send_customer_message",
        entityType:       "customer",
        entityId:         customer_id,
        onAutoExecute: async () => {
          await adminSupabase.functions.invoke("retell-send", {
            body: {
              tenantId,
              to:      (customer as Record<string, unknown>).phone,
              message,
              channel: "sms",
            },
          });
        },
      });

      return result.refused
        ? { error: "Refused" }
        : { success: true, tier: result.tier, auto_executed: result.autoExecuted };
    },

    send_staff_message: async (input: unknown) => {
      const { user_id, message, reason, confidence } =
        input as { user_id: string; message: string; reason: string; confidence: number };

      const { data: staffUser } = await adminSupabase.from("users")
        .select("id, name").eq("id", user_id).eq("tenant_id", tenantId).single();
      if (!staffUser) return { error: "Staff member not found" };

      const result = await finalizeWithAuthority(adminSupabase, {
        ...baseAuthorityOpts,
        reasoning:        `Send staff message to ${(staffUser as { name: string }).name}: "${message}" — ${reason}`,
        proposedAction:   { type: "send_staff_message", user_id, message },
        confidence,
        actionType:       "send_staff_message",
        entityType:       "user",
        entityId:         user_id,
        onAutoExecute: async () => {
          const { data: tokens } = await adminSupabase.from("device_tokens")
            .select("token, platform").eq("user_id", user_id);
          if (tokens?.length) {
            await adminSupabase.functions.invoke("push-notification", {
              body: { tokens, title: "Message from operator", body: message },
            });
          }
        },
      });

      return result.refused
        ? { error: "Refused" }
        : { success: true, tier: result.tier, auto_executed: result.autoExecuted };
    },

    place_material_order: async (input: unknown) => {
      const { project_id, vendor, description, amount_cents, confidence } =
        input as { project_id: string; vendor: string; description: string; amount_cents: number; confidence: number };

      const result = await finalizeWithAuthority(adminSupabase, {
        ...baseAuthorityOpts,
        reasoning:        `Place material order for project ${project_id}: ${description} from ${vendor} ($${(amount_cents / 100).toFixed(0)})`,
        proposedAction:   { type: "place_material_order", project_id, vendor, amount_cents },
        confidence,
        actionType:       "place_material_order",
        entityType:       "project",
        entityId:         project_id,
        amountCents:      amount_cents,
        onAutoExecute: async () => {
          await adminSupabase.from("material_orders").insert({
            tenant_id:      tenantId,
            project_id,
            vendor,
            status:         "ordered",
            total_cost_cents: amount_cents,
            ordered_at:     new Date().toISOString(),
          });
        },
      });

      return result.refused
        ? { error: "Refused" }
        : { success: true, tier: result.tier, auto_executed: result.autoExecuted };
    },

    create_invoice_for_milestone: async (_input: unknown) => {
      return { error: "not_available", message: "Milestone invoicing is built in Phase 5." };
    },

    update_opportunity_status: async (input: unknown) => {
      const { opportunity_id, new_status, reason, confidence } =
        input as { opportunity_id: string; new_status: string; reason: string; confidence: number };

      const { data: opp } = await adminSupabase.from("opportunities")
        .select("id, status").eq("id", opportunity_id).eq("tenant_id", tenantId).single();
      if (!opp) return { error: "Opportunity not found" };

      const result = await finalizeWithAuthority(adminSupabase, {
        ...baseAuthorityOpts,
        reasoning:        `Update opportunity ${opportunity_id} from ${(opp as Record<string, unknown>).status} to ${new_status}: ${reason}`,
        proposedAction:   { type: "update_opportunity_status", opportunity_id, new_status },
        confidence,
        actionType:       "update_opportunity_status",
        entityType:       "opportunity",
        entityId:         opportunity_id,
        reversalDescription: { action: "update_opportunity_status", to: (opp as Record<string, unknown>).status },
        onAutoExecute: async () => {
          await adminSupabase.from("opportunities").update({ status: new_status }).eq("id", opportunity_id);
        },
      });

      return result.refused
        ? { error: "Refused" }
        : { success: true, tier: result.tier, auto_executed: result.autoExecuted };
    },

    book_consultation: async (input: unknown) => {
      const { customer_id, slot_start, notes, confidence } =
        input as { customer_id: string; slot_start: string; notes?: string; confidence: number };

      const { data: customer } = await adminSupabase.from("customers")
        .select("id, name").eq("id", customer_id).eq("tenant_id", tenantId).single();
      if (!customer) return { error: "Customer not found" };

      const result = await finalizeWithAuthority(adminSupabase, {
        ...baseAuthorityOpts,
        reasoning:        `Book consultation for ${(customer as { name: string }).name} at ${slot_start}`,
        proposedAction:   { type: "book_consultation", customer_id, slot_start, notes },
        confidence,
        actionType:       "book_consultation",
        entityType:       "customer",
        entityId:         customer_id,
        onAutoExecute: async () => {
          await adminSupabase.from("jobs").insert({
            tenant_id:       tenantId,
            customer_id,
            job_type:        "remodel_consultation",
            status:          "scheduled",
            scheduled_start: slot_start,
            description:     notes ?? "Consultation booked by operator agent",
          });
        },
      });

      return result.refused
        ? { error: "Refused" }
        : { success: true, tier: result.tier, auto_executed: result.autoExecuted };
    },

    escalate: async (input: unknown) => {
      const { reason, urgency, summary, confidence } =
        input as { reason: string; urgency: string; summary: string; confidence: number };

      const result = await finalizeWithAuthority(adminSupabase, {
        ...baseAuthorityOpts,
        reasoning:        `Escalate (${urgency}): ${reason} — ${summary}`,
        proposedAction:   { type: "escalate", reason, urgency, summary },
        confidence,
        actionType:       "escalate",
        onAutoExecute: async () => {
          await adminSupabase.functions.invoke("page-on-call", {
            body: { tenantId, reason, urgency, summary },
          });
        },
      });

      return result.refused
        ? { error: "Refused" }
        : { success: true, tier: result.tier, auto_executed: result.autoExecuted };
    },
  };

  return { ...readHandlers, ...writeHandlers };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { data: dbUser } = await adminSupabase
    .from("users")
    .select("id, tenant_id, role")
    .eq("auth_id", user.id)
    .single();

  if (!dbUser?.tenant_id) {
    return new Response(JSON.stringify({ error: "User has no tenant" }), { status: 403 });
  }

  const tenantId    = dbUser.tenant_id as string;
  const actorUserId = dbUser.id as string;

  try {
    const { message, history = [], allow_write = false } = await req.json() as {
      message: string;
      history?: Array<{ role: string; content: string }>;
      allow_write?: boolean;
    };

    if (!message?.trim()) {
      return new Response(JSON.stringify({ error: "message is required" }), { status: 400 });
    }

    // Load agent config and tenant
    const ctx = await loadAgentContext(adminSupabase, tenantId, "operator");
    if (!ctx.config.enabled) {
      return new Response(JSON.stringify({ error: "Operator agent is disabled" }), { status: 503 });
    }

    const { data: tenant } = await adminSupabase.from("tenants")
      .select("name, trade").eq("id", tenantId).single();

    const systemPromptRaw = await Deno.readTextFile(
      new URL("../../prompts/operator-agent.md", import.meta.url),
    ).catch(() => null) ?? "You are a business operations assistant.";

    const systemPrompt = systemPromptRaw
      .replace("{{company_name}}", (tenant?.name as string) ?? "your company");

    const historyBlock = history.length
      ? "RECENT CONVERSATION:\n" + history.map((h) => `[${h.role}]: ${h.content}`).join("\n") + "\n\n"
      : "";

    const now = new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });

    const userMessage = `Current date/time: ${now}\n\n${historyBlock}OPERATOR QUESTION:\n${message}`;

    // Write tools available only when explicitly requested (or for remodel tenants by default)
    const isRemodel = (tenant?.trade as string) === "remodel";
    const tools = allow_write || isRemodel
      ? [...READ_TOOLS, ...WRITE_TOOLS]
      : READ_TOOLS;

    const { finalText } = await runAgentLoop({
      systemPrompt,
      userMessage,
      tools,
      toolHandlers: makeToolHandlers(tenantId, actorUserId, ctx),
      model:         ctx.resolvedModelId,
      temperature:   0.3,
      maxTokens:     2048,
      maxIterations: 8,
    });

    return new Response(
      JSON.stringify({ answer: finalText.trim() }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("operator-agent error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
