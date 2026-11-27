// Authority engine — resolves action tiers and wraps finalizeAction.
//
// resolveTier(tenantId, actionType, amountCents) → { tier, approverRole }
//   Looks up authority_rules for the tenant. If no rows exist for this tenant
//   the caller keeps confidence-threshold behavior (backward-compat).
//
// finalizeWithAuthority wraps finalizeAction, applying the tier:
//   never       → refuse immediately, log the refusal
//   ask_first   → write proposed action, notify approver
//   act_and_report → execute, log, add to daily digest
//   act         → execute and log
//
// Confidence still applies: if confidence < threshold, tier drops one level.
// agent_config.paused = true → all tiers except 'never' become 'ask_first'.

import type { SupabaseClient } from "npm:@supabase/supabase-js";
import { finalizeAction, shouldAutoExecute, type FinalizeOptions, type FinalizeResult } from "./agent-base.ts";
import { logAgentAction } from "./agent-logger.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuthorityTier = "act" | "act_and_report" | "ask_first" | "never";

export interface ResolvedTier {
  tier: AuthorityTier;
  approverRole: string | null;
  /** true if the tenant has authority_rules rows (false = legacy confidence-threshold path) */
  hasRules: boolean;
}

export interface AuthorityFinalizeOptions extends FinalizeOptions {
  actionType: string;
  amountCents?: number;
  entityType?: string;
  entityId?: string;
  reversalDescription?: Record<string, unknown>;
}

export interface AuthorityFinalizeResult extends FinalizeResult {
  tier: AuthorityTier | null;
  refused: boolean;
}

// ─── Tier ordering (for drop-one-level logic) ─────────────────────────────────

const TIER_ORDER: AuthorityTier[] = ["act", "act_and_report", "ask_first", "never"];

function dropOneTier(tier: AuthorityTier): AuthorityTier {
  const idx = TIER_ORDER.indexOf(tier);
  // Drop toward ask_first (index 2), not past it.
  if (idx < 2) return TIER_ORDER[idx + 1];
  return tier;
}

// ─── resolveTier ──────────────────────────────────────────────────────────────

export async function resolveTier(
  supabase: SupabaseClient,
  tenantId: string,
  actionType: string,
  amountCents?: number,
): Promise<ResolvedTier> {
  const { data: rules } = await supabase
    .from("authority_rules")
    .select("tier, limit_cents, approver_role")
    .eq("tenant_id", tenantId)
    .eq("action_type", actionType);

  if (!rules || rules.length === 0) {
    return { tier: "act", approverRole: null, hasRules: false };
  }

  // Find the best-matching rule.
  // If amountCents is provided and a rule has limit_cents set:
  //   - Use the rule whose limit_cents >= amountCents (the "below" rule)
  //   - Fall back to the rule with no limit_cents
  // If no amountCents, use the rule with no limit_cents or the first one.
  type RuleRow = { tier: string; limit_cents: number | null; approver_role: string | null };
  const rows = rules as RuleRow[];

  let matched: RuleRow | null = null;

  if (amountCents != null) {
    // Rules with a limit_cents: pick the one where our amount is BELOW the limit
    const belowRules = rows
      .filter((r) => r.limit_cents != null && amountCents <= r.limit_cents)
      .sort((a, b) => (a.limit_cents ?? 0) - (b.limit_cents ?? 0));

    // Rules for amounts ABOVE any stated limit
    const aboveRules = rows
      .filter((r) => r.limit_cents != null && amountCents > r.limit_cents)
      .sort((a, b) => (b.limit_cents ?? 0) - (a.limit_cents ?? 0));

    // Fallback: rule with no limit
    const noLimitRules = rows.filter((r) => r.limit_cents == null);

    matched = belowRules[0] ?? aboveRules[0] ?? noLimitRules[0] ?? null;
  } else {
    // No amount — prefer a rule with no limit_cents
    matched = rows.find((r) => r.limit_cents == null) ?? rows[0];
  }

  if (!matched) {
    return { tier: "act", approverRole: null, hasRules: true };
  }

  return {
    tier:         matched.tier as AuthorityTier,
    approverRole: matched.approver_role,
    hasRules:     true,
  };
}

// ─── notifyApprover ───────────────────────────────────────────────────────────

async function notifyApprover(
  supabase: SupabaseClient,
  tenantId: string,
  approverRole: string,
  actionId: string,
  actionType: string,
  reasoning: string,
): Promise<void> {
  // Find users with the approver role
  const { data: approvers } = await supabase
    .from("users")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("role", approverRole);

  if (!approvers?.length) return;

  // Push notification to each approver
  const deviceTokenPromises = approvers.map(async (u: { id: string }) => {
    const { data: tokens } = await supabase
      .from("device_tokens")
      .select("token, platform")
      .eq("user_id", u.id);

    return tokens ?? [];
  });

  const allTokenArrays = await Promise.all(deviceTokenPromises);
  const allTokens = allTokenArrays.flat();

  if (!allTokens.length) return;

  // Fire and forget — push notifications are best-effort
  supabase.functions.invoke("push-notification", {
    body: {
      tokens:  allTokens,
      title:   "Action needs your approval",
      body:    `${actionType.replace(/_/g, " ")}: ${reasoning.slice(0, 120)}`,
      data:    { action_id: actionId, action_type: actionType },
    },
  }).catch((e: unknown) => console.error("notifyApprover push failed:", e));
}

// ─── addToDailyDigest ─────────────────────────────────────────────────────────

async function addToDailyDigest(
  supabase: SupabaseClient,
  tenantId: string,
  actionId: string,
  actionType: string,
  reasoning: string,
): Promise<void> {
  // Upsert today's digest entry
  const today = new Date().toISOString().slice(0, 10);

  await supabase
    .from("agent_actions")
    .update({ reasoning: reasoning + "\n[Added to daily digest]" })
    .eq("id", actionId);

  // Store in a simple daily digest accumulator via a sweep_findings row
  // (The weekly-briefing function already reads agent_actions; the daily digest
  // is built by ops-sweep and surfaced via push to owner-role users.)
  const digestKey = `daily_digest_${today}`;
  await supabase
    .from("sweep_findings")
    .upsert(
      {
        tenant_id:  tenantId,
        check_name: digestKey,
        entity_type: "agent_action",
        entity_id:  null,
        severity:   "info",
        last_seen:  new Date().toISOString(),
        action_id:  actionId,
      },
      { onConflict: "tenant_id,check_name,entity_id", ignoreDuplicates: true },
    );
}

// ─── finalizeWithAuthority ────────────────────────────────────────────────────

export async function finalizeWithAuthority(
  supabase: SupabaseClient,
  options: AuthorityFinalizeOptions,
): Promise<AuthorityFinalizeResult> {
  const { actionType, amountCents, entityType, entityId, reversalDescription, ...baseOptions } = options;

  // 1. Resolve authority tier
  const resolved = await resolveTier(supabase, options.tenantId, actionType, amountCents);

  let effectiveTier = resolved.tier;

  // 2. If no rules exist, fall through to legacy confidence-threshold path
  if (!resolved.hasRules) {
    const result = await finalizeAction(supabase, baseOptions);
    return { ...result, tier: null, refused: false };
  }

  // 3. Check if any agent of this type is paused
  const { data: agentCfg } = await supabase
    .from("agent_config")
    .select("paused, confidence_threshold")
    .eq("tenant_id", options.tenantId)
    .eq("agent_type", options.agentType)
    .maybeSingle();

  if (agentCfg?.paused && effectiveTier !== "never") {
    effectiveTier = "ask_first";
  }

  // 4. Drop tier if confidence is below threshold
  const threshold = (agentCfg?.confidence_threshold as number) ?? 0.85;
  if (options.confidence < threshold && effectiveTier !== "never") {
    effectiveTier = dropOneTier(effectiveTier);
  }

  // 5. never → refuse
  if (effectiveTier === "never") {
    const actionId = await logAgentAction(supabase, {
      tenantId:        options.tenantId,
      agentType:       options.agentType,
      triggerEvent:    options.triggerEvent,
      contextSnapshot: options.contextSnapshot,
      reasoning:       `REFUSED (authority tier: never): ${options.reasoning}`,
      proposedAction:  { ...options.proposedAction, action_type: actionType, refused: true },
      confidence:      options.confidence,
      autoExecute:     false,
      modelUsed:       options.modelUsed,
      providerUsed:    options.providerUsed,
      inputTokens:     options.inputTokens,
      outputTokens:    options.outputTokens,
    });

    // Annotate with authority fields
    await supabase.from("agent_actions").update({
      entity_type:    entityType ?? null,
      entity_id:      entityId ?? null,
      amount_cents:   amountCents ?? null,
      authority_tier: "never",
      reversal:       null,
    }).eq("id", actionId);

    return { actionId, autoExecuted: false, tier: "never", refused: true };
  }

  // 6. ask_first → propose, notify approver
  if (effectiveTier === "ask_first") {
    const actionId = await logAgentAction(supabase, {
      tenantId:        options.tenantId,
      agentType:       options.agentType,
      triggerEvent:    options.triggerEvent,
      contextSnapshot: options.contextSnapshot,
      reasoning:       `[ask_first] ${options.reasoning}`,
      proposedAction:  { ...options.proposedAction, action_type: actionType },
      confidence:      options.confidence,
      autoExecute:     false,
      modelUsed:       options.modelUsed,
      providerUsed:    options.providerUsed,
      inputTokens:     options.inputTokens,
      outputTokens:    options.outputTokens,
    });

    await supabase.from("agent_actions").update({
      entity_type:    entityType ?? null,
      entity_id:      entityId ?? null,
      amount_cents:   amountCents ?? null,
      authority_tier: "ask_first",
      reversal:       reversalDescription ?? null,
    }).eq("id", actionId);

    if (resolved.approverRole) {
      await notifyApprover(
        supabase, options.tenantId, resolved.approverRole,
        actionId, actionType, options.reasoning,
      );
    }

    return { actionId, autoExecuted: false, tier: "ask_first", refused: false };
  }

  // 7. act or act_and_report → execute
  const autoExecuteOptions: FinalizeOptions = {
    ...baseOptions,
    // Force auto_execute by patching config
    config: { ...baseOptions.config, auto_execute: true, confidence_threshold: 0 },
  };

  const result = await finalizeAction(supabase, autoExecuteOptions);

  await supabase.from("agent_actions").update({
    entity_type:    entityType ?? null,
    entity_id:      entityId ?? null,
    amount_cents:   amountCents ?? null,
    authority_tier: effectiveTier,
    reversal:       reversalDescription ?? null,
  }).eq("id", result.actionId);

  if (effectiveTier === "act_and_report") {
    await addToDailyDigest(
      supabase, options.tenantId, result.actionId,
      actionType, options.reasoning,
    );
  }

  return { ...result, tier: effectiveTier, refused: false };
}
