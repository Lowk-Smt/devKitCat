import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { createMarketplaceDataAccess, DataAccessError } from "../src/lib/server/data-access-core.ts";
import { matchesQuery } from "../src/lib/catalog.ts";
import {
  getOrCreateCachedClient,
  normalizeDatabaseUrl,
} from "../src/lib/server/database-config.ts";
import { buildMarketplaceSeedData } from "../src/lib/server/seed-data.ts";
import { seedMarketplace } from "../src/lib/server/seed-database.ts";

const demoProduct = {
  id: "prosave",
  slug: "prosave",
  title: "ProSave — DataStore System",
  description: "Persistent player data with retries and session locking.",
  overview: ["A reliable player-data layer."],
  price: "14.99",
  type: "SYSTEM",
  version: "1.4.2",
  features: ["Session locking"],
  requirements: ["Roblox Studio"],
  includedFiles: ["ProSave.rbxm", "Documentation.md"],
  installation: ["Import the module."],
  documentationSummary: "Setup and API documentation.",
  documentationTopics: ["Quick start"],
  license: "devKitCat Standard License",
  releasedAt: new Date("2026-03-12T00:00:00.000Z"),
  isFeatured: true,
  isNew: false,
  published: true,
  sortOrder: 0,
  categoryId: "systems",
  createdAt: new Date("2026-03-12T00:00:00.000Z"),
  updatedAt: new Date("2026-08-14T00:00:00.000Z"),
  category: {
    id: "systems",
    name: "Systems",
    slug: "systems",
    description: "Gameplay systems.",
    icon: "SYSTEMS",
    sortOrder: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  images: [{ id: "image-1", productId: "prosave", src: "/prosave.png", position: 0, altText: null }],
  modelPreviews: [
    {
      id: "model-1",
      productId: "prosave",
      src: "/preview.glb",
      label: "Preview model",
      description: "A sample preview.",
      position: 0,
    },
  ],
  changelog: [
    {
      id: "change-1",
      productId: "prosave",
      version: "1.4.2",
      date: new Date("2026-08-14T00:00:00.000Z"),
      notes: "Improved save retries.",
      position: 0,
    },
  ],
};

const secondProduct = {
  ...demoProduct,
  id: "vfx-starter-pack",
  slug: "vfx-starter-pack",
  title: "VFX Starter Pack",
  description: "Effects for Roblox experiences.",
  price: "8.99",
  type: "VFX_PACK",
  isFeatured: false,
  categoryId: "vfx",
  category: {
    ...demoProduct.category,
    id: "vfx",
    name: "VFX",
    slug: "vfx",
    icon: "VFX",
  },
  images: [],
  modelPreviews: [],
  changelog: [],
};

const demoCustomerRow = {
  id: "demo-customer",
  email: "jordan.taylor@example.test",
  name: "Jordan Taylor",
  createdAt: new Date("2025-11-08T00:00:00.000Z"),
  updatedAt: new Date("2025-11-08T00:00:00.000Z"),
};

const demoOrderRow = {
  id: "DKC-2026-0918-10482",
  customerId: demoCustomerRow.id,
  status: "COMPLETE",
  total: "23.98",
  currency: "USD",
  createdAt: new Date("2026-09-18T00:00:00.000Z"),
  updatedAt: new Date("2026-09-18T00:00:00.000Z"),
  items: [
    {
      id: "order-item-1",
      orderId: "DKC-2026-0918-10482",
      productId: "prosave",
      productTitle: "ProSave — DataStore System",
      productSlug: "prosave",
      categorySlug: "systems",
      categoryName: "Systems",
      versionAtPurchase: "1.4.2",
      unitPrice: "14.99",
      quantity: 1,
      position: 0,
      product: demoProduct,
    },
  ],
};

const demoDownloadRow = {
  id: "download-1",
  customerId: demoCustomerRow.id,
  productId: "prosave",
  orderItemId: "order-item-1",
  status: "PENDING",
  fileKey: null,
  createdAt: new Date("2026-09-18T00:00:00.000Z"),
  updatedAt: new Date("2026-09-18T00:00:00.000Z"),
  product: demoProduct,
  orderItem: demoOrderRow.items[0],
};

function makeFallback() {
  return {
    products: [],
    categories: [],
    customers: [],
    orders: [],
    downloads: [],
  };
}

function makeDatabaseClient() {
  const calls = [];
  const client = {
    product: {
      async findMany(args) {
        calls.push(["product.findMany", args]);
        return [demoProduct, secondProduct].filter(
          (product) => !args.where?.isFeatured || product.isFeatured,
        );
      },
      async findFirst(args) {
        calls.push(["product.findFirst", args]);
        return [demoProduct, secondProduct].find((product) =>
          Object.entries(args.where).every(([key, value]) => product[key] === value),
        ) ?? null;
      },
    },
    category: {
      async findMany(args) {
        calls.push(["category.findMany", args]);
        return [demoProduct.category, secondProduct.category];
      },
    },
    customer: {
      async findUnique(args) {
        calls.push(["customer.findUnique", args]);
        return Object.entries(args.where).every(
          ([key, value]) => demoCustomerRow[key] === value,
        )
          ? demoCustomerRow
          : null;
      },
    },
    order: {
      async findMany(args) {
        calls.push(["order.findMany", args]);
        return args.where.customerId === demoOrderRow.customerId ? [demoOrderRow] : [];
      },
      async findUnique(args) {
        calls.push(["order.findUnique", args]);
        return args.where.id === demoOrderRow.id ? demoOrderRow : null;
      },
    },
    download: {
      async findMany(args) {
        calls.push(["download.findMany", args]);
        return args.where.customerId === demoDownloadRow.customerId
          ? [demoDownloadRow]
          : [];
      },
    },
  };
  return { client, calls };
}

function makeMemoryPrisma() {
  const tables = {
    category: new Map(),
    product: new Map(),
    productImage: new Map(),
    productModelPreview: new Map(),
    productChangelogEntry: new Map(),
    customer: new Map(),
    order: new Map(),
    orderItem: new Map(),
    download: new Map(),
  };

  const uniqueKey = (where) => {
    if (where.id) return where.id;
    if (where.email) return where.email;
    for (const [field, value] of Object.entries(where)) {
      if (field.includes("_")) return JSON.stringify(value);
    }
    throw new Error(`Unsupported fake unique key: ${JSON.stringify(where)}`);
  };

  const delegate = (table) => ({
    async upsert({ where, create, update }) {
      const key = uniqueKey(where);
      const previous = tables[table].get(key);
      const saved = previous ? { ...previous, ...update } : { ...create };
      tables[table].set(key, saved);
      return saved;
    },
    async deleteMany({ where }) {
      for (const [key, row] of tables[table]) {
        if (where.productId && row.productId !== where.productId) continue;
        if (where.orderId && row.orderId !== where.orderId) continue;
        if (where.position?.gte !== undefined && row.position < where.position.gte) continue;
        if (where.productId?.notIn && where.productId.notIn.includes(row.productId)) continue;
        tables[table].delete(key);
      }
      return { count: 0 };
    },
  });

  const transaction = {
    category: delegate("category"),
    product: delegate("product"),
    productImage: delegate("productImage"),
    productModelPreview: delegate("productModelPreview"),
    productChangelogEntry: delegate("productChangelogEntry"),
    customer: delegate("customer"),
    order: delegate("order"),
    orderItem: delegate("orderItem"),
    download: delegate("download"),
  };

  return {
    tables,
    prisma: {
      async $transaction(callback) {
        return callback(transaction);
      },
    },
  };
}

test("Prisma client initializes lazily and reuses one client when generated code is present", async (context) => {
  const generatedClient = new URL("../src/generated/prisma/client.ts", import.meta.url);
  if (!existsSync(generatedClient)) {
    context.skip("Prisma Client has not been generated; no database connection is needed for this suite.");
    return;
  }

  const originalUrl = process.env.DATABASE_URL;
  let client;
  try {
    delete process.env.DATABASE_URL;
    const { getDatabaseClient } = await import("../src/lib/server/database.ts");
    assert.equal(getDatabaseClient(), null);

    process.env.DATABASE_URL = "postgresql://devkitcat:placeholder@127.0.0.1:5432/devkitcat";
    client = getDatabaseClient();
    assert.ok(client);
    assert.equal(getDatabaseClient(), client);
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    if (client) await client.$disconnect();
  }
});

test("database configuration accepts Postgres URLs and reuses one warm client", () => {
  assert.equal(normalizeDatabaseUrl(undefined), null);
  assert.equal(normalizeDatabaseUrl("  "), null);
  assert.equal(
    normalizeDatabaseUrl("postgresql://user:pass@localhost:5432/devkitcat"),
    "postgresql://user:pass@localhost:5432/devkitcat",
  );
  assert.equal(
    normalizeDatabaseUrl("postgres://user:pass@localhost:5432/devkitcat"),
    "postgres://user:pass@localhost:5432/devkitcat",
  );
  assert.throws(() => normalizeDatabaseUrl("not-a-url"), /valid PostgreSQL/);
  assert.throws(() => normalizeDatabaseUrl("mysql://localhost/database"), /PostgreSQL protocol/);

  let creations = 0;
  const first = getOrCreateCachedClient(undefined, "postgresql://one", () => ({ id: ++creations }));
  const reused = getOrCreateCachedClient(first.cache, "postgresql://one", () => ({ id: ++creations }));
  const replaced = getOrCreateCachedClient(reused.cache, "postgresql://two", () => ({ id: ++creations }));
  assert.equal(creations, 2);
  assert.equal(reused.client, first.client);
  assert.equal(replaced.replaced, first.client);
  assert.equal(replaced.client.id, 2);
});

test("demo seed is derived from the current catalog and account fixtures", () => {
  const first = buildMarketplaceSeedData();
  const second = buildMarketplaceSeedData();

  assert.deepEqual(first, second);
  assert.equal(first.categories.length, 8);
  assert.equal(first.products.length, 6);
  assert.equal(first.customer.email, "jordan.taylor@example.test");
  assert.equal(first.orders.length, 3);
  assert.equal(first.orders.reduce((sum, order) => sum + order.items.length, 0), 5);
  assert.equal(first.downloads.length, 5);
  assert.equal(first.products.find((product) => product.id === "cozy-furniture-pack").images[0], "/previews/cozy-lounge.png");
  assert.equal(first.products.find((product) => product.id === "camping-props-pack").modelPreviews[0].src, "/previews/camping-lantern.gltf");
  assert.equal(first.orders[0].items[0].versionAtPurchase, "1.4.2");
  assert.ok(first.downloads.every((download) => download.status === "PENDING" && download.fileKey === null));
  assert.ok(first.downloads.every((download) => first.orders.some((order) => order.items.some((item) => item.id === download.orderItemKey))));
});

test("seed runner upserts stable records and is safe to execute repeatedly", async () => {
  const memory = makeMemoryPrisma();
  const result = await seedMarketplace(memory.prisma);
  const again = await seedMarketplace(memory.prisma);

  assert.deepEqual(result, {
    categories: 8,
    products: 6,
    customer: 1,
    orders: 3,
    orderItems: 5,
    downloads: 5,
  });
  assert.deepEqual(again, result);
  assert.equal(memory.tables.category.size, 8);
  assert.equal(memory.tables.product.size, 6);
  assert.equal(memory.tables.productImage.size, 1);
  assert.equal(memory.tables.productModelPreview.size, 2);
  assert.equal(memory.tables.productChangelogEntry.size, 6);
  assert.equal(memory.tables.customer.size, 1);
  assert.equal(memory.tables.order.size, 3);
  assert.equal(memory.tables.orderItem.size, 5);
  assert.equal(memory.tables.download.size, 5);
  assert.equal(
    memory.tables.orderItem.get(
      JSON.stringify({ orderId: "DKC-2026-0918-10482", productId: "prosave" }),
    ).versionAtPurchase,
    "1.4.2",
  );
});

test("database reads map product, media, category, customer, order and download records", async () => {
  const { client, calls } = makeDatabaseClient();
  const data = createMarketplaceDataAccess(() => client, makeFallback(), () => {});

  const products = await data.listProducts();
  assert.equal(products.length, 2);
  assert.equal(products[0].price, 14.99);
  assert.deepEqual(products[0].images, ["/prosave.png"]);
  assert.deepEqual(products[0].modelPreviews, [
    { src: "/preview.glb", label: "Preview model", description: "A sample preview." },
  ]);
  assert.equal(products[0].changelog[0].date, "2026-08-14");
  assert.equal((await data.listProducts({ featuredOnly: true })).length, 1);
  assert.equal((await data.getProductBySlug("prosave")).id, "prosave");
  assert.equal((await data.getProductById("prosave")).slug, "prosave");
  assert.equal(await data.getProductBySlug("missing"), undefined);

  const categories = await data.listCategories();
  assert.deepEqual(categories.map((category) => category.icon), ["systems", "vfx"]);
  assert.equal((await data.getCustomerByEmail(" JORDAN.TAYLOR@EXAMPLE.TEST ")).name, "Jordan Taylor");
  assert.equal((await data.getCustomerById("demo-customer")).email, "jordan.taylor@example.test");

  const orders = await data.listCustomerOrders("demo-customer");
  assert.equal(orders.length, 1);
  assert.equal(orders[0].total, 23.98);
  assert.equal(orders[0].currency, "USD");
  assert.equal(orders[0].items[0].price, 14.99);
  assert.equal(orders[0].items[0].version, "1.4.2");
  assert.equal(orders[0].items[0].product.title, "ProSave — DataStore System");
  assert.equal((await data.getOrderById(demoOrderRow.id)).id, demoOrderRow.id);
  assert.equal(await data.getOrderById("missing"), undefined);

  const downloads = await data.listCustomerDownloads("demo-customer");
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].fileCount, 2);
  assert.equal(downloads[0].version, "1.4.2");
  assert.equal(downloads[0].status, "coming-soon");
  assert.ok(calls.some(([name]) => name === "order.findMany"));
  assert.ok(calls.some(([name]) => name === "download.findMany"));

  const related = await data.getRelatedProducts({ id: "prosave", category: "systems" }, 1);
  assert.equal(related.items[0].id, "vfx-starter-pack");
  assert.equal(related.sameCategory, false);
});

test("catalog search uses category records returned by the database", () => {
  const dynamicProduct = {
    ...demoProduct,
    category: "ambient-audio",
    title: "Atmosphere Pack",
    description: "A set of ambient sound assets.",
  };
  const dynamicCategory = {
    id: "ambient-audio",
    name: "Sonic Collections",
    slug: "ambient-audio",
    description: "Audio for immersive worlds.",
    icon: "audio",
  };

  assert.equal(matchesQuery(dynamicProduct, "sonic"), false);
  assert.equal(matchesQuery(dynamicProduct, "sonic", [dynamicCategory]), true);
});

test("missing DATABASE_URL selects fixtures; database errors stay generic", async () => {
  const fallback = {
    products: [demoProduct],
    categories: [demoProduct.category],
    customers: [demoCustomerRow],
    orders: [{ customerId: "demo-customer", order: { ...mapOrderFixture() } }],
    downloads: [{ customerId: "demo-customer", download: { ...mapDownloadFixture() } }],
  };
  const fallbackData = createMarketplaceDataAccess(() => null, fallback, () => {});
  assert.equal((await fallbackData.listProducts())[0].id, "prosave");
  assert.equal((await fallbackData.getProductBySlug("prosave")).id, "prosave");
  assert.equal((await fallbackData.listCategories()).length, 1);
  assert.equal((await fallbackData.getCustomerByEmail(demoCustomerRow.email)).id, "demo-customer");
  assert.equal((await fallbackData.listCustomerOrders("demo-customer")).length, 1);
  assert.equal((await fallbackData.getOrderById(demoOrderRow.id)).id, demoOrderRow.id);
  assert.equal((await fallbackData.listCustomerDownloads("demo-customer")).length, 1);

  const log = [];
  const broken = makeDatabaseClient().client;
  broken.product.findMany = async () => {
    throw Object.assign(new Error("postgres://secret:password@host/database"), {
      code: "P1001",
    });
  };
  const failingData = createMarketplaceDataAccess(() => broken, makeFallback(), (resource, code) => log.push({ resource, code }));
  await assert.rejects(failingData.listProducts(), (error) => {
    assert.ok(error instanceof DataAccessError);
    assert.doesNotMatch(error.message, /secret|password|postgres/);
    return true;
  });
  assert.deepEqual(log, [{ resource: "products", code: "P1001" }]);
});

function mapOrderFixture() {
  return {
    id: demoOrderRow.id,
    date: "2026-09-18",
    status: "complete",
    total: 23.98,
    currency: "USD",
    items: [
      {
        productId: "prosave",
        version: "1.4.2",
        price: 14.99,
        quantity: 1,
        product: {
          id: "prosave",
          slug: "prosave",
          title: "ProSave — DataStore System",
          description: "Persistent player data with retries and session locking.",
          overview: ["A reliable player-data layer."],
          category: "systems",
          price: 14.99,
          images: ["/prosave.png"],
          modelPreviews: [],
          type: "system",
          version: "1.4.2",
          features: ["Session locking"],
          requirements: ["Roblox Studio"],
          includedFiles: ["ProSave.rbxm", "Documentation.md"],
          installation: ["Import the module."],
          documentation: { summary: "Setup and API documentation.", topics: ["Quick start"] },
          changelog: [{ version: "1.4.2", date: "2026-08-14", notes: "Improved save retries." }],
          license: "devKitCat Standard License",
          releasedAt: "2026-03-12",
          isFeatured: true,
          isNew: false,
        },
        categoryName: "Systems",
      },
    ],
  };
}

function mapDownloadFixture() {
  return {
    product: mapOrderFixture().items[0].product,
    categoryName: "Systems",
    version: "1.4.2",
    fileCount: 2,
    lastUpdated: "2026-08-14",
    status: "coming-soon",
  };
}
