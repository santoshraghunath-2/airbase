// Portal Session Edge Function
// No authentication required — security is the invitation token (UUID v4, 90-day TTL).
//
// POST { action: "load",  token }                                     → PortalData
// POST { action: "book",  token, service_type, notes?, preferred_date? } → { ok: true }

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

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

async function validateToken(token: string) {
  const { data } = await supabase
    .from("portal_invitations")
    .select("id, tenant_id, customer_id, expires_at")
    .eq("token", token)
    .gt("expires_at", new Date().toISOString())
    .single();
  return data as { id: string; tenant_id: string; customer_id: string; expires_at: string } | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json() as Record<string, string>;
    const { action, token } = body;

    if (!token) return json({ error: "Missing token" }, 400);

    const invite = await validateToken(token);
    if (!invite) return json({ error: "Invalid or expired portal link" }, 403);

    const { tenant_id, customer_id } = invite;

    // ── Load: return all customer portal data ────────────────────────────────
    if (action === "load") {
      // Get service location IDs first so we can query equipment
      const { data: locations } = await supabase
        .from("service_locations")
        .select("id")
        .eq("customer_id", customer_id);

      const locationIds = (locations ?? []).map((l) => l.id);

      const [tenantRes, customerRes, jobsRes, invoicesRes, equipmentRes, membershipRes] =
        await Promise.all([
          supabase
            .from("tenants")
            .select("name, phone, brand_color")
            .eq("id", tenant_id)
            .single(),

          supabase
            .from("customers")
            .select("name, phone, email")
            .eq("id", customer_id)
            .single(),

          supabase
            .from("jobs")
            .select("id, job_type, status, scheduled_start, description, created_at")
            .eq("tenant_id", tenant_id)
            .eq("customer_id", customer_id)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(12),

          supabase
            .from("invoices")
            .select("id, invoice_number, status, total, balance_due, due_date, payment_link_url, created_at")
            .eq("tenant_id", tenant_id)
            .eq("customer_id", customer_id)
            .in("status", ["sent", "viewed", "partial", "overdue"])
            .order("created_at", { ascending: false }),

          locationIds.length > 0
            ? supabase
                .from("equipment")
                .select("id, category, make, model, install_date, warranty_expiry, last_service_date")
                .eq("tenant_id", tenant_id)
                .in("location_id", locationIds)
            : Promise.resolve({ data: [] }),

          supabase
            .from("memberships")
            .select("status, billing_cycle, expires_at, membership_plans(name, benefits)")
            .eq("tenant_id", tenant_id)
            .eq("customer_id", customer_id)
            .eq("status", "active")
            .maybeSingle(),
        ]);

      return json({
        tenant:     tenantRes.data,
        customer:   customerRes.data,
        jobs:       jobsRes.data ?? [],
        invoices:   invoicesRes.data ?? [],
        equipment:  equipmentRes.data ?? [],
        membership: membershipRes.data ?? null,
      });
    }

    // ── Book: create a portal appointment request ────────────────────────────
    if (action === "book") {
      const { service_type, notes, preferred_date } = body;
      if (!service_type) return json({ error: "service_type is required" }, 400);

      const { data: customer } = await supabase
        .from("customers")
        .select("name, phone")
        .eq("id", customer_id)
        .single();

      const c = customer as { name: string; phone: string } | null;

      const messageText =
        `[Portal request] Service: ${service_type}` +
        (notes         ? `. Notes: ${notes}` : "") +
        (preferred_date ? `. Preferred: ${preferred_date}` : "");

      const { error } = await supabase.from("booking_conversations").insert({
        tenant_id,
        customer_id,
        phone:    c?.phone ?? "portal",
        channel:  "portal",
        status:   "active",
        messages: [{ role: "customer", content: messageText, timestamp: new Date().toISOString() }],
        context:  { source: "portal", service_type, preferred_date: preferred_date ?? null },
      });

      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("portal-session error:", e);
    return json({ error: String(e) }, 500);
  }
});
