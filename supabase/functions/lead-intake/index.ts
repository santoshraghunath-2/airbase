// lead-intake: Accepts web form leads and routes them into the opportunity pipeline.
// Public endpoint — authenticated via HMAC-SHA256 signature per lead_intake_sources row.
//
// Expected request format:
//   POST /functions/v1/lead-intake?source=<slug>
//   Header: x-intake-signature: v={unix_ms},d={hex_digest}
//   Body: JSON with lead fields (name, phone, email, project_summary, etc.)
//
// The HMAC key is lead_intake_sources.hmac_secret.
// Same signature scheme as Retell: rawBody + timestamp, HMAC-SHA256 hex.
//
// After saving the lead, fires retell-send to start an SMS outreach.

import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyRetellSignature } from "../_shared/retell-auth.ts";

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

// ─── CORS (web forms need it) ─────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-intake-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...CORS, "Content-Type": "application/json" },
    status,
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS, status: 204 });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const url = new URL(req.url);
  const slug = url.searchParams.get("source");
  if (!slug) return json({ error: "Missing ?source=<slug>" }, 400);

  const rawBody = await req.text();

  // Look up the intake source by slug
  const { data: source } = await getSupabase()
    .from("lead_intake_sources")
    .select("id, tenant_id, hmac_secret, is_active")
    .eq("slug", slug)
    .is("deleted_at", null)
    .single();

  if (!source || !source.is_active) {
    return json({ error: "Unknown or inactive intake source" }, 403);
  }

  // Verify signature using same scheme as Retell auth
  const signature = req.headers.get("x-intake-signature");
  const valid = await verifyRetellSignature(
    rawBody,
    signature,
    source.hmac_secret as string,
  );
  if (!valid) {
    console.warn(`lead-intake: invalid signature for source ${slug}`);
    return json({ error: "Invalid signature" }, 401);
  }

  let lead: Record<string, unknown>;
  try {
    lead = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const tenantId = source.tenant_id as string;
  const phone = (lead.phone as string | undefined)?.trim();
  const name = (lead.name as string | undefined)?.trim() ?? "Web Lead";
  const email = (lead.email as string | undefined)?.trim() ?? null;
  const projectSummary = (lead.project_summary as string | undefined) ?? null;
  const budgetRange = (lead.budget_range as string | undefined) ?? null;
  const timeline = (lead.timeline as string | undefined) ?? null;
  const zip = (lead.zip as string | undefined) ?? null;

  if (!phone) return json({ error: "phone is required" }, 400);

  try {
    // Find or create customer
    const normalized = phone.replace(/\D/g, "");
    const { data: existing } = await getSupabase()
      .from("customers")
      .select("id")
      .eq("tenant_id", tenantId)
      .or(`phone.eq.${phone},phone.eq.+1${normalized},phone.eq.${normalized}`)
      .is("deleted_at", null)
      .maybeSingle();

    let customerId: string;
    if (existing) {
      customerId = existing.id as string;
    } else {
      const { data: newCust, error } = await getSupabase()
        .from("customers")
        .insert({
          tenant_id: tenantId,
          name,
          phone,
          email,
          source: "web_form",
        })
        .select("id")
        .single();

      if (error || !newCust) {
        console.error("lead-intake: failed to create customer", error);
        return json({ error: "Failed to save lead" }, 500);
      }
      customerId = (newCust as Record<string, string>).id;
    }

    // Budget gate — save as lost if below minimum, still log for analysis
    const disqualified = budgetRange === "under_8k";

    const { data: opp, error: oppError } = await getSupabase()
      .from("opportunities")
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        source: "web_form",
        status: disqualified ? "lost" : "new",
        lead_name: name,
        lead_phone: phone,
        lead_email: email,
        project_summary: projectSummary,
        budget_range: budgetRange,
        timeline,
        service_area_zip: zip,
        disqualify_reason: disqualified ? "budget_too_low" : null,
        intake_source_id: source.id as string,
      })
      .select("id")
      .single();

    if (oppError || !opp) {
      console.error("lead-intake: failed to create opportunity", oppError);
      return json({ error: "Failed to save lead" }, 500);
    }

    const opportunityId = (opp as Record<string, string>).id;

    // Fire retell-send SMS outreach for qualified leads (fire-and-forget)
    if (!disqualified) {
      void fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/retell-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          to_number: phone,
          channel: "sms",
          opportunity_id: opportunityId,
          touch_type: "web_form_immediate",
          dynamic_variables: {
            lead_name: name.split(" ")[0],
            project_summary: projectSummary ?? "your remodel project",
          },
        }),
      }).catch((e) => console.error("lead-intake: retell-send fire failed", e));
    }

    return json({
      success: true,
      opportunity_id: opportunityId,
      qualified: !disqualified,
    });
  } catch (e) {
    console.error("lead-intake error:", e);
    return json({ error: "Internal error" }, 500);
  }
});
