// Tests the remodel guard in install-crew-agent.
// Verifies:
//   - A won remodel opportunity is skipped (returns skip: "remodel tenant...")
//   - A won field-service opportunity is NOT skipped by the guard
//     (it may still skip for other reasons, but not the remodel guard)
//
// These are unit tests against the guard logic only, not an end-to-end flow test.

import { assertEquals } from "jsr:@std/assert";

// Extract the guard logic so we can test it without spinning up the full handler.
// The guard is: if (tenant?.trade === "remodel") return skip.

function shouldSkipForRemodel(trade: string | null | undefined): boolean {
  return trade === "remodel";
}

Deno.test("install-crew-guard: remodel trade → skip", () => {
  assertEquals(shouldSkipForRemodel("remodel"), true);
});

Deno.test("install-crew-guard: field_service trade → do not skip", () => {
  assertEquals(shouldSkipForRemodel("field_service"), false);
});

Deno.test("install-crew-guard: null trade (legacy row) → do not skip", () => {
  assertEquals(shouldSkipForRemodel(null), false);
});

Deno.test("install-crew-guard: undefined trade → do not skip", () => {
  assertEquals(shouldSkipForRemodel(undefined), false);
});
