/**
 * membership-agent
 *
 * Nightly sweep edge function. Handles two jobs:
 *   1. Pre-expiry outreach  — 60 / 30 / 7 days before a membership expires
 *   2. Win-back sequences   — 7 / 30 / 90 days after a membership lapses
 *
 * Trigger: pg_cron (run nightly at 09:00 local time) OR manual POST.
 *   SELECT cron.schedule(
 *     'membership-agent-nightly',
 *     '0 17 * * *',   -- 09:00 PT = 17:00 UTC
 *     $$ SELECT net.http_post(
 *          url      := 'https://<project>.supabase.co/functions/v1/membership-agent',
 *          headers  := '{"Authorization": "Bearer <service_role_key>"}',
 *          body     := '{}'
 *        ) $$
 *   );
 *
 * Body (optional): { tenantId?: string }  — scope to a single tenant for testing.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { logAgentAction } from "../_shared/agent-logger.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN  = Deno.env.get("TWILIO_AUTH_TOKEN")!;

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

function firstName(name: string): string {
  return name?.split(" ")[0] ?? name;
}

// ─── Message templates ────────────────────────────────────────────────────────

function preExpiryMessage(
  customerName: string,
  planName: string,
  daysLeft: number,
  companyName: string,
  autoRenew: boolean,
): string {
  const fn = firstName(customerName);
  const urgency = daysLeft <= 7 ? "just" : daysLeft <= 30 ? "soon" : "coming up";
  const renewClause = autoRenew
    ? `Your plan renews automatically — no action needed.`
    : `Reply RENEW to keep your benefits, or call us to update your payment.`;
  return (
    `Hi ${fn}! Your ${planName} with ${companyName} expires ${urgency} — in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}. ` +
    `${renewClause} Questions? Call us anytime. Reply STOP to opt out.`
  );
}

function winBackMessage(
  customerName: string,
  planName: string,
  daysSinceLapse: number,
  companyName: string,
): string {
  const fn = firstName(customerName);
  if (daysSinceLapse <= 10) {
    return (
      `Hi ${fn} — we noticed your ${planName} with ${companyName} expired recently. ` +
      `Renew today to keep your priority scheduling, discounts, and free service calls. ` +
      `Reply YES to reactivate or call us. Reply STOP to opt out.`
    );
  }
  if (daysSinceLapse <= 35) {
    return (
      `Hi ${fn}! It's been a month since your ${planName} with ${companyName} lapsed. ` +
      `Members save an average of $200/year on plumbing and HVAC. ` +
      `Ready to rejoin? Reply YES or call us. Reply STOP to opt out.`
    );
  }
  return (
    `Hi ${fn} — it's been a while since your ${planName} with ${companyName}! ` +
    `We'd love to have you back. Members get priority scheduling, parts discounts, and peace of mind year-round. ` +
    `Rejoin anytime — reply YES or call us. Reply STOP to opt out.`
  );
}

// ─── Sweep helpers ────────────────────────────────────────────────────────────

interface MembershipRecord {
  id: string;
  customer_id: string;
  plan_id: string;
  status: string;
  billing_cycle: string;
  expires_at: string;
  auto_renew: boolean;
  outreach_sent_at_60: string | null;
  outreach_sent_at_30: string | null;
  outreach_sent_at_7:  string | null;
  win_back_sent_at_7:  string | null;
  win_back_sent_at_30: string | null;
  win_back_sent_at_90: string | null;
  customers: { name: string; phone: string } | null;
  membership_plans: { name: string } | null;
  tenants: { name: string; twilio_phone_number: string | null } | null;
}

async function runPreExpirySweep(
  scopedTenantId: string | null,
  summary: { sent: number; skipped: number; errors: number },
) {
  const today      = new Date();
  const in7days    = new Date(today); in7days.setDate(today.getDate() + 7);
  const in30days   = new Date(today); in30days.setDate(today.getDate() + 30);
  const in60days   = new Date(today); in60days.setDate(today.getDate() + 60);

  const fmt = (d: Date) => d.toISOString().split("T")[0];

  // Fetch all active memberships expiring within 61 days
  let query = supabase
    .from("memberships")
    .select("id,tenant_id,customer_id,plan_id,status,billing_cycle,expires_at,auto_renew,outreach_sent_at_60,outreach_sent_at_30,outreach_sent_at_7,customers(name,phone),membership_plans(name),tenants(name,twilio_phone_number)")
    .eq("status", "active")
    .lte("expires_at", fmt(in60days))
    .gte("expires_at", fmt(today));

  if (scopedTenantId) query = query.eq("tenant_id", scopedTenantId);

  const { data: memberships, error } = await query;
  if (error) { console.error("pre-expiry fetch error:", error); return; }

  for (const m of (memberships ?? []) as unknown as (MembershipRecord & { tenant_id: string })[]) {
    const customer  = m.customers;
    const plan      = m.membership_plans;
    const tenant    = m.tenants;

    if (!customer?.phone || !tenant?.twilio_phone_number || !plan?.name) {
      summary.skipped++;
      continue;
    }

    const expiresDate  = new Date(m.expires_at);
    const daysLeft     = Math.ceil((expiresDate.getTime() - today.getTime()) / 86_400_000);

    // Determine which outreach tier applies (most urgent first)
    let tier: "7" | "30" | "60" | null = null;
    if (daysLeft <= 7  && !m.outreach_sent_at_7)  tier = "7";
    else if (daysLeft <= 30 && !m.outreach_sent_at_30) tier = "30";
    else if (daysLeft <= 60 && !m.outreach_sent_at_60) tier = "60";

    if (!tier) { summary.skipped++; continue; }

    const body = preExpiryMessage(customer.name, plan.name, daysLeft, tenant.name, m.auto_renew);

    try {
      await sendSms(customer.phone, tenant.twilio_phone_number, body);

      const col = `outreach_sent_at_${tier}` as "outreach_sent_at_7" | "outreach_sent_at_30" | "outreach_sent_at_60";
      await supabase.from("memberships").update({ [col]: new Date().toISOString() }).eq("id", m.id);

      await logAgentAction(supabase, {
        tenantId:        m.tenant_id,
        agentType:       "membership",
        triggerEvent:    `membership:${m.id}:pre_expiry_${tier}d`,
        contextSnapshot: { membership_id: m.id, customer_id: m.customer_id, days_left: daysLeft },
        reasoning:       `Membership expires in ${daysLeft} days. Sending ${tier}-day pre-expiry outreach to ${customer.name}.`,
        proposedAction:  { type: "sms", tier, to: customer.phone, body },
        confidence:      1.0,
        autoExecute:     true,
      });

      summary.sent++;
    } catch (err) {
      console.error(`pre-expiry SMS failed for membership ${m.id}:`, err);
      summary.errors++;
    }
  }
}

async function runWinBackSweep(
  scopedTenantId: string | null,
  summary: { sent: number; skipped: number; errors: number },
) {
  const today = new Date();

  // Windows: lapsed 5–10 days ago (7d), 25–35 days ago (30d), 85–95 days ago (90d)
  const windows = [
    { label: "7",  daysAgo: 7,  range: [5,  10], col: "win_back_sent_at_7"  as const },
    { label: "30", daysAgo: 30, range: [25, 35], col: "win_back_sent_at_30" as const },
    { label: "90", daysAgo: 90, range: [85, 95], col: "win_back_sent_at_90" as const },
  ];

  for (const win of windows) {
    const fromDate = new Date(today); fromDate.setDate(today.getDate() - win.range[1]);
    const toDate   = new Date(today); toDate.setDate(today.getDate() - win.range[0]);
    const fmt      = (d: Date) => d.toISOString().split("T")[0];

    let query = supabase
      .from("memberships")
      .select("id,tenant_id,customer_id,plan_id,status,expires_at,win_back_sent_at_7,win_back_sent_at_30,win_back_sent_at_90,customers(name,phone),membership_plans(name),tenants(name,twilio_phone_number)")
      .eq("status", "lapsed")
      .gte("expires_at", fmt(fromDate))
      .lte("expires_at", fmt(toDate))
      .is(win.col, null);

    if (scopedTenantId) query = query.eq("tenant_id", scopedTenantId);

    const { data: memberships, error } = await query;
    if (error) { console.error(`win-back ${win.label}d fetch error:`, error); continue; }

    for (const m of (memberships ?? []) as unknown as MembershipRecord[]) {
      const customer = m.customers;
      const plan     = m.membership_plans;
      const tenant   = m.tenants;

      if (!customer?.phone || !tenant?.twilio_phone_number || !plan?.name) {
        summary.skipped++;
        continue;
      }

      const lapseDate    = new Date(m.expires_at);
      const daysSinceLapse = Math.ceil((today.getTime() - lapseDate.getTime()) / 86_400_000);
      const body = winBackMessage(customer.name, plan.name, daysSinceLapse, tenant.name);

      try {
        await sendSms(customer.phone, tenant.twilio_phone_number, body);
        await supabase.from("memberships").update({ [win.col]: new Date().toISOString() }).eq("id", m.id);
        summary.sent++;
      } catch (err) {
        console.error(`win-back ${win.label}d SMS failed for membership ${m.id}:`, err);
        summary.errors++;
      }
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
    await runPreExpirySweep(tenantId, summary);
    await runWinBackSweep(tenantId, summary);

    console.log("membership-agent complete:", summary);
    return new Response(JSON.stringify({ ok: true, ...summary }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("membership-agent fatal error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
