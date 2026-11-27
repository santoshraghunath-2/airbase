// Tests for _shared/retell-auth.ts
// Covers: valid sig, wrong key, stale/future timestamps, malformed headers,
//         body tampered, empty body.

import { assertEquals } from "jsr:@std/assert";
import { verifyRetellSignature } from "../_shared/retell-auth.ts";

const TEST_KEY = "test-api-key-abc123";

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

Deno.test("valid signature passes", async () => {
  const body = '{"event":"call_started"}';
  const ts = Date.now();
  const sig = await makeSignature(body, ts, TEST_KEY);
  assertEquals(await verifyRetellSignature(body, sig, TEST_KEY), true);
});

Deno.test("wrong key fails", async () => {
  const body = '{"event":"call_started"}';
  const ts = Date.now();
  const sig = await makeSignature(body, ts, TEST_KEY);
  assertEquals(await verifyRetellSignature(body, sig, "wrong-key"), false);
});

Deno.test("stale timestamp (6 min ago) fails", async () => {
  const body = '{}';
  const ts = Date.now() - 6 * 60 * 1000;
  const sig = await makeSignature(body, ts, TEST_KEY);
  assertEquals(await verifyRetellSignature(body, sig, TEST_KEY), false);
});

Deno.test("future timestamp (6 min ahead) fails", async () => {
  const body = '{}';
  const ts = Date.now() + 6 * 60 * 1000;
  const sig = await makeSignature(body, ts, TEST_KEY);
  assertEquals(await verifyRetellSignature(body, sig, TEST_KEY), false);
});

Deno.test("timestamp within window (4 min ago) passes", async () => {
  const body = '{"event":"function_call"}';
  const ts = Date.now() - 4 * 60 * 1000;
  const sig = await makeSignature(body, ts, TEST_KEY);
  assertEquals(await verifyRetellSignature(body, sig, TEST_KEY), true);
});

Deno.test("null signature fails", async () => {
  assertEquals(await verifyRetellSignature("{}", null, TEST_KEY), false);
});

Deno.test("malformed header: no v= prefix fails", async () => {
  assertEquals(await verifyRetellSignature("{}", "deadbeef", TEST_KEY), false);
});

Deno.test("malformed header: missing d= fails", async () => {
  assertEquals(await verifyRetellSignature("{}", `v=${Date.now()}`, TEST_KEY), false);
});

Deno.test("malformed header: non-numeric timestamp fails", async () => {
  assertEquals(await verifyRetellSignature("{}", "v=abc,d=deadbeef", TEST_KEY), false);
});

Deno.test("body tampered fails", async () => {
  const body = '{"event":"call_started"}';
  const ts = Date.now();
  const sig = await makeSignature(body, ts, TEST_KEY);
  const tampered = '{"event":"function_call"}';
  assertEquals(await verifyRetellSignature(tampered, sig, TEST_KEY), false);
});

Deno.test("empty body with valid sig passes", async () => {
  const body = "";
  const ts = Date.now();
  const sig = await makeSignature(body, ts, TEST_KEY);
  assertEquals(await verifyRetellSignature(body, sig, TEST_KEY), true);
});
