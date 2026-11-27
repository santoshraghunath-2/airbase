// Static audit: every CREATE TABLE in supabase/migrations/ must have
// ENABLE ROW LEVEL SECURITY in the same file.

import { assertEquals } from "jsr:@std/assert";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);

Deno.test("every CREATE TABLE has ENABLE ROW LEVEL SECURITY", async () => {
  const failures: string[] = [];

  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.name.endsWith(".sql")) continue;

    const content = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
    const upper = content.toUpperCase();

    // Count CREATE TABLE statements (excluding CREATE TABLE IF NOT EXISTS … AS SELECT etc.)
    const tableMatches = [...upper.matchAll(/CREATE TABLE\b/g)];
    if (tableMatches.length === 0) continue;

    if (!upper.includes("ENABLE ROW LEVEL SECURITY")) {
      failures.push(entry.name);
    }
  }

  assertEquals(
    failures,
    [],
    `These migration files CREATE TABLE without ENABLE ROW LEVEL SECURITY:\n${failures.join("\n")}`,
  );
});
