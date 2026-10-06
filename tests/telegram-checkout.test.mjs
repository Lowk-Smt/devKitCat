import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  generateOrderIdempotencyKey,
  normalizeOrderCustomerName,
  normalizeOrderPhoneNumber,
  normalizeTelegramHandle,
} from "../src/lib/server/cart-core.ts";
import { createCartService } from "../src/lib/server/cart-service.ts";
import {
  escapeTelegramHtml,
  formatTelegramOrderMessage,
  sendTelegramOrderNotification,
} from "../src/lib/server/telegram.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (rel) => readFile(path.join(repoRoot, rel), "utf8");

/* --------------------------------------------------------------------------
   Mock database harness for unit testing cart and checkout
   -------------------------------------------------------------------------- */

const CUSTOMER_A = "cust_a_12345";
const CUSTOMER_B = "cust_b_67890";

function createMockDb() {
  const products = new Map([
    [
      "prod-paid-1",
      {
        id: "prod-paid-1",
        slug: "prosave",
        title: "ProSave System",
        price: "15.00",
        published: true,
        version: "1.0.0",
        category: { slug: "systems", name: "Systems", icon: "SYSTEMS" },
        images: [{ src: "/prosave.png" }],
      },
    ],
    [
      "prod-free-1",
      {
        id: "prod-free-1",
        slug: "free-module",
        title: "Free Community Module",
        price: "0.00",
        published: true,
        version: "1.0.0",
        category: { slug: "developer-tools", name: "Tools", icon: "DEVELOPER_TOOLS" },
        images: [{ src: "/free.png" }],
      },
    ],
    [
      "prod-unpub-1",
      {
        id: "prod-unpub-1",
        slug: "unpub-system",
        title: "Draft System",
        price: "10.00",
        published: false,
        version: "0.9.0",
        category: { slug: "systems", name: "Systems", icon: "SYSTEMS" },
        images: [{ src: "/draft.png" }],
      },
    ],
  ]);

  const customers = new Map([
    [CUSTOMER_A, { id: CUSTOMER_A, name: "Alice Developer", email: "alice@example.com" }],
    [CUSTOMER_B, { id: CUSTOMER_B, name: "Bob Builder", email: "bob@example.com" }],
  ]);

  const cartItems = new Map();
  const orders = new Map();
  const orderItems = new Map();

  let nextId = 1;

  const client = {
    cartItem: {
      async findMany({ where }) {
        return [...cartItems.values()]
          .filter((row) => row.customerId === where.customerId)
          .map((row) => ({
            ...row,
            product: products.get(row.productId),
          }));
      },
      async deleteMany({ where }) {
        let count = 0;
        for (const [id, row] of [...cartItems.entries()]) {
          if (row.customerId === where.customerId) {
            cartItems.delete(id);
            count++;
          }
        }
        return { count };
      },
    },
    customer: {
      async findUnique({ where }) {
        return customers.get(where.id) ?? null;
      },
    },
    order: {
      async findFirst({ where }) {
        const found = [...orders.values()].find(
          (o) =>
            o.customerId === where.customerId &&
            o.idempotencyKey === where.idempotencyKey,
        );
        if (!found) return null;
        const items = [...orderItems.values()].filter((item) => item.orderId === found.id);
        return { ...found, items };
      },
      async create({ data }) {
        const id = data.id || `order_${nextId++}`;
        const row = {
          ...data,
          id,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        orders.set(id, row);
        if (data.items?.create) {
          for (const item of data.items.create) {
            const itemId = `item_${nextId++}`;
            orderItems.set(itemId, { ...item, id: itemId, orderId: id });
          }
        }
        return { id };
      },
    },
    async $transaction(fn) {
      return fn(client);
    },
  };

  return { client, products, customers, cartItems, orders, orderItems };
}

/* --------------------------------------------------------------------------
   Checkout Core Validation Tests
   -------------------------------------------------------------------------- */

test("phone number validation accepts common international and domestic formats", () => {
  assert.equal(normalizeOrderPhoneNumber("+1 (555) 234-5678"), "+1 (555) 234-5678");
  assert.equal(normalizeOrderPhoneNumber("+44 20 7946 0958"), "+44 20 7946 0958");
  assert.equal(normalizeOrderPhoneNumber("+855 12 345 678"), "+855 12 345 678");
  assert.equal(normalizeOrderPhoneNumber("0812345678"), "0812345678");
  assert.equal(normalizeOrderPhoneNumber("   +1-800-555-0199   "), "+1-800-555-0199");
});

test("phone number validation rejects empty, malformed, or hostile inputs", () => {
  assert.equal(normalizeOrderPhoneNumber(""), null);
  assert.equal(normalizeOrderPhoneNumber("   "), null);
  assert.equal(normalizeOrderPhoneNumber("123"), null); // under 7 digits
  assert.equal(normalizeOrderPhoneNumber("call-me-maybe"), null); // letters
  assert.equal(normalizeOrderPhoneNumber("<script>alert(1)</script>"), null); // script tags
  assert.equal(normalizeOrderPhoneNumber("+12345678901234567890"), null); // over 16 digits
  assert.equal(normalizeOrderPhoneNumber("1234567890123456789012345678901234567890"), null); // exceeds 32 chars
});

test("customer full name normalization trims, bounds, and collapses whitespace", () => {
  assert.equal(normalizeOrderCustomerName("  Alice   Smith  "), "Alice Smith");
  assert.equal(normalizeOrderCustomerName("A"), null); // min 2 characters
  assert.equal(normalizeOrderCustomerName(""), null);
  assert.equal(normalizeOrderCustomerName("a".repeat(121)), null); // max 120
});

test("telegram username normalization handles @ prefix, casing, and bounds", () => {
  assert.equal(normalizeTelegramHandle("alice_dev"), "@alice_dev");
  assert.equal(normalizeTelegramHandle("@alice_dev"), "@alice_dev");
  assert.equal(normalizeTelegramHandle(""), null);
  assert.equal(normalizeTelegramHandle("   "), null);
  assert.equal(normalizeTelegramHandle("al"), null); // min 3 chars
  assert.equal(normalizeTelegramHandle("@invalid-handle!"), null); // invalid chars
});

/* --------------------------------------------------------------------------
   Checkout End-to-End Service Tests
   -------------------------------------------------------------------------- */

test("1. Valid authenticated checkout creates an order and stores phone + name", async () => {
  const db = createMockDb();
  db.cartItems.set("cart_1", {
    id: "cart_1",
    customerId: CUSTOMER_A,
    productId: "prod-paid-1",
    quantity: 2,
  });

  let telegramCalls = [];
  const service = createCartService(
    () => db.client,
    () => {},
    async (notification) => {
      telegramCalls.push(notification);
    },
  );

  const idempotencyKey = generateOrderIdempotencyKey();
  const result = await service.placeOrder(CUSTOMER_A, {
    idempotencyKey,
    reviewedSubtotalCents: 3000, // 2 x $15.00
    customerName: "Alice Developer",
    customerPhone: "+1 (555) 234-5678",
    telegramHandle: "@alice_dev",
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.totalCents, 3000);
  assert.equal(result.value.itemCount, 2);

  const order = db.orders.get(result.value.orderId);
  assert.ok(order);
  assert.equal(order.customerId, CUSTOMER_A);
  assert.equal(order.status, "PENDING_PAYMENT");
  assert.equal(order.total, "30.00");
  assert.equal(order.customerName, "Alice Developer");
  assert.equal(order.customerPhone, "+1 (555) 234-5678");
  assert.equal(order.telegramHandle, "@alice_dev");
  assert.equal(db.cartItems.size, 0); // Cart cleared
});

test("2. Order belongs strictly to the authenticated customer", async () => {
  const db = createMockDb();
  db.cartItems.set("cart_1", {
    id: "cart_1",
    customerId: CUSTOMER_A,
    productId: "prod-paid-1",
    quantity: 1,
  });

  const service = createCartService(() => db.client, () => {}, async () => {});
  const result = await service.placeOrder(CUSTOMER_A, {
    idempotencyKey: generateOrderIdempotencyKey(),
    reviewedSubtotalCents: 1500,
    customerPhone: "+15551234567",
  });

  assert.equal(result.ok, true);
  const order = db.orders.get(result.value.orderId);
  assert.equal(order.customerId, CUSTOMER_A);
  assert.notEqual(order.customerId, CUSTOMER_B);
});

test("3 & 4. Database price is authoritative; client subtotal cannot alter order price", async () => {
  const db = createMockDb();
  db.cartItems.set("cart_1", {
    id: "cart_1",
    customerId: CUSTOMER_A,
    productId: "prod-paid-1",
    quantity: 1,
  });

  const service = createCartService(() => db.client, () => {}, async () => {});
  // Client attempts to claim subtotal was 1 cent instead of 1500 cents
  const tampered = await service.placeOrder(CUSTOMER_A, {
    idempotencyKey: generateOrderIdempotencyKey(),
    reviewedSubtotalCents: 1,
    customerPhone: "+15551234567",
  });

  assert.equal(tampered.ok, false);
  assert.equal(tampered.code, "TOTAL_CHANGED");
  assert.equal(db.orders.size, 0); // No order created
});

test("5. Invalid phone is rejected", async () => {
  const db = createMockDb();
  db.cartItems.set("cart_1", {
    id: "cart_1",
    customerId: CUSTOMER_A,
    productId: "prod-paid-1",
    quantity: 1,
  });

  const service = createCartService(() => db.client, () => {}, async () => {});
  const result = await service.placeOrder(CUSTOMER_A, {
    idempotencyKey: generateOrderIdempotencyKey(),
    reviewedSubtotalCents: 1500,
    customerPhone: "not-a-phone",
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_PHONE");
});

test("6 & 7. Valid phone and optional Telegram handle are recorded", async () => {
  const db = createMockDb();
  db.cartItems.set("cart_1", {
    id: "cart_1",
    customerId: CUSTOMER_A,
    productId: "prod-paid-1",
    quantity: 1,
  });

  const service = createCartService(() => db.client, () => {}, async () => {});
  const result = await service.placeOrder(CUSTOMER_A, {
    idempotencyKey: generateOrderIdempotencyKey(),
    reviewedSubtotalCents: 1500,
    customerPhone: "+44 20 7946 0958",
    telegramHandle: "alice_uk",
  });

  assert.equal(result.ok, true);
  const order = db.orders.get(result.value.orderId);
  assert.equal(order.customerPhone, "+44 20 7946 0958");
  assert.equal(order.telegramHandle, "@alice_uk");
});

test("8. Empty cart is rejected", async () => {
  const db = createMockDb();
  const service = createCartService(() => db.client, () => {}, async () => {});
  const result = await service.placeOrder(CUSTOMER_A, {
    idempotencyKey: generateOrderIdempotencyKey(),
    reviewedSubtotalCents: 0,
    customerPhone: "+15551234567",
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "CART_EMPTY");
});

test("9. Unpublished product is rejected", async () => {
  const db = createMockDb();
  db.cartItems.set("cart_1", {
    id: "cart_1",
    customerId: CUSTOMER_A,
    productId: "prod-unpub-1",
    quantity: 1,
  });

  const service = createCartService(() => db.client, () => {}, async () => {});
  const result = await service.placeOrder(CUSTOMER_A, {
    idempotencyKey: generateOrderIdempotencyKey(),
    reviewedSubtotalCents: 1000,
    customerPhone: "+15551234567",
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "PRODUCT_UNAVAILABLE");
});

test("10. $0.00 valid cart creates an order instead of CART_EMPTY", async () => {
  const db = createMockDb();
  db.cartItems.set("cart_free", {
    id: "cart_free",
    customerId: CUSTOMER_A,
    productId: "prod-free-1",
    quantity: 1,
  });

  const service = createCartService(() => db.client, () => {}, async () => {});
  const result = await service.placeOrder(CUSTOMER_A, {
    idempotencyKey: generateOrderIdempotencyKey(),
    reviewedSubtotalCents: 0,
    customerPhone: "+15551234567",
  });

  assert.equal(result.ok, true, "Free order should succeed");
  assert.equal(result.value.totalCents, 0);
  const order = db.orders.get(result.value.orderId);
  assert.equal(order.total, "0.00");
  assert.equal(order.status, "PENDING_PAYMENT");
});

test("11. Duplicate submission / idempotency key returns the original order", async () => {
  const db = createMockDb();
  db.cartItems.set("cart_1", {
    id: "cart_1",
    customerId: CUSTOMER_A,
    productId: "prod-paid-1",
    quantity: 1,
  });

  const service = createCartService(() => db.client, () => {}, async () => {});
  const key = generateOrderIdempotencyKey();

  const first = await service.placeOrder(CUSTOMER_A, {
    idempotencyKey: key,
    reviewedSubtotalCents: 1500,
    customerPhone: "+15551234567",
  });
  assert.equal(first.ok, true);
  assert.equal(first.value.alreadyPlaced, false);

  // Retry with same key
  const second = await service.placeOrder(CUSTOMER_A, {
    idempotencyKey: key,
    reviewedSubtotalCents: 1500,
    customerPhone: "+15551234567",
  });
  assert.equal(second.ok, true);
  assert.equal(second.value.alreadyPlaced, true);
  assert.equal(second.value.orderId, first.value.orderId);
});

test("11b. A retried submission never sends a second Telegram notification", async () => {
  const db = createMockDb();
  db.cartItems.set("cart_1", {
    id: "cart_1",
    customerId: CUSTOMER_A,
    productId: "prod-paid-1",
    quantity: 1,
  });

  const notifications = [];
  const service = createCartService(
    () => db.client,
    () => {},
    async (notification) => {
      notifications.push(notification);
    },
  );

  const idempotencyKey = generateOrderIdempotencyKey();
  const first = await service.placeOrder(CUSTOMER_A, {
    idempotencyKey,
    reviewedSubtotalCents: 1500,
    customerPhone: "+15551234567",
  });
  assert.equal(first.ok, true);
  assert.equal(first.value.alreadyPlaced, false);
  assert.equal(notifications.length, 1, "a new order notifies once");

  // Same key again: resolves to the original order, so it must not notify again.
  const retry = await service.placeOrder(CUSTOMER_A, {
    idempotencyKey,
    reviewedSubtotalCents: 1500,
    customerPhone: "+15551234567",
  });
  assert.equal(retry.ok, true);
  assert.equal(retry.value.alreadyPlaced, true);
  assert.equal(retry.value.orderId, first.value.orderId);
  assert.equal(notifications.length, 1, "a retry must not notify Telegram twice");
  assert.equal(db.orders.size, 1, "a retry must not create a second order");
});

/* --------------------------------------------------------------------------
   Telegram Integration Tests
   -------------------------------------------------------------------------- */

test("12. Telegram order notification payload is formatted correctly", () => {
  const message = formatTelegramOrderMessage({
    orderId: "DKC-2026-1006-12345",
    customerName: "Alice Smith",
    customerEmail: "alice@example.com",
    customerPhone: "+1-555-0199",
    telegramHandle: "@alicedev",
    items: [
      { quantity: 2, productTitle: "ProSave System", unitPrice: "15.00" },
      { quantity: 1, productTitle: "Free Pack", unitPrice: "0.00" },
    ],
    total: "30.00",
    currency: "USD",
    status: "PENDING PAYMENT",
  });

  assert.match(message, /<b>NEW DEVKITCAT ORDER<\/b>/);
  assert.match(message, /DKC-2026-1006-12345/);
  assert.match(message, /Alice Smith \(alice@example\.com\)/);
  assert.match(message, /\+1-555-0199/);
  assert.match(message, /@alicedev/);
  assert.match(message, /• 2x ProSave System — \$15\.00/);
  assert.match(message, /• 1x Free Pack — \$0\.00/);
  assert.match(message, /\$30\.00 USD/);
  assert.match(message, /PENDING PAYMENT/);
});

test("13. User-controlled values are safely HTML-escaped for Telegram", () => {
  assert.equal(escapeTelegramHtml("Hello <script> & <b>world</b>"), "Hello &lt;script&gt; &amp; &lt;b&gt;world&lt;/b&gt;");

  const message = formatTelegramOrderMessage({
    orderId: "DKC-12345",
    customerName: "Alice <Hacker>",
    customerEmail: "a&b@test.com",
    customerPhone: "+1555<123>",
    telegramHandle: "@attacker<script>",
    items: [{ quantity: 1, productTitle: "Pack <v2 & v3>", unitPrice: "10.00" }],
    total: "10.00",
    currency: "USD",
    status: "PENDING PAYMENT",
  });

  assert.doesNotMatch(message, /<Hacker>/);
  assert.doesNotMatch(message, /<script>/);
  assert.match(message, /Alice &lt;Hacker&gt;/);
  assert.match(message, /a&amp;b@test\.com/);
  assert.match(message, /Pack &lt;v2 &amp; v3&gt;/);
});

test("14. Missing Telegram configuration logs warning and does not prevent order creation", async () => {
  const result = await sendTelegramOrderNotification(
    {
      orderId: "DKC-TEST",
      customerName: "Test",
      customerEmail: "test@example.com",
      customerPhone: "+15551234567",
      items: [],
      total: "0.00",
      currency: "USD",
      status: "PENDING PAYMENT",
    },
    { TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "" },
  );

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});

test("15. Telegram API failure does not destroy or roll back the created order", async () => {
  const db = createMockDb();
  db.cartItems.set("cart_1", {
    id: "cart_1",
    customerId: CUSTOMER_A,
    productId: "prod-paid-1",
    quantity: 1,
  });

  // Notifier throws an error simulating network crash
  const failingNotifier = async () => {
    throw new Error("Telegram API Network Outage");
  };

  const service = createCartService(() => db.client, () => {}, failingNotifier);
  const result = await service.placeOrder(CUSTOMER_A, {
    idempotencyKey: generateOrderIdempotencyKey(),
    reviewedSubtotalCents: 1500,
    customerPhone: "+15551234567",
  });

  assert.equal(result.ok, true, "Order must succeed despite Telegram failure");
  assert.ok(db.orders.has(result.value.orderId), "Order must exist in database");
});

test("16. Telegram bot token and chat ID never leak into client bundles", async () => {
  const clientFiles = [
    "src/components/checkout/CheckoutSubmit.tsx",
    "src/components/checkout/PaymentNotice.tsx",
    "src/components/cart/CartProvider.tsx",
    "src/components/account/OrderSummary.tsx",
    "src/app/checkout/page.tsx",
    "src/app/account/purchases/[id]/page.tsx",
  ];

  for (const file of clientFiles) {
    const src = await readSource(file);
    assert.doesNotMatch(src, /TELEGRAM_BOT_TOKEN/, `${file} must not reference bot token`);
    assert.doesNotMatch(src, /TELEGRAM_CHAT_ID/, `${file} must not reference chat id`);
  }
});

/* --------------------------------------------------------------------------
   UI / Account Presentation Tests
   -------------------------------------------------------------------------- */

test("17 & 18. Confirmation page displays order reference and Telegram contact CTA", async () => {
  const detailPage = await readSource("src/app/account/purchases/[id]/page.tsx");
  assert.match(detailPage, /NEXT_PUBLIC_TELEGRAM_CONTACT_URL/);
  assert.match(detailPage, /Continue on Telegram/);
  assert.match(detailPage, /Next steps: Manual Telegram fulfillment/);
  assert.match(detailPage, /order\.id/);
});

test("19. Zero-order purchases page shows the correct 'No purchases yet' empty state", async () => {
  const purchasesPage = await readSource("src/app/account/purchases/page.tsx");
  assert.match(purchasesPage, /orders\.length === 0 && !query/);
  assert.match(purchasesPage, /No purchases yet/);
});

test("20. CartProvider synchronizes session state on navigation", async () => {
  const provider = await readSource("src/components/cart/CartProvider.tsx");
  assert.match(provider, /usePathname/);
  assert.match(provider, /syncCart\(true\)/);
});
