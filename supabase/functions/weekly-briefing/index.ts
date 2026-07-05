// weekly-briefing — generates an AI business briefing for each active tenant.
//
// Called two ways:
//   1. Scheduled (GitHub Actions Monday 7am UTC):
//      POST {} with Authorization: Bearer <SERVICE_ROLE_KEY>
//      → processes all active tenants
//   2. Manual (operator "Generate" button):
//      POST {} with Authorization: Bearer <user JWT>
//      → processes only the calling user's tenant, returns the new briefing

import { createClient } from "npm:@supabase/supabase-js@2";
import { callAgent } from "../_shared/llm-router.ts";

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

const BRIEFING_TOOL = {
  name: "submit_briefing",
  description: "Submit the structured weekly briefing",
  input_schema: {
    type: "object" as const,
    properties: {
      headline:       { type: "string",                description: "One-sentence headline for the week" },
      highlights:     { type: "array", items: { type: "string" }, description: "2-3 positive highlights" },
      watch_items:    { type: "array", items: { type: "string" }, description: "0-2 items needing attention" },
      recommendation: { type: "string",                description: "One actionable recommendation" },
    },
    required: ["headline", "highlights", "watch_items", "recommendation"],
  },
};

const SYSTEM_PROMPT = `You are a business intelligence assistant for a home services company. You receive one week of operational metrics and produce a concise, plain-English briefing for the owner.

Call the submit_briefing tool with:
1. headline — One sentence. The single most important thing this week. Use a number. Be specific.
2. highlights — 2–3 bullets. What went well. Specific numbers. Mention top tech by name if provided.
3. watch_items — 0–2 bullets. Only flag if genuinely concerning (callbacks >12%, overdue >$2k, big revenue drop). Return [] if nothing concerning.
4. recommendation — One actionable sentence grounded in the data.

Rules: No filler. No hedging. No invented data. Plain English. Keep highlights under 15 words each.`;

async function collectMetrics(tenantId: string) {
  const now = new Date();
  const weekEnd = now;
  const weekStart = new Date(now); weekStart.setDate(weekStart.getDate() - 7);
  const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const next7Days = new Date(now); next7Days.setDate(next7Days.getDate() + 7);

  const [
    jobsThisWeekRes, jobsPrevWeekRes, revenueThisRes, revenuePrevRes,
    callbackRes, newCustRes, overdueRes, expiringRes, scheduledRes,
  ] = await Promise.all([
    serviceClient.from("jobs")
      .select("tech_id, technicians(name)")
      .eq("tenant_id", tenantId).in("status", ["completed", "invoiced"])
      .gte("updated_at", weekStart.toISOString()).is("deleted_at", null),

    serviceClient.from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).in("status", ["completed", "invoiced"])
      .gte("updated_at", prevWeekStart.toISOString()).lt("updated_at", weekStart.toISOString())
      .is("deleted_at", null),

    serviceClient.from("invoices").select("total")
      .eq("tenant_id", tenantId).eq("status", "paid")
      .gte("paid_at", weekStart.toISOString()),

    serviceClient.from("invoices").select("total")
      .eq("tenant_id", tenantId).eq("status", "paid")
      .gte("paid_at", prevWeekStart.toISOString()).lt("paid_at", weekStart.toISOString()),

    serviceClient.from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("visit_reason", "callback")
      .gte("created_at", weekStart.toISOString()).is("deleted_at", null),

    serviceClient.from("customers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).gte("created_at", weekStart.toISOString()).is("deleted_at", null),

    serviceClient.from("invoices").select("balance_due")
      .eq("tenant_id", tenantId).in("status", ["overdue", "sent", "partial"])
      .lt("due_date", now.toISOString()),

    serviceClient.from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("status", "active")
      .gte("expires_at", now.toISOString()).lte("expires_at", next7Days.toISOString()),

    serviceClient.from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("scheduled_start", now.toISOString()).lte("scheduled_start", next7Days.toISOString())
      .not("status", "in", "(cancelled,no_show)").is("deleted_at", null),
  ]);

  const jobsCompleted = (jobsThisWeekRes.data ?? []).length;
  const jobsPrevWeek  = jobsPrevWeekRes.count ?? 0;
  const revenue       = (revenueThisRes.data ?? []).reduce((s, i) => s + (Number(i.total) || 0), 0);
  const revenuePrev   = (revenuePrevRes.data ?? []).reduce((s, i) => s + (Number(i.total) || 0), 0);
  const callbacks     = callbackRes.count ?? 0;
  const newCustomers  = newCustRes.count ?? 0;
  const overdueTotal  = (overdueRes.data ?? []).reduce((s, i) => s + (Number(i.balance_due) || 0), 0);
  const overdueCount  = overdueRes.data?.length ?? 0;
  const expiringMemberships = expiringRes.count ?? 0;
  const scheduledNextWeek   = scheduledRes.count ?? 0;
  const callbackRate  = jobsCompleted > 0 ? Math.round((callbacks / jobsCompleted) * 100) : 0;

  // Top tech by completed jobs
  const techMap = new Map<string, { name: string; count: number }>();
  for (const j of (jobsThisWeekRes.data ?? [])) {
    const techName = (j.technicians as { name: string } | null)?.name;
    if (j.tech_id && techName) {
      const prev = techMap.get(j.tech_id) ?? { name: techName, count: 0 };
      techMap.set(j.tech_id, { ...prev, count: prev.count + 1 });
    }
  }
  const topTech = [...techMap.values()].sort((a, b) => b.count - a.count)[0] ?? null;

  return {
    period_start: weekStart.toISOString().split("T")[0],
    period_end:   weekEnd.toISOString().split("T")[0],
    metrics: {
      jobs_completed:        jobsCompleted,
      jobs_prev_week:        jobsPrevWeek,
      revenue,
      revenue_prev_week:     revenuePrev,
      new_customers:         newCustomers,
      callbacks,
      callback_rate_pct:     callbackRate,
      overdue_invoices_count: overdueCount,
      overdue_invoices_total: overdueTotal,
      memberships_expiring:  expiringMemberships,
      jobs_scheduled_next_7: scheduledNextWeek,
      top_tech_name:         topTech?.name ?? null,
      top_tech_jobs:         topTech?.count ?? null,
    },
  };
}

function buildUserMessage(tenantName: string, metrics: ReturnType<typeof collectMetrics> extends Promise<infer T> ? T : never["metrics"], periodStart: string) {
  const fmt = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;
  const pct = (a: number, b: number) => b === 0 ? "N/A" : `${Math.round(((a - b) / b) * 100)}%`;

  return `Weekly metrics for ${tenantName} — week of ${periodStart}:

Jobs completed: ${metrics.jobs_completed} (prior week: ${metrics.jobs_prev_week}, change: ${pct(metrics.jobs_completed, metrics.jobs_prev_week)})
Revenue collected: ${fmt(metrics.revenue)} (prior week: ${fmt(metrics.revenue_prev_week)}, change: ${pct(metrics.revenue, metrics.revenue_prev_week)})
New customers: ${metrics.new_customers}
Callback jobs: ${metrics.callbacks}${metrics.jobs_completed > 0 ? ` (${metrics.callback_rate_pct}% rate)` : ""}
Overdue invoices: ${metrics.overdue_invoices_count} totaling ${fmt(metrics.overdue_invoices_total)}
Memberships expiring next 7 days: ${metrics.memberships_expiring}
Jobs on the board next week: ${metrics.jobs_scheduled_next_7}${metrics.top_tech_name ? `\nTop tech by jobs: ${metrics.top_tech_name} with ${metrics.top_tech_jobs} jobs` : ""}

Generate the weekly business briefing now.`;
}

async function generateBriefing(tenantId: string, tenantName: string, tenantModelId?: string) {
  const { period_start, period_end, metrics } = await collectMetrics(tenantId);

  // Skip tenants with no activity in the past 30 days (check: no completed jobs this week or recent)
  if (metrics.jobs_completed === 0 && metrics.revenue === 0) {
    return null;
  }

  const userMessage = buildUserMessage(tenantName, metrics, period_start);

  const result = await callAgent({
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    tools: [BRIEFING_TOOL],
    temperature: 0.7,
    maxTokens: 512,
    tenantModelId,
  });

  const toolCall = result.toolUses?.find((t: { name: string }) => t.name === "submit_briefing");
  if (!toolCall?.input) {
    console.error("weekly-briefing: LLM did not call submit_briefing tool");
    return null;
  }

  type BriefingInput = { headline: string; highlights: string[]; watch_items: string[]; recommendation: string };
  const input = toolCall.input as BriefingInput;

  const { error } = await serviceClient.from("briefings").insert({
    tenant_id:        tenantId,
    period_start,
    period_end,
    headline:         input.headline,
    highlights:       input.highlights,
    watch_items:      input.watch_items,
    recommendation:   input.recommendation,
    metrics_snapshot: metrics,
    model_used:       result.modelUsed ?? null,
  });

  if (error) throw error;

  return { period_start, period_end, headline: input.headline, highlights: input.highlights, watch_items: input.watch_items, recommendation: input.recommendation, metrics_snapshot: metrics };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const isServiceRole = jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (isServiceRole) {
      // Scheduled run — process all active tenants
      const { data: tenants } = await serviceClient
        .from("tenants")
        .select("id, name, default_model_id")
        .in("subscription_status", ["trialing", "active"]);

      let generated = 0, skipped = 0;
      for (const t of tenants ?? []) {
        try {
          const briefing = await generateBriefing(
            t.id, t.name,
            (t as { default_model_id?: string }).default_model_id,
          );
          if (briefing) generated++; else skipped++;
        } catch (err) {
          console.error(`weekly-briefing: error for tenant ${t.id}:`, err);
          skipped++;
        }
      }

      return json({ generated, skipped });
    }

    // Manual run — user JWT, single tenant
    const { data: { user }, error: authError } = await serviceClient.auth.getUser(jwt);
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: userRow } = await serviceClient
      .from("users")
      .select("tenant_id")
      .eq("auth_id", user.id)
      .single();
    if (!userRow) return json({ error: "User not found" }, 404);

    const tenantId = (userRow as { tenant_id: string }).tenant_id;
    const { data: tenant } = await serviceClient
      .from("tenants")
      .select("name, default_model_id")
      .eq("id", tenantId)
      .single();
    if (!tenant) return json({ error: "Tenant not found" }, 404);

    const t = tenant as { name: string; default_model_id?: string };
    const briefing = await generateBriefing(tenantId, t.name, t.default_model_id);
    if (!briefing) return json({ briefing: null, reason: "No activity to summarize" });

    return json({ briefing });
  } catch (e) {
    console.error("weekly-briefing error:", e);
    return json({ error: String(e) }, 500);
  }
});
