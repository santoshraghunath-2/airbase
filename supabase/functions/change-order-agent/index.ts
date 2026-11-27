// change-order-agent — drafts a change order when crew reports a hidden condition.
//
// Triggered by a crew member (via tech app) with photos and a note.
// Looks up matching pricebook items. If found, drafts lines and total.
// If nothing matches, sets status=needs_pricing and notifies the office.
// Jobs for the extra work cannot be scheduled until the change order is signed.
// A signed change order updates the contract total and adds a payment_schedule_items row.
//
// POST { project_id, description, photo_urls, reported_by_user_id? }
// Authorization: Bearer <user JWT>

import { createClient } from "npm:@supabase/supabase-js@2";
import { callAgent } from "../_shared/llm-router.ts";
import { loadAgentContext, finalizeAction } from "../_shared/agent-base.ts";
import type { NormalisedTool } from "../_shared/llm-router.ts";

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

// ─── Tool ─────────────────────────────────────────────────────────────────────

const DRAFT_CHANGE_ORDER_TOOL: NormalisedTool = {
  name: "draft_change_order",
  description: "Draft a change order for the hidden condition, selecting matching pricebook items.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short title for the change order." },
      lines: {
        type: "array",
        description: "Priced lines for the extra work.",
        items: {
          type: "object",
          properties: {
            pricebook_item_id: { type: "string", description: "UUID of matching pricebook item, or null if no match." },
            description:       { type: "string" },
            quantity:          { type: "number" },
            unit_price_cents:  { type: "number" },
          },
          required: ["description", "quantity", "unit_price_cents"],
        },
      },
      has_pricebook_match: { type: "boolean", description: "true if all lines have a pricebook match." },
      confidence:          { type: "number",  description: "0-1" },
      reasoning:           { type: "string" },
      operator_rationale:  { type: "string",  description: "2-3 sentences for the office." },
    },
    required: ["title", "lines", "has_pricebook_match", "confidence", "reasoning", "operator_rationale"],
  },
};

// ─── Handler ──────────────────────────────────────────────────────────────────

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

    const tenantId     = (userRow as { tenant_id: string }).tenant_id;
    const reportedById = (userRow as { id: string }).id;

    // ── Input ─────────────────────────────────────────────────────────────────
    const body = await req.json() as {
      project_id?: string;
      description?: string;
      photo_urls?: string[];
    };
    const { project_id: projectId, description, photo_urls: photoUrls = [] } = body;
    if (!projectId || !description) return json({ error: "project_id and description required" }, 400);

    // ── Load project + contract ───────────────────────────────────────────────
    const { data: project } = await serviceClient
      .from("projects")
      .select("id, tenant_id, contract_id, name, customer_id, customers(name)")
      .eq("id", projectId)
      .eq("tenant_id", tenantId)
      .single();

    if (!project) return json({ error: "Project not found" }, 404);

    const contractId = project.contract_id as string | null;
    if (!contractId) return json({ error: "Project has no contract" }, 400);

    // ── Load pricebook for context ────────────────────────────────────────────
    const { data: pricebook } = await serviceClient
      .from("pricebook_items")
      .select("id, name, description, unit_price_cents, category")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .limit(50);

    // ── Agent config ──────────────────────────────────────────────────────────
    const ctx = await loadAgentContext(serviceClient, tenantId, "dispatch");

    const pricebookText = (pricebook ?? [])
      .map((p) => `  ${p.id} | ${p.name} | $${((p as { unit_price_cents: number }).unit_price_cents / 100).toFixed(0)} | ${p.category}`)
      .join("\n");

    const systemPrompt =
      `You are a change order drafting agent for ${(project as { name: string }).name ?? "a remodel project"}.\n` +
      `Your job is to draft a priced change order from a crew report of a hidden condition.\n` +
      `Match each item of work to a pricebook item when possible. If no match exists, set pricebook_item_id to null.\n` +
      `Be concise and accurate. If you are uncertain about pricing, set confidence below 0.6 and flag needs_pricing.`;

    const userMessage =
      `HIDDEN CONDITION REPORT\n\n` +
      `Project: ${(project as { name: string }).name}\n` +
      `Reported by: technician\n` +
      `Description: ${description}\n` +
      `Photos: ${photoUrls.length} uploaded\n\n` +
      `ACTIVE PRICEBOOK ITEMS:\n${pricebookText || "No pricebook items found."}\n\n` +
      `Draft a change order. Call draft_change_order.`;

    // ── Call LLM ──────────────────────────────────────────────────────────────
    const result = await callAgent({
      systemPrompt,
      userMessage,
      tools: [DRAFT_CHANGE_ORDER_TOOL],
      model: ctx.resolvedModelId,
      temperature: 0.2,
      maxTokens: 1024,
    });

    const toolCall = result.toolUses.find((t) => t.name === "draft_change_order");
    if (!toolCall) return json({ error: "Agent did not call draft_change_order" }, 500);

    const draft = toolCall.input as {
      title: string;
      lines: Array<{
        pricebook_item_id?: string | null;
        description: string;
        quantity: number;
        unit_price_cents: number;
      }>;
      has_pricebook_match: boolean;
      confidence: number;
      reasoning: string;
      operator_rationale: string;
    };

    const totalCents = draft.lines.reduce(
      (sum, l) => sum + Math.round(l.unit_price_cents * l.quantity),
      0,
    );

    const status = draft.has_pricebook_match ? "draft" : "needs_pricing";

    // ── Write change order ────────────────────────────────────────────────────
    const { data: co, error: coErr } = await serviceClient
      .from("change_orders")
      .insert({
        tenant_id:    tenantId,
        project_id:   projectId,
        contract_id:  contractId,
        title:        draft.title,
        description,
        reported_by:  reportedById,
        photo_urls:   photoUrls,
        amount_cents: totalCents,
        status,
      })
      .select("id")
      .single();

    if (coErr || !co) throw coErr ?? new Error("Failed to create change order");
    const coId = (co as { id: string }).id;

    // ── Write lines ───────────────────────────────────────────────────────────
    if (draft.lines.length > 0) {
      const lineRows = draft.lines.map((l) => ({
        tenant_id:          tenantId,
        change_order_id:    coId,
        pricebook_item_id:  l.pricebook_item_id ?? null,
        description:        l.description,
        quantity:           l.quantity,
        unit_price_cents:   l.unit_price_cents,
        total_cents:        Math.round(l.unit_price_cents * l.quantity),
      }));
      const { error: linesErr } = await serviceClient.from("change_order_lines").insert(lineRows);
      if (linesErr) throw linesErr;
    }

    // ── Log action ────────────────────────────────────────────────────────────
    const { actionId, autoExecuted } = await finalizeAction(serviceClient, {
      tenantId,
      agentType:       "dispatch",
      triggerEvent:    `project:${projectId}:hidden_condition`,
      contextSnapshot: { project_id: projectId, description: description.slice(0, 200) },
      reasoning:       draft.reasoning,
      proposedAction: {
        type:               "draft_change_order",
        change_order_id:    coId,
        total_cents:        totalCents,
        status,
        has_pricebook_match: draft.has_pricebook_match,
        operator_rationale: draft.operator_rationale,
      },
      confidence:   draft.confidence,
      config:       ctx.config,
      modelUsed:    result.modelUsed,
      providerUsed: result.providerUsed,
      inputTokens:  result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      onAutoExecute: async () => {
        // Auto-execute is a no-op here — the change order is already created.
        // A human must review, price (if needs_pricing), and send for signature.
      },
    });

    console.log(`change-order-agent: created change order ${coId} (status: ${status}) for project ${projectId}`);
    return json({ change_order_id: coId, status, total_cents: totalCents, action_id: actionId, auto_executed: autoExecuted });

  } catch (e) {
    console.error("change-order-agent error:", e);
    return json({ error: String(e) }, 500);
  }
});
