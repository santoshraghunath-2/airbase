// Operator Agent — natural language interface to live business data.
// Called from the browser with Supabase JWT auth (not pg_net).
// Read-only: no data is modified by this agent.

import { createClient } from "npm:@supabase/supabase-js@2";
import { loadAgentContext } from "../_shared/agent-base.ts";
import { runAgentLoop } from "../_shared/llm-router.ts";
import type { NormalisedTool } from "../_shared/llm-router.ts";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY")!;

const adminSupabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ─── Tools ────────────────────────────────────────────────────────────────────

const OPERATOR_TOOLS: NormalisedTool[] = [
  {
    name: "query_jobs",
    description: "Query jobs with optional filters. Returns a list of matching jobs.",
    input_schema: {
      type: "object",
      properties: {
        status:    { type: "string", description: "Filter by job status (e.g. unassigned, in_progress, completed)." },
        job_type:  { type: "string", description: "Filter by job type (e.g. drain_cleaning, water_heater_repair)." },
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
    name: "summarize_revenue",
    description: "Calculate total revenue and job count for a time period.",
    input_schema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["today", "yesterday", "this_week", "this_month", "last_30_days"],
          description: "The time period to summarize.",
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

// ─── Tool handlers ────────────────────────────────────────────────────────────

function dateRange(period: string): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case "today":       return { from: today.toISOString(), to: now.toISOString() };
    case "yesterday": {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      return { from: y.toISOString(), to: today.toISOString() };
    }
    case "this_week": {
      const w = new Date(today); w.setDate(w.getDate() - w.getDay());
      return { from: w.toISOString(), to: now.toISOString() };
    }
    case "this_month": {
      const m = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: m.toISOString(), to: now.toISOString() };
    }
    default: { // last_30_days
      const d = new Date(now); d.setDate(d.getDate() - 30);
      return { from: d.toISOString(), to: now.toISOString() };
    }
  }
}

function makeToolHandlers(tenantId: string) {
  return {
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
        const d = date === "today"
          ? new Date().toISOString().slice(0, 10)
          : date === "yesterday"
          ? new Date(Date.now() - 86400000).toISOString().slice(0, 10)
          : date;
        query = query.gte("scheduled_start", d + "T00:00:00").lte("scheduled_start", d + "T23:59:59");
      }

      const { data, error } = await query;
      if (error) return { error: error.message };

      const rows = (data ?? []).map((j: Record<string, unknown>) => ({
        id:             (j.id as string).slice(0, 8),
        type:           j.job_type,
        status:         j.status,
        priority:       j.priority,
        customer:       (j.customers as Record<string, string>)?.name ?? "—",
        tech:           (j.technicians as Record<string, string>)?.name ?? "Unassigned",
        scheduled:      j.scheduled_start
          ? new Date(j.scheduled_start as string).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
          : "Not scheduled",
      }));

      // Filter by tech name in JS (partial match)
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
      const total    = invoices.reduce((s: number, inv: Record<string, unknown>) => s + (Number(inv.total) || 0), 0);
      const paid     = invoices.filter((inv: Record<string, unknown>) => inv.status === "paid")
        .reduce((s: number, inv: Record<string, unknown>) => s + (Number(inv.total) || 0), 0);

      return {
        period,
        invoice_count: invoices.length,
        total_invoiced: `$${total.toFixed(2)}`,
        total_paid:     `$${paid.toFixed(2)}`,
        outstanding:    `$${(total - paid).toFixed(2)}`,
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
        const jobs = (todayJobs ?? []).filter((j: Record<string, unknown>) => j.tech_id === tech.id);
        const active = jobs.find((j: Record<string, unknown>) => j.status === "in_progress");
        return {
          name:        tech.name,
          jobs_today:  jobs.length,
          current_job: active
            ? `in_progress: ${(active.customers as Record<string, string>)?.name ?? "—"} (${active.job_type})`
            : jobs.length === 0 ? "available" : "available (has scheduled jobs)",
        };
      });
    },

    check_anomalies: async (_input: unknown) => {
      const now        = new Date();
      const fourHrsAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();
      const twoHrsOut  = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

      const [stuckRes, urgentRes, escalatedRes, overdueRes] = await Promise.all([
        // Jobs stuck in_progress for > 4 hours
        adminSupabase.from("jobs").select("id, job_type, actual_start, customers(name), technicians(name)")
          .eq("tenant_id", tenantId).eq("status", "in_progress")
          .lt("actual_start", fourHrsAgo).is("deleted_at", null),

        // High-priority unassigned jobs starting in < 2 hours
        adminSupabase.from("jobs").select("id, job_type, priority, scheduled_start, customers(name)")
          .eq("tenant_id", tenantId).eq("status", "unassigned")
          .in("priority", ["emergency", "high"])
          .lte("scheduled_start", twoHrsOut).gte("scheduled_start", now.toISOString()),

        // Escalated booking conversations
        adminSupabase.from("booking_conversations").select("phone, last_message_at")
          .eq("tenant_id", tenantId).eq("status", "escalated"),

        // Overdue invoices (sent > 30 days ago, not paid)
        adminSupabase.from("invoices").select("invoice_number, total")
          .eq("tenant_id", tenantId).eq("status", "overdue"),
      ]);

      const issues: string[] = [];

      for (const j of stuckRes.data ?? []) {
        const hours = Math.round((now.getTime() - new Date((j as Record<string, unknown>).actual_start as string).getTime()) / 3600000);
        const cust = ((j as Record<string, unknown>).customers as Record<string, string>)?.name ?? "—";
        const tech = ((j as Record<string, unknown>).technicians as Record<string, string>)?.name ?? "—";
        issues.push(`⚠️ ${tech} has been in_progress at ${cust} for ${hours}h — may need assistance`);
      }

      for (const j of urgentRes.data ?? []) {
        const cust = ((j as Record<string, unknown>).customers as Record<string, string>)?.name ?? "—";
        const start = new Date((j as Record<string, unknown>).scheduled_start as string)
          .toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
        issues.push(`🚨 ${(j as Record<string, unknown>).priority} unassigned job for ${cust} starts at ${start} — needs dispatch now`);
      }

      if ((escalatedRes.data?.length ?? 0) > 0) {
        issues.push(`📞 ${escalatedRes.data!.length} booking conversation${escalatedRes.data!.length > 1 ? "s" : ""} escalated and waiting for CSR response`);
      }

      if ((overdueRes.data?.length ?? 0) > 0) {
        const total = (overdueRes.data ?? []).reduce((s: number, inv: Record<string, unknown>) => s + (Number(inv.total) || 0), 0);
        issues.push(`💰 ${overdueRes.data!.length} overdue invoice${overdueRes.data!.length > 1 ? "s" : ""} totaling $${total.toFixed(2)}`);
      }

      return issues.length === 0
        ? { status: "all_clear", message: "No issues detected. Everything looks good." }
        : { status: "issues_found", count: issues.length, issues };
    },
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  // Validate Supabase JWT
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  // Resolve tenant from DB user record
  const { data: dbUser } = await adminSupabase
    .from("users")
    .select("tenant_id, role")
    .eq("auth_id", user.id)
    .single();

  if (!dbUser?.tenant_id) {
    return new Response(JSON.stringify({ error: "User has no tenant" }), { status: 403 });
  }

  const tenantId = dbUser.tenant_id as string;

  try {
    const { message, history = [] } = await req.json() as {
      message: string;
      history?: Array<{ role: string; content: string }>;
    };

    if (!message?.trim()) {
      return new Response(JSON.stringify({ error: "message is required" }), { status: 400 });
    }

    // Load agent config
    const ctx = await loadAgentContext(adminSupabase, tenantId, "operator");

    // Load company name
    const { data: tenant } = await adminSupabase
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .single();

    const systemPromptRaw = await Deno.readTextFile(
      new URL("../../prompts/operator-agent.md", import.meta.url),
    ).catch(() => null) ?? "You are a business operations assistant. Answer questions about jobs, customers, and revenue.";

    const systemPrompt = systemPromptRaw
      .replace("{{company_name}}", (tenant?.name as string) ?? "your company");

    // Format conversation history into the user message
    const historyBlock = history.length
      ? "RECENT CONVERSATION:\n" + history.map((h) => `[${h.role}]: ${h.content}`).join("\n") + "\n\n"
      : "";

    const now = new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });

    const userMessage = `Current date/time: ${now}\n\n${historyBlock}OPERATOR QUESTION:\n${message}`;

    const { finalText } = await runAgentLoop({
      systemPrompt,
      userMessage,
      tools:        OPERATOR_TOOLS,
      toolHandlers: makeToolHandlers(tenantId),
      model:        ctx.resolvedModelId,
      temperature:  0.3,
      maxTokens:    2048,
      maxIterations: 6,
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
