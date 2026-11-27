/**
 * Integration-style tests for retell-voice-webhook/index.ts
 *
 * These tests import the handler directly and exercise it without a live Supabase.
 * They verify:
 *   1. An unsigned POST → 401, no DB calls attempted
 *   2. A correctly signed POST → handler returns 200 (or 500 from missing Supabase env,
 *      but only AFTER the signature gate passes — meaning the 401 guard is proven gone)
 *
 * We mock Deno.env.get to inject the Retell API key and prevent DB connections.
 */

import { assertEquals, assertNotEquals } from "@std/assert";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_KEY = "test-retell-api-key-webhook-tests";

async function makeSignature(rawBody: string, timestampMs: number, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(rawBody + String(timestampMs)),
  );
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `v=${timestampMs},d=${hex}`;
}

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://edge.supabase.co/functions/v1/retell-voice-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

// ─── Override env for tests ───────────────────────────────────────────────────

// Patch Deno.env.get to inject the test key without touching any real env.
// The webhook reads RETELL_API_KEY and SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY.
// We supply only RETELL_API_KEY; Supabase keys are absent → DB init will fail,
// but only AFTER the auth gate, which is what we're testing.
const _origEnvGet = Deno.env.get.bind(Deno.env);
function withRetellEnv<T>(fn: () => T): T {
  // deno-lint-ignore no-explicit-any
  (Deno.env as any).get = (key: string) => {
    if (key === "RETELL_API_KEY") return TEST_KEY;
    return undefined;
  };
  try {
    return fn();
  } finally {
    // deno-lint-ignore no-explicit-any
    (Deno.env as any).get = _origEnvGet;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test("OPTIONS request → 405 Method Not Allowed", async () => {
  // Import handler fresh for each test group
  const { handler } = await import("../retell-voice-webhook/index.ts");
  const req = new Request("https://edge.supabase.co/functions/v1/retell-voice-webhook", {
    method: "OPTIONS",
  });
  let response!: Response;
  await withRetellEnv(async () => {
    response = await handler(req);
  });
  assertEquals(response.status, 405);
});

Deno.test("POST with no signature header → 401, no DB access", async () => {
  const { handler } = await import("../retell-voice-webhook/index.ts");
  const body = JSON.stringify({ event: "call_started", call_id: "call_unsigned" });
  const req = makeRequest(body); // no x-retell-signature header

  let response!: Response;
  await withRetellEnv(async () => {
    response = await handler(req);
  });
  assertEquals(response.status, 401, "unsigned request must be rejected with 401");
  const json = await response.json();
  assertEquals(json.error, "Unauthorized");
});

Deno.test("POST with wrong key signature → 401", async () => {
  const { handler } = await import("../retell-voice-webhook/index.ts");
  const body = JSON.stringify({ event: "call_started", call_id: "call_wrongkey" });
  const badSig = await makeSignature(body, Date.now(), "completely-wrong-key");
  const req = makeRequest(body, { "x-retell-signature": badSig });

  let response!: Response;
  await withRetellEnv(async () => {
    response = await handler(req);
  });
  assertEquals(response.status, 401, "wrong-key signature must be rejected with 401");
});

Deno.test("POST with stale timestamp → 401", async () => {
  const { handler } = await import("../retell-voice-webhook/index.ts");
  const body = JSON.stringify({ event: "call_started", call_id: "call_stale" });
  const staleTs = Date.now() - 10 * 60 * 1000; // 10 minutes ago
  const sig = await makeSignature(body, staleTs, TEST_KEY);
  const req = makeRequest(body, { "x-retell-signature": sig });

  let response!: Response;
  await withRetellEnv(async () => {
    response = await handler(req);
  });
  assertEquals(response.status, 401, "stale timestamp must be rejected with 401");
});

Deno.test("POST with valid signature passes auth gate (non-401 response)", async () => {
  const { handler } = await import("../retell-voice-webhook/index.ts");
  const body = JSON.stringify({ event: "call_started", call_id: "call_valid123" });
  const ts = Date.now();
  const sig = await makeSignature(body, ts, TEST_KEY);
  const req = makeRequest(body, { "x-retell-signature": sig });

  let response!: Response;
  await withRetellEnv(async () => {
    response = await handler(req);
  });

  // A valid signature passes the auth gate. The handler will then try to init
  // Supabase (SUPABASE_URL not set in test env) and fail with 500 — that's fine.
  // What matters: it must NOT be 401 (the auth gate did not reject it).
  assertNotEquals(response.status, 401, "valid signature must not be rejected by auth gate");
});
