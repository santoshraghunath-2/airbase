/**
 * RLS audit: static check that every CREATE TABLE in the migrations directory
 * is followed by ENABLE ROW LEVEL SECURITY for that same table.
 *
 * This check is intentionally strict: if a migration creates a table and does NOT
 * enable RLS in the same file, the test fails and reports the table name.
 *
 * Exceptions (tables that intentionally have no RLS — none expected in this codebase):
 * Add to EXEMPT_TABLES below if a table genuinely does not need RLS.
 */

import { assertEquals } from "@std/assert";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

const MIGRATIONS_DIR = join(
  new URL(".", import.meta.url).pathname,
  "..",
  "..",
  "migrations",
);

// Tables that intentionally have no RLS (should stay empty).
const EXEMPT_TABLES = new Set<string>([]);

Deno.test("every CREATE TABLE has ENABLE ROW LEVEL SECURITY in the same migration file", async () => {
  const missing: Array<{ file: string; table: string }> = [];

  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    if (entry.name.startsWith("_")) continue; // skip utility / seed files if any

    const content = await Deno.readTextFile(join(MIGRATIONS_DIR, entry.name));
    const upper = content.toUpperCase();

    // Find all CREATE TABLE statements (simple regex; handles IF NOT EXISTS)
    const createTableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\w+\.)?([\w]+)\s*\(/gi;
    let match: RegExpExecArray | null;

    while ((match = createTableRe.exec(content)) !== null) {
      const tableName = match[1].toLowerCase();

      if (EXEMPT_TABLES.has(tableName)) continue;

      // Check that ENABLE ROW LEVEL SECURITY appears for this table in the same file.
      // We look for the pattern after the CREATE TABLE occurrence.
      const afterCreate = upper.slice(match.index);
      const rlsPattern = new RegExp(
        `ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY\\s+ON\\s+(?:\\w+\\.)?${tableName.toUpperCase()}`,
      );

      if (!rlsPattern.test(afterCreate)) {
        missing.push({ file: entry.name, table: tableName });
      }
    }
  }

  if (missing.length > 0) {
    const report = missing
      .map((m) => `  ${m.file}: table "${m.table}" has no ENABLE ROW LEVEL SECURITY`)
      .join("\n");
    throw new Error(`RLS missing for the following tables:\n${report}`);
  }

  assertEquals(missing.length, 0, "All tables must have RLS enabled");
});
