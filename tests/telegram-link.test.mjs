import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CUSTOMER_LINK_REJECTED_MESSAGE,
  buildTelegramDeepLink,
  classifyMessage,
  formatCustomerAckMessage,
  formatCustomerRelayToStaff,
  formatTelegramConnectionNotice,
  generateLinkToken,
  hashLinkToken,
  isAuthorizedWebhookRequest,
  isTelegramBotConfigured,
  isValidLinkToken,
  linkExpiryFromNow,
  parseTelegramUpdate,
  resolveLinkTtlDays,
  resolveTelegramNotice,
  truncateCustomerText,
} from "../src/lib/server/telegram-link-core.ts";
import { createTelegramLinkService } from "../src/lib/server/telegram-link-service.ts";
import { createTelegramWebhookProcessor } from "../src/lib/server/telegram-webhook-core.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (rel) => readFile(path.join(repoRoot, rel), "utf8");

/* --------------------------------------------------------------------------
   Mock database harness: only the Prisma calls the link service makes.
   -------------------------------------------------------------------------- */

const CUSTOMER_A = "cust_a_12345";
const ORDER_A = "DKC-2026-1008-48213";
const ORDER_A2 = "DKC-2026-1008-48214";
const CUSTOMER_B = "cust_b_67890";
const ORDER_B = "DKC-2026-1008-90001";
const STAFF_CHAT_ID = "-1009876543210";
const CUSTOMER_CHAT = "765432109";
const OTHER_CHAT = "111222333";

function createMockDb() {
  const orders = new Map();
  const links = new Map();
  const relays = new Map();
  // updateId -> ledger row (claim/lease/done state for webhook retries).
  const events = new Map();
  // Failure injection: the next event-table write throws it once, or the Nth
  // (1-based) event write does — to simulate a blip at a precise step.
  let nextEventWriteFailure = null;
  let failEventWriteNumber = null;
  let pendingNthFailure = null;
  let failEventWriteBaseline = null;
  let eventWriteCount = 0;
  let nextId = 1;
  function eventWriteFailure() {
    eventWriteCount += 1;
    if (nextEventWriteFailure) {
      const failure = nextEventWriteFailure;
      nextEventWriteFailure = null;
      return failure;
    }
    if (
      failEventWriteNumber !== null &&
      failEventWriteBaseline !== null &&
      eventWriteCount - failEventWriteBaseline === failEventWriteNumber
    ) {
      failEventWriteNumber = null;
      failEventWriteBaseline = null;
      return pendingNthFailure;
    }
    return null;
  }

  function addOrder(input) {
    const row = {
      id: input.id,
      customerId: input.customerId,
      status: input.status ?? "PENDING_PAYMENT",
      total: input.total ?? "15.00",
      currency: "USD",
      customerName: input.customerName ?? "Alice Developer",
      customerPhone: input.customerPhone ?? "+855 12 345 678",
      customer: input.customer ?? { name: "Alice Developer", email: "alice@example.com" },
      items: input.items ?? [
        {
          id: `item_${nextId++}`,
          orderId: input.id,
          productTitle: "ProSave System",
          quantity: 1,
          unitPrice: "15.00",
          position: 0,
        },
      ],
    };
    orders.set(row.id, row);
    return row;
  }

  function findLink(where) {
    if (!where) return null;
    if (where.id !== undefined) return links.get(where.id) ?? null;
    if (where.orderId !== undefined) {
      return [...links.values()].find((l) => l.orderId === where.orderId) ?? null;
    }
    if (where.tokenHash !== undefined) {
      return [...links.values()].find((l) => l.tokenHash === where.tokenHash) ?? null;
    }
    return null;
  }

  function linkWithOrder(row) {
    return row ? { ...row, order: orders.get(row.orderId) ?? null } : null;
  }

  const client = {
    order: {
      async findFirst({ where }) {
        for (const row of orders.values()) {
          if (where.id !== undefined && row.id !== where.id) continue;
          if (where.customerId !== undefined && row.customerId !== where.customerId) continue;
          if (where.status !== undefined && row.status !== where.status) continue;
          return { ...row, telegramLink: findLink({ orderId: row.id }) };
        }
        return null;
      },
      async findUnique({ where }) {
        const row = orders.get(where.id) ?? null;
        return row ? { ...row, telegramLink: findLink({ orderId: row.id }) } : null;
      },
    },
    orderTelegramLink: {
      async findUnique({ where }) {
        return findLink(where);
      },
      async findMany({ where }) {
        const rows = [...links.values()].filter(
          (l) => where?.chatId === undefined || l.chatId === where.chatId,
        );
        // Newest connection first, then id — matching the service query.
        rows.sort((a, b) => {
          const at = a.connectedAt ? a.connectedAt.getTime() : 0;
          const bt = b.connectedAt ? b.connectedAt.getTime() : 0;
          if (at !== bt) return bt - at;
          return a.id < b.id ? -1 : 1;
        });
        return rows.map(linkWithOrder);
      },
      async create({ data }) {
        if ([...links.values()].some((l) => l.orderId === data.orderId)) {
          throw { code: "P2002" };
        }
        const row = {
          id: `link_${nextId++}`,
          consumedAt: null,
          chatId: null,
          connectedAt: null,
          telegramName: null,
          createdAt: new Date(),
          ...data,
        };
        links.set(row.id, row);
        return row;
      },
      async update({ where, data }) {
        const row = links.get(where.id);
        if (!row) throw { code: "P2025" };
        Object.assign(row, data);
        return row;
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const row of links.values()) {
          if (where.id !== undefined && row.id !== where.id) continue;
          if (where.chatId !== null && row.chatId !== where.chatId) continue;
          if (where.chatId === null && row.chatId !== null) continue;
          if (where.expiresAt?.gt !== undefined && !(row.expiresAt > where.expiresAt.gt)) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      },
    },
    telegramStaffRelay: {
      async findUnique({ where }) {
        const key = where.staffChatId_staffMessageId;
        const relay =
          [...relays.values()].find(
            (r) => r.staffChatId === key.staffChatId && r.staffMessageId === key.staffMessageId,
          ) ?? null;
        if (!relay) return null;
        // Mimic Prisma's relation select: the service reads relay.link.chatId.
        const link = links.get(relay.linkId);
        return {
          ...relay,
          link: link ? { chatId: link.chatId, orderId: link.orderId } : null,
        };
      },
      async findFirst({ where }) {
        const relay =
          [...relays.values()].find(
            (r) => r.sourceUpdateId === where.sourceUpdateId && r.sourceKind === where.sourceKind,
          ) ?? null;
        if (!relay) return null;
        return { staffChatId: relay.staffChatId, staffMessageId: relay.staffMessageId };
      },
      async create({ data }) {
        if (
          [...relays.values()].some(
            (r) =>
              r.staffChatId === data.staffChatId && r.staffMessageId === data.staffMessageId,
          )
        ) {
          throw { code: "P2002" };
        }
        const row = {
          id: `relay_${nextId++}`,
          sourceUpdateId: null,
          sourceKind: null,
          createdAt: new Date(),
          ...data,
        };
        relays.set(row.id, row);
        return row;
      },
    },
    telegramWebhookEvent: {
      async create({ data }) {
        const failure = eventWriteFailure();
        if (failure) throw failure;
        if (events.has(data.updateId)) throw { code: "P2002" };
        const row = {
          updateId: data.updateId,
          status: data.status ?? "processing",
          leaseUntil: data.leaseUntil ?? null,
          attempts: data.attempts ?? 0,
          customerMessageId: null,
          staffReplyMessageId: null,
          receivedAt: new Date(),
        };
        events.set(row.updateId, row);
        return { ...row };
      },
      async findUnique({ where }) {
        const row = events.get(where.updateId);
        return row ? { ...row } : null;
      },
      async updateMany({ where, data }) {
        const failure = eventWriteFailure();
        if (failure) throw failure;
        const row = events.get(where.updateId);
        if (!row) return { count: 0 };
        if (where.status !== undefined && row.status !== where.status) return { count: 0 };
        if (where.leaseUntil?.lte !== undefined) {
          const lease = where.leaseUntil.lte;
          if (!(row.leaseUntil && row.leaseUntil <= lease)) return { count: 0 };
        }
        if (data.attempts?.increment !== undefined) row.attempts += data.attempts.increment;
        if (data.status !== undefined) row.status = data.status;
        if ("leaseUntil" in data) row.leaseUntil = data.leaseUntil ?? null;
        if (data.customerMessageId !== undefined) row.customerMessageId = data.customerMessageId;
        if (data.staffReplyMessageId !== undefined) {
          row.staffReplyMessageId = data.staffReplyMessageId;
        }
        return { count: 1 };
      },
    },
    async $transaction(fn) {
      return fn(client);
    },
  };

  return {
    client,
    orders,
    links,
    relays,
    events,
    addOrder,
    /** Makes the next event-table write fail once (simulating a database blip). */
    failNextEventWrite(error = { code: "P1001" }) {
      nextEventWriteFailure = error;
    },
    /**
     * Makes the Nth (1-based) event-table write of this mock fail once. Event
     * writes per update, in order: claim (create), any outbound marker, then
     * the completion — e.g. N=3 fails "mark done" after all sends succeeded.
     */
    failEventWriteAt(n, error = { code: "P1001" }) {
      failEventWriteNumber = n;
      failEventWriteBaseline = eventWriteCount;
      pendingNthFailure = error;
    },
  };
}

function createService(db, logger) {
  return createTelegramLinkService(() => db.client, logger ?? (() => {}));
}

/**
 * Records every bot send; `failNextWith` makes exactly the following call fail
 * with a typed error. Delivered message ids mirror Telegram: small increasing
 * numbers, exposed on each recorded call for deterministic assertions.
 */
function createMockTelegram() {
  const calls = [];
  let nextMessageId = 1000;
  let failNext = null;
  function deliver(call) {
    calls.push(call);
    if (failNext) {
      const error = failNext;
      failNext = null;
      return { ok: false, error };
    }
    // The id Telegram assigns to OUR message. Never named `messageId` on the
    // call: for forwards that name is the customer's source message id.
    call.sentMessageId = String(nextMessageId++);
    return { ok: true, messageId: call.sentMessageId };
  }
  return {
    calls,
    failNextWith(error) {
      failNext = error;
    },
    /** Delivered sends to one chat (failed attempts stay visible in `calls`). */
    sendsTo(chatId) {
      return calls.filter(
        (call) => call.op === "send" && call.chatId === chatId && call.sentMessageId,
      );
    },
    async sendChatMessage(chatId, text, options = {}) {
      return deliver({ op: "send", chatId, text, options });
    },
    async forwardMessage(toChatId, fromChatId, messageId) {
      return deliver({ op: "forward", toChatId, fromChatId, messageId });
    },
  };
}

function createProcessor(db, telegram, env = {}) {
  const service = createService(db);
  return createTelegramWebhookProcessor({
    links: service,
    telegram,
    env: { TELEGRAM_CHAT_ID: STAFF_CHAT_ID, TELEGRAM_BOT_TOKEN: "test-token", ...env },
  });
}

function tgUpdate(updateId, message) {
  return { update_id: updateId, ...(message ? { message } : {}) };
}

function customerMessage(messageId, text, extra = {}) {
  return {
    message_id: messageId,
    chat: { id: Number(CUSTOMER_CHAT), type: "private" },
    from: { id: 7, first_name: "Alice" },
    text,
    ...extra,
  };
}

function staffReplyMessage(messageId, replyToMessageId, text) {
  return {
    message_id: messageId,
    chat: { id: Number(STAFF_CHAT_ID), type: "supergroup" },
    from: { id: 9, first_name: "Owner" },
    text,
    reply_to_message: { message_id: replyToMessageId },
  };
}

/** Issues a link for ORDER_A and returns the raw token. */
async function issueTokenForOrderA(db) {
  const service = createService(db);
  const result = await service.issueLink(CUSTOMER_A, ORDER_A);
  assert.equal(result.ok, true);
  return result.value.token;
}

/* --------------------------------------------------------------------------
   1-2. Secure token generation and hash storage
   -------------------------------------------------------------------------- */

test("tokens are 43-char base64url values with 32 bytes of entropy and never repeat", () => {
  const tokens = new Set();
  for (let i = 0; i < 200; i += 1) {
    const token = generateLinkToken();
    assert.equal(token.length, 43);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    tokens.add(token);
  }
  assert.equal(tokens.size, 200, "every token must be unique");
});

test("only the SHA-256 hash is stored; the raw token never touches the database", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);

  const [stored] = [...db.links.values()];
  assert.equal(stored.tokenHash, createHash("sha256").update(token, "utf8").digest("hex"));
  assert.notEqual(stored.tokenHash, token);
  const serialized = JSON.stringify([...db.links.values()]);
  assert.ok(!serialized.includes(token), "raw token must not be stored anywhere");

  // The token round-trips through the hash for lookup only.
  const service = createService(db);
  const claim = await service.claimByToken(token, { chatId: CUSTOMER_CHAT, telegramName: "Alice" });
  assert.equal(claim.kind, "claimed");
});

test("token hash lookup never derives from the order id", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  await issueTokenForOrderA(db);

  const service = createService(db);
  // Trying the order id itself as a token must fail the shape check.
  assert.equal(isValidLinkToken(ORDER_A), false);
  const claim = await service.claimByToken(ORDER_A, { chatId: CUSTOMER_CHAT, telegramName: null });
  assert.equal(claim.kind, "rejected");
  assert.equal(claim.order, null);
});

/* --------------------------------------------------------------------------
   3. Token expiry
   -------------------------------------------------------------------------- */

test("expired tokens are rejected and indistinguishable from unknown ones", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);

  // Backdate the link past its expiry.
  const [stored] = [...db.links.values()];
  stored.expiresAt = new Date(Date.now() - 1000);

  const service = createService(db);
  const claim = await service.claimByToken(token, { chatId: CUSTOMER_CHAT, telegramName: "Alice" });
  assert.equal(claim.kind, "rejected");
  assert.equal(claim.order, null, "a rejected claim must not leak order data");

  const unknown = await service.claimByToken(generateLinkToken(), {
    chatId: CUSTOMER_CHAT,
    telegramName: "Alice",
  });
  assert.equal(unknown.kind, "rejected");
});

test("link TTL resolves from env with safe bounds and a 7-day default", () => {
  assert.equal(resolveLinkTtlDays({}), 7);
  assert.equal(resolveLinkTtlDays({ TELEGRAM_LINK_TTL_DAYS: "3" }), 3);
  assert.equal(resolveLinkTtlDays({ TELEGRAM_LINK_TTL_DAYS: "0" }), 7);
  assert.equal(resolveLinkTtlDays({ TELEGRAM_LINK_TTL_DAYS: "31" }), 7);
  assert.equal(resolveLinkTtlDays({ TELEGRAM_LINK_TTL_DAYS: "abc" }), 7);
  const expiry = linkExpiryFromNow(new Date("2026-10-08T00:00:00Z"), { TELEGRAM_LINK_TTL_DAYS: "7" });
  assert.equal(expiry.getTime() - new Date("2026-10-08T00:00:00Z").getTime(), 7 * 24 * 60 * 60 * 1000);
});

/* --------------------------------------------------------------------------
   4-7. One-time atomic claim, correct order, duplicate and stolen Starts
   -------------------------------------------------------------------------- */

test("a valid Start claims the exact order once and stores the chat binding", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  db.addOrder({ id: ORDER_B, customerId: CUSTOMER_B });
  const token = await issueTokenForOrderA(db);

  const service = createService(db);
  const claim = await service.claimByToken(token, { chatId: CUSTOMER_CHAT, telegramName: "Alice A" });
  assert.equal(claim.kind, "claimed");
  assert.equal(claim.order.orderId, ORDER_A, "the token must resolve to its own order");
  assert.equal(claim.order.customerPhone, "+855 12 345 678");

  const [stored] = [...db.links.values()];
  assert.equal(stored.chatId, CUSTOMER_CHAT);
  assert.equal(stored.consumedAt instanceof Date, true);
  assert.equal(stored.telegramName, "Alice A");

  // The other order is untouched.
  assert.equal([...db.links.values()].length, 1);
});

test("duplicate Start from the same chat is idempotent", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);

  const service = createService(db);
  const first = await service.claimByToken(token, { chatId: CUSTOMER_CHAT, telegramName: "Alice" });
  assert.equal(first.kind, "claimed");
  const [storedBefore] = [...db.links.values()];
  const connectedAt = storedBefore.connectedAt;

  const second = await service.claimByToken(token, { chatId: CUSTOMER_CHAT, telegramName: "Alice" });
  assert.equal(second.kind, "already-connected-same-chat");
  assert.equal(second.order.orderId, ORDER_A);

  const [storedAfter] = [...db.links.values()];
  assert.equal(storedAfter.connectedAt, connectedAt, "the row must not change on duplicate Start");
});

test("a different Telegram chat cannot claim or reuse a consumed token", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);

  const service = createService(db);
  const first = await service.claimByToken(token, { chatId: CUSTOMER_CHAT, telegramName: "Alice" });
  assert.equal(first.kind, "claimed");

  const stolen = await service.claimByToken(token, { chatId: OTHER_CHAT, telegramName: "Mallory" });
  assert.equal(stolen.kind, "rejected");
  assert.equal(stolen.order, null, "rejections must not leak the order");

  const [stored] = [...db.links.values()];
  assert.equal(stored.chatId, CUSTOMER_CHAT, "the original binding must survive");
});

test("concurrent Starts produce exactly one claim (conditional update semantics)", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const service = createService(db);

  const [first, second] = await Promise.all([
    service.claimByToken(token, { chatId: CUSTOMER_CHAT, telegramName: "A" }),
    service.claimByToken(token, { chatId: OTHER_CHAT, telegramName: "B" }),
  ]);

  // Exactly one chat wins; the other (a different chat) is plainly rejected.
  const claimed = [first, second].filter((outcome) => outcome.kind === "claimed");
  const rejected = [first, second].filter((outcome) => outcome.kind === "rejected");
  assert.equal(claimed.length, 1, "exactly one chat must win the token");
  assert.equal(rejected.length, 1);
  const [stored] = [...db.links.values()];
  assert.equal(
    stored.chatId,
    first.kind === "claimed" ? CUSTOMER_CHAT : OTHER_CHAT,
    "the winner's chat is the stored binding",
  );
});

/* --------------------------------------------------------------------------
   8-9. Customer ack + staff order information
   -------------------------------------------------------------------------- */

test("customer ack names the order and asks them to wait", () => {
  const ack = formatCustomerAckMessage(ORDER_A);
  assert.match(ack, /DKC-2026-1008-48213/);
  assert.match(ack, /Please wait for the devKitCat team to respond\./);
  assert.ok(!ack.includes("+855"), "customer-facing messages must not carry the phone number");
});

test("connection notice carries order number, customer, phone, items, total, and reply instructions", () => {
  const notice = formatTelegramConnectionNotice({
    orderId: ORDER_A,
    customerName: "Alice Developer",
    customerEmail: "alice@example.com",
    customerPhone: "+855 12 345 678",
    items: [{ quantity: 2, productTitle: "ProSave System", unitPrice: "15.00" }],
    total: "30.00",
    currency: "USD",
    status: "PENDING_PAYMENT",
    telegramName: "Alice",
  });
  assert.match(notice, /ORDER CONNECTED ON TELEGRAM/);
  assert.match(notice, /DKC-2026-1008-48213/);
  assert.match(notice, /Alice Developer/);
  assert.match(notice, /\+855 12 345 678/);
  assert.match(notice, /2x ProSave System/);
  assert.match(notice, /\$30\.00 USD/);
  assert.match(notice, /Reply to this message/);
});

test("staff relay output is HTML-escaped for customer-controlled text", () => {
  const relay = formatCustomerRelayToStaff(
    { orderId: ORDER_A, customerName: "Alice <A>", customerPhone: "+855 <12>", otherOrderRefs: [] },
    "<script>alert(1)</script> & how do I pay?",
  );
  assert.doesNotMatch(relay, /<script>/);
  assert.match(relay, /&lt;script&gt;/);
  assert.match(relay, /&amp;/);
});

/* --------------------------------------------------------------------------
   10-15. Webhook: relay, native Reply routing, chat authorization, dedup
   -------------------------------------------------------------------------- */

test("a connected customer's text is relayed to the staff chat with reply mapping", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  await processor.handleUpdate(tgUpdate(2, customerMessage(51, "Hi, how do I pay?")));

  const relaySends = telegram.sendsTo(STAFF_CHAT_ID);
  assert.equal(relaySends.length, 2, "connection notice + customer relay");
  const relay = relaySends[1];
  assert.match(relay.text, /CUSTOMER MESSAGE/);
  assert.match(relay.text, /DKC-2026-1008-48213/);
  assert.match(relay.text, /Alice Developer/);
  assert.match(relay.text, /\+855 12 345 678/);
  assert.match(relay.text, /Hi, how do I pay\?/);

  // The relayed message id is mapped so a native Reply can resolve it.
  const service = createService(db);
  const resolved = await service.resolveStaffRelay(STAFF_CHAT_ID, relay.sentMessageId);
  assert.ok(resolved.ok && resolved.value, "the relayed staff message must be reply-mappable");
  assert.equal(resolved.value.chatId, CUSTOMER_CHAT);
  assert.equal(resolved.value.orderId, ORDER_A);
});

test("native Telegram Reply to a relayed message routes to the correct customer chat", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  await processor.handleUpdate(tgUpdate(2, customerMessage(51, "Hi, how do I pay?")));

  const relayCall = telegram.calls.find((call) => call.text.includes("CUSTOMER MESSAGE"));
  assert.ok(relayCall?.sentMessageId, "the relay must have a Telegram message id");

  // The owner taps Reply on that exact message in the staff chat.
  await processor.handleUpdate(
    tgUpdate(3, staffReplyMessage(77, Number(relayCall.sentMessageId), "You can pay $20 via ABA.")),
  );

  const customerSends = telegram.sendsTo(CUSTOMER_CHAT);
  const staffReply = customerSends.find((call) => call.text.includes("ABA"));
  assert.ok(staffReply, "the admin's text must reach the customer chat");
  assert.equal(staffReply.text, "You can pay $20 via ABA.", "the reply is passed through verbatim");
});

test("staff Reply confirmation is threaded back into the staff chat", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  // Replying to the connection notice itself must also route.
  const notice = telegram.calls.find((call) => call.text.includes("ORDER CONNECTED ON TELEGRAM"));

  await processor.handleUpdate(tgUpdate(2, staffReplyMessage(70, Number(notice.sentMessageId), "Hello!")));
  const confirmations = telegram.calls.filter(
    (call) => call.op === "send" && call.text.includes("Reply delivered"),
  );
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].chatId, STAFF_CHAT_ID);
  assert.equal(
    confirmations[0].options.replyToMessageId,
    notice.sentMessageId,
    "the confirmation must thread under the admin's message",
  );
});

test("replies from a chat other than the configured staff chat are ignored", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  const sendsBefore = telegram.calls.length;

  // A stranger replies to "message id 1001" from their own private chat: even
  // if a relay row existed with that id for the staff chat, this chat is not
  // the staff chat, so it takes the customer paths instead.
  await processor.handleUpdate(
    tgUpdate(2, {
      message_id: 60,
      chat: { id: Number(OTHER_CHAT), type: "private" },
      from: { id: 11, first_name: "Mallory" },
      text: "pretend to be admin",
      reply_to_message: { message_id: 1001 },
    }),
  );

  const newSends = telegram.calls.slice(sendsBefore);
  assert.deepEqual(
    newSends.map((call) => call.chatId),
    [OTHER_CHAT],
    "the impostor chat may only ever reach its own hint",
  );
  assert.match(newSends[0].text, /Start Telegram/, "no admin reply was delivered");
  assert.equal(
    telegram.sendsTo(CUSTOMER_CHAT).filter((call) => call.text.includes("pretend")).length,
    0,
  );
});

test("staff can reply to an older relayed message, not just the newest one", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  await processor.handleUpdate(tgUpdate(2, customerMessage(51, "first question")));
  await processor.handleUpdate(tgUpdate(3, customerMessage(52, "second question")));

  // The owner replies to the FIRST (older) relay, not the newest.
  const olderRelay = telegram.calls.find((call) => call.text.includes("first question"));
  const newerRelay = telegram.calls.find((call) => call.text.includes("second question"));
  assert.ok(olderRelay && newerRelay);

  const before = telegram.sendsTo(CUSTOMER_CHAT).filter((call) => call.text.includes("older"));
  await processor.handleUpdate(
    tgUpdate(4, staffReplyMessage(80, Number(olderRelay.sentMessageId), "answering the older message")),
  );

  const delivered = telegram.sendsTo(CUSTOMER_CHAT).filter((call) =>
    call.text.includes("answering the older message"),
  );
  assert.equal(delivered.length - before.length, 1, "old mappings must keep working");
});

test("staff replies to unknown or non-relayed messages are ignored", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  const sendsBefore = telegram.calls.length;

  await processor.handleUpdate(tgUpdate(2, staffReplyMessage(71, 999999, "reply to nothing")));
  await processor.handleUpdate(tgUpdate(3, {
    message_id: 72,
    chat: { id: Number(STAFF_CHAT_ID), type: "supergroup" },
    from: { id: 9, first_name: "Owner" },
    text: "a normal staff message with no reply target",
  }));

  const newSends = telegram.calls.slice(sendsBefore);
  assert.equal(newSends.filter((call) => call.chatId === CUSTOMER_CHAT).length, 0);
});

test("a duplicate webhook update does not relay twice", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  const update = tgUpdate(42, customerMessage(50, `/start ${token}`));
  await processor.handleUpdate(update);
  await processor.handleUpdate(update);
  await processor.handleUpdate(update);

  assert.equal(telegram.sendsTo(STAFF_CHAT_ID).length, 1, "connection notice must be sent once");
  assert.equal(telegram.sendsTo(CUSTOMER_CHAT).length, 1, "customer ack must be sent once");
});

test("non-text customer messages are forwarded to staff and mapped for replies", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  const callsBefore = telegram.calls.length;
  await processor.handleUpdate(
    tgUpdate(2, {
      message_id: 55,
      chat: { id: Number(CUSTOMER_CHAT), type: "private" },
      from: { id: 7, first_name: "Alice" },
      photo: [[{ file_id: "x" }]],
    }),
  );

  const forwards = telegram.calls.slice(callsBefore).filter((call) => call.op === "forward");
  assert.equal(forwards.length, 1);
  assert.equal(forwards[0].toChatId, STAFF_CHAT_ID);
  assert.equal(forwards[0].fromChatId, CUSTOMER_CHAT);
  assert.equal(forwards[0].messageId, "55");

  // Both the forward and the context line are mapped.
  const service = createService(db);
  const forwardCall = telegram.calls.find((call) => call.op === "forward");
  const noticeCall = telegram.calls.find(
    (call) => typeof call.text === "string" && call.text.includes("CUSTOMER ATTACHMENT"),
  );
  const forwardMapped = await service.resolveStaffRelay(STAFF_CHAT_ID, forwardCall.sentMessageId);
  const noticeMapped = await service.resolveStaffRelay(STAFF_CHAT_ID, noticeCall.sentMessageId);
  assert.ok(forwardMapped.ok && forwardMapped.value);
  assert.ok(noticeMapped.ok && noticeMapped.value);
});

/* --------------------------------------------------------------------------
   16-17. Failure isolation and destination control
   -------------------------------------------------------------------------- */

test("a failed customer ack stays retryable: the same update succeeds on retry exactly once", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  // First attempt: the Telegram API fails during the customer ack.
  telegram.failNextWith("NETWORK_ERROR");
  const first = await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  assert.equal(first, "failed", "a failed update must be reported as retryable");

  const [stored] = [...db.links.values()];
  assert.equal(stored.chatId, CUSTOMER_CHAT, "the claim must survive a failed ack send");
  assert.equal(telegram.sendsTo(CUSTOMER_CHAT).length, 0);
  assert.equal(telegram.sendsTo(STAFF_CHAT_ID).length, 0, "no staff message before the ack lands");

  // Telegram redelivers the SAME update: it now succeeds, with no duplicates.
  const second = await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  assert.equal(second, "processed");
  assert.equal(telegram.sendsTo(CUSTOMER_CHAT).length, 1, "exactly one customer ack");
  assert.equal(telegram.sendsTo(STAFF_CHAT_ID).length, 1, "exactly one connection notice");

  // A third delivery of the same update is a duplicate: ignored.
  const third = await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  assert.equal(third, "skipped");
  assert.equal(telegram.sendsTo(CUSTOMER_CHAT).length, 1);
  assert.equal(telegram.sendsTo(STAFF_CHAT_ID).length, 1);
});

test("a permanently undeliverable staff reply informs the admin instead of retrying forever", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  const notice = telegram.calls.find((call) => call.text.includes("ORDER CONNECTED ON TELEGRAM"));

  // The customer blocked the bot: HTTP 403 can never succeed on retry.
  telegram.failNextWith("HTTP_403");
  const outcome = await processor.handleUpdate(
    tgUpdate(2, staffReplyMessage(71, Number(notice.sentMessageId), "Are you there?")),
  );

  assert.equal(outcome, "processed", "a permanent failure must not stay retryable forever");
  const failureNotices = telegram.calls.filter((call) => call.text.includes("Could not deliver"));
  assert.equal(failureNotices.length, 1, "the admin must learn the reply did not arrive");
  assert.equal(failureNotices[0].chatId, STAFF_CHAT_ID);
  const [stored] = [...db.links.values()];
  assert.equal(stored.chatId, CUSTOMER_CHAT, "connection state must be untouched");
});

test("a transient staff-reply failure is retried and delivered exactly once", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  const notice = telegram.calls.find((call) => call.text.includes("ORDER CONNECTED ON TELEGRAM"));

  // First attempt: the delivery to the customer fails transiently.
  telegram.failNextWith("NETWORK_ERROR");
  const first = await processor.handleUpdate(
    tgUpdate(2, staffReplyMessage(71, Number(notice.sentMessageId), "Are you there?")),
  );
  assert.equal(first, "failed");
  assert.equal(
    telegram.sendsTo(CUSTOMER_CHAT).filter((call) => call.text.includes("Are you there?")).length,
    0,
    "the reply must not have been delivered",
  );
  assert.equal(telegram.calls.filter((call) => call.text.includes("Could not deliver")).length, 0);

  // Retry: delivered once, confirmed once.
  const second = await processor.handleUpdate(
    tgUpdate(2, staffReplyMessage(71, Number(notice.sentMessageId), "Are you there?")),
  );
  assert.equal(second, "processed");
  const deliveries = telegram.sendsTo(CUSTOMER_CHAT).filter((call) => call.text.includes("Are you there?"));
  assert.equal(deliveries.length, 1, "exactly one delivery to the customer");
  assert.equal(telegram.calls.filter((call) => call.text.includes("Reply delivered")).length, 1);
});

test("customers can never influence the destination chat of any bot message", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  db.addOrder({ id: ORDER_B, customerId: CUSTOMER_B });
  const tokenA = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  // The customer tries to smuggle a different destination into their text.
  await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${tokenA}`)));
  await processor.handleUpdate(
    tgUpdate(2, customerMessage(51, `please reply to chat ${OTHER_CHAT} instead`)),
  );

  for (const call of telegram.calls) {
    assert.ok(
      [STAFF_CHAT_ID, CUSTOMER_CHAT].includes(call.chatId),
      "every destination must come from stored state or the update's own chat",
    );
  }
  assert.equal(
    telegram.sendsTo(OTHER_CHAT).length,
    0,
    "a customer-supplied chat id must never become a destination",
  );
});

/* --------------------------------------------------------------------------
   Edge cases: hints, plain /start, rebind, two customers
   -------------------------------------------------------------------------- */

test("an unconnected private chat gets a hint and nothing about any order", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  await processor.handleUpdate(tgUpdate(1, customerMessage(50, "hello?")));
  await processor.handleUpdate(tgUpdate(2, customerMessage(51, "/start")));

  const sends = telegram.sendsTo(CUSTOMER_CHAT);
  assert.equal(sends.length, 2);
  for (const send of sends) {
    assert.match(send.text, /Start Telegram/);
    assert.ok(!send.text.includes("DKC-"), "no order reference may leak to an unconnected chat");
  }
  assert.equal(telegram.sendsTo(STAFF_CHAT_ID).length, 0);
});

test("plain /start from a connected chat re-acknowledges without resetting", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  const before = telegram.sendsTo(CUSTOMER_CHAT).length;
  await processor.handleUpdate(tgUpdate(2, customerMessage(51, "/start")));

  const sends = telegram.sendsTo(CUSTOMER_CHAT);
  assert.equal(sends.length, before + 1);
  assert.match(sends[sends.length - 1].text, /already connected to order DKC-2026-1008-48213/);
});

test("two customers connected simultaneously relay and reply independently", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  db.addOrder({ id: ORDER_B, customerId: CUSTOMER_B, customerPhone: "+1 555 555 0199" });
  const tokenA = await issueTokenForOrderA(db);

  const service = createService(db);
  const issueB = await service.issueLink(CUSTOMER_B, ORDER_B);
  assert.equal(issueB.ok, true);
  const tokenB = issueB.value.token;

  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${tokenA}`)));
  await processor.handleUpdate(
    tgUpdate(2, {
      message_id: 51,
      chat: { id: Number(OTHER_CHAT), type: "private" },
      from: { id: 8, first_name: "Bob" },
      text: `/start ${tokenB}`,
    }),
  );
  await processor.handleUpdate(tgUpdate(3, customerMessage(52, "Alice here")));
  await processor.handleUpdate(
    tgUpdate(4, {
      message_id: 53,
      chat: { id: Number(OTHER_CHAT), type: "private" },
      from: { id: 8, first_name: "Bob" },
      text: "Bob here",
    }),
  );

  const aliceRelay = telegram.calls.find((call) => call.text.includes("Alice here"));
  const bobRelay = telegram.calls.find((call) => call.text.includes("Bob here"));
  assert.equal(aliceRelay.chatId, STAFF_CHAT_ID);
  assert.equal(bobRelay.chatId, STAFF_CHAT_ID);
  assert.match(aliceRelay.text, /DKC-2026-1008-48213/);
  assert.match(bobRelay.text, /DKC-2026-1008-90001/);

  // Replies route to the right customer chats.
  const service2 = createService(db);
  const aliceMapping = await service2.resolveStaffRelay(STAFF_CHAT_ID, aliceRelay.sentMessageId);
  const bobMapping = await service2.resolveStaffRelay(STAFF_CHAT_ID, bobRelay.sentMessageId);
  assert.ok(aliceMapping.ok && bobMapping.ok);
  assert.equal(aliceMapping.value.chatId, CUSTOMER_CHAT);
  assert.equal(bobMapping.value.chatId, OTHER_CHAT);
});

test("one chat with two orders relays with both references and routes to the chat", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  db.addOrder({ id: ORDER_A2, customerId: CUSTOMER_A, total: "20.00" });
  const service = createService(db);

  const first = await service.issueLink(CUSTOMER_A, ORDER_A);
  const second = await service.issueLink(CUSTOMER_A, ORDER_A2);
  const tokenA = first.value.token;
  const tokenA2 = second.value.token;

  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${tokenA}`)));
  await processor.handleUpdate(tgUpdate(2, customerMessage(51, `/start ${tokenA2}`)));
  await processor.handleUpdate(tgUpdate(3, customerMessage(52, "which order is this about?")));

  const relay = telegram.calls.find((call) => call.text.includes("which order"));
  assert.match(relay.text, /DKC-2026-1008-48213|DKC-2026-1008-48214/);
  assert.match(relay.text, /Also connected to this chat/);
});

test("issuing while connected reports the connection; rebind clears it", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const service = createService(db);

  const first = await service.issueLink(CUSTOMER_A, ORDER_A);
  assert.equal(first.ok, true);
  await service.claimByToken(first.value.token, { chatId: CUSTOMER_CHAT, telegramName: "Alice" });

  // Plain issue: the existing connection is reported, not destroyed.
  const second = await service.issueLink(CUSTOMER_A, ORDER_A);
  assert.equal(second.ok, true);
  assert.equal(second.value.alreadyConnected, true);
  const [stored] = [...db.links.values()];
  assert.equal(stored.chatId, CUSTOMER_CHAT);

  // Explicit rebind (recovery): connection cleared, fresh token issued.
  const third = await service.issueLink(CUSTOMER_A, ORDER_A, { rebind: true });
  assert.equal(third.ok, true);
  assert.ok("token" in third.value && third.value.token, "rebind mints a fresh token");
  assert.notEqual(stored.tokenHash, hashLinkToken(first.value.token), "the old token is dead");
  assert.equal(stored.chatId, null, "rebind clears the chat binding");

  const reClaim = await service.claimByToken(third.value.token, {
    chatId: OTHER_CHAT,
    telegramName: "Mallory",
  });
  assert.equal(reClaim.kind, "claimed", "a new account may now take over");
});

test("issueLink refuses orders the customer does not own or that are not pending", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  db.addOrder({ id: ORDER_A2, customerId: CUSTOMER_A, status: "COMPLETE" });
  db.addOrder({ id: ORDER_B, customerId: CUSTOMER_B });
  const service = createService(db);

  const foreign = await service.issueLink(CUSTOMER_B, ORDER_A);
  assert.equal(foreign.ok, false);
  assert.equal(foreign.code, "NOT_FOUND");

  const settled = await service.issueLink(CUSTOMER_A, ORDER_A2);
  assert.equal(settled.ok, false);
  assert.equal(settled.code, "NOT_FOUND");

  const missing = await service.issueLink(CUSTOMER_A, "DKC-2026-1008-00000");
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "NOT_FOUND");
});

test("issuing rotates the token: only the newest link works", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const service = createService(db);

  const first = await service.issueLink(CUSTOMER_A, ORDER_A);
  const second = await service.issueLink(CUSTOMER_A, ORDER_A);
  assert.notEqual(first.value.token, second.value.token, "rotation must mint a new token");

  const [stored] = [...db.links.values()];
  assert.equal(stored.tokenHash, hashLinkToken(second.value.token));

  const oldClaim = await service.claimByToken(first.value.token, {
    chatId: CUSTOMER_CHAT,
    telegramName: "Alice",
  });
  assert.equal(oldClaim.kind, "rejected", "the rotated-away token must be dead");

  const newClaim = await service.claimByToken(second.value.token, {
    chatId: CUSTOMER_CHAT,
    telegramName: "Alice",
  });
  assert.equal(newClaim.kind, "claimed");
});

/* --------------------------------------------------------------------------
   Webhook request authorization and update parsing
   -------------------------------------------------------------------------- */

test("webhook secret check is exact, length-safe, and fails closed", () => {
  assert.equal(isAuthorizedWebhookRequest("good-secret", "good-secret"), true);
  assert.equal(isAuthorizedWebhookRequest("bad-secret", "good-secret"), false);
  assert.equal(isAuthorizedWebhookRequest("", "good-secret"), false);
  assert.equal(isAuthorizedWebhookRequest(null, "good-secret"), false);
  assert.equal(isAuthorizedWebhookRequest("good-secret", ""), false);
  assert.equal(isAuthorizedWebhookRequest("good-secret", undefined), false);
  assert.equal(isAuthorizedWebhookRequest(undefined, undefined), false);
});

test("update parsing keeps only message updates and extracts reply metadata", () => {
  const parsed = parseTelegramUpdate({
    update_id: 5,
    message: {
      message_id: 10,
      chat: { id: -1001234, type: "supergroup" },
      text: "hi",
      reply_to_message: { message_id: 9 },
      from: { first_name: "Own", last_name: "Er" },
    },
  });
  assert.equal(parsed.updateId, "5");
  assert.equal(parsed.message.messageId, "10");
  assert.equal(parsed.message.chatId, "-1001234");
  assert.equal(parsed.message.replyToMessageId, "9");
  assert.equal(parsed.message.fromName, "Own Er");

  // Edits, callbacks, channel posts, and shapeless payloads are not messages.
  for (const update of [
    { update_id: 6, edited_message: { message_id: 1, chat: { id: 1, type: "private" } } },
    { update_id: 7, callback_query: { id: "x" } },
    { update_id: 8, channel_post: { message_id: 1, chat: { id: -1, type: "channel" } } },
    { message: { message_id: 1, chat: { id: 1, type: "private" } } },
    null,
    "nope",
    { update_id: 9 },
  ]) {
    const ignored = parseTelegramUpdate(update);
    assert.equal(ignored.message, null, JSON.stringify(update));
  }
});

test("classification: staff chat first, private customer paths, everything else ignored", () => {
  const staffMessage = {
    messageId: "1",
    chatId: STAFF_CHAT_ID,
    chatType: "supergroup",
    text: "reply text",
    replyToMessageId: "9",
    fromName: "Owner",
  };
  const classifiedStaff = classifyMessage(staffMessage, STAFF_CHAT_ID);
  assert.equal(classifiedStaff.kind, "staff-reply");

  const staffNonReply = classifyMessage({ ...staffMessage, replyToMessageId: null }, STAFF_CHAT_ID);
  assert.equal(staffNonReply.kind, "ignore");

  const start = classifyMessage(
    { ...staffMessage, chatId: CUSTOMER_CHAT, chatType: "private", replyToMessageId: null, text: "/start AbCd1234567890123456789012345678901234567890" },
    STAFF_CHAT_ID,
  );
  assert.equal(start.kind, "customer-start");
  assert.equal(start.token, "AbCd1234567890123456789012345678901234567890");

  const bareStart = classifyMessage(
    { ...staffMessage, chatId: CUSTOMER_CHAT, chatType: "private", text: "/start" },
    STAFF_CHAT_ID,
  );
  assert.equal(bareStart.kind, "customer-start");
  assert.equal(bareStart.token, null);

  const media = classifyMessage(
    { ...staffMessage, chatId: CUSTOMER_CHAT, chatType: "private", text: null },
    STAFF_CHAT_ID,
  );
  assert.equal(media.kind, "customer-media");

  const group = classifyMessage(
    { ...staffMessage, chatId: "-2002", chatType: "group" },
    STAFF_CHAT_ID,
  );
  assert.equal(group.kind, "ignore");
});

test("unsupported chat types never reach customer or staff paths", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  await processor.handleUpdate(
    tgUpdate(1, {
      message_id: 10,
      chat: { id: -555, type: "channel" },
      text: `/start ${token}`,
    }),
  );
  assert.equal(telegram.calls.length, 0);
  assert.equal([...db.links.values()][0].chatId, null);
});


/* --------------------------------------------------------------------------
   Webhook retry safety: claim/lease/done ledger, retry without duplicates
   -------------------------------------------------------------------------- */

test("ledger semantics: claim, in-flight, done, release, and reclaim with markers", async () => {
  const db = createMockDb();
  const service = createService(db);

  const first = await service.claimUpdate("501");
  assert.equal(first.kind, "claimed");
  assert.equal(first.markers.customerMessageId, null);

  // A concurrent duplicate sees a live lease and skips.
  const concurrent = await service.claimUpdate("501");
  assert.equal(concurrent.kind, "in-flight");

  // Markers written while processing are preserved for a later reclaim.
  assert.equal(await service.recordUpdateOutbound("501", { customerMessageId: "77" }), true);
  assert.equal(await service.completeUpdate("501"), true);

  // A completed update is permanently deduplicated.
  const afterDone = await service.claimUpdate("501");
  assert.equal(afterDone.kind, "done");

  // A failed attempt releases its lease; a retry steals it and keeps markers.
  const fresh = await service.claimUpdate("502");
  assert.equal(fresh.kind, "claimed");
  assert.equal(await service.recordUpdateOutbound("502", { staffReplyMessageId: "88" }), true);
  assert.equal(await service.releaseUpdate("502"), true);
  const reclaimed = await service.claimUpdate("502");
  assert.equal(reclaimed.kind, "reclaimed");
  assert.equal(reclaimed.attempts, 2);
  assert.equal(reclaimed.markers.staffReplyMessageId, "88");
});

test("an in-flight lease blocks processing until it expires, then a retry takes over", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  // Simulate another live delivery holding the lease.
  const service = createService(db);
  await service.claimUpdate("900");
  const blocked = await processor.handleUpdate(tgUpdate(900, customerMessage(60, "hello?")));
  assert.equal(blocked, "skipped");
  assert.equal(telegram.calls.length, 0, "a lease held elsewhere must not be processed twice");

  // Once the lease expires (crashed holder), the redelivery takes over.
  db.events.get("900").leaseUntil = new Date(Date.now() - 1000);
  const taken = await processor.handleUpdate(tgUpdate(900, customerMessage(60, "hello?")));
  assert.equal(taken, "processed");
  assert.equal(telegram.sendsTo(CUSTOMER_CHAT).length, 1);
});

test("first attempt fails mid-relay: retry sends exactly one staff message and mapping", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));

  // Attempt 1: the relay send to staff fails transiently.
  telegram.failNextWith("NETWORK_ERROR");
  const first = await processor.handleUpdate(tgUpdate(2, customerMessage(51, "Hi, how do I pay?")));
  assert.equal(first, "failed");
  assert.equal(telegram.sendsTo(STAFF_CHAT_ID).length, 1, "only the connection notice so far");

  // Attempt 2 (Telegram redelivery of the SAME update): succeeds.
  const second = await processor.handleUpdate(tgUpdate(2, customerMessage(51, "Hi, how do I pay?")));
  assert.equal(second, "processed");

  const relays = telegram.sendsTo(STAFF_CHAT_ID).filter((call) => call.text.includes("CUSTOMER MESSAGE"));
  assert.equal(relays.length, 1, "the retry must not duplicate the staff relay");

  const service = createService(db);
  const mapping = await service.resolveStaffRelay(STAFF_CHAT_ID, relays[0].sentMessageId);
  assert.ok(mapping.ok && mapping.value);
  assert.equal(mapping.value.chatId, CUSTOMER_CHAT);
  assert.equal(
    [...db.relays.values()].filter((row) => row.sourceKind === "relay").length,
    1,
    "exactly one relay mapping row",
  );

  // A third delivery is a plain duplicate.
  const third = await processor.handleUpdate(tgUpdate(2, customerMessage(51, "Hi, how do I pay?")));
  assert.equal(third, "skipped");
  assert.equal(telegram.sendsTo(STAFF_CHAT_ID).length, 2);
});

test("relay delivered but completion fails: retry does not duplicate the staff message", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  const sendsAfterConnect = telegram.sendsTo(STAFF_CHAT_ID).length;

  // Event writes for the relay update: 1 claim, 2 completion. Fail the completion
  // AFTER the relay was sent and mapped (the crash-before-done window).
  db.failEventWriteAt(2);
  const first = await processor.handleUpdate(tgUpdate(2, customerMessage(51, "payment?")));
  assert.equal(first, "failed");
  assert.equal(telegram.sendsTo(STAFF_CHAT_ID).length, sendsAfterConnect + 1);

  // Retry: the source-keyed mapping makes the processor skip the re-send.
  const second = await processor.handleUpdate(tgUpdate(2, customerMessage(51, "payment?")));
  assert.equal(second, "processed");
  assert.equal(telegram.sendsTo(STAFF_CHAT_ID).length, sendsAfterConnect + 1, "no duplicate relay");
});

test("reply delivered but completion fails: retry does not duplicate the customer message", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  const notice = telegram.calls.find((call) => call.text.includes("ORDER CONNECTED ON TELEGRAM"));

  // Event writes for the staff-reply update: 1 claim, 2 reply marker, 3 completion.
  db.failEventWriteAt(3);
  const first = await processor.handleUpdate(
    tgUpdate(2, staffReplyMessage(71, Number(notice.sentMessageId), "You can pay via ABA.")),
  );
  assert.equal(first, "failed");
  assert.equal(telegram.sendsTo(CUSTOMER_CHAT).filter((c) => c.text.includes("ABA")).length, 1);

  // Retry: the reply marker makes the processor skip the re-delivery.
  const second = await processor.handleUpdate(
    tgUpdate(2, staffReplyMessage(71, Number(notice.sentMessageId), "You can pay via ABA.")),
  );
  assert.equal(second, "processed");
  assert.equal(
    telegram.sendsTo(CUSTOMER_CHAT).filter((c) => c.text.includes("ABA")).length,
    1,
    "the customer must never receive the reply twice",
  );
});

test("concurrent duplicate deliveries: exactly one processing path succeeds", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  const staffSendsBefore = telegram.sendsTo(STAFF_CHAT_ID).length;

  const duplicate = tgUpdate(2, customerMessage(51, "Hi, how do I pay?"));
  const outcomes = await Promise.all([
    processor.handleUpdate(duplicate),
    processor.handleUpdate(duplicate),
  ]);

  assert.deepEqual(outcomes.sort(), ["processed", "skipped"]);
  const relays = telegram.sendsTo(STAFF_CHAT_ID).filter((call) => call.text.includes("CUSTOMER MESSAGE"));
  assert.equal(relays.length, 1, "only one relay may be produced");
  assert.equal(
    [...db.relays.values()].filter((row) => row.sourceKind === "relay").length,
    1,
    "only one mapping row may exist",
  );
  assert.equal(telegram.sendsTo(STAFF_CHAT_ID).length, staffSendsBefore + 1);
});

test("retries of a connection update fill gaps instead of duplicating: ack crash window", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  // Crash after the customer ack was delivered but before the update completed.
  // Event writes: 1 claim, 2 ack marker, 3 completion.
  db.failEventWriteAt(3);
  const first = await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  assert.equal(first, "failed");
  assert.equal(telegram.sendsTo(CUSTOMER_CHAT).length, 1, "ack was delivered");
  assert.equal(telegram.sendsTo(STAFF_CHAT_ID).length, 1, "notice was delivered");

  // Retry: nothing is re-sent; the update simply completes.
  const second = await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  assert.equal(second, "processed");
  assert.equal(telegram.sendsTo(CUSTOMER_CHAT).length, 1, "no duplicate ack");
  assert.equal(telegram.sendsTo(STAFF_CHAT_ID).length, 1, "no duplicate notice");
});

test("unavailable event ledger fails the update instead of silently dropping it", async () => {
  const db = createMockDb();
  db.addOrder({ id: ORDER_A, customerId: CUSTOMER_A });
  const token = await issueTokenForOrderA(db);
  const telegram = createMockTelegram();
  const processor = createProcessor(db, telegram);

  // The claim write itself fails (database blip): the update must stay
  // retryable, not be dropped — otherwise Telegram would never redeliver.
  db.failNextEventWrite();
  const outcome = await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  assert.equal(outcome, "failed");
  assert.equal(telegram.calls.length, 0, "nothing is sent without a claim");

  const second = await processor.handleUpdate(tgUpdate(1, customerMessage(50, `/start ${token}`)));
  assert.equal(second, "processed");
  assert.equal(telegram.sendsTo(CUSTOMER_CHAT).length, 1);
});

/* --------------------------------------------------------------------------
   Webhook route behavior: 401 before everything, 500 only as the retry signal
   -------------------------------------------------------------------------- */

test("route: invalid secret is 401 before parsing; authorized garbage is 200; failures are 500", async () => {
  const previousSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_WEBHOOK_SECRET = "route-test-secret";
  try {
    const { POST } = await import("../src/app/api/telegram/webhook/route.ts");
    const request = (body, secret) =>
      new Request("https://devkitcat.test/api/telegram/webhook", {
        method: "POST",
        headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {},
        body,
      });

    // Wrong and missing secrets: 401 before the body is even read.
    const wrong = await POST(request("{}", "wrong-secret"));
    assert.equal(wrong.status, 401);
    const missing = await POST(request("{}"));
    assert.equal(missing.status, 401);

    // Authorized but unparseable body: nothing retryable, answer 200.
    const garbage = await POST(request("not-json", "route-test-secret"));
    assert.equal(garbage.status, 200);

    // Authorized, parseable, but no database configured in this test process:
    // the update cannot be processed, so the route must answer 500 so Telegram
    // retries instead of dropping the message.
    const update = await POST(
      request(JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: 1, type: "private" }, text: "hi" } }), "route-test-secret"),
    );
    assert.equal(update.status, 500);
  } finally {
    if (previousSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
    else process.env.TELEGRAM_WEBHOOK_SECRET = previousSecret;
  }
});

/* --------------------------------------------------------------------------
   18. Nothing unsafe is exposed
   -------------------------------------------------------------------------- */

test("rejections, hints, and deep links never expose order data", () => {
  // The wording may say "your order page" but must never name or number one.
  assert.ok(!CUSTOMER_LINK_REJECTED_MESSAGE.includes("DKC-"));
  assert.ok(!/DKC-\d{4}-\d{4}-\d{5}/.test(CUSTOMER_LINK_REJECTED_MESSAGE));

  const token = generateLinkToken();
  const link = buildTelegramDeepLink("devKitCatBot", token);
  assert.equal(link, `https://t.me/devKitCatBot?start=${token}`);
  assert.ok(!link.includes("DKC-"));

  assert.equal(buildTelegramDeepLink("bad name!", token), null);
  assert.equal(buildTelegramDeepLink("devKitCatBot", "short"), null);
  assert.equal(truncateCustomerText("x".repeat(3600)).length, 3501);
});

test("allowlisted telegram notices resolve and reject everything else", () => {
  assert.equal(resolveTelegramNotice("connected"), "connected");
  assert.equal(resolveTelegramNotice("unavailable"), "unavailable");
  assert.equal(resolveTelegramNotice("error"), "error");
  assert.equal(resolveTelegramNotice(undefined), null);
  assert.equal(resolveTelegramNotice(["error", "connected"]), "error");
  assert.equal(resolveTelegramNotice("drop table"), null);
});

test("bot configuration and username normalization stay server-side concerns", () => {
  assert.equal(isTelegramBotConfigured({ TELEGRAM_BOT_TOKEN: " x " }), true);
  assert.equal(isTelegramBotConfigured({}), false);
});

/* --------------------------------------------------------------------------
   19-20. Source safety and existing behavior
   -------------------------------------------------------------------------- */

test("Telegram secrets never appear in client-reachable or page sources", async () => {
  const clientFiles = [
    "src/components/checkout/CheckoutSubmit.tsx",
    "src/components/cart/CartProvider.tsx",
    "src/components/cart/CartDrawer.tsx",
    "src/components/cart/CartButton.tsx",
  ];
  for (const file of clientFiles) {
    const src = await readSource(file);
    for (const secret of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_WEBHOOK_SECRET"]) {
      assert.ok(!src.includes(secret), `${file} must not reference ${secret}`);
    }
  }

  // The order page renders only public state; the token lives in the redirect
  // target of the Server Function, never in rendered HTML.
  const page = await readSource("src/app/account/purchases/[id]/page.tsx");
  for (const secret of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_WEBHOOK_SECRET", "generateLinkToken"]) {
    assert.ok(!page.includes(secret), `order page must not reference ${secret}`);
  }
});

test("the webhook authorizes before it parses and uses 500 only as the retry signal", async () => {
  const route = await readSource("src/app/api/telegram/webhook/route.ts");
  const authorizeIndex = route.indexOf("isAuthorizedWebhookRequest");
  const parseIndex = route.indexOf("request.json()");
  assert.ok(authorizeIndex !== -1, "the route must check the webhook secret");
  assert.ok(parseIndex !== -1);
  assert.ok(authorizeIndex < parseIndex, "authorization must happen before body parsing");
  assert.match(route, /status: 401/);
  assert.match(route, /status: 200/);
  // 500 is the deliberate "left retryable" answer that makes Telegram redeliver;
  // the body is always empty so no detail ever leaks.
  assert.match(route, /status: outcome === "failed" \? 500 : 200/);
  assert.doesNotMatch(route, /status: 502/);
});

test("checkout no longer collects a Telegram username", async () => {
  const form = await readSource("src/components/checkout/CheckoutSubmit.tsx");
  assert.ok(!form.includes("telegramHandle"), "the checkout form must not collect a handle");
  assert.ok(!form.includes("checkout-telegram"));

  const action = await readSource("src/lib/server/cart-actions.ts");
  assert.ok(!action.includes('formData.get("telegramHandle")'));
});

test("the order page exposes the Start Telegram CTA, connected state, and the unconfigured fallback", async () => {
  const page = await readSource("src/app/account/purchases/[id]/page.tsx");
  assert.match(page, /Start Telegram/);
  assert.match(page, /Telegram connected ✓/);
  assert.match(page, /startTelegramConnectionAction/);
  assert.match(page, /rebind/);
  assert.match(page, /NEXT_PUBLIC_TELEGRAM_CONTACT_URL/, "unconfigured deployments keep the fallback");
  assert.match(page, /Continue on Telegram/);
  assert.match(page, /Order received/);
});
