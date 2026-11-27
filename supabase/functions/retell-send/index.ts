// retell-send: Initiate outbound Retell contact (SMS chat or voice call).
// Service-role only — called by lead-follow-up and other internal agents.
//
// Guards applied before sending:
//   1. tenant.sms_enabled must be true (not set for field-service tenants)
//   2. Contact window: 8am–8pm tenant timezone (Mon–Sat)
//   3. honor_internal_dnc: true — Retell skips if number is on DNC list
//
// ASSUMPTION: Retell /create-sms-chat and /v2/create-phone-call base URL is
// https://api.retellai.com (confirmed from docs). Auth: Bearer RETELL_API_KEY.

import { createClient } from "npm:@supabase/supabase-js@2";
import { validateServiceRoleAuth, ok, err } from "../_shared/agent-base.ts";

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isInContactWindow(timezone: string): boolean {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      weekday: "short",
      hour12: false,
    }).formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const weekday = parts.find((p) => p.type === "weekday")?.value;
    if (weekday === "Sun") return false;
    return hour >= 8 && hour < 20;
  } catch {
    // If timezone is invalid, default to allowing (better to send than to miss)
    return true;
  }
}

// ─── Retell API calls ─────────────────────────────────────────────────────────

async function createSmsChat(
  fromNumber: string,
  toNumber: string,
  overrideAgentId?: string,
  dynamicVars?: Record<string, string>,
): Promise<{ chat_id: string } | null> {
  const retellKey = Deno.env.get("RETELL_API_KEY");
  if (!retellKey) throw new Error("RETELL_API_KEY not set");

  const body: Record<string, unknown> = {
    from_number: fromNumber,
    to_number: toNumber,
    honor_internal_dnc: true,
  };
  if (overrideAgentId) body.override_agent_id = overrideAgentId;
  if (dynamicVars) body.retell_llm_dynamic_variables = dynamicVars;

  const res = await fetch("https://api.retellai.com/create-sms-chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${retellKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Retell create-sms-chat ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data as { chat_id: string };
}

async function createPhoneCall(
  fromNumber: string,
  toNumber: string,
  overrideAgentId?: string,
  dynamicVars?: Record<string, string>,
): Promise<{ call_id: string } | null> {
  const retellKey = Deno.env.get("RETELL_API_KEY");
  if (!retellKey) throw new Error("RETELL_API_KEY not set");

  const body: Record<string, unknown> = {
    from_number: fromNumber,
    to_number: toNumber,
    honor_internal_dnc: true,
  };
  if (overrideAgentId) body.override_agent_id = overrideAgentId;
  if (dynamicVars) body.retell_llm_dynamic_variables = dynamicVars;

  const res = await fetch("https://api.retellai.com/v2/create-phone-call", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${retellKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Retell v2/create-phone-call ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data as { call_id: string };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (!validateServiceRoleAuth(req)) return err("Unauthorized", 401);

  const body = await req.json() as {
    tenant_id: string;
    to_number: string;
    channel: "sms" | "voice";
    override_agent_id?: string;
    dynamic_variables?: Record<string, string>;
    // For logging
    opportunity_id?: string;
    touch_type?: string;
  };

  if (!body.tenant_id || !body.to_number || !body.channel) {
    return err("Missing required fields: tenant_id, to_number, channel");
  }

  try {
    // Load tenant info
    const { data: tenant } = await getSupabase()
      .from("tenants")
      .select("name, timezone, retell_phone_number")
      .eq("id", body.tenant_id)
      .single();

    if (!tenant) return err(`Tenant ${body.tenant_id} not found`);
    if (!tenant.retell_phone_number) return err("Tenant has no retell_phone_number configured");

    // Contact window guard
    const timezone = (tenant.timezone as string) ?? "America/Los_Angeles";
    if (!isInContactWindow(timezone)) {
      console.log(`retell-send: outside contact window for tenant ${body.tenant_id}`);
      return ok({ skipped: true, reason: "outside_contact_window" });
    }

    let sessionId: string;

    if (body.channel === "sms") {
      const result = await createSmsChat(
        tenant.retell_phone_number as string,
        body.to_number,
        body.override_agent_id,
        body.dynamic_variables,
      );
      sessionId = result?.chat_id ?? "unknown";
    } else {
      const result = await createPhoneCall(
        tenant.retell_phone_number as string,
        body.to_number,
        body.override_agent_id,
        body.dynamic_variables,
      );
      sessionId = result?.call_id ?? "unknown";
    }

    console.log(`retell-send: ${body.channel} initiated → ${sessionId} for tenant ${body.tenant_id}`);

    // Update opportunity if provided
    if (body.opportunity_id) {
      const updateField =
        body.channel === "sms" ? { retell_chat_id: sessionId } : { retell_call_id: sessionId };
      await getSupabase()
        .from("opportunities")
        .update(updateField)
        .eq("id", body.opportunity_id)
        .eq("tenant_id", body.tenant_id)
        .catch(() => {});
    }

    return ok({ sent: true, channel: body.channel, session_id: sessionId });
  } catch (e) {
    console.error("retell-send error:", e);
    return err(String(e));
  }
});
