/**
 * membership-cancel
 *
 * Cancels a customer membership — cancels the Stripe subscription and
 * updates the memberships row. Annual subscriptions cancel at period end
 * (customer retains benefits through the paid period); monthly cancel
 * immediately.
 *
 * POST body: { membership_id: string }
 * Returns:   { cancelled: true, cancel_at_period_end: boolean }
 *
 * Required secrets: STRIPE_SECRET_KEY
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function stripeRequest(path: string, method: string, body?: Record<string, string>): Promise<Response> {
  return fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  if (!STRIPE_KEY) {
    return new Response(JSON.stringify({ error: "STRIPE_SECRET_KEY not configured" }), {
      status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const { data: userRecord } = await supabase
      .from("users")
      .select("tenant_id, role")
      .eq("auth_id", user.id)
      .single();
    if (!userRecord) return new Response(JSON.stringify({ error: "User not found" }), { status: 403 });

    const tenantId = userRecord.tenant_id as string;
    const { membership_id } = await req.json() as { membership_id: string };

    const { data: membership, error: memErr } = await supabase
      .from("memberships")
      .select("id, billing_cycle, stripe_subscription_id, status")
      .eq("id", membership_id)
      .eq("tenant_id", tenantId)
      .single();

    if (memErr || !membership) {
      return new Response(JSON.stringify({ error: "Membership not found" }), {
        status: 404, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const subId = membership.stripe_subscription_id as string | null;
    const isAnnual = membership.billing_cycle === "annual";
    const cancelAtPeriodEnd = isAnnual;
    const now = new Date().toISOString();

    // Cancel the Stripe subscription
    if (subId) {
      if (cancelAtPeriodEnd) {
        // Annual: cancel at the end of the billing period so the customer keeps benefits
        const res = await stripeRequest(`/subscriptions/${subId}`, "POST", {
          cancel_at_period_end: "true",
        });
        if (!res.ok) {
          const text = await res.text();
          // 404 means the sub is already gone — treat as success
          if (!text.includes('"code":"resource_missing"')) {
            console.error("membership-cancel: Stripe cancel error:", text);
          }
        }
        // DB: mark auto_renew false; status stays active until period ends
        await supabase
          .from("memberships")
          .update({ auto_renew: false, cancellation_reason: "operator_cancelled" })
          .eq("id", membership_id);
      } else {
        // Monthly: cancel immediately
        const res = await stripeRequest(`/subscriptions/${subId}`, "DELETE");
        if (!res.ok) {
          const text = await res.text();
          if (!text.includes('"code":"resource_missing"')) {
            console.error("membership-cancel: Stripe delete error:", text);
          }
        }
        await supabase
          .from("memberships")
          .update({
            status:               "cancelled",
            cancelled_at:         now,
            auto_renew:           false,
            stripe_subscription_id: null,
            cancellation_reason:  "operator_cancelled",
          })
          .eq("id", membership_id);
      }
    } else {
      // No Stripe subscription — just mark cancelled in DB
      await supabase
        .from("memberships")
        .update({ status: "cancelled", cancelled_at: now, auto_renew: false })
        .eq("id", membership_id);
    }

    return new Response(
      JSON.stringify({ cancelled: true, cancel_at_period_end: cancelAtPeriodEnd }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("membership-cancel error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
