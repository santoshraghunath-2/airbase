import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";
import Stripe from "npm:stripe";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    apiVersion: "2024-12-18.acacia",
  });

  const supabaseService = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // Handle Stripe webhook (no auth header needed — verified by signature)
    if (req.headers.get("stripe-signature")) {
      const payload = await req.text();
      const sig = req.headers.get("stripe-signature")!;
      const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Webhook verification failed";
        return new Response(JSON.stringify({ error: msg }), { status: 400 });
      }

      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object as Stripe.PaymentIntent;
        const invoiceId = pi.metadata.invoice_id;
        if (invoiceId) {
          // Mark payment succeeded
          await supabaseService.from("payments").update({
            status: "succeeded",
            processed_at: new Date().toISOString(),
          }).eq("stripe_payment_intent_id", pi.id);

          // Update invoice
          await supabaseService.from("invoices").update({
            status: "paid",
            amount_paid: pi.amount_received / 100,
            balance_due: 0,
            paid_at: new Date().toISOString(),
          }).eq("id", invoiceId);
        }
      }

      return new Response(JSON.stringify({ received: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Regular call: create payment intent + Stripe payment link
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const { data: userRecord } = await supabaseService
      .from("users")
      .select("tenant_id")
      .eq("auth_id", user.id)
      .single();
    if (!userRecord) throw new Error("User not found");

    const tenantId = userRecord.tenant_id as string;
    const body = await req.json() as { invoice_id: string };

    const { data: invoice } = await supabaseService
      .from("invoices")
      .select("*, customers(name, email)")
      .eq("id", body.invoice_id)
      .eq("tenant_id", tenantId)
      .single();
    if (!invoice) throw new Error("Invoice not found");

    const amountCents = Math.round((invoice.balance_due as number) * 100);
    if (amountCents <= 0) throw new Error("Invoice already paid");

    const customer = invoice.customers as { name: string; email: string };

    // Create Stripe Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      metadata: {
        invoice_id: body.invoice_id,
        tenant_id: tenantId,
        customer_name: customer.name,
        invoice_number: invoice.invoice_number as string,
      },
      description: `Invoice ${invoice.invoice_number as string} — ${customer.name}`,
    });

    // Record the pending payment
    await supabaseService.from("payments").insert({
      tenant_id: tenantId,
      invoice_id: body.invoice_id,
      stripe_payment_intent_id: paymentIntent.id,
      amount: invoice.balance_due as number,
      status: "pending",
    });

    return new Response(
      JSON.stringify({
        client_secret: paymentIntent.client_secret,
        payment_intent_id: paymentIntent.id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("process-payment error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
