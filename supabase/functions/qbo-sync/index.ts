import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const QBO_BASE = "https://quickbooks.api.intuit.com/v3/company";

async function refreshQboToken(
  tenantId: string,
  refreshToken: string,
  supabase: ReturnType<typeof createClient>
): Promise<string> {
  const clientId = Deno.env.get("QBO_CLIENT_ID")!;
  const clientSecret = Deno.env.get("QBO_CLIENT_SECRET")!;
  const credentials = btoa(`${clientId}:${clientSecret}`);

  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const data = await res.json() as { access_token: string; refresh_token: string };
  if (!data.access_token) throw new Error("QBO token refresh failed");

  // Persist new tokens
  await supabase
    .from("tenants")
    .update({
      qbo_access_token: data.access_token,
      qbo_refresh_token: data.refresh_token,
    })
    .eq("id", tenantId);

  return data.access_token;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
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

    const { data: tenant } = await supabaseService
      .from("tenants")
      .select("qbo_realm_id, qbo_access_token, qbo_refresh_token")
      .eq("id", tenantId)
      .single();

    if (!tenant?.qbo_realm_id) throw new Error("QuickBooks not connected");

    // Refresh token if needed
    let accessToken = tenant.qbo_access_token as string;
    try {
      const testRes = await fetch(
        `${QBO_BASE}/${tenant.qbo_realm_id}/companyinfo/${tenant.qbo_realm_id}`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
      );
      if (testRes.status === 401) {
        accessToken = await refreshQboToken(tenantId, tenant.qbo_refresh_token as string, supabaseService);
      }
    } catch {
      accessToken = await refreshQboToken(tenantId, tenant.qbo_refresh_token as string, supabaseService);
    }

    // Fetch invoice with line items
    const { data: invoice } = await supabaseService
      .from("invoices")
      .select("*, customers(name, email, qbo_customer_id), invoice_line_items(*)")
      .eq("id", body.invoice_id)
      .eq("tenant_id", tenantId)
      .single();
    if (!invoice) throw new Error("Invoice not found");

    const customer = invoice.customers as { name: string; email: string; qbo_customer_id: string | null };
    const lineItems = invoice.invoice_line_items as Array<{
      description: string;
      quantity: number;
      unit_price: number;
      total: number;
    }>;

    // Build QBO invoice payload
    const qboInvoice = {
      Line: lineItems.map((li, idx) => ({
        Id: (idx + 1).toString(),
        LineNum: idx + 1,
        Amount: li.total,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          Qty: li.quantity,
          UnitPrice: li.unit_price,
          ItemRef: { value: "1", name: "Services" },
        },
        Description: li.description,
      })),
      CustomerRef: customer.qbo_customer_id
        ? { value: customer.qbo_customer_id }
        : { name: customer.name },
      DocNumber: invoice.invoice_number,
      DueDate: invoice.due_date,
    };

    const qboRes = await fetch(
      `${QBO_BASE}/${tenant.qbo_realm_id}/invoice`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(qboInvoice),
      }
    );

    const qboData = await qboRes.json() as { Invoice?: { Id: string }; Fault?: { Error: Array<{ Message: string }> } };

    if (!qboRes.ok || qboData.Fault) {
      const msg = qboData.Fault?.Error?.[0]?.Message ?? "QBO sync failed";
      throw new Error(msg);
    }

    const qboInvoiceId = qboData.Invoice?.Id;

    await supabaseService
      .from("invoices")
      .update({ qbo_invoice_id: qboInvoiceId })
      .eq("id", body.invoice_id);

    return new Response(JSON.stringify({ qbo_invoice_id: qboInvoiceId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("qbo-sync error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
