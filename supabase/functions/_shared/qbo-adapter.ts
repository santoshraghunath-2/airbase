/**
 * QuickBooks Online accounting adapter.
 * Wraps the existing qbo-sync function's token-refresh + API call pattern.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import type { AccountingAdapter, InvoicePayload, PaymentPayload, CostPayload, AdapterResult } from "./accounting-adapter.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const QBO_BASE = "https://quickbooks.api.intuit.com/v3/company";

async function getQboAccessToken(tenantId: string): Promise<{ accessToken: string; realmId: string }> {
  const { data: tenant } = await supabase
    .from("tenants")
    .select("qbo_access_token, qbo_refresh_token, qbo_realm_id")
    .eq("id", tenantId)
    .single();

  if (!tenant?.qbo_realm_id) throw new Error("QBO not connected for this tenant");

  // Try stored access token first; refresh if needed
  let accessToken = tenant.qbo_access_token as string;

  // Probe: a stale token will fail on the first API call and we'll refresh then.
  // (Full token-expiry check would require storing expiry timestamp — keeping it simple.)
  return { accessToken, realmId: tenant.qbo_realm_id as string };
}

async function refreshAndRetry(tenantId: string): Promise<{ accessToken: string; realmId: string }> {
  const { data: tenant } = await supabase
    .from("tenants")
    .select("qbo_refresh_token, qbo_realm_id")
    .eq("id", tenantId)
    .single();

  if (!tenant?.qbo_refresh_token) throw new Error("No QBO refresh token");

  const clientId     = Deno.env.get("QBO_CLIENT_ID")!;
  const clientSecret = Deno.env.get("QBO_CLIENT_SECRET")!;
  const credentials  = btoa(`${clientId}:${clientSecret}`);

  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method:  "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({ grant_type: "refresh_token", refresh_token: tenant.qbo_refresh_token as string }),
  });

  const data = await res.json() as { access_token: string; refresh_token: string };
  if (!data.access_token) throw new Error("QBO token refresh failed");

  await supabase
    .from("tenants")
    .update({ qbo_access_token: data.access_token, qbo_refresh_token: data.refresh_token })
    .eq("id", tenantId);

  return { accessToken: data.access_token, realmId: tenant.qbo_realm_id as string };
}

async function qboPost(
  tenantId: string,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data: unknown }> {
  let { accessToken, realmId } = await getQboAccessToken(tenantId);

  const doRequest = async (token: string) =>
    fetch(`${QBO_BASE}/${realmId}${endpoint}`, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept:         "application/json",
      },
      body: JSON.stringify(body),
    });

  let res = await doRequest(accessToken);
  if (res.status === 401) {
    // Token expired — refresh and retry once
    const refreshed = await refreshAndRetry(tenantId);
    accessToken = refreshed.accessToken;
    res = await doRequest(accessToken);
  }

  const data = await res.json();
  return { ok: res.ok, data };
}

export class QuickBooksAdapter implements AccountingAdapter {
  async postInvoice(tenantId: string, payload: InvoicePayload): Promise<AdapterResult> {
    try {
      const { data: customer } = await supabase
        .from("customers")
        .select("name, qbo_customer_id")
        .eq("id", payload.customer_id)
        .single();

      if (!(customer as { qbo_customer_id?: string } | null)?.qbo_customer_id) {
        return { success: false, error: "Customer has no QBO ID — sync customer first" };
      }

      const qboInvoice = {
        Line: [{
          Amount:        payload.amount_cents / 100,
          DetailType:    "SalesItemLineDetail",
          Description:   `${payload.project_name} — ${payload.milestone_name}`,
          SalesItemLineDetail: {
            Qty:       1,
            UnitPrice: payload.amount_cents / 100,
          },
        }],
        CustomerRef: { value: (customer as { qbo_customer_id: string }).qbo_customer_id },
        DocNumber:   payload.invoice_number,
        PrivateNote: `Airbase invoice ${payload.invoice_id}`,
      };

      const { ok, data } = await qboPost(tenantId, "/invoice", qboInvoice);
      if (!ok) {
        const errText = JSON.stringify(data);
        return { success: false, error: `QBO invoice creation failed: ${errText}` };
      }

      const qboId = (data as { Invoice?: { Id?: string } })?.Invoice?.Id;

      // Store QBO ID on the invoice for reconciliation
      if (qboId) {
        await supabase
          .from("invoices")
          .update({ qbo_invoice_id: qboId })
          .eq("id", payload.invoice_id);
      }

      return { success: true, external_id: qboId };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async postPayment(tenantId: string, payload: PaymentPayload): Promise<AdapterResult> {
    try {
      const { data: invoice } = await supabase
        .from("invoices")
        .select("qbo_invoice_id, customer_id")
        .eq("id", payload.invoice_id)
        .single();

      if (!(invoice as { qbo_invoice_id?: string } | null)?.qbo_invoice_id) {
        return { success: false, error: "Invoice has no QBO ID — post invoice first" };
      }

      const { data: customer } = await supabase
        .from("customers")
        .select("qbo_customer_id")
        .eq("id", (invoice as { customer_id: string }).customer_id)
        .single();

      const qboPayment = {
        TotalAmt:    payload.amount_cents / 100,
        CustomerRef: { value: (customer as { qbo_customer_id: string }).qbo_customer_id },
        Line: [{
          Amount:        payload.amount_cents / 100,
          LinkedTxn: [{ TxnId: (invoice as { qbo_invoice_id: string }).qbo_invoice_id, TxnType: "Invoice" }],
        }],
        TxnDate:     payload.paid_at.slice(0, 10),
        PrivateNote: `Airbase payment ${payload.payment_id}`,
      };

      const { ok, data } = await qboPost(tenantId, "/payment", qboPayment);
      if (!ok) {
        return { success: false, error: `QBO payment failed: ${JSON.stringify(data)}` };
      }

      return { success: true, external_id: (data as { Payment?: { Id?: string } })?.Payment?.Id };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async postCost(tenantId: string, payload: CostPayload): Promise<AdapterResult> {
    try {
      // Post project costs as QBO Purchases (expenses)
      const qboPurchase = {
        PaymentType: "Cash",
        EntityRef:   { type: "Vendor", name: "Airbase Project Cost" },
        Line: [{
          Amount:          payload.amount_cents / 100,
          DetailType:      "AccountBasedExpenseLineDetail",
          Description:     `${payload.description} (${payload.cost_type})`,
          AccountBasedExpenseLineDetail: {
            AccountRef: { name: "Job Costs" }, // PLACEHOLDER: use actual chart-of-accounts ref
          },
        }],
        TxnDate:     payload.occurred_at,
        PrivateNote: `Airbase cost ${payload.cost_id}`,
      };

      const { ok, data } = await qboPost(tenantId, "/purchase", qboPurchase);
      if (!ok) {
        return { success: false, error: `QBO purchase failed: ${JSON.stringify(data)}` };
      }

      return { success: true, external_id: (data as { Purchase?: { Id?: string } })?.Purchase?.Id };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}
