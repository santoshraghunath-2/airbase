/**
 * membership-renew
 *
 * Creates a Stripe Checkout Session for membership auto-renewal.
 * Called from the Memberships UI when an operator enables auto_renew
 * or when a customer replies "RENEW" / "YES" to a pre-expiry SMS.
 *
 * POST body: { membership_id: string, return_url?: string }
 * Returns: { checkout_url: string }
 *
 * Required secrets: STRIPE_SECRET_KEY
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const APP_URL    = Deno.env.get("APP_URL") ?? "https://app.airbaseapp.netlify.app";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Stripe helpers ───────────────────────────────────────────────────────────

async function stripeRequest(path: string, method: string, body?: Record<string, unknown>): Promise<Response> {
  return fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(flattenStripeParams(body)).toString() : undefined,
  });
}

function flattenStripeParams(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenStripeParams(value as Record<string, unknown>, fullKey));
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === "object" && item !== null) {
          Object.assign(result, flattenStripeParams(item as Record<string, unknown>, `${fullKey}[${i}]`));
        } else {
          result[`${fullKey}[${i}]`] = String(item);
        }
      });
    } else if (value !== undefined && value !== null) {
      result[fullKey] = String(value);
    }
  }
  return result;
}

async function getOrCreateStripePriceId(
  planId: string,
  planName: string,
  priceCents: number,
  billingCycle: "monthly" | "annual",
): Promise<string> {
  // Create a Stripe Product for this plan
  const productRes = await stripeRequest("/products", "POST", {
    name: planName,
    metadata: { airbase_plan_id: planId },
  });
  if (!productRes.ok) throw new Error(`Stripe product creation failed: ${await productRes.text()}`);
  const product = await productRes.json() as { id: string };

  // Create a recurring Price on that Product
  const priceRes = await stripeRequest("/prices", "POST", {
    product: product.id,
    unit_amount: priceCents,
    currency: "usd",
    recurring: { interval: billingCycle === "annual" ? "year" : "month" },
    metadata: { airbase_plan_id: planId, billing_cycle: billingCycle },
  });
  if (!priceRes.ok) throw new Error(`Stripe price creation failed: ${await priceRes.text()}`);
  const price = await priceRes.json() as { id: string };

  // Persist the new Price ID back to the plan row
  const column = billingCycle === "annual" ? "stripe_price_id_annual" : "stripe_price_id";
  await supabase.from("membership_plans").update({ [column]: price.id }).eq("id", planId);

  return price.id;
}

async function getOrCreateStripeCustomer(
  customerId: string,
  name: string,
  email: string | null,
  phone: string | null,
  existingStripeId: string | null,
): Promise<string> {
  if (existingStripeId) return existingStripeId;

  const res = await stripeRequest("/customers", "POST", {
    name,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    metadata: { airbase_customer_id: customerId },
  });

  if (!res.ok) throw new Error(`Stripe customer creation failed: ${await res.text()}`);
  const data = await res.json() as { id: string };

  await supabase.from("customers").update({ stripe_customer_id: data.id }).eq("id", customerId);
  return data.id;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

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

    const { data: userRecord } = await supabase.from("users").select("tenant_id").eq("auth_id", user.id).single();
    if (!userRecord) return new Response(JSON.stringify({ error: "User not found" }), { status: 403 });

    const tenantId = userRecord.tenant_id as string;
    const body     = await req.json() as { membership_id: string; return_url?: string };

    // Load membership with plan, customer, tenant
    const { data: membership, error: memErr } = await supabase
      .from("memberships")
      .select("id, customer_id, plan_id, billing_cycle, stripe_subscription_id, customers(id, name, email, phone, stripe_customer_id), membership_plans(id, name, price_cents, stripe_price_id, stripe_price_id_annual), tenants(name)")
      .eq("id", body.membership_id)
      .eq("tenant_id", tenantId)
      .single();

    if (memErr || !membership) {
      return new Response(JSON.stringify({ error: "Membership not found" }), {
        status: 404, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Already has active subscription
    if (membership.stripe_subscription_id) {
      return new Response(JSON.stringify({ already_active: true, subscription_id: membership.stripe_subscription_id }), {
        status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const customer = membership.customers as { id: string; name: string; email: string | null; phone: string | null; stripe_customer_id: string | null } | null;
    const plan     = membership.membership_plans as { id: string; name: string; price_cents: number; stripe_price_id: string | null; stripe_price_id_annual: string | null } | null;

    if (!customer || !plan) {
      return new Response(JSON.stringify({ error: "Customer or plan not found" }), {
        status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // stripe_price_id = monthly; stripe_price_id_annual = annual (migration 043)
    // Lazily create Stripe Product+Price if the plan has never been synced to Stripe.
    const rawPriceId = membership.billing_cycle === "annual"
      ? plan.stripe_price_id_annual
      : plan.stripe_price_id;

    const priceId = rawPriceId ?? await getOrCreateStripePriceId(
      plan.id,
      plan.name,
      plan.price_cents,
      membership.billing_cycle as "monthly" | "annual",
    );

    // Get or create Stripe customer
    const stripeCustomerId = await getOrCreateStripeCustomer(
      customer.id,
      customer.name,
      customer.email,
      customer.phone,
      customer.stripe_customer_id,
    );

    // Create Checkout Session
    const returnUrl = body.return_url ?? `${APP_URL}/memberships/${body.membership_id}`;
    const sessionRes = await stripeRequest("/checkout/sessions", "POST", {
      customer: stripeCustomerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${returnUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${returnUrl}?checkout=cancelled`,
      subscription_data: {
        metadata: {
          airbase_membership_id: body.membership_id,
          airbase_tenant_id:     tenantId,
        },
      },
      metadata: { airbase_membership_id: body.membership_id },
    });

    if (!sessionRes.ok) throw new Error(`Stripe checkout creation failed: ${await sessionRes.text()}`);
    const session = await sessionRes.json() as { id: string; url: string };

    await supabase
      .from("memberships")
      .update({ stripe_checkout_session_id: session.id, auto_renew: true })
      .eq("id", body.membership_id);

    return new Response(JSON.stringify({ checkout_url: session.url, session_id: session.id }), {
      status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("membership-renew error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
