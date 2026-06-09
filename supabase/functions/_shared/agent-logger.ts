import type { SupabaseClient } from "npm:@supabase/supabase-js";

export interface LogAgentActionOptions {
  tenantId: string;
  agentType: string;
  triggerEvent: string;
  contextSnapshot: Record<string, unknown>;
  reasoning: string;
  proposedAction: Record<string, unknown>;
  confidence: number;
  autoExecute: boolean;
  modelUsed?: string;
  providerUsed?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export async function logAgentAction(
  supabase: SupabaseClient,
  options: LogAgentActionOptions
): Promise<string> {
  const { data, error } = await supabase
    .from("agent_actions")
    .insert({
      tenant_id: options.tenantId,
      agent_type: options.agentType,
      trigger_event: options.triggerEvent,
      context_snapshot: options.contextSnapshot,
      reasoning: options.reasoning,
      proposed_action: options.proposedAction,
      confidence: options.confidence,
      status: options.autoExecute ? "auto_executed" : "proposed",
      executed_at: options.autoExecute ? new Date().toISOString() : null,
      model_used: options.modelUsed ?? null,
      provider_used: options.providerUsed ?? null,
      input_tokens: options.inputTokens ?? null,
      output_tokens: options.outputTokens ?? null,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}
