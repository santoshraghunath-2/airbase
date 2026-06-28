// CSR Reply — sends an SMS from the booking dashboard on behalf of a human CSR.
// Called with Supabase JWT auth (browser), not service-role.

import { createClient } from "npm:@supabase/supabase-js@2";

const adminSupabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const TWILIO_SID   = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  // Validate Supabase JWT
  const authHeader = req.headers.get("Authorization") ?? "";
  const userSupabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await userSupabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { conversation_id, message } = await req.json() as { conversation_id: string; message: string };
  if (!conversation_id || !message?.trim()) {
    return new Response(JSON.stringify({ error: "conversation_id and message are required" }), { status: 400 });
  }

  // Load conversation + tenant
  const { data: conv } = await adminSupabase
    .from("booking_conversations")
    .select("*, tenants(phone)")
    .eq("id", conversation_id)
    .single();

  if (!conv) {
    return new Response(JSON.stringify({ error: "Conversation not found" }), { status: 404 });
  }

  // Verify calling user belongs to this tenant
  const { data: callerUser } = await adminSupabase
    .from("users")
    .select("tenant_id, role")
    .eq("auth_id", user.id)
    .single();

  if (!callerUser || callerUser.tenant_id !== conv.tenant_id) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const fromNumber = (conv.tenants as Record<string, string>)?.phone;
  if (!fromNumber) {
    return new Response(JSON.stringify({ error: "Tenant phone not configured" }), { status: 400 });
  }

  // Send SMS via Twilio
  const auth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
  const twilioRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: conv.phone as string, From: fromNumber, Body: message.trim() }),
    },
  );

  if (!twilioRes.ok) {
    const twilioError = await twilioRes.text();
    return new Response(JSON.stringify({ error: `Twilio error: ${twilioError}` }), { status: 502 });
  }

  // Append CSR message to conversation
  const messages = (conv.messages as Array<unknown>) ?? [];
  const updatedMessages = [
    ...messages,
    { role: "csr", content: message.trim(), csr_user_id: user.id, timestamp: new Date().toISOString() },
  ];
  await adminSupabase
    .from("booking_conversations")
    .update({ messages: updatedMessages, last_message_at: new Date().toISOString() })
    .eq("id", conversation_id);

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
