// Retell AI chat/SMS webhook
// Handles chat lifecycle events and custom tool calls for the remodel tenant SMS agent.
// Server-to-server endpoint: no CORS, OPTIONS → 405.
//
// ASSUMPTION: Retell sends function_call events for chat agents using the same
// format as voice (event: "function_call", with chat_id instead of call_id).
// If Retell's docs change this, update the ChatFunctionCallEvent type below.
// Verified from Retell docs: chat lifecycle events are chat_started, chat_ended, chat_analyzed.
// Function call event shape during chat is NOT confirmed in Retell docs — marked with ASSUMPTION.
//
// In Retell dashboard:
//   - Custom Function webhook URL → this function URL
//   - Chat events webhook → same URL
//   - Agent functions: lookup_customer, qualify_lead, check_consult_availability,
//                      book_consultation, save_lead, escalate_to_human

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyRetellSignature } from "../_shared/retell-auth.ts";
import { dispatchRemodelTool } from "../_shared/remodel-tools.ts";
import type { RecastToolContext } from "../_shared/remodel-tools.ts";

// ─── Supabase (lazy) ──────────────────────────────────────────────────────────

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
  }
  return _supabase;
}

// ─── Retell payload types ─────────────────────────────────────────────────────

interface RetellChatLifecycleEvent {
  event: "chat_started" | "chat_ended" | "chat_analyzed";
  chat_id: string;
  agent_id: string;
  chat_type?: "api_chat" | "sms_chat";
  chat_status?: "ongoing" | "ended" | "error";
  transcript?: string;
  chat_analysis?: {
    chat_summary?: string;
    user_sentiment?: "Negative" | "Positive" | "Neutral" | "Unknown";
    chat_successful?: boolean;
  };
  // The customer's phone is in the chat metadata for sms_chat
  metadata?: Record<string, unknown>;
}

// ASSUMPTION: Retell sends function_call events for chat using this shape.
// Not explicitly confirmed in Retell docs — adapt if the actual payload differs.
interface RetellChatFunctionCallEvent {
  event: "function_call";
  chat_id: string;        // chat context, not call_id
  agent_id: string;
  name: string;
  arguments: string;      // JSON string
  // For sms_chat, the from_number carries the customer's phone
  from_number?: string;
}

type RetellChatEvent = RetellChatLifecycleEvent | RetellChatFunctionCallEvent;

// ─── Tenant resolution ────────────────────────────────────────────────────────

interface RecastTenantCtx {
  tenantId: string;
  companyName: string;
}

async function resolveTenant(agentId: string): Promise<RecastTenantCtx | null> {
  const { data: configRow } = await getSupabase()
    .from("agent_config")
    .select("tenant_id, tenants(name, trade)")
    .eq("agent_type", "remodel_sms")
    .filter("settings->>'retell_agent_id'", "eq", agentId)
    .single();

  if (!configRow) return null;
  const tenant = configRow.tenants as { name: string; trade: string } | null;
  if (tenant?.trade !== "remodel") {
    // Chat webhook is remodel-only; field-service tenants use booking-agent
    console.warn(`retell-chat-webhook: non-remodel tenant ${configRow.tenant_id} — ignoring`);
    return null;
  }
  return {
    tenantId: configRow.tenant_id as string,
    companyName: tenant?.name ?? "RECAST California",
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 405 });
  }

  const rawBody = await req.text();

  const apiKey = Deno.env.get("RETELL_API_KEY");
  if (!apiKey) {
    console.error("retell-chat-webhook: RETELL_API_KEY not set — rejecting");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      headers: { "Content-Type": "application/json" },
      status: 401,
    });
  }

  const signature = req.headers.get("x-retell-signature");
  const valid = await verifyRetellSignature(rawBody, signature, apiKey);
  if (!valid) {
    console.warn("retell-chat-webhook: invalid signature");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      headers: { "Content-Type": "application/json" },
      status: 401,
    });
  }

  try {
    const event = JSON.parse(rawBody) as RetellChatEvent;

    if (event.event === "chat_started") {
      const ctx = await resolveTenant(event.agent_id);
      const companyName = ctx?.companyName ?? "RECAST California";
      console.log(`chat_started: ${event.chat_id} → ${companyName}`);
      // Return dynamic variables for the agent's prompt template
      return new Response(
        JSON.stringify({ dynamic_variables: { company_name: companyName } }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    if (event.event === "chat_ended" || event.event === "chat_analyzed") {
      const chatEvent = event as RetellChatLifecycleEvent;
      console.log(`${event.event}: ${event.chat_id}`);

      if (event.event === "chat_analyzed" && chatEvent.chat_analysis) {
        const ctx = await resolveTenant(event.agent_id);
        if (ctx) {
          // Update booking_conversation with final analysis if one exists
          await getSupabase()
            .from("booking_conversations")
            .update({
              context: getSupabase()
                .from("booking_conversations")
                .select("context")
                .eq("tenant_id", ctx.tenantId)
                .eq("retell_chat_id", event.chat_id)
                .single()
                .then((r) => ({
                  ...(r.data?.context ?? {}),
                  chat_analysis: chatEvent.chat_analysis,
                })),
            })
            .eq("tenant_id", ctx.tenantId)
            .eq("retell_chat_id", event.chat_id)
            .catch(() => {});
        }
      }

      return new Response(JSON.stringify({ received: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (event.event === "function_call") {
      const fnEvent = event as RetellChatFunctionCallEvent;
      const ctx = await resolveTenant(fnEvent.agent_id);

      if (!ctx) {
        return new Response(
          JSON.stringify({ result: "Configuration error: unknown agent." }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }

      const callerPhone = fnEvent.from_number ?? "unknown";
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(fnEvent.arguments) as Record<string, unknown>;
      } catch {
        args = {};
      }

      // tenantId comes from resolved agent context — never from tool arguments
      const remodelCtx: RecastToolContext = {
        tenantId: ctx.tenantId,
        callerPhone,
        interactionId: fnEvent.chat_id,
        interactionType: "chat",
        supabase: getSupabase(),
      };

      const result = await dispatchRemodelTool(fnEvent.name, args, remodelCtx);

      return new Response(JSON.stringify({ result: JSON.stringify(result) }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("retell-chat-webhook error:", message);
    return new Response(
      JSON.stringify({ result: "System error. Someone from our team will follow up." }),
      { headers: { "Content-Type": "application/json" }, status: 200 },
    );
  }
}

serve(handler);
