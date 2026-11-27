/**
 * accounting-post
 *
 * Drains pending rows from accounting_outbox and posts them to the
 * configured accounting adapter (QuickBooks or BuildersBooks).
 *
 * Trigger: pg_cron every 15 minutes (see backlog for setup SQL), or POST body.
 * Auth: service-role only.
 *
 * Retry logic:
 *   - Up to MAX_ATTEMPTS before marking a row as 'failed'
 *   - Uses optimistic locking (status → 'posting') to prevent double-posting
 *
 * Optional body: { tenant_id?: string } — scope to a single tenant for testing.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { getAdapter } from "../_shared/accounting-adapter.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MAX_ATTEMPTS = 5;
const BATCH_SIZE   = 20;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

interface OutboxRow {
  id:            string;
  tenant_id:     string;
  event_type:    string;
  entity_type:   string;
  entity_id:     string;
  payload:       Record<string, unknown>;
  target_system: string;
  attempts:      number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // Service-role only: this function writes to external accounting systems.
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!authHeader.includes(serviceKey) && authHeader !== `Bearer ${serviceKey}`) {
    // Allow pg_cron invocations (no auth header) on localhost
    const callerIp = req.headers.get("x-forwarded-for") ?? "";
    const isLocal  = callerIp === "" || callerIp.startsWith("127.") || callerIp.startsWith("::1");
    if (!isLocal) {
      return json({ error: "Service-role auth required" }, 403);
    }
  }

  let body: { tenant_id?: string } = {};
  if (req.method === "POST" && req.headers.get("content-type")?.includes("application/json")) {
    body = await req.json().catch(() => ({})) as { tenant_id?: string };
  }

  // ── Fetch pending rows ─────────────────────────────────────────────────────
  let query = supabase
    .from("accounting_outbox")
    .select("id, tenant_id, event_type, entity_type, entity_id, payload, target_system, attempts")
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (body.tenant_id) {
    query = query.eq("tenant_id", body.tenant_id);
  }

  const { data: rows, error: fetchErr } = await query;
  if (fetchErr) {
    console.error("accounting-post fetch error:", fetchErr);
    return json({ error: "Failed to fetch outbox rows" }, 500);
  }

  if (!rows?.length) {
    return json({ processed: 0, message: "No pending rows" });
  }

  // ── Process each row ───────────────────────────────────────────────────────
  const results: { id: string; status: string; error?: string }[] = [];

  for (const row of rows as OutboxRow[]) {
    // Claim: mark as 'posting' to prevent concurrent workers from picking it up
    const { error: claimErr } = await supabase
      .from("accounting_outbox")
      .update({ status: "posting", attempts: row.attempts + 1, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", row.attempts === 0 ? "pending" : "failed"); // only claim if status hasn't changed

    if (claimErr) {
      // Another worker claimed it; skip
      continue;
    }

    try {
      const adapter = getAdapter(row.target_system);
      let result: { success: boolean; external_id?: string; error?: string };

      switch (row.event_type) {
        case "invoice_created":
          result = await adapter.postInvoice(row.tenant_id, row.payload as never);
          break;
        case "payment_received":
          result = await adapter.postPayment(row.tenant_id, row.payload as never);
          break;
        case "cost_logged":
          result = await adapter.postCost(row.tenant_id, row.payload as never);
          break;
        default:
          result = { success: false, error: `Unknown event_type: ${row.event_type}` };
      }

      if (result.success) {
        await supabase
          .from("accounting_outbox")
          .update({
            status:     "posted",
            posted_at:  new Date().toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        results.push({ id: row.id, status: "posted" });
      } else {
        const newStatus = row.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending";
        await supabase
          .from("accounting_outbox")
          .update({ status: newStatus, last_error: result.error ?? "Unknown error", updated_at: new Date().toISOString() })
          .eq("id", row.id);

        results.push({ id: row.id, status: newStatus, error: result.error });
      }
    } catch (err) {
      const newStatus = row.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending";
      await supabase
        .from("accounting_outbox")
        .update({ status: newStatus, last_error: String(err), updated_at: new Date().toISOString() })
        .eq("id", row.id);

      results.push({ id: row.id, status: newStatus, error: String(err) });
    }
  }

  const posted = results.filter(r => r.status === "posted").length;
  const failed = results.filter(r => r.status === "failed").length;

  console.log(`accounting-post: ${posted} posted, ${failed} failed, ${results.length} total`);
  return json({ processed: results.length, posted, failed, results });
});
