// page-on-call — resolves who is on call, writes a pages row, sends push + voice.
// Called by ops-sweep, operator-agent (escalate), and Phase 1 simple escalation path.
// Replaces Phase 1's simple escalation. Falls back to tenants.escalation_phone when
// on_call roster is empty.
//
// Unacknowledged pages roll to the next person in sort_order after 10 minutes.
// Rollover is polled by a pg_cron every 11 minutes (see migration 066 comment).

import { createClient } from "npm:@supabase/supabase-js@2";
import { validateServiceRoleAuth } from "../_shared/agent-base.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase     = createClient(SUPABASE_URL, SERVICE_KEY);

// ─── Types ────────────────────────────────────────────────────────────────────

interface PageRequest {
  tenantId: string;
  reason:   string;
  urgency:  "normal" | "urgent";
  summary:  string;
  role?:    string;  // defaults to 'owner'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveOnCallUser(
  tenantId: string,
  role: string,
): Promise<{ userId: string; name: string } | null> {
  const now = new Date().toISOString();

  const { data } = await supabase
    .from("on_call")
    .select("user_id, users(id, name)")
    .eq("tenant_id", tenantId)
    .eq("role", role)
    .lte("start_at", now)
    .gte("end_at", now)
    .order("sort_order", { ascending: true })
    .limit(1);

  if (!data?.length) return null;

  const row = data[0] as Record<string, unknown>;
  const user = row.users as { id: string; name: string } | null;
  if (!user) return null;

  return { userId: user.id, name: user.name };
}

async function sendPagePush(
  userId: string,
  title: string,
  body: string,
  pageId: string,
): Promise<void> {
  const { data: tokens } = await supabase
    .from("device_tokens")
    .select("token, platform")
    .eq("user_id", userId);

  if (!tokens?.length) return;

  await supabase.functions.invoke("push-notification", {
    body: {
      tokens,
      title,
      body,
      data: { type: "page", page_id: pageId },
    },
  }).catch((e: unknown) => console.error("sendPagePush failed:", e));
}

async function placeVoiceCall(
  tenantId: string,
  userId: string,
  summary: string,
): Promise<void> {
  // Get user phone
  const { data: user } = await supabase
    .from("users")
    .select("phone")
    .eq("id", userId)
    .single();

  if (!(user as Record<string, unknown> | null)?.phone) return;

  // Call retell-send with voice channel
  await supabase.functions.invoke("retell-send", {
    body: {
      tenantId,
      to:      (user as Record<string, unknown>).phone,
      message: summary,
      channel: "voice",
    },
  }).catch((e: unknown) => console.error("placeVoiceCall failed:", e));
}

// ─── Main page logic ──────────────────────────────────────────────────────────

async function sendPage(req: PageRequest): Promise<{ pageId: string; paged: string | null }> {
  const role = req.role ?? "owner";

  const onCall = await resolveOnCallUser(req.tenantId, role);

  // Fallback: get escalation_phone from tenant and log a page with no user
  if (!onCall) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("escalation_phone, name")
      .eq("id", req.tenantId)
      .single();

    const { data: page } = await supabase
      .from("pages")
      .insert({
        tenant_id:      req.tenantId,
        reason:         req.reason,
        urgency:        req.urgency,
        summary:        req.summary,
        target_user_id: null,
      })
      .select("id")
      .single();

    const phone = (tenant as Record<string, unknown> | null)?.escalation_phone as string | undefined;
    console.log(`No on-call staff found for ${req.tenantId}/${role}. Fallback phone: ${phone ?? "none"}`);

    return { pageId: (page as { id: string })?.id ?? "unknown", paged: phone ?? null };
  }

  // Create the page row
  const { data: page } = await supabase
    .from("pages")
    .insert({
      tenant_id:      req.tenantId,
      reason:         req.reason,
      urgency:        req.urgency,
      summary:        req.summary,
      target_user_id: onCall.userId,
    })
    .select("id")
    .single();

  const pageId = (page as { id: string })?.id ?? "unknown";
  const title  = req.urgency === "urgent" ? `🚨 Urgent: ${req.reason}` : `📟 ${req.reason}`;

  await sendPagePush(onCall.userId, title, req.summary, pageId);

  if (req.urgency === "urgent") {
    await placeVoiceCall(req.tenantId, onCall.userId, req.summary);
  }

  return { pageId, paged: onCall.name };
}

// ─── Rollover check ───────────────────────────────────────────────────────────
// Called by pg_cron every 11 minutes to roll unacknowledged pages.

async function processRollovers(): Promise<void> {
  const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  // Find unacknowledged pages older than 10 min with no rollover yet
  const { data: stalePages } = await supabase
    .from("pages")
    .select("id, tenant_id, reason, urgency, summary, target_user_id")
    .is("acknowledged_at", null)
    .is("rolled_to_id", null)
    .lt("sent_at", tenMinsAgo);

  for (const stalePage of stalePages ?? []) {
    const p = stalePage as Record<string, unknown>;

    // Find the next person in the on-call roster after the current target
    const now = new Date().toISOString();
    const { data: roster } = await supabase
      .from("on_call")
      .select("user_id, sort_order, users(id, name)")
      .eq("tenant_id", p.tenant_id as string)
      .lte("start_at", now)
      .gte("end_at", now)
      .order("sort_order", { ascending: true });

    if (!roster?.length) continue;

    const currentIdx = (roster as Array<{ user_id: string }>).findIndex(
      (r) => r.user_id === p.target_user_id
    );

    const nextEntry = (roster as Array<{ user_id: string; users: { id: string; name: string } }>)[currentIdx + 1];
    if (!nextEntry) continue;

    // Create the rollover page
    const { data: newPage } = await supabase
      .from("pages")
      .insert({
        tenant_id:      p.tenant_id,
        reason:         p.reason,
        urgency:        p.urgency,
        summary:        `[Rollover from unacknowledged page] ${p.summary as string}`,
        target_user_id: nextEntry.user_id,
      })
      .select("id")
      .single();

    const newPageId = (newPage as { id: string })?.id;

    // Link the old page to the new one
    await supabase
      .from("pages")
      .update({ rolled_to_id: newPageId })
      .eq("id", p.id as string);

    // Send push to next person
    await sendPagePush(
      nextEntry.user_id,
      `🔄 Rollover: ${p.reason as string}`,
      `${nextEntry.users.name}, the previous on-call didn't respond. ${p.summary as string}`,
      newPageId,
    );
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  if (!validateServiceRoleAuth(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const body = await req.json() as Record<string, unknown>;

    // Rollover mode: triggered by a separate pg_cron schedule
    if (body.mode === "rollover") {
      await processRollovers();
      return new Response(JSON.stringify({ ok: true, mode: "rollover" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // Normal page
    const { tenantId, reason, urgency = "normal", summary, role } = body as {
      tenantId: string;
      reason:   string;
      urgency?: string;
      summary:  string;
      role?:    string;
    };

    if (!tenantId || !reason || !summary) {
      return new Response(JSON.stringify({ error: "tenantId, reason, and summary are required" }), { status: 400 });
    }

    const result = await sendPage({
      tenantId,
      reason,
      urgency: (urgency === "urgent" ? "urgent" : "normal"),
      summary,
      role,
    });

    return new Response(JSON.stringify(result), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("page-on-call error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
