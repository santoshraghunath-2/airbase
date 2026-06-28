// Pricebook Import — accepts a CSV or PDF, extracts line items via Claude,
// and returns structured items for operator review before bulk insert.
// Operators call this from the browser (JWT auth).

import { createClient } from "npm:@supabase/supabase-js@2";
import { loadAgentContext } from "../_shared/agent-base.ts";
import { callAgent } from "../_shared/llm-router.ts";
import type { TextContent } from "../_shared/llm-router.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;

const adminSupabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ─── Types ────────────────────────────────────────────────────────────────────

interface PricebookItem {
  name:        string;
  description: string;
  unit_price:  number;
  category:    string;
  unit:        string;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  // JWT auth
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { data: dbUser } = await adminSupabase
    .from("users")
    .select("tenant_id, role")
    .eq("auth_id", user.id)
    .single();

  if (!dbUser?.tenant_id) {
    return new Response(JSON.stringify({ error: "User has no tenant" }), { status: 403 });
  }
  if (!["owner", "dispatcher"].includes(dbUser.role as string)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const tenantId = dbUser.tenant_id as string;

  try {
    const formData = await req.formData();
    const file     = formData.get("file") as File | null;
    const mode     = (formData.get("mode") as string | null) ?? "extract";

    if (mode === "commit") {
      // Bulk insert reviewed items
      const itemsJson = formData.get("items") as string | null;
      if (!itemsJson) {
        return new Response(JSON.stringify({ error: "items required for commit" }), { status: 400 });
      }
      const items = JSON.parse(itemsJson) as PricebookItem[];

      const rows = items.map((item) => ({
        ...item,
        tenant_id: tenantId,
      }));

      const { error } = await adminSupabase.from("pricebook_items").insert(rows);
      if (error) throw error;

      return new Response(JSON.stringify({ inserted: rows.length }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // mode === "extract"
    if (!file) {
      return new Response(JSON.stringify({ error: "file is required" }), { status: 400 });
    }

    const contentType = file.type;
    const bytes       = await file.arrayBuffer();
    const ctx         = await loadAgentContext(adminSupabase, tenantId, "operator");

    let userMessage: string;
    let userContentForPdf: unknown;

    const systemPrompt = `You are a pricebook extraction assistant. Extract all service/part line items from the provided document.

Return ONLY a JSON array with this exact structure — no markdown, no explanation, just the array:
[
  {
    "name":        "Short item name",
    "description": "Longer description or empty string",
    "unit_price":  123.45,
    "category":    "labor | parts | equipment | service",
    "unit":        "each | hour | flat | foot | lb"
  }
]

Rules:
- unit_price must be a number (not a string)
- category must be one of: labor, parts, equipment, service
- unit must be one of: each, hour, flat, foot, lb
- If a price range is given, use the midpoint
- Skip headers, totals, discounts, and non-line-item rows
- If description is unclear, set it to an empty string`;

    if (contentType === "application/pdf" || file.name.endsWith(".pdf")) {
      const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
      userContentForPdf = [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        },
        { type: "text", text: "Extract all pricebook line items from this document." },
      ];
      userMessage = "Extract all pricebook line items from the attached PDF.";
    } else {
      // CSV or plain text
      const text   = new TextDecoder().decode(bytes);
      userMessage  = `Extract all pricebook line items from this CSV/text data:\n\n${text.slice(0, 32000)}`;
    }

    const result = await callAgent({
      systemPrompt,
      userMessage,
      userContent: userContentForPdf as TextContent[] | undefined,
      model:       ctx.resolvedModelId,
      temperature: 0.1,
      maxTokens:   4096,
    });

    // Parse Claude's JSON response
    const raw  = result.text.trim();
    const json = raw.startsWith("[")
      ? raw
      : raw.match(/\[[\s\S]*\]/)?.[0] ?? "[]";

    let items: PricebookItem[] = [];
    try {
      items = JSON.parse(json) as PricebookItem[];
    } catch {
      return new Response(
        JSON.stringify({ error: "Claude returned unparseable output", raw: raw.slice(0, 500) }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ items, count: items.length }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("pricebook-import error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
