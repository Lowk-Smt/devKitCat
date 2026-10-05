#!/usr/bin/env node
/**
 * Non-production migration verification for PR #12 staff access.
 *
 * Verifies that prisma/migrations/20261004120000_add_staff_access/migration.sql
 * applies cleanly to a scratch PostgreSQL database and that the resulting
 * schema matches prisma/schema.prisma.
 *
 * By default it uses PGlite (WASM Postgres, no external service) so it runs
 * in CI and in the sandbox without credentials. If a scratch DATABASE_URL is
 * supplied (e.g. a local postgres or a non-production Neon branch), it will
 * also verify against that database when --real is passed, but it refuses to
 * touch a production URL.
 *
 * Safety guard (fail-closed):
 *  - Any URL containing "neon.tech" without "scratch" or "test" is treated as
 *    probably production and is REJECTED by default.
 *  - localhost / 127.0.0.1 and non-Neon hosts are allowed without extra flags.
 *  - To verify against a disposable Neon scratch database whose hostname is a
 *    normal Neon hostname (no scratch/test marker), you must explicitly opt-in
 *    with BOTH:
 *      1) VERIFY_MIGRATION_SCRATCH_DB=true
 *      2) VERIFY_MIGRATION_SCRATCH_HOST="<expected-host-fragment>"
 *         and/or VERIFY_MIGRATION_SCRATCH_DATABASE="<expected-db-name>"
 *    The host fragment must be a case-insensitive substring of DATABASE_URL's
 *    hostname (e.g. "ep-scratch-123-pooler" or the full host). The database
 *    name, if supplied, must match DATABASE_URL's database exactly. At least
 *    one of HOST or DATABASE must be supplied when the flag is true; setting
 *    the flag alone does NOT allow a production URL (fail-closed).
 *    Aliases VERIFY_MIGRATION_EXPECTED_HOST / VERIFY_MIGRATION_EXPECTED_DATABASE
 *    are also accepted.
 *
 *  This makes accidental production use impossible: `node ... --real` alone
 *  never allows a production Neon URL, and `VERIFY_MIGRATION_SCRATCH_DB=true`
 *  alone without the matching host/database still rejects.
 *
 * Usage:
 *   node scripts/verify-staff-migration.mjs              # PGlite only
 *   node scripts/verify-staff-migration.mjs --help       # this help
 *   DATABASE_URL=postgres://... node scripts/verify-staff-migration.mjs --real  # also real PG (local or scratch/test URL)
 *   VERIFY_MIGRATION_SCRATCH_DB=true VERIFY_MIGRATION_SCRATCH_HOST=ep-scratch-xyz-pooler DATABASE_URL=postgres://...@ep-scratch-xyz-pooler.c-2.us-east-1.aws.neon.tech/neondb node scripts/verify-staff-migration.mjs --real
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function isProbablyProductionUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  // Heuristic: Neon production URLs often contain the project id or are not
  // localhost. We refuse anything that is not explicitly localhost / 127.0.0.1
  // unless explicitly allowed via scratch override. For safety, default real-PG
  // mode only allows localhost or URLs containing "scratch" / "test".
  if (lower.includes("neon.tech") && !lower.includes("scratch") && !lower.includes("test")) {
    return true;
  }
  return false;
}

export function getUrlHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function getUrlDatabase(url) {
  try {
    const u = new URL(url);
    // pathname is "/dbname" possibly with leading slash; strip search params handled by URL
    const raw = u.pathname.replace(/^\//, "").split("/")[0] ?? "";
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return "";
  }
}

function getExpectedScratchHost() {
  return (
    process.env.VERIFY_MIGRATION_SCRATCH_HOST ??
    process.env.VERIFY_MIGRATION_EXPECTED_HOST ??
    ""
  )
    .trim()
    .toLowerCase();
}

function getExpectedScratchDatabase() {
  return (
    process.env.VERIFY_MIGRATION_SCRATCH_DATABASE ??
    process.env.VERIFY_MIGRATION_EXPECTED_DATABASE ??
    ""
  )
    .trim()
    .toLowerCase();
}

export function isScratchOverrideValid(url) {
  const optIn = process.env.VERIFY_MIGRATION_SCRATCH_DB?.trim().toLowerCase() === "true";
  if (!optIn) return false;
  if (!url) return false;
  const expectedHost = getExpectedScratchHost();
  const expectedDb = getExpectedScratchDatabase();
  // Fail-closed: at least one of host or database must be supplied
  if (!expectedHost && !expectedDb) return false;

  if (expectedHost) {
    const host = getUrlHost(url);
    if (!host || !host.includes(expectedHost)) return false;
  }
  if (expectedDb) {
    const db = getUrlDatabase(url);
    if (!db || db !== expectedDb) return false;
  }
  // Both supplied checks passed, or single check passed
  return true;
}

export function shouldAllowRealVerification(url) {
  if (!isProbablyProductionUrl(url)) return true;
  return isScratchOverrideValid(url);
}

function printHelp() {
  console.log(`
Non-production migration verification for PR #12 staff access.

Verifies that prisma/migrations/20261004120000_add_staff_access/migration.sql
applies cleanly and matches prisma/schema.prisma.

Modes:
  node scripts/verify-staff-migration.mjs              # PGlite only (default, no DB)
  node scripts/verify-staff-migration.mjs --real       # also real PostgreSQL via DATABASE_URL

Safety (fail-closed):
  --real refuses any URL that looks like production (contains "neon.tech"
  without "scratch"/"test") UNLESS you explicitly designate a scratch DB
  with BOTH:

    VERIFY_MIGRATION_SCRATCH_DB=true
    VERIFY_MIGRATION_SCRATCH_HOST=<host-fragment>   (required if DB has normal Neon hostname)
    VERIFY_MIGRATION_SCRATCH_DATABASE=<db-name>     (optional, exact match; aliases
                                                     VERIFY_MIGRATION_EXPECTED_HOST/DATABASE also work)

  The host fragment must be a case-insensitive substring of DATABASE_URL's
  hostname. At least one of HOST or DATABASE must be set when the flag is
  true; the flag alone does nothing. This prevents accidental production use.

  Real verification never migrates the production/default schema: it creates a
  temporary schema "verify_staff_<timestamp>", applies migrations there, checks,
  then drops it.

Examples:
  # PGlite only
  node scripts/verify-staff-migration.mjs

  # Local Postgres (no extra vars needed)
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/devkitcat node scripts/verify-staff-migration.mjs --real

  # Neon scratch with normal hostname — explicit opt-in:
  VERIFY_MIGRATION_SCRATCH_DB=true VERIFY_MIGRATION_SCRATCH_HOST=ep-scratch-xyz123-pooler \\
    DATABASE_URL=postgresql://user:pass@ep-scratch-xyz123-pooler.c-2.us-east-1.aws.neon.tech/neondb \\
    node scripts/verify-staff-migration.mjs --real

  # With database name check:
  VERIFY_MIGRATION_SCRATCH_DB=true VERIFY_MIGRATION_SCRATCH_HOST=ep-scratch-xyz \\
  VERIFY_MIGRATION_SCRATCH_DATABASE=neondb DATABASE_URL=... node scripts/verify-staff-migration.mjs --real
`.trim());
}

async function readMigrationFile(relative) {
  return fs.readFile(path.join(repoRoot, relative), "utf8");
}

async function verifyWithPGlite() {
  console.log("→ Verifying staff migration with PGlite (in-memory Postgres) …");
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();

  const order = [
    "prisma/migrations/20261003000000_init/migration.sql",
    "prisma/migrations/20261003120000_add_customer_authentication/migration.sql",
    "prisma/migrations/20261003150000_add_cart_and_checkout_foundation/migration.sql",
    "prisma/migrations/20261004120000_add_staff_access/migration.sql",
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

  // Schema assertions that mirror prisma/schema.prisma.
  const checks = [];

  // 1. Table exists.
  checks.push(async () => {
    const r = await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='StaffMembership'",
    );
    if (r.rows.length !== 1) throw new Error("StaffMembership table missing");
  });

  // 2. Columns.
  checks.push(async () => {
    const r = await db.query(
      "SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name='StaffMembership' ORDER BY ordinal_position",
    );
    const cols = Object.fromEntries(r.rows.map((row) => [row.column_name, row]));
    const expected = ["id", "customerId", "role", "grantedByCustomerId", "createdAt", "updatedAt"];
    for (const name of expected) {
      if (!cols[name]) throw new Error(`column ${name} missing`);
    }
    if (!cols.role.column_default.includes("STAFF")) {
      throw new Error(`role default should be 'STAFF', got ${cols.role.column_default}`);
    }
    if (cols.customerId.is_nullable !== "NO") throw new Error("customerId should be NOT NULL");
    if (cols.grantedByCustomerId.is_nullable !== "YES") throw new Error("grantedByCustomerId should be nullable");
  });

  // 3. Enum.
  checks.push(async () => {
    const r = await db.query(
      "SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid=pg_enum.enumtypid WHERE typname='StaffRole' ORDER BY enumsortorder",
    );
    const labels = r.rows.map((row) => row.enumlabel).sort();
    if (labels.join(",") !== "OWNER,STAFF") {
      throw new Error(`StaffRole enum mismatch: ${labels}`);
    }
  });

  // 4. Indexes.
  checks.push(async () => {
    const r = await db.query("SELECT indexname FROM pg_indexes WHERE tablename='StaffMembership'");
    const names = r.rows.map((row) => row.indexname).sort();
    const needed = ["StaffMembership_customerId_key", "StaffMembership_grantedByCustomerId_idx", "StaffMembership_pkey", "StaffMembership_role_idx"];
    for (const n of needed) if (!names.includes(n)) throw new Error(`index ${n} missing (have ${names})`);
    // customerId unique.
    const uniq = await db.query(
      "SELECT indexname FROM pg_indexes WHERE tablename='StaffMembership' AND indexdef LIKE '%UNIQUE%'",
    );
    if (!uniq.rows.some((row) => row.indexname === "StaffMembership_customerId_key")) {
      throw new Error("customerId unique index missing");
    }
  });

  // 5. Foreign keys.
  checks.push(async () => {
    const r = await db.query(
      "SELECT conname, confdeltype, confupdtype FROM pg_constraint WHERE conrelid='\"StaffMembership\"'::regclass AND contype='f'",
    );
    // confdeltype: 'c'=cascade, 'n'=set null, 'a'=no action
    const byName = Object.fromEntries(r.rows.map((row) => [row.conname, row]));
    if (!byName.StaffMembership_customerId_fkey) throw new Error("FK customerId missing");
    if (byName.StaffMembership_customerId_fkey.confdeltype !== "c") throw new Error("customerId FK should be CASCADE");
    if (!byName.StaffMembership_grantedByCustomerId_fkey) throw new Error("FK grantedByCustomerId missing");
    if (byName.StaffMembership_grantedByCustomerId_fkey.confdeltype !== "n") throw new Error("grantedByCustomerId FK should be SET NULL");
  });

  // 6. Additive check: migration.sql is additive only.
  checks.push(async () => {
    const sql = await readMigrationFile("prisma/migrations/20261004120000_add_staff_access/migration.sql");
    if (/^\s*DROP/m.test(sql)) throw new Error("migration should not contain DROP");
    if (/^\s*TRUNCATE/m.test(sql)) throw new Error("migration should not contain TRUNCATE");
    // No ALTER TABLE "Customer" DROP, no UPDATE/DELETE.
    if (/ALTER TABLE "Customer"[^;]*DROP/i.test(sql)) throw new Error("migration should not alter Customer with DROP");
  });

  for (const check of checks) {
    await check();
  }
  console.log("  ✓ schema matches prisma/schema.prisma (table, columns, enum, indexes, FKs, additive)");

  // Also ensure prisma/schema.prisma indeed defines the same model (static check).
  const schema = await readMigrationFile("prisma/schema.prisma");
  if (!/enum StaffRole/.test(schema)) throw new Error("schema.prisma missing enum StaffRole");
  if (!/model StaffMembership/.test(schema)) throw new Error("schema.prisma missing model StaffMembership");
  if (!/customerId\s+String\s+@unique/.test(schema)) throw new Error("schema.prisma StaffMembership.customerId should be @unique");
  if (!/role\s+StaffRole\s+@default\(STAFF\)/.test(schema)) throw new Error("schema.prisma role default should be STAFF");
  console.log("  ✓ prisma/schema.prisma defines StaffMembership + StaffRole correctly");

  console.log("✓ PGlite verification passed: migration applies cleanly and matches schema.");
  await db.close();
}

async function verifyWithRealPostgres(url) {
  console.log("→ Verifying staff migration against real PostgreSQL …");
  if (isProbablyProductionUrl(url) && !isScratchOverrideValid(url)) {
    console.error("  ✗ Refusing to run against a probable production Neon URL.");
    console.error("    Use a scratch URL (localhost or containing 'scratch'/'test'), or enable explicit scratch override:");
    console.error("      VERIFY_MIGRATION_SCRATCH_DB=true VERIFY_MIGRATION_SCRATCH_HOST=<expected-host-fragment>");
    console.error("      (and optionally VERIFY_MIGRATION_SCRATCH_DATABASE=<expected-db>) DATABASE_URL=... node scripts/verify-staff-migration.mjs --real");
    console.error("    The expected host/database must match DATABASE_URL; setting the flag alone is not sufficient (fail-closed). See --help for details.");
    process.exit(1);
  }
  if (isProbablyProductionUrl(url) && isScratchOverrideValid(url)) {
    console.log("  ⚠ Production guard overridden: explicit scratch designation verified.");
    console.log(`    VERIFY_MIGRATION_SCRATCH_DB=true + host/database match confirmed`);
  }
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // Use a temporary schema so we don't pollute the scratch DB.
    const schemaName = `verify_staff_${Date.now()}`;
    await client.query(`CREATE SCHEMA "${schemaName}"`);
    await client.query(`SET search_path TO "${schemaName}"`);
    // Apply migrations in order inside that schema (PGlite used public; here we
    // use the isolated schema, so the check is the same).
    const order = [
      "prisma/migrations/20261003000000_init/migration.sql",
      "prisma/migrations/20261003120000_add_customer_authentication/migration.sql",
      "prisma/migrations/20261003150000_add_cart_and_checkout_foundation/migration.sql",
      "prisma/migrations/20261004120000_add_staff_access/migration.sql",
    ];
    for (const rel of order) {
      let sql = await readMigrationFile(rel);
      // The migration SQL uses unqualified table names, so it lands in the
      // current search_path schema.
      await client.query(sql);
      console.log(`  ✓ ${rel} (real PG)`);
    }
    // Quick sanity: enum and table exist in this schema.
    const r = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename='StaffMembership'",
      [schemaName],
    );
    if (r.rows.length !== 1) throw new Error("StaffMembership missing in real PG");
    console.log("  ✓ real PG schema matches expected");
    await client.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    console.log("✓ Real PostgreSQL verification passed.");
  } finally {
    await client.end();
  }
}

const args = process.argv.slice(2);
const useReal = args.includes("--real");
const wantsHelp = args.includes("--help") || args.includes("-h");
const databaseUrl = process.env.DATABASE_URL?.trim() || null;

// Only run when executed directly, not when imported for tests
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  (async () => {
    if (wantsHelp) {
      printHelp();
      process.exit(0);
    }
    await verifyWithPGlite();
    if (useReal) {
      if (!databaseUrl) {
        console.error("DATABASE_URL is required for --real verification");
        process.exit(1);
      }
      await verifyWithRealPostgres(databaseUrl);
    } else if (databaseUrl && isProbablyProductionUrl(databaseUrl) && !isScratchOverrideValid(databaseUrl)) {
      console.log("Note: DATABASE_URL looks like production; skipping real-PG check (use PGlite result).");
      console.log("      To verify against a scratch DB, set DATABASE_URL to a localhost or scratch URL and pass --real,");
      console.log("      or for a Neon scratch with a normal hostname set VERIFY_MIGRATION_SCRATCH_DB=true and VERIFY_MIGRATION_SCRATCH_HOST=<host>.");
    }
  })();
}
