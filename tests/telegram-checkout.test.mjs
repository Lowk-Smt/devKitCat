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
      return { ok: true };
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

  const service = createCartService(() => db.client, () => {}, async () => ({ ok: true }));
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

  const service = createCartService(() => db.client, () => {}, async () => ({ ok: true }));
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

  const service = createCartService(() => db.client, () => {}, async () => ({ ok: true }));
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

  const service = createCartService(() => db.client, () => {}, async () => ({ ok: true }));
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
  const service = createCartService(() => db.client, () => {}, async () => ({ ok: true }));
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

  const service = createCartService(() => db.client, () => {}, async () => ({ ok: true }));
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

  const service = createCartService(() => db.client, () => {}, async () => ({ ok: true }));
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

test("10b. Every newly created order invokes Telegram without optional contact fields", async () => {
  const db = createMockDb();
  db.cartItems.set("cart_1", {
    id: "cart_1",
    customerId: CUSTOMER_A,
    productId: "prod-paid-1",
    quantity: 1,
  });

  let calls = 0;
  const service = createCartService(
    () => db.client,
    () => {},
    async () => {
      calls += 1;
      return { ok: true };
    },
  );

  const result = await service.placeOrder(CUSTOMER_A, {
    idempotencyKey: generateOrderIdempotencyKey(),
    reviewedSubtotalCents: 1500,
  });

  assert.equal(result.ok, true);
  assert.equal(calls, 1, "a newly created order must always invoke Telegram");
});

test("11. Duplicate submission / idempotency key returns the original order", async () => {
  const db = createMockDb();
  db.cartItems.set("cart_1", {
    id: "cart_1",
    customerId: CUSTOMER_A,
    productId: "prod-paid-1",
    quantity: 1,
  });

  const service = createCartService(() => db.client, () => {}, async () => ({ ok: true }));
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
      return { ok: true };
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

const telegramNotification = {
  orderId: "DKC-2026-1006-12345",
  customerName: "Alice Smith",
  customerEmail: "alice@example.test",
  customerPhone: "+15551234567",
  telegramHandle: "@alice_dev",
  items: [{ quantity: 1, productTitle: "ProSave System", unitPrice: "15.00" }],
  total: "15.00",
  currency: "USD",
  status: "PENDING PAYMENT",
};
const telegramEnv = {
  TELEGRAM_BOT_TOKEN: "123456789:FAKE_BOT_TOKEN_FOR_TESTS_ONLY",
  TELEGRAM_CHAT_ID: "987654321",
  DATABASE_URL: "postgresql://test_user:fake_password@db.example.test/devkitcat",
};

function mockTelegramAttempt(t, implementation = async () => {
  throw new Error("Unexpected Telegram request in test");
}) {
  return {
    info: t.mock.method(console, "info", () => {}),
    warn: t.mock.method(console, "warn", () => {}),
    fetch: t.mock.method(globalThis, "fetch", implementation),
  };
}

function assertSafeTelegramLogs(logs) {
  const output = [...logs.info.mock.calls, ...logs.warn.mock.calls]
    .map((call) => call.arguments.join(" ")).join("\n");
  for (const value of [
    telegramEnv.TELEGRAM_BOT_TOKEN, telegramEnv.TELEGRAM_CHAT_ID, telegramEnv.DATABASE_URL,
    telegramNotification.customerName, telegramNotification.customerEmail,
    telegramNotification.customerPhone, telegramNotification.telegramHandle,
  ]) {
    assert.ok(!output.includes(value), "Telegram logs must not include credentials or customer details");
  }
}

function assertTelegramFailure(logs, code, status) {
  assert.equal(logs.info.mock.calls.length, 1, "only the invocation may be logged at info level");
  assert.equal(logs.warn.mock.calls.length, 1, "every attempt must have one terminal warning");
  const warning = logs.warn.mock.calls[0].arguments[0];
  assert.ok(warning.includes(telegramNotification.orderId));
  assert.ok(warning.includes(code));
  if (status !== undefined) assert.ok(warning.includes(`HTTP ${status}`));
  assertSafeTelegramLogs(logs);
  return warning;
}

function telegramResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("Telegram 2xx + ok:true consumes JSON and logs a correlated acknowledgment", async (t) => {
  const response = telegramResponse({
    ok: true,
    result: { message_id: 42, chat: { id: telegramEnv.TELEGRAM_CHAT_ID }, text: "private response text" },
  });
  const logs = mockTelegramAttempt(t, async () => response);
  const result = await sendTelegramOrderNotification(telegramNotification, telegramEnv);

  assert.deepEqual(result, { ok: true });
  assert.equal(response.bodyUsed, true);
  assert.equal(logs.info.mock.calls.length, 2);
  assert.equal(logs.warn.mock.calls.length, 0);
  assert.match(logs.info.mock.calls[0].arguments[0], /telegramConfigured: true/);
  assert.match(logs.info.mock.calls[1].arguments[0], /notification acknowledged.*DKC-2026-1006-12345.*HTTP 200.*telegramOk: true/);
  assertSafeTelegramLogs(logs);
  assert.ok(!logs.info.mock.calls[1].arguments[0].includes("private response text"));
  const [url, options] = logs.fetch.mock.calls[0].arguments;
  assert.equal(url, `https://api.telegram.org/bot${telegramEnv.TELEGRAM_BOT_TOKEN}/sendMessage`);
  assert.equal(options.method, "POST");
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(options.body), {
    chat_id: telegramEnv.TELEGRAM_CHAT_ID,
    text: formatTelegramOrderMessage(telegramNotification),
    parse_mode: "HTML",
  }, "the notification content and configured destination must remain unchanged");
});

test("Telegram 2xx + ok:false fails with a redacted, single-line, truncated description", async (t) => {
  const response = telegramResponse({
    ok: false,
    description: `Bad Request: chat not found\n\t\u001b ${Object.values(telegramEnv).join(" ")} ${telegramNotification.customerName} ${telegramNotification.customerEmail} ${telegramNotification.customerPhone} ${telegramNotification.telegramHandle} password=another-secret ${"x".repeat(300)}`,
  }, 201);
  const logs = mockTelegramAttempt(t, async () => response);
  const result = await sendTelegramOrderNotification(telegramNotification, telegramEnv);

  assert.deepEqual(result, { ok: false, error: "TELEGRAM_API_ERROR" });
  assert.equal(response.bodyUsed, true);
  const warning = assertTelegramFailure(logs, "TELEGRAM_API_ERROR", 201);
  assert.match(warning, /Bad Request: chat not found/);
  assert.match(warning, /\[redacted\]/);
  assert.ok(!warning.includes("another-secret"));
  for (const control of ["\n", "\t", "\u001b"]) assert.ok(!warning.includes(control));
  const description = warning.split("): ")[1].slice(0, -1);
  assert.ok(description.length <= 200);
});

test("Telegram descriptions redact credentials before truncation, including partial-token boundaries", async (t) => {
  const response = telegramResponse({
    ok: false,
    description: `${"x".repeat(180)} ${telegramEnv.TELEGRAM_BOT_TOKEN} ${"y".repeat(100)}`,
  });
  const logs = mockTelegramAttempt(t, async () => response);
  assert.deepEqual(await sendTelegramOrderNotification(telegramNotification, telegramEnv), {
    ok: false, error: "TELEGRAM_API_ERROR",
  });
  const warning = assertTelegramFailure(logs, "TELEGRAM_API_ERROR", 200);
  assert.ok(!warning.includes(telegramEnv.TELEGRAM_BOT_TOKEN.slice(0, 15)));
  assert.equal(warning.split("): ")[1].slice(0, -1).length, 200);
});

test("Telegram non-2xx responses consume JSON and preserve status/description", async (t) => {
  for (const status of [400, 429, 503]) {
    await t.test(`HTTP ${status}`, async (t) => {
      const response = telegramResponse({ ok: false, description: "Bad Request: chat not found" }, status);
      const logs = mockTelegramAttempt(t, async () => response);
      const result = await sendTelegramOrderNotification(telegramNotification, telegramEnv);
      assert.deepEqual(result, { ok: false, error: `HTTP_${status}` });
      assert.equal(response.bodyUsed, true);
      assert.match(assertTelegramFailure(logs, `HTTP_${status}`, status), /Bad Request: chat not found/);
    });
  }
});

test("Telegram non-JSON HTTP failure still reports the HTTP status safely", async (t) => {
  const response = new Response(`not JSON: ${telegramEnv.TELEGRAM_BOT_TOKEN}`, { status: 502 });
  const logs = mockTelegramAttempt(t, async () => response);
  const result = await sendTelegramOrderNotification(telegramNotification, telegramEnv);
  assert.deepEqual(result, { ok: false, error: "HTTP_502" });
  assert.equal(response.bodyUsed, true);
  assert.match(assertTelegramFailure(logs, "HTTP_502", 502), /No valid Telegram description/);
});

test("Telegram network/fetch failure returns NETWORK_ERROR without logging the exception", async (t) => {
  const logs = mockTelegramAttempt(t, async () => {
    throw new TypeError(`fetch failed: ${telegramEnv.TELEGRAM_BOT_TOKEN} ${telegramEnv.DATABASE_URL}`);
  });
  const result = await sendTelegramOrderNotification(telegramNotification, telegramEnv);
  assert.deepEqual(result, { ok: false, error: "NETWORK_ERROR" });
  assertTelegramFailure(logs, "NETWORK_ERROR");
});

test("Telegram fetch TimeoutError returns TIMEOUT rather than NETWORK_ERROR", async (t) => {
  const logs = mockTelegramAttempt(t, async () => {
    throw new DOMException(`timeout: ${telegramEnv.TELEGRAM_BOT_TOKEN}`, "TimeoutError");
  });
  const result = await sendTelegramOrderNotification(telegramNotification, telegramEnv);
  assert.deepEqual(result, { ok: false, error: "TIMEOUT" });
  assertTelegramFailure(logs, "TIMEOUT");
});

test("Telegram deadline covers body consumption, including an AbortError after 2xx headers", async (t) => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    assert.equal(milliseconds, 5000);
    return controller.signal;
  });
  const response = telegramResponse({ ok: true });
  t.mock.method(response, "json", async () => {
    controller.abort(new DOMException("deadline elapsed", "TimeoutError"));
    throw new DOMException("body aborted", "AbortError");
  });
  const logs = mockTelegramAttempt(t, async (_url, options) => {
    assert.equal(options.signal, controller.signal);
    return response;
  });
  const result = await sendTelegramOrderNotification(telegramNotification, telegramEnv);
  assert.deepEqual(result, { ok: false, error: "TIMEOUT" });
  assertTelegramFailure(logs, "TIMEOUT", 200);
});

test("Telegram body transport failure is NETWORK_ERROR, not a false acknowledgment", async (t) => {
  const response = telegramResponse({ ok: true });
  t.mock.method(response, "json", async () => { throw new TypeError("connection terminated"); });
  const logs = mockTelegramAttempt(t, async () => response);
  const result = await sendTelegramOrderNotification(telegramNotification, telegramEnv);
  assert.deepEqual(result, { ok: false, error: "NETWORK_ERROR" });
  assertTelegramFailure(logs, "NETWORK_ERROR", 200);
});

test("Malformed or unexpected 2xx responses never count as Telegram success", async (t) => {
  for (const body of ["not JSON", "null", "[]", "{}", '{"ok":"true"}', '{"ok":1}']) {
    await t.test(body, async (t) => {
      const response = new Response(body, { status: 200 });
      const logs = mockTelegramAttempt(t, async () => response);
      const result = await sendTelegramOrderNotification(telegramNotification, telegramEnv);
      assert.deepEqual(result, { ok: false, error: "INVALID_RESPONSE" });
      assert.equal(response.bodyUsed, true);
      assertTelegramFailure(logs, "INVALID_RESPONSE", 200);
    });
  }
});

test("Telegram formatting errors are caught and correlated without attempting fetch", async (t) => {
  const logs = mockTelegramAttempt(t);
  const result = await sendTelegramOrderNotification({ ...telegramNotification, customerName: null }, telegramEnv);
  assert.deepEqual(result, { ok: false, error: "FORMAT_ERROR" });
  assert.equal(logs.fetch.mock.calls.length, 0);
  assertTelegramFailure(logs, "FORMAT_ERROR");
});

test("Telegram acknowledgment is not returned or logged before the JSON body resolves", { timeout: 1000 }, async (t) => {
  let resolveBody;
  const body = new Promise((resolve) => { resolveBody = resolve; });
  let bodyStarted;
  const started = new Promise((resolve) => { bodyStarted = resolve; });
  const response = telegramResponse({ ok: true });
  t.mock.method(response, "json", () => { bodyStarted(); return body; });
  const logs = mockTelegramAttempt(t, async () => response);
  let settled = false;
  const attempt = sendTelegramOrderNotification(telegramNotification, telegramEnv)
    .then((result) => { settled = true; return result; });
  await started;
  assert.equal(settled, false);
  assert.equal(logs.info.mock.calls.length, 1);
  assert.equal(logs.warn.mock.calls.length, 0);
  resolveBody({ ok: true });
  assert.deepEqual(await attempt, { ok: true });
  assert.equal(logs.info.mock.calls.length, 2);
  assertSafeTelegramLogs(logs);
});

test("14. Missing Telegram configuration logs a correlated skip without fetching", async (t) => {
  const logs = mockTelegramAttempt(t);
  const result = await sendTelegramOrderNotification(telegramNotification, {
    TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "",
  });
  assert.deepEqual(result, { ok: true, skipped: true });
  assert.equal(logs.fetch.mock.calls.length, 0);
  assert.equal(logs.info.mock.calls.length, 1);
  assert.match(logs.info.mock.calls[0].arguments[0], /telegramConfigured: false/);
  assert.equal(logs.warn.mock.calls.length, 1);
  assert.ok(logs.warn.mock.calls[0].arguments[0].includes(telegramNotification.orderId));
  assert.match(logs.warn.mock.calls[0].arguments[0], /notification skipped/);
  assertSafeTelegramLogs(logs);
});

test("15. Telegram API failure does not destroy or roll back the created order", async () => {
  const db = createMockDb();
  db.cartItems.set("cart_1", {
    id: "cart_1",
    customerId: CUSTOMER_A,
    productId: "prod-paid-1",
    quantity: 1,
  });

  // An unexpected notifier exception must also remain safe and non-blocking.
  const failingNotifier = async () => {
    throw new Error(`Telegram API Network Outage ${telegramEnv.TELEGRAM_BOT_TOKEN}`);
  };
  const diagnostics = [];
  const service = createCartService(() => db.client, (...args) => diagnostics.push(args), failingNotifier);
  const result = await service.placeOrder(CUSTOMER_A, {
    idempotencyKey: generateOrderIdempotencyKey(),
    reviewedSubtotalCents: 1500,
    customerPhone: "+15551234567",
  });

  assert.equal(result.ok, true, "Order must succeed despite Telegram failure");
  assert.ok(db.orders.has(result.value.orderId), "Order must exist in database");
  assert.deepEqual(diagnostics, [[`telegram notification for order ${result.value.orderId}`, "UNKNOWN"]]);
});

test("Returned Telegram failures are logged after commit without failing checkout or notifying on retry", async (t) => {
  for (const error of ["HTTP_400", "TELEGRAM_API_ERROR", "INVALID_RESPONSE", "NETWORK_ERROR", "TIMEOUT", "FORMAT_ERROR"]) {
    await t.test(error, async () => {
      const db = createMockDb();
      db.cartItems.set("cart_1", { id: "cart_1", customerId: CUSTOMER_A, productId: "prod-paid-1", quantity: 1 });
      const diagnostics = [];
      let notifications = 0;
      const service = createCartService(
        () => db.client,
        (...args) => diagnostics.push(args),
        async () => {
          assert.equal(db.orders.size, 1, "notification must stay post-commit");
          notifications += 1;
          return { ok: false, error };
        },
      );
      const input = { idempotencyKey: generateOrderIdempotencyKey(), reviewedSubtotalCents: 1500 };
      const placed = await service.placeOrder(CUSTOMER_A, input);
      assert.equal(placed.ok, true, "a returned notification failure must not fail checkout");
      assert.equal(placed.value.alreadyPlaced, false);
      assert.equal(db.orders.get(placed.value.orderId).status, "PENDING_PAYMENT");
      assert.equal(db.cartItems.size, 0);
      assert.equal(notifications, 1);
      assert.deepEqual(diagnostics, [[`telegram notification for order ${placed.value.orderId}`, error]]);
      const retry = await service.placeOrder(CUSTOMER_A, input);
      assert.equal(retry.ok, true);
      assert.equal(retry.value.alreadyPlaced, true);
      assert.equal(retry.value.orderId, placed.value.orderId);
      assert.equal(db.orders.size, 1);
      assert.equal(notifications, 1, "an idempotent retry must not notify again, even after failure");
      assert.equal(diagnostics.length, 1);
    });
  }
});

test("Checkout still awaits the post-commit notifier instead of detaching it", { timeout: 1000 }, async () => {
  const db = createMockDb();
  db.cartItems.set("cart_1", { id: "cart_1", customerId: CUSTOMER_A, productId: "prod-paid-1", quantity: 1 });
  let enterNotifier;
  const started = new Promise((resolve) => { enterNotifier = resolve; });
  let finishNotifier;
  const finished = new Promise((resolve) => { finishNotifier = resolve; });
  const service = createCartService(() => db.client, () => {}, async () => {
    enterNotifier();
    return await finished;
  });
  let settled = false;
  const placement = service.placeOrder(CUSTOMER_A, {
    idempotencyKey: generateOrderIdempotencyKey(), reviewedSubtotalCents: 1500,
  }).then((result) => { settled = true; return result; });
  await started;
  assert.equal(db.orders.size, 1);
  assert.equal(settled, false);
  finishNotifier({ ok: true });
  assert.equal((await placement).ok, true);
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
