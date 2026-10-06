#!/usr/bin/env node
/**
 * Non-production migration verification for PR #16 order contact fields.
 *
 * Verifies that prisma/migrations/20261006120000_add_order_contact_fields/migration.sql
 * applies cleanly to an isolated schema in PostgreSQL on top of all
 * prior migrations, that the resulting columns match prisma/schema.prisma,
 * and that the migration contains no destructive operations.
 *
 * Modes:
 *   node scripts/verify-order-contact-migration.mjs          # PGlite (in-memory Postgres)
 *   DATABASE_URL=... node scripts/verify-order-contact-migration.mjs --real  # real scratch PG
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isProbablyProductionUrl,
  isScratchOverrideValid,
} from "./verify-staff-migration.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readMigrationFile(relative) {
  return fs.readFile(path.join(repoRoot, relative), "utf8");
}

const MIGRATIONS = [
  "prisma/migrations/20261003000000_init/migration.sql",
  "prisma/migrations/20261003120000_add_customer_authentication/migration.sql",
  "prisma/migrations/20261003150000_add_cart_and_checkout_foundation/migration.sql",
  "prisma/migrations/20261004120000_add_staff_access/migration.sql",
  "prisma/migrations/20261006120000_add_order_contact_fields/migration.sql",
];

async function verifySchemaColumns(queryFn, schemaName) {
  const r = await queryFn(
    `SELECT column_name, data_type, character_maximum_length, is_nullable
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'Order'
     ORDER BY ordinal_position`,
    [schemaName],
  );
  const cols = Object.fromEntries(r.rows.map((row) => [row.column_name, row]));

  const expected = [
    { name: "customerName", maxLen: 120 },
    { name: "customerPhone", maxLen: 32 },
    { name: "telegramHandle", maxLen: 64 },
  ];

  for (const exp of expected) {
    const col = cols[exp.name];
    if (!col) throw new Error(`Column ${exp.name} missing on Order table in schema ${schemaName}`);
    if (col.is_nullable !== "YES") throw new Error(`Column ${exp.name} should be nullable`);
    if (col.character_maximum_length !== exp.maxLen) {
      throw new Error(
        `Column ${exp.name} should have max length ${exp.maxLen}, got ${col.character_maximum_length}`,
      );
    }
  }

  // Additive check: migration.sql is additive only
  const sql = await readMigrationFile(
    "prisma/migrations/20261006120000_add_order_contact_fields/migration.sql",
  );
  if (/^\s*DROP/im.test(sql)) throw new Error("migration should not contain DROP");
  if (/^\s*TRUNCATE/im.test(sql)) throw new Error("migration should not contain TRUNCATE");
  if (/ALTER TABLE\s+"?Order"?\s+DROP/i.test(sql)) {
    throw new Error("migration should not drop anything from Order");
  }

  // Static check on schema.prisma
  const schema = await readMigrationFile("prisma/schema.prisma");
  if (!/customerName\s+String\?\s+@db\.VarChar\(120\)/.test(schema)) {
    throw new Error("schema.prisma missing customerName");
  }
  if (!/customerPhone\s+String\?\s+@db\.VarChar\(32\)/.test(schema)) {
    throw new Error("schema.prisma missing customerPhone");
  }
  if (!/telegramHandle\s+String\?\s+@db\.VarChar\(64\)/.test(schema)) {
    throw new Error("schema.prisma missing telegramHandle");
  }
}

async function verifyWithPGlite() {
  console.log("→ Verifying order contact migration with PGlite (isolated temporary schema) …");
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();

  const tempSchema = `verify_order_contact_${Date.now()}`;
  await db.exec(`CREATE SCHEMA "${tempSchema}"`);
  await db.exec(`SET search_path TO "${tempSchema}"`);

  for (const rel of MIGRATIONS) {
    const sql = await readMigrationFile(rel);
    try {
      await db.exec(sql);
      console.log(`  ✓ ${rel}`);
    } catch (e) {
      console.error(`  ✗ ${rel} failed: ${e.message}`);
      await db.close();
      process.exit(1);
    }
  }

  await verifySchemaColumns((query, params) => db.query(query, params), tempSchema);
  console.log("  ✓ schema matches prisma/schema.prisma (customerName, customerPhone, telegramHandle nullable, additive)");

  await db.exec(`DROP SCHEMA "${tempSchema}" CASCADE`);
  console.log("✓ PGlite verification passed: isolated temporary schema verified and dropped.");
  await db.close();
}

async function verifyWithRealPostgres(url) {
  console.log("→ Verifying order contact migration against real PostgreSQL …");
  if (isProbablyProductionUrl(url) && !isScratchOverrideValid(url)) {
    console.error("  ✗ Refusing to run against a probable production Neon URL.");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: url });
  await client.connect();

  const tempSchema = `verify_order_contact_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA "${tempSchema}"`);
    await client.query(`SET search_path TO "${tempSchema}"`);

    for (const rel of MIGRATIONS) {
      const sql = await readMigrationFile(rel);
      await client.query(sql);
      console.log(`  ✓ ${rel} (real PG scratch)`);
    }

    await verifySchemaColumns(
      (query, params) => client.query(query, params),
      tempSchema,
    );
    console.log("  ✓ real PG scratch schema matches expected");

    await client.query(`DROP SCHEMA "${tempSchema}" CASCADE`);
    console.log("✓ Real PostgreSQL verification passed: temporary schema dropped.");
  } finally {
    await client.end();
  }
}

const args = process.argv.slice(2);
const useReal = args.includes("--real");
const databaseUrl = process.env.DATABASE_URL?.trim() || null;

(async () => {
  await verifyWithPGlite();
  if (useReal) {
    if (!databaseUrl) {
      console.error("DATABASE_URL is required for --real verification");
      process.exit(1);
    }
    await verifyWithRealPostgres(databaseUrl);
  }
})();
