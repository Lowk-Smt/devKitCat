import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildCatalogSeedData,
  buildMarketplaceSeedData,
} from "../src/lib/server/seed-data.ts";
import { seedCatalog } from "../src/lib/server/seed-catalog.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Tables that hold customer/account state. The catalog-only seed must never
 * write to any of them; this list also covers tables that came after the seed
 * originally shipped, so the test keeps guarding the promise as the schema
 * grows.
 */
const ACCOUNT_TABLES = [
  "customer",
  "session",
  "cartItem",
  "order",
  "orderItem",
  "download",
];

const CATALOG_TABLES = [
  "category",
  "product",
  "productImage",
  "productModelPreview",
  "productChangelogEntry",
];

/**
 * In-memory Prisma stand-in that records every delegate call on every table,
 * including the account tables. Reaching for an account delegate is visible in
 * `calls`, and any row it might have written lands in `tables`.
 */
function makeInstrumentedPrisma() {
  const tables = Object.fromEntries(
    [...CATALOG_TABLES, ...ACCOUNT_TABLES].map((name) => [name, new Map()]),
  );
  const calls = [];

  const uniqueKey = (table, where) => {
    if (typeof where.id === "string") return where.id;
    for (const field of Object.keys(where)) {
      // Compound unique keys such as `productId_position`.
      if (field.includes("_")) return JSON.stringify(where[field]);
    }
    throw new Error(
      `Unexpected unique key for ${table}: ${JSON.stringify(where)}`,
    );
  };

  const delegate = (table) => ({
    async upsert({ where, create, update }) {
      calls.push([`${table}.upsert`, { where, create, update }]);
      const key = uniqueKey(table, where);
      const previous = tables[table].get(key);
      const saved = previous ? { ...previous, ...update } : { ...create };
      tables[table].set(key, saved);
      return saved;
    },
    async deleteMany({ where }) {
      calls.push([`${table}.deleteMany`, where]);
      for (const [key, row] of tables[table]) {
        if (where.productId !== undefined && row.productId !== where.productId) continue;
        if (where.position?.gte !== undefined && row.position < where.position.gte) continue;
        tables[table].delete(key);
      }
      return { count: 0 };
    },
  });

  const transaction = Object.fromEntries(
    Object.keys(tables).map((table) => [table, delegate(table)]),
  );

  return {
    tables,
    calls,
    prisma: {
      async $transaction(callback) {
        return callback(transaction);
      },
    },
  };
}

function snapshot(tables) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(tables).map(([table, rows]) => [
        table,
        [...rows.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ]),
    ),
  );
}

test("catalog seed data contains only the catalog fixtures", () => {
  const catalog = buildCatalogSeedData();
  const marketplace = buildMarketplaceSeedData();

  assert.deepEqual(Object.keys(catalog).sort(), ["categories", "products"]);
  // One projection feeds both the full demo seed and the catalog-only seed, so
  // the two commands can never drift apart on catalog content.
  assert.deepEqual(catalog.categories, marketplace.categories);
  assert.deepEqual(catalog.products, marketplace.products);

  assert.equal(catalog.categories.length, 8);
  assert.equal(catalog.products.length, 6);
  assert.deepEqual(
    catalog.categories.map((category) => category.id),
    [
      "systems",
      "ui-kits",
      "3d-assets",
      "vfx",
      "audio",
      "developer-tools",
      "templates",
      "complete-kits",
    ],
  );
  assert.ok(
    catalog.products.every(
      (product) => product.published === true && typeof product.sortOrder === "number",
    ),
  );
  assert.ok(
    catalog.products.every((product) =>
      catalog.categories.some((category) => category.id === product.categoryId),
    ),
  );
});

test("catalog seed writes only catalog tables, never account tables", async () => {
  const { prisma, tables, calls } = makeInstrumentedPrisma();
  const result = await seedCatalog(prisma);

  assert.deepEqual(result, {
    categories: 8,
    products: 6,
    productImages: 1,
    productModelPreviews: 2,
    changelogEntries: 6,
  });

  // The promised production safety property, asserted directly: no delegate
  // method on any customer/account table was even invoked.
  for (const table of ACCOUNT_TABLES) {
    assert.equal(
      tables[table].size,
      0,
      `${table} must stay empty after the catalog-only seed`,
    );
    assert.deepEqual(
      calls.filter(([name]) => name.split(".")[0] === table),
      [],
      `${table} must not receive any writes from the catalog-only seed`,
    );
  }

  // Catalog content is fully populated for the storefront reads.
  assert.equal(tables.category.size, 8);
  assert.equal(tables.product.size, 6);
  assert.equal(tables.productImage.size, 1);
  assert.equal(tables.productModelPreview.size, 2);
  assert.equal(tables.productChangelogEntry.size, 6);

  // Every product row points at a seeded category row.
  for (const product of tables.product.values()) {
    assert.ok(tables.category.has(product.categoryId));
  }
  assert.equal(tables.product.get("prosave").published, true);
});

test("repeated catalog seed runs stay idempotent on stable unique keys", async () => {
  const { prisma, tables, calls } = makeInstrumentedPrisma();

  const first = await seedCatalog(prisma);
  const afterFirst = snapshot(tables);
  const callsAfterFirst = calls.length;

  const second = await seedCatalog(prisma);
  const third = await seedCatalog(prisma);

  // Same summary, same database contents: replaying does not append anything.
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
  assert.equal(snapshot(tables), afterFirst);

  // Each replay takes the update path of the same upserts; nothing switches to
  // blind inserts after the first run.
  assert.equal(calls.length, callsAfterFirst * 3);

  // Every upsert targets one of the established stable unique keys, and create
  // payloads fix the stable fixture IDs, so IDs stay identical across
  // environments and across runs.
  const upserts = calls.filter(([name]) => name.endsWith(".upsert"));
  assert.ok(upserts.length > 0);
  for (const [name, args] of upserts) {
    const table = name.split(".")[0];
    if (table === "category" || table === "product") {
      assert.deepEqual(Object.keys(args.where), ["id"], `${name} where key`);
      assert.equal(args.create.id, args.where.id, `${name} create id`);
    } else {
      assert.deepEqual(Object.keys(args.where), ["productId_position"], `${name} where key`);
    }
  }
});

test("full demo seed still shares one catalog projection with the catalog seed", () => {
  const marketplace = buildMarketplaceSeedData();
  const catalog = buildCatalogSeedData();

  assert.deepEqual(
    { categories: marketplace.categories, products: marketplace.products },
    catalog,
  );
  assert.ok(marketplace.orders.length > 0 && marketplace.downloads.length > 0);
});

test("the catalog seed command fails closed without a valid DATABASE_URL", () => {
  // DATABASE_URL is emptied explicitly: dotenv does not override already-set
  // variables, so this process can never connect anywhere — it must refuse
  // before loading the seed runner.
  const missing = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import=tsx",
      path.join(repoRoot, "prisma", "seed-catalog.ts"),
    ],
    {
      env: { ...process.env, DATABASE_URL: "" },
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  assert.equal(missing.status, 1);
  assert.match(missing.stderr + missing.stdout, /DATABASE_URL is required/);

  const invalid = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import=tsx",
      path.join(repoRoot, "prisma", "seed-catalog.ts"),
    ],
    {
      env: { ...process.env, DATABASE_URL: "mysql://localhost/catalog" },
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr + invalid.stdout, /valid PostgreSQL/);
});
