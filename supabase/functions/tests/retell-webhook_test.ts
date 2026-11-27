// Integration tests for retell-voice-webhook/index.ts
// Tests: OPTIONS → 405, auth gate (unsigned/wrong key/stale), valid sig passes auth.
// No DB calls are made — Supabase init is lazy and no tool calls are exercised.

import { assertEquals } from "jsr:@std/assert";
import { handler } from "../retell-voice-webhook/index.ts";

const TEST_KEY = "test-webhook-key-xyz";

// Patch Deno.env so the handler uses our test key
const _origEnvGet = Deno.env.get.bind(Deno.env);
Deno.env.get = (key: string) => {
  if (key === "RETELL_API_KEY") return TEST_KEY;
  if (key === "SUPABASE_URL") return "http://localhost:54321";
  if (key === "SUPABASE_SERVICE_ROLE_KEY") return "test-service-role-key";
  return _origEnvGet(key);
};

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

Deno.test("OPTIONS returns 405", async () => {
  const req = new Request("http://localhost", { method: "OPTIONS" });
  const res = await handler(req);
  assertEquals(res.status, 405);
});

Deno.test("unsigned POST returns 401 without reaching DB", async () => {
  const body = '{"event":"call_started","call_id":"c1","agent_id":"a1"}';
  const req = new Request("http://localhost", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
  const res = await handler(req);
  assertEquals(res.status, 401);
});

Deno.test("wrong key returns 401", async () => {
  const body = '{"event":"call_started","call_id":"c1","agent_id":"a1"}';
  const ts = Date.now();
  const sig = await makeSignature(body, ts, "wrong-key");
  const req = new Request("http://localhost", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json", "x-retell-signature": sig },
  });
  const res = await handler(req);
  assertEquals(res.status, 401);
});

Deno.test("stale signature returns 401", async () => {
  const body = '{"event":"call_started","call_id":"c1","agent_id":"a1"}';
  const ts = Date.now() - 6 * 60 * 1000;
  const sig = await makeSignature(body, ts, TEST_KEY);
  const req = new Request("http://localhost", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json", "x-retell-signature": sig },
  });
  const res = await handler(req);
  assertEquals(res.status, 401);
});

Deno.test("valid signature passes auth gate (not 401)", async () => {
  // Passes auth but resolveTenant will get no DB hit — returns 200 with dynamic vars
  // from the fallback path (no RETELL_TENANT_DEFAULT set → null ctx → default company_name)
  const body = '{"event":"call_started","call_id":"c1","agent_id":"a1","call_type":"phone_call","call_status":"ongoing","from_number":"+14155550100","to_number":"+14155550101"}';
  const ts = Date.now();
  const sig = await makeSignature(body, ts, TEST_KEY);
  const req = new Request("http://localhost", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json", "x-retell-signature": sig },
  });
  const res = await handler(req);
  // Not 401 — auth passed. May be 200 or 500 depending on DB; just check it's not an auth error.
  assertEquals(res.status !== 401, true);
});
