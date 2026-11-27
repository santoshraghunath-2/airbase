/**
 * stripe-webhook
 *
 * Handles Stripe webhook events for membership and contract deposit flows.
 * Configure in Stripe Dashboard → Developers → Webhooks, pointing to:
 *   https://<project>.supabase.co/functions/v1/stripe-webhook
 *
 * Required secrets: STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY
 *
 * Handled events:
 *   checkout.session.completed     → membership: link subscription
 *                                  → contract deposit: mark paid, check effectivity
 *   customer.subscription.deleted  → mark membership lapsed
 *   invoice.payment_succeeded      → renew membership expires_at
 *   invoice.payment_failed         → mark payment_failed, send SMS alert
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const STRIPE_KEY            = Deno.env.get("STRIPE_SECRET_KEY")!;
const TWILIO_ACCOUNT_SID    = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN     = Deno.env.get("TWILIO_AUTH_TOKEN")!;

async function sendSms(to: string, from: string, body: string): Promise<void> {
  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    },
  );
}

// ─── Stripe signature verification ────────────────────────────────────────────

async function verifyStripeSignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const parts    = signature.split(",").reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split("=");
    acc[k] = v;
    return acc;
  }, {});

  const timestamp = parts["t"];
  const sigHex    = parts["v1"];
  if (!timestamp || !sigHex) return false;

  const payload  = `${timestamp}.${body}`;
  const key      = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig      = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const computed = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return computed === sigHex;
}

// ─── Event handlers ───────────────────────────────────────────────────────────

async function handleCheckoutCompleted(session: Record<string, unknown>): Promise<void> {
  const meta = (session.metadata as Record<string, string>) ?? {};

  // ── Contract deposit path ─────────────────────────────────────────────────
  const psiId      = meta.airbase_payment_schedule_item_id;
  const contractId = meta.airbase_contract_id;
  const tenantId   = meta.airbase_tenant_id;

  if (psiId && contractId && tenantId) {
    const now = new Date().toISOString();
    const paymentIntentId = session.payment_intent as string | null;

    await supabase
      .from("payment_schedule_items")
      .update({
        status:                    "paid",
        paid_at:                   now,
        stripe_payment_intent_id:  paymentIntentId ?? session.id as string,
      })
      .eq("id", psiId)
      .eq("tenant_id", tenantId);

    // Check if contract can now be set effective (cancel window already passed)
    await checkAndSetContractEffective(contractId, tenantId);
    return;
  }

  // ── Membership path ───────────────────────────────────────────────────────
  const membershipId   = meta.airbase_membership_id;
  const subscriptionId = session.subscription as string | null;
  if (!membershipId || !subscriptionId) return;

  await supabase
    .from("memberships")
    .update({ stripe_subscription_id: subscriptionId, stripe_checkout_session_id: null, auto_renew: true })
    .eq("id", membershipId);
}

async function checkAndSetContractEffective(contractId: string, tenantId: string): Promise<void> {
  const { data: contract } = await supabase
    .from("contracts")
    .select("id, status, cancel_by_date, opportunity_id")
    .eq("id", contractId)
    .eq("tenant_id", tenantId)
    .single();

  if (!contract || contract.status !== "signed") return;

  const cancelBy = contract.cancel_by_date ? new Date(contract.cancel_by_date as string) : null;
  if (cancelBy && new Date() < cancelBy) {
    // Still inside cancellation window — deposit is paid but we wait
    console.log(`stripe-webhook: deposit paid for contract ${contractId}, waiting for cancel window (${contract.cancel_by_date})`);
    return;
  }

  const now = new Date().toISOString();
  await supabase
    .from("contracts")
    .update({ status: "effective", effective_at: now })
    .eq("id", contractId)
    .eq("tenant_id", tenantId);

  if (contract.opportunity_id) {
    await supabase
      .from("opportunities")
      .update({ status: "won", won_at: now })
      .eq("id", contract.opportunity_id as string)
      .eq("tenant_id", tenantId);
  }

  console.log(`stripe-webhook: contract ${contractId} set to effective`);

  // Trigger project creation
  await fetch(
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/project-create`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ contract_id: contractId }),
    },
  ).catch((e) => console.error("stripe-webhook: project-create call failed:", e));
}

async function handleSubscriptionDeleted(subscription: Record<string, unknown>): Promise<void> {
  const membershipId = (subscription.metadata as Record<string, string>)?.airbase_membership_id;
  if (!membershipId) return;

  await supabase
    .from("memberships")
    .update({ status: "lapsed", stripe_subscription_id: null, auto_renew: false })
    .eq("id", membershipId);
}

async function handleInvoicePaymentSucceeded(invoice: Record<string, unknown>): Promise<void> {
  const subscriptionId = invoice.subscription as string | null;
  if (!subscriptionId) return;

  // Fetch subscription to get billing_cycle_anchor and current_period_end
  const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${STRIPE_KEY}` },
  });
  if (!subRes.ok) return;
  const sub = await subRes.json() as { metadata: Record<string, string>; current_period_end: number };

  const membershipId = sub.metadata?.airbase_membership_id;
  if (!membershipId) return;

  const expiresAt = new Date(sub.current_period_end * 1000).toISOString();
  await supabase
    .from("memberships")
    .update({ status: "active", expires_at: expiresAt })
    .eq("id", membershipId);
}

async function handleInvoicePaymentFailed(invoice: Record<string, unknown>): Promise<void> {
  const subscriptionId = invoice.subscription as string | null;
  if (!subscriptionId) return;

  // Find membership and customer for SMS alert
  const { data: membership } = await supabase
    .from("memberships")
    .select("id, tenant_id, customer_id, membership_plans(name), customers(name, phone), tenants(name, twilio_phone_number)")
    .eq("stripe_subscription_id", subscriptionId)
    .single();

  if (!membership) return;

  await supabase
    .from("memberships")
    .update({ status: "payment_failed" })
    .eq("id", membership.id as string);

  const customer = membership.customers as { name: string; phone: string | null } | null;
  const tenant   = membership.tenants as { name: string; twilio_phone_number: string | null } | null;
  const plan     = membership.membership_plans as { name: string } | null;

  if (customer?.phone && tenant?.twilio_phone_number) {
    const fn = customer.name?.split(" ")[0] ?? customer.name;
    await sendSms(
      customer.phone,
      tenant.twilio_phone_number,
      `Hi ${fn} — we were unable to process your ${plan?.name ?? "membership"} renewal with ${tenant.name}. Please update your payment method or call us to keep your benefits. Reply STOP to opt out.`,
    );
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const sig  = req.headers.get("stripe-signature");
  const body = await req.text();

  if (!sig || !await verifyStripeSignature(body, sig, STRIPE_WEBHOOK_SECRET)) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  try {
    const obj = event.data.object;
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(obj);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(obj);
        break;
      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(obj);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(obj);
        break;
      default:
        // Unhandled event type — acknowledge and move on
        break;
    }
  } catch (err) {
    console.error(`stripe-webhook: error handling ${event.type}:`, err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
