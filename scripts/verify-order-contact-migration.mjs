#!/usr/bin/env node
/**
 * Non-production migration verification for PR #16 order contact fields.
 *
 * Verifies that prisma/migrations/20261006120000_add_order_contact_fields/migration.sql
 * applies cleanly to an in-memory PostgreSQL database (PGlite) on top of all
 * prior migrations, that the resulting columns match prisma/schema.prisma,
 * and that the migration contains no destructive operations.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readMigrationFile(relative) {
  return fs.readFile(path.join(repoRoot, relative), "utf8");
}

async function verifyWithPGlite() {
  console.log("→ Verifying order contact migration with PGlite (in-memory Postgres) …");
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();

  const order = [
    "prisma/migrations/20261003000000_init/migration.sql",
    "prisma/migrations/20261003120000_add_customer_authentication/migration.sql",
    "prisma/migrations/20261003150000_add_cart_and_checkout_foundation/migration.sql",
    "prisma/migrations/20261004120000_add_staff_access/migration.sql",
    "prisma/migrations/20261006120000_add_order_contact_fields/migration.sql",
  ];

  for (const rel of order) {
    const sql = await readMigrationFile(rel);
    try {
      await db.exec(sql);
      console.log(`  ✓ ${rel}`);
    } catch (e) {
      console.error(`  ✗ ${rel} failed: ${e.message}`);
      console.error(e);
      process.exit(1);
    }
  }

  // 1. Columns on Order table
  const r = await db.query(
    "SELECT column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns WHERE table_name='Order' ORDER BY ordinal_position",
  );
  const cols = Object.fromEntries(r.rows.map((row) => [row.column_name, row]));

  const expected = [
    { name: "customerName", maxLen: 120 },
    { name: "customerPhone", maxLen: 32 },
    { name: "telegramHandle", maxLen: 64 },
  ];

  for (const exp of expected) {
    const col = cols[exp.name];
    if (!col) throw new Error(`Column ${exp.name} missing on Order table`);
    if (col.is_nullable !== "YES") throw new Error(`Column ${exp.name} should be nullable`);
    if (col.character_maximum_length !== exp.maxLen) {
      throw new Error(`Column ${exp.name} should have max length ${exp.maxLen}, got ${col.character_maximum_length}`);
    }
  }

  // 2. Additive check: migration.sql is additive only.
  const sql = await readMigrationFile("prisma/migrations/20261006120000_add_order_contact_fields/migration.sql");
  if (/^\s*DROP/im.test(sql)) throw new Error("migration should not contain DROP");
  if (/^\s*TRUNCATE/im.test(sql)) throw new Error("migration should not contain TRUNCATE");
  if (/ALTER TABLE\s+"?Order"?\s+DROP/i.test(sql)) throw new Error("migration should not drop anything from Order");

  console.log("  ✓ schema matches prisma/schema.prisma (customerName, customerPhone, telegramHandle nullable, additive)");

  // 3. Static check on schema.prisma
  const schema = await readMigrationFile("prisma/schema.prisma");
  if (!/customerName\s+String\?\s+@db\.VarChar\(120\)/.test(schema)) throw new Error("schema.prisma missing customerName");
  if (!/customerPhone\s+String\?\s+@db\.VarChar\(32\)/.test(schema)) throw new Error("schema.prisma missing customerPhone");
  if (!/telegramHandle\s+String\?\s+@db\.VarChar\(64\)/.test(schema)) throw new Error("schema.prisma missing telegramHandle");
  console.log("  ✓ prisma/schema.prisma defines Order contact fields correctly");

  console.log("✓ PGlite verification passed: all migrations apply cleanly in order.");
  await db.close();
}

verifyWithPGlite().catch((err) => {
  console.error("Migration verification failed:", err);
  process.exit(1);
});
