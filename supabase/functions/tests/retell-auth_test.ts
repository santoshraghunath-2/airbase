/**
 * Tests for _shared/retell-auth.ts
 *
 * Verifies the Retell webhook signature scheme described at:
 *   https://docs.retellai.com/features/secure-webhook (verified 2026-11-26)
 *
 * Signed string: rawBody + timestamp_string
 * Header:        x-retell-signature: v={unix_ms},d={hex_digest}
 * Key:           Retell API key
 * Timestamp:     rejected if more than 5 minutes from now
 */

import { assertEquals } from "@std/assert";
import { verifyRetellSignature } from "../_shared/retell-auth.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_KEY = "test-retell-api-key-for-unit-tests";

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

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test("valid signature with fresh timestamp returns true", async () => {
  const body = JSON.stringify({ event: "call_started", call_id: "call_abc123" });
  const ts = Date.now();
  const sig = await makeSignature(body, ts, TEST_KEY);
  const result = await verifyRetellSignature(body, sig, TEST_KEY);
  assertEquals(result, true);
});

Deno.test("valid format but wrong key returns false", async () => {
  const body = JSON.stringify({ event: "call_started", call_id: "call_abc123" });
  const ts = Date.now();
  const sig = await makeSignature(body, ts, "wrong-key");
  const result = await verifyRetellSignature(body, sig, TEST_KEY);
  assertEquals(result, false);
});

Deno.test("stale timestamp (6 minutes old) returns false", async () => {
  const body = JSON.stringify({ event: "function_call", name: "lookup_customer" });
  const staleTs = Date.now() - 6 * 60 * 1000; // 6 minutes ago
  const sig = await makeSignature(body, staleTs, TEST_KEY);
  const result = await verifyRetellSignature(body, sig, TEST_KEY);
  assertEquals(result, false);
});

Deno.test("future timestamp beyond 5 minutes returns false", async () => {
  const body = JSON.stringify({ event: "function_call" });
  const futureTs = Date.now() + 6 * 60 * 1000; // 6 minutes in the future
  const sig = await makeSignature(body, futureTs, TEST_KEY);
  const result = await verifyRetellSignature(body, sig, TEST_KEY);
  assertEquals(result, false);
});

Deno.test("timestamp within 4 minutes returns true", async () => {
  const body = JSON.stringify({ event: "call_ended" });
  const ts = Date.now() - 4 * 60 * 1000; // 4 minutes ago (within window)
  const sig = await makeSignature(body, ts, TEST_KEY);
  const result = await verifyRetellSignature(body, sig, TEST_KEY);
  assertEquals(result, true);
});

Deno.test("null signature header returns false", async () => {
  const body = "{}";
  const result = await verifyRetellSignature(body, null, TEST_KEY);
  assertEquals(result, false);
});

Deno.test("malformed header with no v= prefix returns false", async () => {
  const result = await verifyRetellSignature("{}", "not-a-valid-signature", TEST_KEY);
  assertEquals(result, false);
});

Deno.test("malformed header missing d= field returns false", async () => {
  const result = await verifyRetellSignature("{}", `v=${Date.now()}`, TEST_KEY);
  assertEquals(result, false);
});

Deno.test("malformed header with non-hex digest returns false", async () => {
  const result = await verifyRetellSignature("{}", `v=${Date.now()},d=ZZZZZZ`, TEST_KEY);
  assertEquals(result, false);
});

Deno.test("body tampered after signing returns false", async () => {
  const originalBody = JSON.stringify({ event: "call_started", call_id: "call_abc" });
  const tamperedBody = JSON.stringify({ event: "call_started", call_id: "call_EVIL" });
  const ts = Date.now();
  const sig = await makeSignature(originalBody, ts, TEST_KEY);
  const result = await verifyRetellSignature(tamperedBody, sig, TEST_KEY);
  assertEquals(result, false);
});

Deno.test("empty body with valid signature returns true", async () => {
  const body = "";
  const ts = Date.now();
  const sig = await makeSignature(body, ts, TEST_KEY);
  const result = await verifyRetellSignature(body, sig, TEST_KEY);
  assertEquals(result, true);
});
