// create-deposit-link — creates a Stripe Checkout Session for a contract deposit.
//
// POST { contract_id: string }
// Authorization: Bearer <supabase user JWT>
// Returns { url: string, amount_cents: number, expires_at: string }
//
// The Checkout Session metadata carries:
//   airbase_payment_schedule_item_id — routed in stripe-webhook
//   airbase_contract_id
//   airbase_tenant_id
//
// On success Stripe fires checkout.session.completed; stripe-webhook marks
// the payment_schedule_item paid and runs the contract effectivity check.

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";

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
    // ── Auth ──────────────────────────────────────────────────────────────────
    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const { data: { user }, error: authErr } = await serviceClient.auth.getUser(jwt);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: userRow } = await serviceClient
      .from("users")
      .select("tenant_id")
      .eq("auth_id", user.id)
      .single();
    if (!userRow) return json({ error: "User not found" }, 404);

    const tenantId = (userRow as { tenant_id: string }).tenant_id;

    // ── Input ─────────────────────────────────────────────────────────────────
    const body = await req.json() as { contract_id?: string };
    const contractId = body.contract_id;
    if (!contractId) return json({ error: "contract_id required" }, 400);

    // ── Load contract (scoped to tenant) ──────────────────────────────────────
    const { data: contract } = await serviceClient
      .from("contracts")
      .select(`
        id, status, total_cents, tenant_id,
        customers(id, name, email, phone),
        estimates(id, title, selected_option)
      `)
      .eq("id", contractId)
      .eq("tenant_id", tenantId)
      .single();

    if (!contract) return json({ error: "Contract not found" }, 404);
    if (contract.status !== "signed") {
      return json({ error: `Deposit link requires a signed contract (current status: ${contract.status})` }, 400);
    }

    // ── Load deposit payment_schedule_item ────────────────────────────────────
    const { data: depositItem } = await serviceClient
      .from("payment_schedule_items")
      .select("id, amount_cents, status, stripe_payment_intent_id")
      .eq("contract_id", contractId)
      .eq("trigger_type", "contract_signed")
      .order("sort_order", { ascending: true })
      .limit(1)
      .single();

    if (!depositItem) return json({ error: "No deposit payment schedule item found" }, 404);
    if (depositItem.status === "paid") return json({ error: "Deposit is already paid" }, 400);

    // ── Load tenant Stripe key ────────────────────────────────────────────────
    const { data: tenant } = await serviceClient
      .from("tenants")
      .select("name, stripe_account_id, slug")
      .eq("id", tenantId)
      .single();
    if (!tenant) return json({ error: "Tenant not found" }, 404);

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: "2024-12-18.acacia" as Parameters<typeof Stripe>[1]["apiVersion"],
    });

    const customer   = contract.customers as { id: string; name: string; email: string | null; phone: string | null } | null;
    const estimate   = contract.estimates as { id: string; title: string; selected_option: string | null } | null;
    const tenantRow  = tenant as { name: string; stripe_account_id: string | null; slug: string };

    const depositCents = (depositItem as { id: string; amount_cents: number; status: string; stripe_payment_intent_id: string | null }).amount_cents;
    const psiId = (depositItem as { id: string }).id;

    // ── Create Stripe Checkout Session ────────────────────────────────────────
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: depositCents,
            product_data: {
              name: `Deposit — ${estimate?.title ?? "Home improvement project"}`,
              description: estimate?.selected_option
                ? `${estimate.selected_option.charAt(0).toUpperCase() + estimate.selected_option.slice(1)} package deposit`
                : "Contract deposit",
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        airbase_payment_schedule_item_id: psiId,
        airbase_contract_id: contractId,
        airbase_tenant_id:   tenantId,
      },
      success_url: `${APP_URL}/${tenantRow.slug}/contracts/${contractId}?deposit=paid`,
      cancel_url:  `${APP_URL}/${tenantRow.slug}/contracts/${contractId}?deposit=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
    };

    if (customer?.email) sessionParams.customer_email = customer.email;

    const session = await stripe.checkout.sessions.create(sessionParams);

    // Mark item as invoiced so we know a session is in-flight
    await serviceClient
      .from("payment_schedule_items")
      .update({
        status: "invoiced",
        invoiced_at: new Date().toISOString(),
        stripe_payment_intent_id: session.id, // store session id until PI is known
      })
      .eq("id", psiId)
      .eq("tenant_id", tenantId);

    return json({
      url: session.url,
      amount_cents: depositCents,
      expires_at: new Date((sessionParams.expires_at as number) * 1000).toISOString(),
    });
  } catch (err) {
    console.error("create-deposit-link error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
