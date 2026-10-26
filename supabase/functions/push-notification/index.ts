/**
 * push-notification
 *
 * Sends Expo push notifications to one or more users.
 * Called internally by dispatch-agent, invoice-agent, and escalation flows
 * when an action requires operator approval or a tech receives a new job.
 *
 * POST body:
 * {
 *   tenant_id: string,
 *   user_ids?: string[],        // specific users — OR —
 *   roles?: string[],           // all users with these roles in the tenant
 *   title: string,
 *   body: string,
 *   data?: Record<string, unknown>  // deep-link payload for the app
 * }
 *
 * Required secrets: none (uses Expo's public push API, no key needed)
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default";
  badge?: number;
}

async function sendPushBatch(messages: PushMessage[]): Promise<void> {
  if (messages.length === 0) return;

  // Expo accepts up to 100 messages per request
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Expo push batch failed: ${res.status} ${text}`);
    } else {
      const result = await res.json() as { data: { status: string; id?: string; message?: string }[] };
      const failed = result.data.filter((r) => r.status !== "ok");
      if (failed.length > 0) {
        console.warn(`Expo push: ${failed.length} messages failed:`, failed);
      }
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (!req.headers.get("Authorization")?.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS_HEADERS });
  }

  try {
    const body = await req.json() as {
      tenant_id: string;
      user_ids?: string[];
      roles?: string[];
      title: string;
      body: string;
      data?: Record<string, unknown>;
    };

    if (!body.tenant_id || !body.title || !body.body) {
      return new Response(JSON.stringify({ error: "tenant_id, title, body required" }), { status: 400, headers: CORS_HEADERS });
    }

    // Resolve target user IDs
    let userIds: string[] = body.user_ids ?? [];

    if (body.roles && body.roles.length > 0 && userIds.length === 0) {
      const { data: usersWithRoles } = await supabase
        .from("users")
        .select("id")
        .eq("tenant_id", body.tenant_id)
        .in("role", body.roles)
        .is("deleted_at", null);

      userIds = (usersWithRoles ?? []).map((u: { id: string }) => u.id);
    }

    if (userIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "no target users" }), { status: 200, headers: CORS_HEADERS });
    }

    // Fetch all active device tokens for those users
    const { data: tokens } = await supabase
      .from("device_tokens")
      .select("token")
      .eq("tenant_id", body.tenant_id)
      .in("user_id", userIds);

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "no registered devices" }), { status: 200, headers: CORS_HEADERS });
    }

    const messages: PushMessage[] = tokens.map((t: { token: string }) => ({
      to: t.token,
      title: body.title,
      body: body.body,
      sound: "default",
      ...(body.data ? { data: body.data } : {}),
    }));

    await sendPushBatch(messages);

    return new Response(JSON.stringify({ sent: messages.length }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("push-notification error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS_HEADERS });
  }
});
