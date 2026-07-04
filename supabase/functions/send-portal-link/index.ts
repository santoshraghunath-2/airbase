// Send Portal Link — fires when an invoice is sent.
// Upserts a portal_invitation for the customer, then sends an SMS with the portal URL.
// Falls back silently if the customer has no phone number.

import { createClient } from "npm:@supabase/supabase-js@2";
import { validateServiceRoleAuth, ok, err } from "../_shared/agent-base.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const APP_URL = Deno.env.get("APP_URL") ?? "https://app.airbase.io";

Deno.serve(async (req: Request) => {
  if (!validateServiceRoleAuth(req)) return err("Unauthorized", 401);

  try {
    const payload = await req.json();
    const invoice = payload.record as Record<string, unknown>;

    if (invoice.status !== "sent") return ok({ skip: true });

    const tenantId    = invoice.tenant_id as string;
    const customerId  = invoice.customer_id as string;
    const invoiceId   = invoice.id as string;

    // Upsert portal invitation (one per customer per tenant)
    const { data: existingInvite } = await supabase
      .from("portal_invitations")
      .select("id, token")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .maybeSingle();

    let token: string;

    if (existingInvite) {
      token = (existingInvite as Record<string, string>).token;
      // Refresh expiry on re-send
      await supabase
        .from("portal_invitations")
        .update({
          expires_at:   new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
          last_sent_at: new Date().toISOString(),
        })
        .eq("id", (existingInvite as Record<string, string>).id);
    } else {
      const { data: newInvite, error: insertErr } = await supabase
        .from("portal_invitations")
        .insert({ tenant_id: tenantId, customer_id: customerId, last_sent_at: new Date().toISOString() })
        .select("token")
        .single();
      if (insertErr || !newInvite) throw insertErr ?? new Error("Failed to create portal invitation");
      token = (newInvite as Record<string, string>).token;
    }

    const portalUrl = `${APP_URL}/portal/${token}`;

    // Store portal URL on the invoice for display in the customer portal
    await supabase
      .from("invoices")
      .update({ payment_link_url: portalUrl })
      .eq("id", invoiceId)
      .is("payment_link_url", null);

    // Look up customer phone
    const { data: customer } = await supabase
      .from("customers")
      .select("name, phone")
      .eq("id", customerId)
      .single();

    const c = customer as { name: string; phone: string } | null;
    if (!c?.phone) return ok({ skip: "no customer phone" });

    // Look up tenant for SMS sender name
    const { data: tenant } = await supabase
      .from("tenants")
      .select("name, twilio_phone_number")
      .eq("id", tenantId)
      .single();

    const t = tenant as { name: string; twilio_phone_number: string | null } | null;
    if (!t?.twilio_phone_number) return ok({ skip: "no twilio number configured" });

    // Send SMS via existing send-sms function
    await supabase.functions.invoke("send-sms", {
      body: {
        to:       c.phone,
        tenantId,
        message:  `Hi ${c.name.split(" ")[0]}, your invoice from ${t.name} is ready. View your invoice, pay online, and manage your service history here: ${portalUrl}`,
      },
    });

    return ok({ portalUrl, token, customerPhone: c.phone });
  } catch (e) {
    console.error("send-portal-link error:", e);
    return err(String(e));
  }
});
