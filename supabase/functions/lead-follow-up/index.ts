// lead-follow-up: Cadence SMS touches for remodel leads.
// Service-role only — triggered every 2 hours by pg_cron (see migration 051).
//
// Cadence (calendar days after first contact, based on opportunity created_at):
//   Day 1  — 4-hour delay  — initial follow-up if no response to immediate SMS
//   Day 2  — next-day      — second touch
//   Day 5  — 5-day         — third touch
//   Day 10 — 10-day        — final touch
//
// A touch is skipped if:
//   - opportunity.status is 'visit_scheduled', 'won', 'lost', or 'no_decision'
//   - A retell_chat_id or retell_call_id is already set (conversation in progress)
//   - Outside contact window (checked by retell-send)
//
// Each touch increments ai_notes with touch log (non-destructive append).

import { createClient } from "npm:@supabase/supabase-js@2";
import { validateServiceRoleAuth, ok, err } from "../_shared/agent-base.ts";

// ─── Supabase (lazy) ──────────────────────────────────────────────────────────

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
  }
  return _supabase;
}

// ─── Cadence ──────────────────────────────────────────────────────────────────

interface CadenceTouch {
  touch_key: string;      // unique key stored in ai_notes to prevent double-sends
  min_hours: number;      // send >= this many hours after created_at
  max_hours: number;      // send < this many hours after created_at (window)
}

const CADENCE: CadenceTouch[] = [
  { touch_key: "t1_4h",    min_hours: 4,   max_hours: 36  },
  { touch_key: "t2_day2",  min_hours: 36,  max_hours: 72  },
  { touch_key: "t3_day5",  min_hours: 96,  max_hours: 144 },
  { touch_key: "t4_day10", min_hours: 216, max_hours: 264 },
];

function getTouch(ageHours: number, sentTouches: string[]): CadenceTouch | null {
  for (const touch of CADENCE) {
    if (ageHours >= touch.min_hours && ageHours < touch.max_hours) {
      if (!sentTouches.includes(touch.touch_key)) return touch;
    }
  }
  return null;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (!validateServiceRoleAuth(req)) return err("Unauthorized", 401);

  try {
    const now = new Date();
    const cutoffHours = 264; // 11 days — no touches after this

    // Find all opportunities needing a cadence touch, for any tenant
    // that has a retell_voice or retell_sms agent configured
    const { data: retellTenantIds } = await getSupabase()
      .from("agent_config")
      .select("tenant_id")
      .in("agent_type", ["retell_voice", "retell_sms"])
      .eq("enabled", true);

    const tenantIds = [...new Set((retellTenantIds ?? []).map((r: { tenant_id: string }) => r.tenant_id))];
    if (tenantIds.length === 0) return ok({ processed: 0, skipped: 0, sent: 0 });

    const { data: opps } = await getSupabase()
      .from("opportunities")
      .select(`
        id, tenant_id, lead_phone, lead_name,
        retell_chat_id, retell_call_id, ai_notes, created_at,
        tenants!inner(retell_phone_number, timezone)
      `)
      .in("tenant_id", tenantIds)
      .in("status", ["new", "contacted"])
      .is("deleted_at", null)
      .not("lead_phone", "is", null)
      .gte("created_at", new Date(now.getTime() - cutoffHours * 60 * 60 * 1000).toISOString());

    if (!opps || opps.length === 0) {
      return ok({ processed: 0, skipped: 0, sent: 0 });
    }

    let sent = 0;
    let skipped = 0;

    for (const opp of opps) {
      const ageMs = now.getTime() - new Date(opp.created_at as string).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);

      // Parse touch log from ai_notes
      const aiNotes = (opp.ai_notes as string) ?? "";
      const sentTouches = (aiNotes.match(/TOUCH:(\w+)/g) ?? []).map((s: string) =>
        s.replace("TOUCH:", ""),
      );

      // Skip if already in a live conversation
      if (opp.retell_chat_id || opp.retell_call_id) {
        skipped++;
        continue;
      }

      const touch = getTouch(ageHours, sentTouches);
      if (!touch) {
        skipped++;
        continue;
      }

      const phone = opp.lead_phone as string;
      const tenantId = opp.tenant_id as string;

      // Fire retell-send (which applies the contact window guard)
      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/retell-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          to_number: phone,
          channel: "sms",
          opportunity_id: opp.id,
          touch_type: touch.touch_key,
          dynamic_variables: {
            lead_name: ((opp.lead_name as string) ?? "there").split(" ")[0],
          },
        }),
      });

      const result = await res.json() as Record<string, unknown>;

      if (result.skipped) {
        skipped++;
        continue;
      }

      if (result.sent) {
        // Append touch key to ai_notes so we don't send it again
        await getSupabase()
          .from("opportunities")
          .update({
            ai_notes: aiNotes
              ? `${aiNotes}\nTOUCH:${touch.touch_key} ${now.toISOString()}`
              : `TOUCH:${touch.touch_key} ${now.toISOString()}`,
          })
          .eq("id", opp.id)
          .eq("tenant_id", tenantId);

        sent++;
      } else {
        skipped++;
      }
    }

    console.log(`lead-follow-up: processed ${opps.length}, sent ${sent}, skipped ${skipped}`);
    return ok({ processed: opps.length, sent, skipped });
  } catch (e) {
    console.error("lead-follow-up error:", e);
    return err(String(e));
  }
});
