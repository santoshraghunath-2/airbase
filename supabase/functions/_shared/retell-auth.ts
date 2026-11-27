/**
 * Retell webhook signature verification.
 *
 * Header format (x-retell-signature): v={unix_ms_timestamp},d={hex_digest}
 * Signed string: rawBody + timestamp_string  (body bytes followed by the decimal ms digits)
 * Key: the Retell API key with the webhook badge
 *
 * Source: https://docs.retellai.com/features/secure-webhook (verified 2026-11-26)
 * Timestamps more than 5 minutes from now are rejected (replay protection).
 * Digest comparison is constant-time to prevent timing attacks.
 */

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Verify a Retell webhook request.
 *
 * @param rawBody   The raw request body as a string (read once before JSON.parse).
 * @param signature The value of the x-retell-signature header.
 * @param apiKey    The Retell API key (from RETELL_API_KEY secret).
 * @returns true if the signature is valid and the timestamp is fresh; false otherwise.
 */
export async function verifyRetellSignature(
  rawBody: string,
  signature: string | null,
  apiKey: string,
): Promise<boolean> {
  if (!signature) return false;

  // Parse "v={unix_ms},d={hex_digest}"
  const match = signature.match(/^v=(\d+),d=([0-9a-f]+)$/i);
  if (!match) return false;

  const timestampMs = parseInt(match[1], 10);
  const receivedHex = match[2].toLowerCase();

  // Reject stale or future timestamps (replay / clock-skew protection)
  const nowMs = Date.now();
  if (Math.abs(nowMs - timestampMs) > FIVE_MINUTES_MS) return false;

  // Compute HMAC-SHA256 keyed with the API key over (rawBody + timestamp_string)
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(apiKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(rawBody + match[1]),
  );

  // Convert to lowercase hex
  const expectedHex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison (lengths must match first)
  if (expectedHex.length !== receivedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedHex.length; i++) {
    diff |= expectedHex.charCodeAt(i) ^ receivedHex.charCodeAt(i);
  }
  return diff === 0;
}
