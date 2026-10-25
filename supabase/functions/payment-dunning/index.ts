/**
 * payment-dunning
 *
 * Nightly sweep — sends SMS (and email when available) reminders for overdue invoices.
 *   Day 7:  First reminder, status → 'overdue'
 *   Day 14: Second reminder, increased urgency
 *   Day 30: Final notice, mentions escalation
 *
 * Trigger: pg_cron (see migration 041 for setup SQL)
 * Body (optional): { tenantId?: string } — scope to a single tenant for testing
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { logAgentAction } from "../_shared/agent-logger.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN  = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const SENDGRID_KEY       = Deno.env.get("SENDGRID_API_KEY");
const SENDGRID_FROM      = Deno.env.get("SENDGRID_FROM_EMAIL") ?? "billing@example.com";

// ─── SMS helper ───────────────────────────────────────────────────────────────

async function sendSms(to: string, from: string, body: string): Promise<void> {
  const res = await fetch(
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio SMS failed: ${res.status} ${text}`);
  }
}

async function sendEmail(
  toEmail: string,
  toName: string,
  subject: string,
  html: string,
  fromName: string,
): Promise<void> {
  if (!SENDGRID_KEY) return;
  await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${SENDGRID_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail, name: toName }] }],
      from: { email: SENDGRID_FROM, name: fromName },
      subject,
      content: [{ type: "text/html", value: html }],
    }),
  });
}

// ─── Message copy ─────────────────────────────────────────────────────────────

function firstName(name: string): string {
  return name?.split(" ")[0] ?? name;
}

function dunningMessage(
  customerName: string,
  invoiceNumber: string,
  total: number,
  companyName: string,
  daysTier: 7 | 14 | 30,
  paymentLink: string | null,
): string {
  const fn  = firstName(customerName);
  const amt = `$${total.toFixed(2)}`;
  const pay = paymentLink ? ` Pay now: ${paymentLink}` : " Call us to pay.";

  if (daysTier === 7) {
    return `Hi ${fn} — a friendly reminder that invoice ${invoiceNumber} for ${amt} from ${companyName} is now past due.${pay} Reply STOP to opt out.`;
  }
  if (daysTier === 14) {
    return `Hi ${fn} — your invoice ${invoiceNumber} for ${amt} from ${companyName} is 2 weeks overdue. Please arrange payment at your earliest convenience.${pay} Questions? Call us. Reply STOP to opt out.`;
  }
  return `Hi ${fn} — final notice: invoice ${invoiceNumber} for ${amt} from ${companyName} is 30 days overdue. Please pay today to avoid further action.${pay} Reply STOP to opt out.`;
}

// ─── Sweep ────────────────────────────────────────────────────────────────────

interface InvoiceRecord {
  id: string;
  tenant_id: string;
  invoice_number: string;
  total: number;
  status: string;
  due_date: string;
  stripe_payment_link: string | null;
  dunning_sent_at_7: string | null;
  dunning_sent_at_14: string | null;
  dunning_sent_at_30: string | null;
  customers: { name: string; phone: string | null; email: string | null } | null;
  tenants: { name: string; twilio_phone_number: string | null } | null;
}

async function runDunningSweep(
  scopedTenantId: string | null,
  summary: { sent: number; skipped: number; errors: number },
) {
  const today = new Date();
  const fmt   = (d: Date) => d.toISOString().split("T")[0];

  // Oldest due_date worth dunning: 31 days ago
  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() - 31);

  let query = supabase
    .from("invoices")
    .select("id,tenant_id,invoice_number,total,status,due_date,stripe_payment_link,dunning_sent_at_7,dunning_sent_at_14,dunning_sent_at_30,customers(name,phone,email),tenants(name,twilio_phone_number)")
    .in("status", ["sent", "viewed", "overdue"])
    .lt("due_date", fmt(today))    // already past due
    .gte("due_date", fmt(cutoff)); // not older than 31 days

  if (scopedTenantId) query = query.eq("tenant_id", scopedTenantId);

  const { data: invoices, error } = await query;
  if (error) { console.error("dunning fetch error:", error); return; }

  for (const inv of (invoices ?? []) as unknown as InvoiceRecord[]) {
    const customer = inv.customers;
    const tenant   = inv.tenants;

    if (!customer?.phone || !tenant?.twilio_phone_number) {
      summary.skipped++;
      continue;
    }

    const dueDate   = new Date(inv.due_date);
    const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000);

    // Determine which tier applies (most recent first, stops at first match)
    let tier: 7 | 14 | 30 | null = null;
    if (daysOverdue >= 30 && !inv.dunning_sent_at_30) tier = 30;
    else if (daysOverdue >= 14 && !inv.dunning_sent_at_14) tier = 14;
    else if (daysOverdue >= 7  && !inv.dunning_sent_at_7)  tier = 7;

    if (!tier) { summary.skipped++; continue; }

    const smsBody = dunningMessage(
      customer.name,
      inv.invoice_number,
      inv.total,
      tenant.name,
      tier,
      inv.stripe_payment_link,
    );

    try {
      await sendSms(customer.phone, tenant.twilio_phone_number, smsBody);

      // Email if available
      if (customer.email) {
        const subject = tier === 30
          ? `Final notice: invoice ${inv.invoice_number} from ${tenant.name}`
          : `Payment reminder: invoice ${inv.invoice_number} from ${tenant.name}`;
        await sendEmail(customer.email, customer.name, subject, `<p>${smsBody}</p>`, tenant.name);
      }

      const col = `dunning_sent_at_${tier}` as "dunning_sent_at_7" | "dunning_sent_at_14" | "dunning_sent_at_30";
      await supabase
        .from("invoices")
        .update({
          [col]: new Date().toISOString(),
          ...(tier === 7 && inv.status !== "overdue" ? { status: "overdue" } : {}),
        })
        .eq("id", inv.id);

      await logAgentAction(supabase, {
        tenantId:        inv.tenant_id,
        agentType:       "payment_dunning",
        triggerEvent:    `invoice:${inv.id}:dunning_day_${tier}`,
        contextSnapshot: { invoice_id: inv.id, days_overdue: daysOverdue, total: inv.total },
        reasoning:       `Invoice ${inv.invoice_number} is ${daysOverdue} days overdue. Sending Day ${tier} dunning SMS to ${customer.name}.`,
        proposedAction:  { type: "sms", tier, to: customer.phone, body: smsBody },
        confidence:      1.0,
        autoExecute:     true,
      });

      summary.sent++;
    } catch (err) {
      console.error(`dunning SMS failed for invoice ${inv.id}:`, err);
      summary.errors++;
    }
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  try {
    let tenantId: string | null = null;
    try {
      const body = await req.json() as { tenantId?: string };
      tenantId = body.tenantId ?? null;
    } catch {
      // no body — run for all tenants
    }

    const summary = { sent: 0, skipped: 0, errors: 0 };
    await runDunningSweep(tenantId, summary);

    console.log("payment-dunning complete:", summary);
    return new Response(JSON.stringify({ ok: true, ...summary }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("payment-dunning fatal error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
