import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CART_ITEM_MAX_QUANTITY,
  CART_ITEM_MIN_QUANTITY,
  CART_MAX_LINES,
  emptyCart,
  summarizeCartLines,
} from "../src/lib/cart-contract.ts";
import {
  lineTotalCents,
  priceCentsToAmount,
  priceCentsToDecimalString,
  sumCents,
  toPriceCents,
} from "../src/lib/money.ts";
import {
  CART_CURRENCY,
  clampCartQuantity,
  describeCartFailure,
  describeCheckoutFailure,
  generateOrderIdempotencyKey,
  generateOrderReference,
  isCatalogIdentifier,
  isOrderIdempotencyKey,
  parseCartQuantity,
} from "../src/lib/server/cart-core.ts";
import { createCartService } from "../src/lib/server/cart-service.ts";
import { createMarketplaceDataAccess } from "../src/lib/server/data-access-core.ts";
import { isUnpaidOrderStatus } from "../src/lib/account-presentation.ts";

const repositoryRoot = path.resolve(fileURLToPath(import.meta.url), "../..");
const readSource = (relativePath) =>
  readFile(path.join(repositoryRoot, relativePath), "utf8");

/* --------------------------------------------------------------------------
   Fixtures and an in-memory stand-in for the Prisma calls the cart uses
   -------------------------------------------------------------------------- */

function productRow(overrides = {}) {
  return {
    id: "prosave",
    slug: "prosave",
    title: "ProSave — DataStore System",
    version: "1.4.2",
    // Prisma returns Decimal columns as objects; `String()` is how they are read.
    price: { toString: () => "14.99" },
    published: true,
    // Remaining columns exist so the shared order mapper can read these rows.
    type: "SYSTEM",
    overview: [],
    features: [],
    requirements: [],
    includedFiles: [],
    installation: [],
    documentationSummary: "Setup and API documentation.",
    documentationTopics: [],
    license: "devKitCat Standard License",
    releasedAt: new Date("2026-03-12T00:00:00.000Z"),
    isFeatured: false,
    isNew: false,
    modelPreviews: [],
    changelog: [],
    category: { id: "systems", name: "Systems", slug: "systems", icon: "SYSTEMS" },
    images: [{ id: "image-1", src: "/previews/prosave.png", position: 0 }],
    ...overrides,
  };
}

const secondProduct = productRow({
  id: "vfx-starter-pack",
  slug: "vfx-starter-pack",
  title: "VFX Starter Pack",
  version: "1.3.1",
  price: { toString: () => "8.99" },
  category: { id: "vfx", name: "VFX", slug: "vfx", icon: "VFX" },
  images: [],
});

const unpublishedProduct = productRow({
  id: "retired-kit",
  slug: "retired-kit",
  title: "Retired Kit",
  published: false,
});

/**
 * Minimal in-memory Prisma stand-in: the compound unique key on
 * (customerId, productId), the per-customer unique idempotency key with
 * Postgres NULL semantics, P2002/P2025 error codes, and transaction rollback.
 */
function makeCartDatabase(products = [productRow(), secondProduct, unpublishedProduct]) {
  const tables = {
    cartItem: new Map(),
    order: new Map(),
    orderItem: new Map(),
    download: new Map(),
  };
  const catalog = new Map(products.map((product) => [product.id, product]));
  const calls = [];
  let sequence = 0;
  const nextId = (prefix) => `${prefix}-${++sequence}`;

  const uniqueViolation = (target) =>
    Object.assign(new Error(`Unique constraint failed on ${target}`), { code: "P2002" });
  const notFound = () =>
    Object.assign(new Error("Record to update not found"), { code: "P2025" });

  const matchesWhere = (row, where) =>
    Object.entries(where).every(([field, value]) => row[field] === value);

  const findLine = (compound) =>
    [...tables.cartItem.values()].find(
      (row) =>
        row.customerId === compound.customerId && row.productId === compound.productId,
    );

  /** Attaches the product include (category + first image) the service reads. */
  const withProduct = (row) => {
    const product = catalog.get(row.productId);
    if (!product) throw new Error(`No catalog row for ${row.productId}`);
    return { ...row, product };
  };

  const sortLines = (rows) =>
    [...rows].sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );

  const cartItem = {
    async findMany({ where }) {
      calls.push(["cartItem.findMany", Object.keys(where)]);
      return sortLines(
        [...tables.cartItem.values()].filter((row) => matchesWhere(row, where)),
      ).map(withProduct);
    },
    async findUnique({ where, select }) {
      calls.push(["cartItem.findUnique", Object.keys(where)]);
      const row = where.customerId_productId
        ? findLine(where.customerId_productId)
        : tables.cartItem.get(where.id);
      if (!row) return null;
      return select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : row;
    },
    async count({ where }) {
      calls.push(["cartItem.count", Object.keys(where)]);
      return [...tables.cartItem.values()].filter((row) => matchesWhere(row, where)).length;
    },
    async upsert({ where, create, update, select }) {
      calls.push(["cartItem.upsert", Object.keys(where)]);
      const existing = findLine(where.customerId_productId);

      if (existing) {
        existing.quantity += update.quantity.increment;
        existing.updatedAt = new Date();
        return select
          ? Object.fromEntries(Object.keys(select).map((key) => [key, existing[key]]))
          : existing;
      }

      if (findLine({ customerId: create.customerId, productId: create.productId })) {
        throw uniqueViolation("CartItem_customerId_productId_key");
      }

      const row = {
        id: nextId("cart-item"),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...create,
      };
      tables.cartItem.set(row.id, row);
      return select
        ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]))
        : row;
    },
    async update({ where, data, select }) {
      calls.push(["cartItem.update", Object.keys(where)]);
      const row = where.id
        ? tables.cartItem.get(where.id)
        : findLine(where.customerId_productId);
      if (!row) throw notFound();

      Object.assign(row, data, { updatedAt: new Date() });
      return select
        ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]))
        : row;
    },
    async deleteMany({ where }) {
      calls.push(["cartItem.deleteMany", Object.keys(where)]);
      let count = 0;
      for (const [id, row] of tables.cartItem) {
        if (matchesWhere(row, where)) {
          tables.cartItem.delete(id);
          count += 1;
        }
      }
      return { count };
    },
  };

  const order = {
    async create({ data }) {
      calls.push(["order.create", Object.keys(data)]);

      // @@unique([customerId, idempotencyKey]); NULL keys never collide.
      const duplicate = [...tables.order.values()].some(
        (row) =>
          row.customerId === data.customerId &&
          data.idempotencyKey !== null &&
          row.idempotencyKey === data.idempotencyKey,
      );
      if (duplicate) throw uniqueViolation("Order_customerId_idempotencyKey_key");
      if (tables.order.has(data.id)) throw uniqueViolation("Order_pkey");

      const now = new Date();
      const row = {
        id: data.id,
        customerId: data.customerId,
        status: data.status,
        total: data.total,
        currency: data.currency,
        idempotencyKey: data.idempotencyKey,
        createdAt: now,
        updatedAt: now,
      };
      tables.order.set(row.id, row);

      for (const item of data.items?.create ?? []) {
        const itemRow = { id: nextId("order-item"), orderId: row.id, ...item };
        const clash = [...tables.orderItem.values()].some(
          (existing) =>
            existing.orderId === itemRow.orderId && existing.productId === itemRow.productId,
        );
        if (clash) throw uniqueViolation("OrderItem_orderId_productId_key");
        tables.orderItem.set(itemRow.id, itemRow);
      }

      return { id: row.id };
    },
    async findFirst({ where, select }) {
      calls.push(["order.findFirst", Object.keys(where)]);
      const row = [...tables.order.values()].find((candidate) => matchesWhere(candidate, where));
      if (!row) return null;

      if (!select?.items) return row;
      return {
        ...row,
        items: [...tables.orderItem.values()].filter((item) => item.orderId === row.id),
      };
    },
  };

  const delegate = { cartItem, order };
  const snapshot = () =>
    Object.fromEntries(
      Object.entries(tables).map(([name, rows]) => [name, new Map(rows)]),
    );
  const restore = (state) => {
    for (const [name, rows] of Object.entries(state)) {
      tables[name].clear();
      for (const [key, row] of rows) tables[name].set(key, row);
    }
  };

  const client = {
    product: {
      async findFirst({ where }) {
        calls.push(["product.findFirst", Object.keys(where)]);
        const row = catalog.get(where.id);
        if (!row) return null;
        if (where.published !== undefined && row.published !== where.published) return null;
        return { id: row.id };
      },
      async update({ where, data }) {
        const row = catalog.get(where.id);
        if (!row) throw notFound();
        Object.assign(row, data);
        return row;
      },
    },
    cartItem,
    order,
    download: {
      async count() {
        return tables.download.size;
      },
    },
    async $transaction(work) {
      const before = snapshot();
      try {
        return await work(delegate);
      } catch (error) {
        // A failed checkout must leave the cart exactly as it was.
        restore(before);
        throw error;
      }
    },
  };

  return { client, tables, catalog, calls };
}

function makeService(database = makeCartDatabase(), logger = () => {}) {
  return {
    database,
    logged: logger,
    cart: createCartService(() => database.client, logger, async () => ({ ok: true })),
  };
}

const CUSTOMER = "customer-one";
const OTHER_CUSTOMER = "customer-two";
const key = () => generateOrderIdempotencyKey();

/* --------------------------------------------------------------------------
   Money handling
   -------------------------------------------------------------------------- */

test("prices are parsed into whole cents and anything ambiguous is rejected", () => {
  assert.equal(toPriceCents("14.99"), 1499);
  assert.equal(toPriceCents("14.9"), 1490);
  assert.equal(toPriceCents("15"), 1500);
  assert.equal(toPriceCents(14.99), 1499);
  // Prisma hands Decimal columns back as objects.
  assert.equal(toPriceCents({ toString: () => "8.99" }), 899);

  for (const value of [
    "14.999",
    "-1",
    "abc",
    "",
    "  ",
    null,
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    {},
    [],
    "1e3",
    "999999999.99",
  ]) {
    assert.equal(toPriceCents(value), null, `accepted ${String(value)}`);
  }

  assert.equal(toPriceCents("99999999.99"), 9_999_999_999);
  assert.equal(priceCentsToAmount(1499), 14.99);
  assert.equal(priceCentsToDecimalString(1499), "14.99");
  assert.equal(priceCentsToDecimalString(5), "0.05");
});

test("line totals and subtotals are integer arithmetic, never floats", () => {
  assert.equal(lineTotalCents(1499, 3), 4497);
  assert.equal(lineTotalCents(1999, 2), 3998);
  // 0.1 + 0.2 style drift cannot appear: three lines of 33 cents sum exactly.
  assert.equal(sumCents([33, 33, 33]), 99);
  assert.equal(priceCentsToAmount(sumCents([1499, 1499, 1499, 899, 899])), 62.95);

  assert.equal(lineTotalCents(1499, 0), null);
  assert.equal(lineTotalCents(1499, 1.5), null);
  assert.equal(lineTotalCents(1499, -1), null);
  assert.equal(lineTotalCents(-1, 1), null);
  assert.equal(sumCents([1, 1.5]), null);
});

/* --------------------------------------------------------------------------
   Cart policy
   -------------------------------------------------------------------------- */

test("quantities must be whole numbers inside the documented limits", () => {
  assert.equal(CART_ITEM_MIN_QUANTITY, 1);
  assert.equal(CART_ITEM_MAX_QUANTITY, 10);
  assert.equal(CART_MAX_LINES, 20);

  assert.equal(parseCartQuantity(1), 1);
  assert.equal(parseCartQuantity("10"), 10);
  for (const value of [0, "0", -1, "-1", 11, "11", 1.5, "1.5", "abc", "", null, undefined, {}, Number.NaN, 1e5]) {
    assert.equal(parseCartQuantity(value), null, `accepted ${String(value)}`);
  }

  assert.equal(clampCartQuantity(0), CART_ITEM_MIN_QUANTITY);
  assert.equal(clampCartQuantity(99), CART_ITEM_MAX_QUANTITY);
  assert.equal(clampCartQuantity(3), 3);
});

test("malformed identifiers and checkout tokens are rejected before any query", () => {
  assert.equal(isCatalogIdentifier("prosave"), true);
  assert.equal(isCatalogIdentifier("clx8f2k9j0000abcd1234efgh"), true);
  for (const value of ["", " ", "a b", "'; DROP TABLE \"Product\";--", 42, null, {}, "x".repeat(65)]) {
    assert.equal(isCatalogIdentifier(value), false, `accepted ${String(value)}`);
  }

  const generated = generateOrderIdempotencyKey();
  assert.equal(isOrderIdempotencyKey(generated), true);
  assert.notEqual(generated, generateOrderIdempotencyKey());
  for (const value of ["", "short", generated.slice(0, 42), `${generated}!`, 42, null, {}]) {
    assert.equal(isOrderIdempotencyKey(value), false, `accepted ${String(value)}`);
  }

  // Seeded historical orders use DKC-YYYY-MMDD-NNNNN; checkout matches it.
  const reference = generateOrderReference(new Date("2026-10-03T12:00:00.000Z"));
  assert.match(reference, /^DKC-2026-1003-\d{5}$/);
  assert.notEqual(reference, generateOrderReference(new Date("2026-10-03T12:00:00.000Z")));
});

test("cart failures are described without echoing raw input", () => {
  assert.equal(CART_CURRENCY, "USD");
  assert.match(describeCartFailure("INVALID_QUANTITY"), /between 1 and 10/);
  assert.match(describeCartFailure("CART_FULL"), /up to 20 different products/);
  assert.match(describeCartFailure("INVALID_PRODUCT"), /not available for purchase/);
  assert.match(
    describeCartFailure("PRODUCT_UNAVAILABLE", { titles: ["Retired Kit"] }),
    /“Retired Kit” is no longer available/,
  );
  assert.match(
    describeCartFailure("PRODUCT_UNAVAILABLE", { titles: ["One", "Two", "Three"] }),
    /“One”, “Two”, and 1 more item are no longer available/,
  );
  assert.match(describeCartFailure("UNAVAILABLE"), /temporarily unavailable/);

  // Every checkout failure states that nothing was charged where that matters.
  for (const code of ["TOTAL_CHANGED", "PRODUCT_UNAVAILABLE", "INVALID_CHECKOUT", "ERROR", "UNAVAILABLE"]) {
    assert.match(
      describeCheckoutFailure(code, { titles: ["Retired Kit"] }),
      /Nothing was charged|not charged|nothing to order/i,
      `${code} does not say nothing was charged`,
    );
  }
  assert.match(describeCheckoutFailure("CART_EMPTY"), /nothing to order yet/);
});

test("the shared cart summary adds quantities and blocks an unorderable cart", () => {
  const line = (overrides = {}) => ({
    productId: "prosave",
    productTitle: "ProSave",
    productSlug: "prosave",
    categoryName: "Systems",
    categoryIcon: "systems",
    imageSrc: null,
    unitPriceCents: 1499,
    lineTotalCents: 1499,
    quantity: 1,
    available: true,
    ...overrides,
  });

  const summary = summarizeCartLines([line(), line({ productId: "b", lineTotalCents: 2998, quantity: 2, unitPriceCents: 1499 })]);
  assert.equal(summary.itemCount, 3);
  assert.equal(summary.subtotalCents, 4497);
  assert.equal(summary.currency, "USD");
  assert.equal(summary.canCheckout, true);

  const withUnavailable = summarizeCartLines([line(), line({ productId: "b", available: false })]);
  assert.equal(withUnavailable.canCheckout, false);
  assert.equal(withUnavailable.subtotalCents, 1499);

  assert.deepEqual(emptyCart(), {
    lines: [],
    itemCount: 0,
    subtotalCents: 0,
    currency: "USD",
    canCheckout: false,
  });
});

/* --------------------------------------------------------------------------
   Cart reads and mutations
   -------------------------------------------------------------------------- */

test("a new customer's cart is empty until a product is added", async () => {
  const { cart } = makeService();

  const empty = await cart.getCart(CUSTOMER);
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.value.lines, []);
  assert.equal(empty.value.itemCount, 0);
  assert.equal(empty.value.subtotalCents, 0);
  assert.equal(empty.value.canCheckout, false);

  const added = await cart.addItem(CUSTOMER, "prosave");
  assert.equal(added.ok, true);
  assert.deepEqual(added.value.lines, [
    {
      productId: "prosave",
      productTitle: "ProSave — DataStore System",
      productSlug: "prosave",
      categoryName: "Systems",
      categoryIcon: "systems",
      imageSrc: "/previews/prosave.png",
      unitPriceCents: 1499,
      lineTotalCents: 1499,
      quantity: 1,
      available: true,
    },
  ]);
  assert.equal(added.value.subtotalCents, 1499);
  assert.equal(added.value.canCheckout, true);

  const reloaded = await cart.getCart(CUSTOMER);
  assert.deepEqual(reloaded.value, added.value);
});

test("adding the same product again raises its quantity instead of duplicating the line", async () => {
  const { cart, database } = makeService();

  await cart.addItem(CUSTOMER, "prosave");
  const second = await cart.addItem(CUSTOMER, "prosave");
  assert.equal(second.value.lines.length, 1);
  assert.equal(second.value.lines[0].quantity, 2);
  assert.equal(second.value.itemCount, 2);
  assert.equal(second.value.subtotalCents, 2998);
  assert.equal(database.tables.cartItem.size, 1);

  // Adding past the cap lands on the cap rather than erroring.
  const capped = await cart.addItem(CUSTOMER, "prosave", CART_ITEM_MAX_QUANTITY);
  assert.equal(capped.value.lines[0].quantity, CART_ITEM_MAX_QUANTITY);
});

test("quantities can be changed and lines removed; removal is idempotent", async () => {
  const { cart, database } = makeService();

  await cart.addItem(CUSTOMER, "prosave");
  await cart.addItem(CUSTOMER, "vfx-starter-pack");
  assert.equal(database.tables.cartItem.size, 2);

  const updated = await cart.setItemQuantity(CUSTOMER, "vfx-starter-pack", 4);
  assert.equal(updated.value.lines.find((line) => line.productId === "vfx-starter-pack").quantity, 4);
  assert.equal(updated.value.subtotalCents, 1499 + 899 * 4);

  const removed = await cart.removeItem(CUSTOMER, "vfx-starter-pack");
  assert.deepEqual(removed.value.lines.map((line) => line.productId), ["prosave"]);

  const removedAgain = await cart.removeItem(CUSTOMER, "vfx-starter-pack");
  assert.equal(removedAgain.ok, true);

  const cleared = await cart.clearCart(CUSTOMER);
  assert.deepEqual(cleared.value.lines, []);
  assert.equal(database.tables.cartItem.size, 0);
});

test("invalid quantities, malformed input, and unavailable products are refused", async () => {
  const { cart, database } = makeService();

  assert.equal((await cart.addItem(CUSTOMER, "does-not-exist")).code, "INVALID_PRODUCT");
  assert.equal((await cart.addItem(CUSTOMER, "retired-kit")).code, "INVALID_PRODUCT");
  assert.equal((await cart.addItem(CUSTOMER, "'; DROP TABLE \"Product\";--")).code, "INVALID_PRODUCT");
  assert.equal((await cart.addItem(CUSTOMER, 42)).code, "INVALID_PRODUCT");
  assert.equal((await cart.addItem(CUSTOMER, "prosave", 0)).code, "INVALID_QUANTITY");
  assert.equal((await cart.addItem(CUSTOMER, "prosave", CART_ITEM_MAX_QUANTITY + 1)).code, "INVALID_QUANTITY");
  assert.equal((await cart.addItem(CUSTOMER, "prosave", "lots")).code, "INVALID_QUANTITY");
  assert.equal((await cart.setItemQuantity(CUSTOMER, "prosave", 0)).code, "INVALID_QUANTITY");
  assert.equal((await cart.setItemQuantity(CUSTOMER, "absent-product", 2)).code, "NOT_IN_CART");
  assert.equal(database.tables.cartItem.size, 0);
});

test("a cart cannot grow past the documented number of lines", async () => {
  const products = Array.from({ length: CART_MAX_LINES + 1 }, (_, index) =>
    productRow({ id: `product-${index}`, slug: `product-${index}`, title: `Product ${index}` }),
  );
  const { cart, database } = makeService(makeCartDatabase(products));

  for (const product of products.slice(0, CART_MAX_LINES)) {
    assert.equal((await cart.addItem(CUSTOMER, product.id)).ok, true);
  }
  assert.equal(database.tables.cartItem.size, CART_MAX_LINES);

  const overflow = await cart.addItem(CUSTOMER, products[CART_MAX_LINES].id);
  assert.equal(overflow.code, "CART_FULL");
  assert.equal(database.tables.cartItem.size, CART_MAX_LINES);

  // A line that already exists can still change quantity.
  assert.equal((await cart.addItem(CUSTOMER, "product-0", 2)).ok, true);
});

test("two customers' carts never mix", async () => {
  const { cart, database } = makeService();

  await cart.addItem(CUSTOMER, "prosave", 2);
  await cart.addItem(OTHER_CUSTOMER, "vfx-starter-pack", 5);

  const mine = await cart.getCart(CUSTOMER);
  const theirs = await cart.getCart(OTHER_CUSTOMER);
  assert.deepEqual(mine.value.lines.map((line) => [line.productId, line.quantity]), [["prosave", 2]]);
  assert.deepEqual(theirs.value.lines.map((line) => [line.productId, line.quantity]), [
    ["vfx-starter-pack", 5],
  ]);

  // Mutations are keyed by the session customer, so they cannot cross over.
  await cart.setItemQuantity(CUSTOMER, "prosave", 3);
  assert.equal((await cart.getCart(OTHER_CUSTOMER)).value.lines[0].quantity, 5);
  await cart.removeItem(CUSTOMER, "vfx-starter-pack");
  assert.equal((await cart.getCart(OTHER_CUSTOMER)).value.lines.length, 1);
  await cart.clearCart(CUSTOMER);
  assert.equal((await cart.getCart(OTHER_CUSTOMER)).value.lines[0].quantity, 5);
  assert.equal(database.tables.cartItem.size, 1);

  // Every cart query carried the owner; none filtered afterwards.
  // Every cart query named the owner, either directly or through the compound
  // (customerId, productId) key; none of them filtered afterwards.
  for (const [name, where] of database.calls.filter(([method]) => method.startsWith("cartItem."))) {
    assert.ok(
      where.includes("customerId") ||
        where.includes("customerId_productId") ||
        // The quantity clamp updates the row the upsert just returned.
        where.includes("id"),
      `${name} is not scoped by customer`,
    );
  }
});

test("every cart operation requires a customer identity and a database", async () => {
  const { cart } = makeService();
  for (const result of [
    await cart.getCart(""),
    await cart.addItem("", "prosave"),
    await cart.setItemQuantity(undefined, "prosave", 1),
    await cart.removeItem(null, "prosave"),
    await cart.clearCart("   "),
    await cart.placeOrder("", { idempotencyKey: key(), reviewedSubtotalCents: "0" }),
  ]) {
    assert.equal(result.code, "UNAUTHENTICATED");
  }

  const unavailable = createCartService(() => null, () => {});
  assert.equal(unavailable.isAvailable(), false);
  assert.equal((await unavailable.getCart(CUSTOMER)).code, "UNAVAILABLE");
  assert.equal((await unavailable.addItem(CUSTOMER, "prosave")).code, "UNAVAILABLE");
  assert.equal(
    (await unavailable.placeOrder(CUSTOMER, { idempotencyKey: key(), reviewedSubtotalCents: "1" })).code,
    "UNAVAILABLE",
  );
});

test("database failures are reported generically and logged without details", async () => {
  const database = makeCartDatabase();
  database.client.cartItem.findMany = async () => {
    throw Object.assign(new Error("postgresql://user:secret@host/devkitcat"), { code: "P1001" });
  };
  const log = [];
  const { cart } = makeService(database, (resource, code) => log.push({ resource, code }));

  const result = await cart.getCart(CUSTOMER);
  assert.equal(result.code, "ERROR");
  assert.deepEqual(log, [{ resource: "cart read", code: "P1001" }]);
  assert.doesNotMatch(describeCartFailure(result.code), /secret|postgres|host/);
});

/* --------------------------------------------------------------------------
   Checkout
   -------------------------------------------------------------------------- */

async function fillCart(cart) {
  await cart.addItem(CUSTOMER, "prosave", 3);
  await cart.addItem(CUSTOMER, "vfx-starter-pack", 2);
  const summary = (await cart.getCart(CUSTOMER)).value;
  assert.equal(summary.subtotalCents, 1499 * 3 + 899 * 2);
  return summary;
}

test("checkout writes an unpaid order with snapshots and clears the cart", async () => {
  const { cart, database } = makeService();
  await fillCart(cart);

  const idempotencyKey = key();
  const placed = await cart.placeOrder(CUSTOMER, {
    idempotencyKey,
    reviewedSubtotalCents: "6295",
  });

  assert.equal(placed.ok, true);
  assert.equal(placed.value.alreadyPlaced, false);
  assert.equal(placed.value.currency, "USD");
  assert.equal(placed.value.totalCents, 6295);
  assert.equal(placed.value.itemCount, 5);
  assert.match(placed.value.orderId, /^DKC-\d{4}-\d{4}-\d{5}$/);

  const order = [...database.tables.order.values()][0];
  assert.equal(order.id, placed.value.orderId);
  assert.equal(order.customerId, CUSTOMER);
  // The critical safety property: an order placed here is never "paid".
  assert.equal(order.status, "PENDING_PAYMENT");
  assert.equal(order.total, "62.95");
  assert.equal(order.currency, "USD");
  assert.equal(order.idempotencyKey, idempotencyKey);

  const items = [...database.tables.orderItem.values()];
  assert.deepEqual(
    items.map((item) => [
      item.productTitle,
      item.productSlug,
      item.categorySlug,
      item.categoryName,
      item.versionAtPurchase,
      item.unitPrice,
      item.quantity,
      item.position,
    ]),
    [
      ["ProSave — DataStore System", "prosave", "systems", "Systems", "1.4.2", "14.99", 3, 0],
      ["VFX Starter Pack", "vfx-starter-pack", "vfx", "VFX", "1.3.1", "8.99", 2, 1],
    ],
  );

  // The cart is empty afterwards, and nothing was written to Download.
  assert.equal(database.tables.cartItem.size, 0);
  assert.equal(database.tables.download.size, 0);
});

test("checkout ignores client-supplied prices and refuses a stale total", async () => {
  const { cart, database } = makeService();
  await fillCart(cart);

  // A well-formed cents value that is not the real total is a stale review;
  // anything else never reaches the comparison.
  const submissions = [
    ["1", "TOTAL_CHANGED"],
    ["0", "TOTAL_CHANGED"],
    ["6294", "TOTAL_CHANGED"],
    ["6300", "TOTAL_CHANGED"],
    ["999999", "TOTAL_CHANGED"],
    ["62.95", "INVALID_CHECKOUT"],
    ["-6295", "INVALID_CHECKOUT"],
    ["1e3", "INVALID_CHECKOUT"],
    ["", "INVALID_CHECKOUT"],
    [null, "INVALID_CHECKOUT"],
    [{}, "INVALID_CHECKOUT"],
    [undefined, "INVALID_CHECKOUT"],
  ];

  for (const [reviewedSubtotalCents, expected] of submissions) {
    const result = await cart.placeOrder(CUSTOMER, {
      idempotencyKey: key(),
      reviewedSubtotalCents,
    });
    assert.equal(result.code, expected, `reviewedSubtotalCents=${String(reviewedSubtotalCents)}`);
    // Nothing was written and the cart survived.
    assert.equal(database.tables.order.size, 0);
    assert.equal(database.tables.cartItem.size, 2);
  }

  // The reviewed subtotal is compared, never used: the stored total comes from
  // the catalog rows.
  const placed = await cart.placeOrder(CUSTOMER, {
    idempotencyKey: key(),
    reviewedSubtotalCents: "6295",
  });
  assert.equal(placed.ok, true);
  assert.equal([...database.tables.order.values()][0].total, "62.95");
});

test("a price change between review and checkout forces a fresh review", async () => {
  const { cart, database } = makeService();
  await fillCart(cart);

  database.catalog.get("prosave").price = { toString: () => "19.99" };

  const stale = await cart.placeOrder(CUSTOMER, {
    idempotencyKey: key(),
    reviewedSubtotalCents: "6295",
  });
  assert.equal(stale.code, "TOTAL_CHANGED");
  assert.equal(database.tables.order.size, 0);
  assert.equal(database.tables.cartItem.size, 2);

  const reviewed = (await cart.getCart(CUSTOMER)).value;
  assert.equal(reviewed.value ?? reviewed.subtotalCents, 1999 * 3 + 899 * 2);

  const fresh = await cart.placeOrder(CUSTOMER, {
    idempotencyKey: key(),
    reviewedSubtotalCents: String(reviewed.subtotalCents),
  });
  assert.equal(fresh.ok, true);
  assert.equal([...database.tables.order.values()][0].total, "77.95");
});

test("a product unpublished after review blocks checkout and keeps the cart", async () => {
  const { cart, database } = makeService();
  await fillCart(cart);

  database.catalog.get("vfx-starter-pack").published = false;

  const summary = (await cart.getCart(CUSTOMER)).value;
  assert.equal(summary.lines.find((line) => line.productId === "vfx-starter-pack").available, false);
  assert.equal(summary.canCheckout, false);

  const blocked = await cart.placeOrder(CUSTOMER, {
    idempotencyKey: key(),
    reviewedSubtotalCents: "6295",
  });
  assert.equal(blocked.code, "PRODUCT_UNAVAILABLE");
  assert.deepEqual(blocked.titles, ["VFX Starter Pack"]);
  assert.equal(database.tables.order.size, 0);
  // The line stays so the customer can remove it deliberately.
  assert.equal(database.tables.cartItem.size, 2);

  database.catalog.get("vfx-starter-pack").published = true;
  await cart.removeItem(CUSTOMER, "vfx-starter-pack");
  const placed = await cart.placeOrder(CUSTOMER, {
    idempotencyKey: key(),
    reviewedSubtotalCents: String(1499 * 3),
  });
  assert.equal(placed.ok, true);
});

test("an empty cart cannot be ordered", async () => {
  const { cart, database } = makeService();

  const result = await cart.placeOrder(CUSTOMER, {
    idempotencyKey: key(),
    reviewedSubtotalCents: "0",
  });
  assert.equal(result.code, "CART_EMPTY");
  assert.equal(database.tables.order.size, 0);
});

test("a retried or double submission resolves to the same order", async () => {
  const { cart, database } = makeService();
  await fillCart(cart);

  const idempotencyKey = key();
  const first = await cart.placeOrder(CUSTOMER, { idempotencyKey, reviewedSubtotalCents: "6295" });
  assert.equal(first.ok, true);

  // Same key again (a second click after the cart was already cleared).
  const retry = await cart.placeOrder(CUSTOMER, { idempotencyKey, reviewedSubtotalCents: "6295" });
  assert.equal(retry.ok, true);
  assert.equal(retry.value.orderId, first.value.orderId);
  assert.equal(retry.value.alreadyPlaced, true);
  assert.equal(retry.value.totalCents, 6295);
  assert.equal(database.tables.order.size, 1);
  assert.equal(database.tables.orderItem.size, 2);

  // A malformed or missing key never reaches the database.
  for (const badKey of ["", "nope", "a".repeat(42), null, undefined, 42, {}]) {
    const result = await cart.placeOrder(CUSTOMER, {
      idempotencyKey: badKey,
      reviewedSubtotalCents: "6295",
    });
    assert.equal(result.code, "INVALID_CHECKOUT", `accepted ${String(badKey)}`);
  }
  assert.equal(database.tables.order.size, 1);
});

test("the cart is cleared only when the whole checkout transaction succeeds", async () => {
  const database = makeCartDatabase();
  const { cart } = makeService(database);
  await fillCart(cart);

  // Fail after the cart was cleared inside the transaction.
  const originalCreate = database.client.order.create;
  database.client.order.create = async () => {
    await database.client.cartItem.deleteMany({ where: { customerId: CUSTOMER } });
    throw Object.assign(new Error("connection reset"), { code: "P2024" });
  };

  const failed = await cart.placeOrder(CUSTOMER, {
    idempotencyKey: key(),
    reviewedSubtotalCents: "6295",
  });
  assert.equal(failed.code, "ERROR");
  assert.equal(database.tables.order.size, 0);
  assert.equal(database.tables.orderItem.size, 0);
  // Rolled back: the customer still has the cart they reviewed.
  assert.equal(database.tables.cartItem.size, 2);
  assert.equal((await cart.getCart(CUSTOMER)).value.subtotalCents, 6295);

  database.client.order.create = originalCreate;
  const recovered = await cart.placeOrder(CUSTOMER, {
    idempotencyKey: key(),
    reviewedSubtotalCents: "6295",
  });
  assert.equal(recovered.ok, true);
  assert.equal(database.tables.cartItem.size, 0);
});

test("another customer cannot read an order this checkout created", async () => {
  const database = makeCartDatabase();
  const { cart } = makeService(database);
  await fillCart(cart);

  const placed = await cart.placeOrder(CUSTOMER, {
    idempotencyKey: key(),
    reviewedSubtotalCents: "6295",
  });
  assert.equal(placed.ok, true);

  // The same customer-scoped read the account pages use.
  const data = createMarketplaceDataAccess(
    () => ({
      order: {
        async findMany({ where }) {
          return [...database.tables.order.values()]
            .filter((order) => order.customerId === where.customerId)
            .map((order) => ({
              ...order,
              items: [...database.tables.orderItem.values()]
                .filter((item) => item.orderId === order.id)
                .map((item) => ({ ...item, product: database.catalog.get(item.productId) })),
            }));
        },
        async findFirst({ where }) {
          const order = [...database.tables.order.values()].find(
            (candidate) => candidate.id === where.id && candidate.customerId === where.customerId,
          );
          if (!order) return null;
          return {
            ...order,
            items: [...database.tables.orderItem.values()]
              .filter((item) => item.orderId === order.id)
              .map((item) => ({ ...item, product: database.catalog.get(item.productId) })),
          };
        },
      },
    }),
    { products: [], categories: [] },
    () => {},
  );

  assert.deepEqual((await data.listCustomerOrders(OTHER_CUSTOMER)), []);
  assert.equal(await data.getCustomerOrderById(OTHER_CUSTOMER, placed.value.orderId), undefined);

  const own = await data.getCustomerOrderById(CUSTOMER, placed.value.orderId);
  assert.equal(own.status, "pending-payment");
  assert.equal(own.total, 62.95);
  assert.equal(own.items[0].product.title, "ProSave — DataStore System");
  assert.equal(own.items[0].price, 14.99);
  assert.equal(own.items[0].quantity, 3);
});

test("an unpaid order is never presented as a completed purchase", async () => {
  const database = makeCartDatabase();
  const { cart } = makeService(database);
  await cart.addItem(CUSTOMER, "prosave");

  const placed = await cart.placeOrder(CUSTOMER, {
    idempotencyKey: key(),
    reviewedSubtotalCents: "1499",
  });
  assert.equal(placed.ok, true);

  assert.equal([...database.tables.order.values()][0].status, "PENDING_PAYMENT");
  assert.equal(isUnpaidOrderStatus("pending-payment"), true);
  assert.equal(isUnpaidOrderStatus("complete"), false);
  assert.equal(isUnpaidOrderStatus("processing"), false);
  assert.equal(isUnpaidOrderStatus("refunded"), false);

  // Checkout creates no download entitlement, so nothing is unlocked.
  assert.equal(database.tables.download.size, 0);
  assert.equal(
    database.calls.some(([name]) => name.startsWith("download.")),
    false,
    "checkout must never touch the Download table",
  );
});

/* --------------------------------------------------------------------------
   Source-level guards
   -------------------------------------------------------------------------- */

test("cart Server Functions authorize before touching the cart", async () => {
  const source = await readSource("src/lib/server/cart-actions.ts");

  assert.match(source, /^"use server";/m);
  // Five mutating actions, each gated on the session customer.
  assert.equal(source.match(/await requireCustomer\(\)/g).length, 5);
  assert.match(source, /const customer = await getAuthenticatedCustomer\(\);/);
  // The form fields: verification tokens alongside customer contact details.
  assert.deepEqual(
    [...source.matchAll(/formData\.get\("([^"]+)"\)/g)].map((match) => match[1]).sort(),
    ["customerName", "customerPhone", "idempotencyKey", "reviewedSubtotalCents", "telegramHandle"],
  );
  // No action returns raw failure codes or stack traces to the client.
  assert.doesNotMatch(source, /message: (result|error)\.message/);
  assert.doesNotMatch(source, /console\.(log|error|warn|info|debug)\([^)]*(token|password|secret)/i);
});

test('a "use server" module only exports async functions', async () => {
  const source = await readSource("src/lib/server/cart-actions.ts");
  const exportLines = source.split("\n").filter((line) => line.startsWith("export "));

  assert.equal(exportLines.length, 6);
  for (const line of exportLines) {
    assert.match(line, /^export async function \w+\(/, `unexpected export: ${line}`);
  }
});

test("activating Review & checkout closes the cart while navigating to /checkout", async () => {
  const drawer = await readSource("src/components/cart/CartDrawer.tsx");
  const checkoutButton = drawer.match(
    /<Button\s+([^>]*?)>\s*Review &amp; checkout\s*<\/Button>/s,
  );

  assert.ok(checkoutButton, "the checkout action should remain a Button link");
  assert.match(checkoutButton[1], /href="\/checkout"/);
  assert.match(
    checkoutButton[1],
    /onClick=\{close\}/,
    "activation should close the cart at the navigation trigger",
  );

  const button = await readSource("src/components/ui/Button.tsx");
  assert.match(
    button,
    /<AppLink[\s\S]*?href=\{href\}[\s\S]*?onClick=\{onClick\}/,
    "Button links must forward activation to the close callback",
  );
});

test("the checkout route is protected and reads only the session customer's cart", async () => {
  const page = await readSource("src/app/checkout/page.tsx");

  assert.match(page, /await requireCustomer\(\)/);
  assert.match(page, /cart\.getCart\(customer\.id\)/);
  assert.match(page, /generateOrderIdempotencyKey\(\)/);
  assert.match(page, /reviewedSubtotalCents=\{summary\.subtotalCents\}/);
  assert.doesNotMatch(page, /mock-account/);

  const order = await readSource("src/app/account/purchases/[id]/page.tsx");
  assert.match(order, /getCustomerOrderById\(customer\.id, id\)/);
  assert.match(order, /isUnpaidOrderStatus\(order\.status\)/);
});

test("client cart components never send prices, totals, or ownership", async () => {
  const modules = [
    "src/components/cart/CartProvider.tsx",
    "src/components/cart/CartDrawer.tsx",
    "src/components/cart/CartItem.tsx",
    "src/components/checkout/CheckoutLine.tsx",
  ];

  for (const modulePath of modules) {
    const source = await readSource(modulePath);
    assert.doesNotMatch(
      source,
      /customerId|orderTotal|discount|formData/,
      `${modulePath} sends ownership or pricing to the server`,
    );
    // Checkout components import only the formatter: they render server-computed
    // cents and never parse prices or add up totals themselves.
    if (modulePath.includes("checkout")) {
      const moneyImport = /import \{([^}]*)\} from "@\/lib\/money"/.exec(source);
      assert.deepEqual(
        moneyImport[1].split(",").map((name) => name.trim()),
        ["priceCentsToAmount"],
        `${modulePath} imports money helpers it should not use`,
      );
    }
  }

  // The submission form carries the verification tokens and contact fields.
  const submit = await readSource("src/components/checkout/CheckoutSubmit.tsx");
  assert.deepEqual(
    [...submit.matchAll(/name="([^"]+)"/g)].map((match) => match[1]).sort(),
    ["customerName", "customerPhone", "idempotencyKey", "reviewedSubtotalCents", "telegramHandle"],
  );

  // No Prisma or server-only import leaks into a client bundle.
  for (const modulePath of [...modules, "src/components/checkout/CheckoutSubmit.tsx"]) {
    const source = await readSource(modulePath);
    assert.doesNotMatch(
      source,
      /from "@\/(generated|lib\/server\/(?!cart-actions))/,
      `${modulePath} imports server-only code`,
    );
  }
});

test("the checkout path states that payment is not enabled", async () => {
  const notice = await readSource("src/components/checkout/PaymentNotice.tsx");
  assert.match(notice, /Payment is not enabled yet/);
  assert.match(notice, /no payment provider is connected|No payment provider is connected/i);
  assert.match(notice, /no download (is|has been) unlocked/);

  const page = await readSource("src/app/checkout/page.tsx");
  assert.match(page, /<PaymentNotice variant="checkout" \/>/);

  const service = await readSource("src/lib/server/cart-service.ts");
  assert.match(service, /status: "PENDING_PAYMENT"/);
  assert.doesNotMatch(service, /status: "COMPLETE"/);
  assert.doesNotMatch(service, /download\.(create|upsert)/);
});
