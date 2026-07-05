// AI Draft Campaign — resolves audience count and drafts an SMS message.
//
// POST { segment, segment_params?, intent }
// Authorization: Bearer <operator JWT>
// Returns { message, recipient_count }

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

const SEGMENT_DESC: Record<string, string> = {
  reactivation:      "customers who haven't had a service call in several months",
  member_upsell:     "customers who don't yet have a maintenance plan or membership",
  seasonal_blast:    "all current customers",
  job_type_followup: "customers who recently had a specific type of service done",
  equipment_aging:   "customers whose home equipment is aging and may need replacement soon",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const { data: { user }, error: authError } = await serviceClient.auth.getUser(jwt);
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: userRow } = await serviceClient
      .from("users")
      .select("tenant_id")
      .eq("auth_id", user.id)
      .single();
    if (!userRow) return json({ error: "User not found" }, 404);

    const tenantId = (userRow as { tenant_id: string }).tenant_id;

    const body = await req.json() as {
      segment:        string;
      segment_params?: Record<string, unknown>;
      intent:         string;
    };
    const { segment, segment_params = {}, intent } = body;
    if (!segment || !intent) return json({ error: "segment and intent required" }, 400);

    // Resolve audience count
    const { data: audience } = await serviceClient.rpc("resolve_campaign_audience", {
      p_tenant_id: tenantId,
      p_segment:   segment,
      p_params:    segment_params,
    });
    const recipientCount = Array.isArray(audience) ? audience.length : 0;

    // Tenant name for context
    const { data: tenant } = await serviceClient
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .single();
    const tenantName = (tenant as { name: string } | null)?.name ?? "our company";

    // AI draft — use deepseek for cost efficiency on copy generation
    const result = await callAgent({
      systemPrompt: [
        `You write SMS marketing messages for ${tenantName}, a home services company (plumbing, HVAC, electrical).`,
        `Target audience: ${SEGMENT_DESC[segment] ?? "customers"}.`,
        "Write in a friendly, conversational tone — not corporate or pushy.",
        "Keep the message under 140 characters.",
        "Do NOT include opt-out instructions; those are appended automatically.",
        "Return ONLY the message text — no quotes, no explanation.",
      ].join(" "),
      userMessage: `Campaign goal: ${intent}\n\nWrite the SMS.`,
      temperature: 0.7,
      maxTokens:   200,
      model:       "deepseek-chat",
    });

    return json({ message: result.text.trim(), recipient_count: recipientCount });
  } catch (e) {
    console.error("ai-draft-campaign error:", e);
    return json({ error: String(e) }, 500);
  }
});
