#!/usr/bin/env node
/**
 * Non-production migration verification for the order <-> Telegram connection.
 *
 * Verifies that prisma/migrations/20261008120000_add_order_telegram_link/migration.sql
 * applies cleanly on top of all prior migrations in an isolated schema, that
 * the resulting tables/indexes match prisma/schema.prisma, and that the
 * migration contains no destructive operations. `Order` must be untouched.
 *
 * Modes:
 *   node scripts/verify-order-telegram-link-migration.mjs          # PGlite (in-memory Postgres)
 *   DATABASE_URL=... node scripts/verify-order-telegram-link-migration.mjs --real  # real scratch PG
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
  "prisma/migrations/20261008120000_add_order_telegram_link/migration.sql",
];

const LINK_COLUMNS = [
  { name: "id", nullable: false, maxLen: null },
  { name: "orderId", nullable: false, maxLen: null },
  { name: "tokenHash", nullable: false, maxLen: 64 },
  { name: "expiresAt", nullable: false, maxLen: null },
  { name: "consumedAt", nullable: true, maxLen: null },
  { name: "chatId", nullable: true, maxLen: 32 },
  { name: "connectedAt", nullable: true, maxLen: null },
  { name: "telegramName", nullable: true, maxLen: 120 },
  { name: "createdAt", nullable: false, maxLen: null },
  { name: "updatedAt", nullable: false, maxLen: null },
];

const RELAY_COLUMNS = [
  { name: "id", nullable: false, maxLen: null },
  { name: "linkId", nullable: false, maxLen: null },
  { name: "staffChatId", nullable: false, maxLen: 32 },
  { name: "staffMessageId", nullable: false, maxLen: 32 },
  { name: "sourceUpdateId", nullable: true, maxLen: 24 },
  { name: "sourceKind", nullable: true, maxLen: 16 },
  { name: "createdAt", nullable: false, maxLen: null },
];

const EVENT_COLUMNS = [
  { name: "updateId", nullable: false, maxLen: 24 },
  { name: "status", nullable: false, maxLen: 16 },
  { name: "leaseUntil", nullable: true, maxLen: null },
  { name: "attempts", nullable: false, maxLen: null },
  { name: "customerMessageId", nullable: true, maxLen: 32 },
  { name: "staffReplyMessageId", nullable: true, maxLen: 32 },
  { name: "receivedAt", nullable: false, maxLen: null },
  { name: "updatedAt", nullable: false, maxLen: null },
];

async function verifyTables(queryFn, schemaName) {
  async function columnsOf(table) {
    const r = await queryFn(
      `SELECT column_name, data_type, character_maximum_length, is_nullable
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schemaName, table],
    );
    return Object.fromEntries(r.rows.map((row) => [row.column_name, row]));
  }

  function assertColumns(cols, expected, table) {
    for (const exp of expected) {
      const col = cols[exp.name];
      if (!col) throw new Error(`Column ${exp.name} missing on ${table} in schema ${schemaName}`);
      const shouldBeNullable = exp.nullable ? "YES" : "NO";
      if (col.is_nullable !== shouldBeNullable) {
        throw new Error(`Column ${exp.name} on ${table} should be nullable=${exp.nullable}`);
      }
      if (exp.maxLen !== null && String(col.character_maximum_length) !== String(exp.maxLen)) {
        throw new Error(
          `Column ${exp.name} on ${table} should have max length ${exp.maxLen}, got ${col.character_maximum_length}`,
        );
      }
    }
  }

  const linkCols = await columnsOf("OrderTelegramLink");
  assertColumns(linkCols, LINK_COLUMNS, "OrderTelegramLink");
  const relayCols = await columnsOf("TelegramStaffRelay");
  assertColumns(relayCols, RELAY_COLUMNS, "TelegramStaffRelay");
  const eventCols = await columnsOf("TelegramWebhookEvent");
  assertColumns(eventCols, EVENT_COLUMNS, "TelegramWebhookEvent");

  // Unique constraints that carry the security and routing guarantees.
  const indexes = await queryFn(
    `SELECT indexname, indexdef
     FROM pg_indexes
     WHERE schemaname = $1 AND tablename IN ('OrderTelegramLink', 'TelegramStaffRelay', 'TelegramWebhookEvent')`,
    [schemaName],
  );
  const defs = Object.fromEntries(indexes.rows.map((row) => [row.indexname, row.indexdef]));
  for (const required of [
    "OrderTelegramLink_orderId_key",
    "OrderTelegramLink_tokenHash_key",
    "TelegramStaffRelay_staffChatId_staffMessageId_key",
    "TelegramWebhookEvent_pkey",
  ]) {
    if (!defs[required] || !/UNIQUE/i.test(defs[required])) {
      throw new Error(`Expected unique index ${required} is missing`);
    }
  }
  if (!defs["OrderTelegramLink_chatId_idx"]) {
    throw new Error("Expected index OrderTelegramLink_chatId_idx is missing");
  }
  if (!defs["TelegramStaffRelay_sourceUpdateId_idx"]) {
    throw new Error("Expected index TelegramStaffRelay_sourceUpdateId_idx is missing");
  }

  // The foreign key must cascade from Order so removing an order removes its
  // connection instead of leaving orphaned links.
  const fks = await queryFn(
    `SELECT confdeltype
     FROM pg_constraint
     WHERE contype = 'f' AND conrelid = $1::regclass AND confrelid = $2::regclass`,
    [`${schemaName}."OrderTelegramLink"`, `${schemaName}."Order"`],
  );
  if (fks.rows.length !== 1 || fks.rows[0].confdeltype !== "c") {
    throw new Error("OrderTelegramLink.orderId must reference Order with ON DELETE CASCADE");
  }

  // Order itself must be untouched by this migration.
  const orderCols = await queryFn(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'Order' ORDER BY ordinal_position`,
    [schemaName],
  );
  const orderColumnNames = new Set(orderCols.rows.map((row) => row.column_name));
  for (const forbidden of ["telegramLinkId", "telegramChatId", "telegramLink"]) {
    if (orderColumnNames.has(forbidden)) {
      throw new Error(`Order must not gain a ${forbidden} column`);
    }
  }

  // Additive check: this migration's SQL must not destroy anything.
  const sql = await readMigrationFile(
    "prisma/migrations/20261008120000_add_order_telegram_link/migration.sql",
  );
  if (/^\s*DROP/im.test(sql)) throw new Error("migration should not contain DROP");
  if (/^\s*TRUNCATE/im.test(sql)) throw new Error("migration should not contain TRUNCATE");
  if (/ALTER TABLE\s+"?Order"?\s/i.test(sql)) {
    throw new Error("migration should not alter the Order table");
  }

  // Static check on schema.prisma.
  const schema = await readMigrationFile("prisma/schema.prisma");
  for (const expected of [
    /model\s+OrderTelegramLink\s*\{/,
    /model\s+TelegramStaffRelay\s*\{/,
    /model\s+TelegramWebhookEvent\s*\{/,
    /tokenHash\s+String\s+@unique\s+@db\.VarChar\(64\)/,
    /orderId\s+String\s+@unique/,
    /chatId\s+String\?\s+@db\.VarChar\(32\)/,
    /telegramLink\s+OrderTelegramLink\?/,
    /sourceUpdateId\s+String\?\s+@db\.VarChar\(24\)/,
    /status\s+String\s+@default\("processing"\)\s+@db\.VarChar\(16\)/,
    /leaseUntil\s+DateTime\?\s+@db\.Timestamptz\(3\)/,
    /customerMessageId\s+String\?\s+@db\.VarChar\(32\)/,
    /staffReplyMessageId\s+String\?\s+@db\.VarChar\(32\)/,
  ]) {
    if (!expected.test(schema)) {
      throw new Error(`schema.prisma missing expected pattern: ${expected}`);
    }
  }
}

async function verifyWithPGlite() {
  console.log("→ Verifying order telegram-link migration with PGlite (isolated temporary schema) …");
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();

  const tempSchema = `verify_order_telegram_${Date.now()}`;
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

  await verifyTables((query, params) => db.query(query, params), tempSchema);
  console.log("  ✓ tables, unique indexes, cascade FK, and schema.prisma all match (additive only)");

  await db.exec(`DROP SCHEMA "${tempSchema}" CASCADE`);
  console.log("✓ PGlite verification passed: isolated temporary schema verified and dropped.");
  await db.close();
}

async function verifyWithRealPostgres(url) {
  console.log("→ Verifying order telegram-link migration against real PostgreSQL …");
  if (isProbablyProductionUrl(url) && !isScratchOverrideValid(url)) {
    console.error("  ✗ Refusing to run against a probable production Neon URL.");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: url });
  await client.connect();

  const tempSchema = `verify_order_telegram_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA "${tempSchema}"`);
    await client.query(`SET search_path TO "${tempSchema}"`);

    for (const rel of MIGRATIONS) {
      const sql = await readMigrationFile(rel);
      await client.query(sql);
      console.log(`  ✓ ${rel} (real PG scratch)`);
    }

    await verifyTables((query, params) => client.query(query, params), tempSchema);
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
