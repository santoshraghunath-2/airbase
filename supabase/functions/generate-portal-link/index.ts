// Generate Portal Link — called by authenticated operators from the customer detail page.
// Creates or refreshes a portal_invitation and optionally sends an SMS to the customer.
//
// POST { customer_id: string, send_sms?: boolean }
// Authorization: Bearer <supabase user JWT>
// Returns { portal_url, token, sent, last_sent_at }

import { createClient } from "npm:@supabase/supabase-js@2";

const serviceClient = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const APP_URL = Deno.env.get("APP_URL") ?? "https://app.airbase.io";

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
    // Validate operator JWT
    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const { data: { user }, error: authError } = await serviceClient.auth.getUser(jwt);
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    // Resolve tenant from the users table
    const { data: userRow } = await serviceClient
      .from("users")
      .select("tenant_id, role")
      .eq("auth_id", user.id)
      .single();
    if (!userRow) return json({ error: "User not found" }, 404);

    const { tenant_id } = userRow as { tenant_id: string; role: string };

    const body = await req.json() as { customer_id: string; send_sms?: boolean };
    const { customer_id, send_sms = true } = body;
    if (!customer_id) return json({ error: "customer_id required" }, 400);

    // Verify customer belongs to this tenant
    const { data: customer } = await serviceClient
      .from("customers")
      .select("id, name, phone")
      .eq("id", customer_id)
      .eq("tenant_id", tenant_id)
      .is("deleted_at", null)
      .single();
    if (!customer) return json({ error: "Customer not found" }, 404);

    const c = customer as { id: string; name: string; phone: string | null };
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    // Upsert portal invitation (one per customer per tenant)
    const { data: existing } = await serviceClient
      .from("portal_invitations")
      .select("id, token")
      .eq("tenant_id", tenant_id)
      .eq("customer_id", customer_id)
      .maybeSingle();

    let token: string;
    if (existing) {
      token = (existing as Record<string, string>).token;
      await serviceClient
        .from("portal_invitations")
        .update({ expires_at: expiresAt, last_sent_at: send_sms ? now : undefined })
        .eq("id", (existing as Record<string, string>).id);
    } else {
      const { data: newInvite, error: insertErr } = await serviceClient
        .from("portal_invitations")
        .insert({
          tenant_id,
          customer_id,
          expires_at:   expiresAt,
          last_sent_at: send_sms ? now : null,
        })
        .select("token")
        .single();
      if (insertErr || !newInvite) throw insertErr ?? new Error("Insert failed");
      token = (newInvite as Record<string, string>).token;
    }

    const portalUrl = `${APP_URL}/portal/${token}`;
    let sent = false;

    if (send_sms && c.phone) {
      const { data: tenant } = await serviceClient
        .from("tenants")
        .select("name")
        .eq("id", tenant_id)
        .single();
      const tenantName = (tenant as Record<string, string> | null)?.name ?? "your service provider";
      const firstName  = c.name.split(" ")[0];

      const { error: smsErr } = await serviceClient.functions.invoke("send-sms", {
        body: {
          to:       c.phone,
          tenantId: tenant_id,
          message:  `Hi ${firstName}, here's your ${tenantName} portal — view service history, invoices, and request appointments: ${portalUrl}`,
        },
      });
      if (!smsErr) sent = true;
    }

    return json({ portal_url: portalUrl, token, sent, last_sent_at: now });
  } catch (e) {
    console.error("generate-portal-link error:", e);
    return json({ error: String(e) }, 500);
  }
});
