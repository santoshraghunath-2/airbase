// Send Campaign — creates the campaign record, resolves the audience,
// inserts recipients, and fires SMS to each via send-sms.
//
// POST { name, segment, segment_params?, message }
// Authorization: Bearer <operator JWT>
// Returns { campaign_id, sent_count, failed_count }

import { createClient } from "npm:@supabase/supabase-js@2";

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
      .select("id, tenant_id, role")
      .eq("auth_id", user.id)
      .single();
    if (!userRow) return json({ error: "User not found" }, 404);

    const { id: userId, tenant_id, role } =
      userRow as { id: string; tenant_id: string; role: string };

    if (!["owner", "office_manager", "dispatcher"].includes(role)) {
      return json({ error: "Insufficient permissions" }, 403);
    }

    const body = await req.json() as {
      name:            string;
      segment:         string;
      segment_params?: Record<string, unknown>;
      message:         string;
    };
    const { name, segment, segment_params = {}, message } = body;
    if (!name || !segment || !message) {
      return json({ error: "name, segment, and message required" }, 400);
    }

    // Resolve audience
    const { data: audience, error: audienceErr } = await serviceClient.rpc(
      "resolve_campaign_audience",
      { p_tenant_id: tenant_id, p_segment: segment, p_params: segment_params },
    );
    if (audienceErr) throw audienceErr;

    type Recipient = { customer_id: string; customer_name: string; phone: string };
    const recipients: Recipient[] = (audience as Recipient[] | null) ?? [];

    // Create campaign record
    const { data: campaign, error: campaignErr } = await serviceClient
      .from("campaigns")
      .insert({
        tenant_id,
        name,
        segment,
        segment_params,
        channel:         "sms",
        message_text:    message,
        status:          "sending",
        recipient_count: recipients.length,
        created_by:      userId,
      })
      .select("id")
      .single();
    if (campaignErr || !campaign) throw campaignErr ?? new Error("Campaign insert failed");

    const campaignId = (campaign as { id: string }).id;

    // Insert recipient rows
    if (recipients.length > 0) {
      await serviceClient.from("campaign_recipients").insert(
        recipients.map((r) => ({
          campaign_id: campaignId,
          customer_id: r.customer_id,
          status:      "queued",
        })),
      );
    }

    // SMS text — opt-out instruction always appended
    const smsText = `${message}\n\nReply STOP to opt out.`;
    let sentCount   = 0;
    let failedCount = 0;
    const now = new Date().toISOString();

    for (const r of recipients) {
      try {
        const { error: smsErr } = await serviceClient.functions.invoke("send-sms", {
          body: { to: r.phone, tenantId: tenant_id, message: smsText },
        });
        if (smsErr) throw smsErr;
        await serviceClient
          .from("campaign_recipients")
          .update({ status: "sent", sent_at: now })
          .eq("campaign_id", campaignId)
          .eq("customer_id", r.customer_id);
        sentCount++;
      } catch (err) {
        await serviceClient
          .from("campaign_recipients")
          .update({ status: "failed", error: String(err) })
          .eq("campaign_id", campaignId)
          .eq("customer_id", r.customer_id);
        failedCount++;
      }
    }

    // Finalise campaign
    await serviceClient
      .from("campaigns")
      .update({
        status:       "sent",
        sent_at:      now,
        sent_count:   sentCount,
        failed_count: failedCount,
        updated_at:   now,
      })
      .eq("id", campaignId);

    return json({ campaign_id: campaignId, sent_count: sentCount, failed_count: failedCount });
  } catch (e) {
    console.error("send-campaign error:", e);
    return json({ error: String(e) }, 500);
  }
});
