// Retell AI webhook signature verification
// Signed string: rawBody + timestamp_string (the numeric value from v=)
// Digest: HMAC-SHA256 hex
// Header format: v={unix_ms},d={hex_digest}
// Reject if |now - timestamp| > 5 minutes

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export async function verifyRetellSignature(
  rawBody: string,
  signature: string | null,
  apiKey: string,
): Promise<boolean> {
  if (!signature) return false;
  const match = signature.match(/^v=(\d+),d=([0-9a-f]+)$/i);
  if (!match) return false;

  const timestampMs = parseInt(match[1], 10);
  const receivedHex = match[2].toLowerCase();

  if (Math.abs(Date.now() - timestampMs) > FIVE_MINUTES_MS) return false;

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
  const expectedHex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expectedHex.length !== receivedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedHex.length; i++) {
    diff |= expectedHex.charCodeAt(i) ^ receivedHex.charCodeAt(i);
  }
  return diff === 0;
}
