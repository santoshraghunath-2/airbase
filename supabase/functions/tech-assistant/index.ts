// Tech Assistant — answers field questions using Claude + optional vector search
// over equipment manuals ingested via pgvector.
// Called from the tech PWA with Supabase JWT auth.

import { createClient } from "npm:@supabase/supabase-js@2";
import OpenAI from "npm:openai";
import { loadAgentContext } from "../_shared/agent-base.ts";
import { callAgent } from "../_shared/llm-router.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;

const adminSupabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ─── Vector search ────────────────────────────────────────────────────────────

async function embedText(text: string): Promise<number[] | null> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return null;
  try {
    const client   = new OpenAI({ apiKey: openaiKey });
    const response = await client.embeddings.create({ model: "text-embedding-3-small", input: text });
    return response.data[0].embedding;
  } catch {
    return null;
  }
}

async function searchManuals(
  tenantId: string,
  query: string,
  matchCount = 4,
): Promise<Array<{ document_name: string; chunk_text: string; similarity: number }>> {
  const embedding = await embedText(query);
  if (!embedding) return [];

  const { data } = await adminSupabase.rpc("match_manual_chunks", {
    p_tenant_id:   tenantId,
    p_embedding:   embedding,
    p_match_count: matchCount,
  });

  return (data ?? []) as Array<{ document_name: string; chunk_text: string; similarity: number }>;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
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
    .select("tenant_id")
    .eq("auth_id", user.id)
    .single();

  if (!dbUser?.tenant_id) {
    return new Response(JSON.stringify({ error: "User has no tenant" }), { status: 403 });
  }

  const tenantId = dbUser.tenant_id as string;

  try {
    const { message, history = [] } = await req.json() as {
      message: string;
      history?: Array<{ role: string; content: string }>;
    };

    if (!message?.trim()) {
      return new Response(JSON.stringify({ error: "message is required" }), { status: 400 });
    }

    // Load agent config + company name
    const [ctx, { data: tenant }] = await Promise.all([
      loadAgentContext(adminSupabase, tenantId, "tech_assistant"),
      adminSupabase.from("tenants").select("name").eq("id", tenantId).single(),
    ]);

    // Vector search over manuals
    const manualChunks = await searchManuals(tenantId, message);
    const manualContext = manualChunks.length
      ? manualChunks
          .map((c) => `[From: ${c.document_name}]\n${c.chunk_text}`)
          .join("\n\n---\n\n")
      : "No equipment manual content available. Answer from general knowledge.";

    const systemPromptRaw = await Deno.readTextFile(
      new URL("../../prompts/tech-assistant.md", import.meta.url),
    ).catch(() => null) ?? "You are a helpful field service assistant for technicians.";

    const systemPrompt = systemPromptRaw
      .replace("{{company_name}}", (tenant?.name as string) ?? "your company")
      .replace("{{manual_context}}", manualContext);

    // Build user message with conversation history
    const historyBlock = history.length
      ? history.map((h) => `[${h.role}]: ${h.content}`).join("\n") + "\n\n"
      : "";

    const userMessage = historyBlock + `TECH QUESTION:\n${message}`;

    const result = await callAgent({
      systemPrompt,
      userMessage,
      model:       ctx.resolvedModelId,
      temperature: 0.4,
      maxTokens:   1024,
    });

    return new Response(
      JSON.stringify({
        answer:          result.text.trim(),
        sources_used:    manualChunks.map((c) => c.document_name),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("tech-assistant error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
