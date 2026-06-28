// Shared boilerplate for every Airbase AI agent Edge Function.
//
// Usage pattern in each agent:
//
//   const ctx = await loadAgentContext(supabase, tenantId, 'dispatch');
//   if (!ctx.config.enabled) return earlyReturn();
//
//   const result = await callAgent({ model: ctx.resolvedModelId, ... });
//
//   const { actionId, autoExecuted } = await finalizeAction(supabase, {
//     ...ctx,
//     reasoning: result.text,
//     confidence: parsedConfidence,
//     proposedAction: { type: 'assign_tech', ... },
//     onAutoExecute: async () => { /* write to DB */ },
//     ...result.usage,
//   });

import type { SupabaseClient } from "npm:@supabase/supabase-js";
import { resolveModel, PLATFORM_DEFAULT_MODEL } from "./llm-router.ts";
import { logAgentAction } from "./agent-logger.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentConfig {
  id: string;
  tenant_id: string;
  agent_type: string;
  model_id: string | null;
  confidence_threshold: number;
  enabled: boolean;
  auto_execute: boolean;
  settings: Record<string, unknown>;
}

export interface AgentContext {
  tenantId: string;
  config: AgentConfig;
  resolvedModelId: string;
}

export interface FinalizeOptions {
  tenantId: string;
  agentType: string;
  triggerEvent: string;
  contextSnapshot: Record<string, unknown>;
  reasoning: string;
  proposedAction: Record<string, unknown>;
  confidence: number;
  config: AgentConfig;
  modelUsed?: string;
  providerUsed?: string;
  inputTokens?: number;
  outputTokens?: number;
  onAutoExecute: () => Promise<void>;
}

export interface FinalizeResult {
  actionId: string;
  autoExecuted: boolean;
}

// ─── Per-agent default models (from CLAUDE.md) ────────────────────────────────
// Tenant can override per-agent via agent_config.model_id.
// Tenant default via tenants.default_model_id overrides platform default.

const AGENT_DEFAULT_MODELS: Record<string, string> = {
  dispatch:           "claude-sonnet-4-6",
  booking_sms:        "deepseek-chat",
  booking_voice:      "claude-sonnet-4-6",
  invoice:            "deepseek-chat",
  operator:           "claude-sonnet-4-6",
  tech_assistant:     "moonshot-v1-32k",
  membership:         "deepseek-chat",
  // Notification agents don't call LLMs, but still get a config row.
  eta_notification:   PLATFORM_DEFAULT_MODEL,
  review_request:     PLATFORM_DEFAULT_MODEL,
  warranty_detector:  PLATFORM_DEFAULT_MODEL,
};

// ─── loadAgentContext ─────────────────────────────────────────────────────────
// Ensures an agent_config row exists for this tenant+agent_type (upserts
// defaults on first run), then resolves the effective model ID.

export async function loadAgentContext(
  supabase: SupabaseClient,
  tenantId: string,
  agentType: string,
): Promise<AgentContext> {
  // Upsert defaults so the row always exists after first call.
  await supabase
    .from("agent_config")
    .upsert(
      {
        tenant_id:            tenantId,
        agent_type:           agentType,
        model_id:             null,
        confidence_threshold: 0.85,
        enabled:              true,
        auto_execute:         false,
        settings:             {},
      },
      { onConflict: "tenant_id,agent_type", ignoreDuplicates: true },
    );

  // Load the (now guaranteed to exist) row alongside tenant default model.
  const [{ data: config }, { data: tenant }] = await Promise.all([
    supabase
      .from("agent_config")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("agent_type", agentType)
      .single(),
    supabase
      .from("tenants")
      .select("default_model_id")
      .eq("id", tenantId)
      .single(),
  ]);

  if (!config) throw new Error(`agent_config row missing for ${agentType} / ${tenantId}`);

  // Model resolution order (CLAUDE.md):
  //   1. agent_config.model_id  (tenant override for this specific agent)
  //   2. tenants.default_model_id  (tenant-wide default)
  //   3. per-agent recommended model  (AGENT_DEFAULT_MODELS)
  //   4. platform default  (PLATFORM_DEFAULT_MODEL = claude-sonnet-4-6)
  const modelId =
    config.model_id ??
    tenant?.default_model_id ??
    AGENT_DEFAULT_MODELS[agentType] ??
    PLATFORM_DEFAULT_MODEL;

  const resolved = resolveModel({ callTimeOverride: modelId });

  return {
    tenantId,
    config: config as AgentConfig,
    resolvedModelId: resolved.modelId,
  };
}

// ─── shouldAutoExecute ────────────────────────────────────────────────────────

export function shouldAutoExecute(
  confidence: number,
  config: AgentConfig,
): boolean {
  return config.auto_execute && confidence >= config.confidence_threshold;
}

// ─── finalizeAction ───────────────────────────────────────────────────────────
// Logs the action and either auto-executes (calling onAutoExecute) or leaves
// it as 'proposed' for operator review.

export async function finalizeAction(
  supabase: SupabaseClient,
  options: FinalizeOptions,
): Promise<FinalizeResult> {
  const willAutoExecute = shouldAutoExecute(options.confidence, options.config);

  // Write the log row first.
  const actionId = await logAgentAction(supabase, {
    tenantId:        options.tenantId,
    agentType:       options.agentType,
    triggerEvent:    options.triggerEvent,
    contextSnapshot: options.contextSnapshot,
    reasoning:       options.reasoning,
    proposedAction:  options.proposedAction,
    confidence:      options.confidence,
    autoExecute:     willAutoExecute,
    modelUsed:       options.modelUsed,
    providerUsed:    options.providerUsed,
    inputTokens:     options.inputTokens,
    outputTokens:    options.outputTokens,
  });

  if (willAutoExecute) {
    try {
      await options.onAutoExecute();
    } catch (err) {
      // Execution failed — downgrade to proposed so operator can review.
      console.error(`finalizeAction: auto-execute failed for ${options.agentType}:`, err);
      await supabase
        .from("agent_actions")
        .update({
          status:   "proposed",
          reasoning: options.reasoning + `\n\n[Auto-execute failed: ${String(err)}]`,
        })
        .eq("id", actionId);
      return { actionId, autoExecuted: false };
    }
  }

  return { actionId, autoExecuted: willAutoExecute };
}

// ─── Request auth helper ──────────────────────────────────────────────────────
// Validates the Authorization header on inbound webhook calls.
// Agents called by pg_net triggers pass the service role key — this confirms
// the call is internal, not a spoofed external request.

export function validateServiceRoleAuth(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return token === serviceRoleKey && token.length > 0;
}

// ─── Standard JSON responses ──────────────────────────────────────────────────

export function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export function err(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
