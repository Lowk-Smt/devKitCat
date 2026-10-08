import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { escapeTelegramHtml } from "./telegram";

/**
 * Framework-free policy for the order <-> Telegram connection: token shape and
 * hashing, link expiry, deep-link construction, webhook request authorization,
 * /start parsing, and the exact wording of every message either side can
 * receive.
 *
 * Mirrors `cart-core.ts`: nothing here touches Next.js, Prisma, or a request
 * context, so the whole surface is unit-testable and every rule is stated once.
 *
 * Three properties are load-bearing:
 *
 * 1. **Tokens are opaque and one-way.** A link token is 32 CSPRNG bytes,
 *    base64url — never derived from an order id — and only its SHA-256 hash is
 *    ever stored or logged, so the deep link cannot be reconstructed from the
 *    database and the database cannot be replayed as a link.
 * 2. **Refusals never describe orders.** Unknown, expired, and stolen tokens
 *    get one identical message, so a bot reply reveals nothing about order
 *    existence or state.
 * 3. **Reply routing is database state, not message text.** Customer messages
 *    never influence where a staff reply is delivered; only a stored
 *    relay-mapping row can resolve one.
 */

/** 32 bytes of entropy, base64url encoded — the session token's own format. */
export const TELEGRAM_LINK_TOKEN_BYTES = 32;
const TELEGRAM_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const TELEGRAM_LINK_TTL_DAYS_DEFAULT = 7;
export const TELEGRAM_LINK_TTL_DAYS_MIN = 1;
export const TELEGRAM_LINK_TTL_DAYS_MAX = 30;
export const TELEGRAM_LINK_TTL_DAYS_ENV_VAR = "TELEGRAM_LINK_TTL_DAYS";

/**
 * How long one webhook delivery owns an update while processing it. Covers the
 * worst case of a handler (a few database writes plus up to three Bot API
 * calls at 5s timeout each); an expired lease lets a Telegram redelivery steal
 * the update instead of waiting forever after a crashed attempt.
 */
export const TELEGRAM_UPDATE_LEASE_MS = 90_000;

/** Environment variables that must never appear in client bundles or logs. */
export const TELEGRAM_SERVER_ENV_VARS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "TELEGRAM_WEBHOOK_SECRET",
] as const;

/** Env vars that are safe to expose (public values) — documented, not secret. */
export const TELEGRAM_PUBLIC_ENV_VARS = [
  "TELEGRAM_BOT_USERNAME",
  "NEXT_PUBLIC_TELEGRAM_CONTACT_URL",
  TELEGRAM_LINK_TTL_DAYS_ENV_VAR,
] as const;

/** Generates one raw deep-link token. The raw value lives only in the link URL. */
export function generateLinkToken(): string {
  return randomBytes(TELEGRAM_LINK_TOKEN_BYTES).toString("base64url");
}

/** The stored form of a token: SHA-256 hex. The raw token is never persisted. */
export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isValidLinkToken(value: unknown): value is string {
  return typeof value === "string" && TELEGRAM_LINK_TOKEN_PATTERN.test(value);
}

/** Resolves the link lifetime in days from env, failing closed to the default. */
export function resolveLinkTtlDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[TELEGRAM_LINK_TTL_DAYS_ENV_VAR]?.trim();
  if (!raw || !/^\d{1,3}$/.test(raw)) return TELEGRAM_LINK_TTL_DAYS_DEFAULT;
  const days = Number(raw);
  if (!Number.isSafeInteger(days) || days < TELEGRAM_LINK_TTL_DAYS_MIN || days > TELEGRAM_LINK_TTL_DAYS_MAX) {
    return TELEGRAM_LINK_TTL_DAYS_DEFAULT;
  }
  return days;
}

export function linkExpiryFromNow(now: Date, env: NodeJS.ProcessEnv = process.env): Date {
  return new Date(now.getTime() + resolveLinkTtlDays(env) * 24 * 60 * 60 * 1000);
}

/**
 * Builds `https://t.me/<username>?start=<token>`. The URL carries the opaque
 * token and nothing else — no order id, no customer data.
 */
export function buildTelegramDeepLink(botUsername: string, token: string): string | null {
  const username = botUsername.trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) return null;
  if (!isValidLinkToken(token)) return null;
  return `https://t.me/${username}?start=${token}`;
}

/** True when the deployment has the server-side credentials the bot needs. */
export function isTelegramBotConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN?.trim());
}

/** The staff chat id from env, trimmed; null when unset (staff routing off). */
export function resolveStaffChatId(env: NodeJS.ProcessEnv = process.env): string | null {
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  return chatId ? chatId : null;
}

/**
 * Webhook authorization: the request header must equal the configured secret.
 * Compared via SHA-256 digests with timingSafeEqual, so mismatched lengths are
 * comparable and the comparison is not timing-observable.
 */
export function isAuthorizedWebhookRequest(
  providedHeader: string | null | undefined,
  expectedSecret: string | null | undefined,
): boolean {
  const provided = providedHeader?.trim() ?? "";
  const expected = expectedSecret?.trim() ?? "";
  if (!provided || !expected) return false;
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

/* Update parsing
   -------------------------------------------------------------------------- */

export interface TelegramIncomingMessage {
  readonly messageId: string;
  readonly chatId: string;
  readonly chatType: string;
  /** Trimmed message text, when the update carries any. */
  readonly text: string | null;
  /** True when the update is a reply to another message in the same chat. */
  readonly replyToMessageId: string | null;
  /** Sender's display name, when Telegram provides one. */
  readonly fromName: string | null;
}

/**
 * Reduces one raw Telegram update to the only parts the webhook may act on.
 * Anything that is not a `message` update (edits, callback queries, channel
 * posts, …) or an update without an id yields no message and is ignored by the
 * caller.
 */
export function parseTelegramUpdate(update: unknown): {
  updateId: string | null;
  message: TelegramIncomingMessage | null;
} {
  if (typeof update !== "object" || update === null) {
    return { updateId: null, message: null };
  }

  const record = update as Record<string, unknown>;
  const rawUpdateId = record.update_id;
  if (typeof rawUpdateId !== "number" && typeof rawUpdateId !== "string") {
    return { updateId: null, message: null };
  }
  if (typeof rawUpdateId === "number" && !Number.isSafeInteger(rawUpdateId)) {
    return { updateId: null, message: null };
  }

  const rawMessage = record.message;
  if (typeof rawMessage !== "object" || rawMessage === null) {
    return { updateId: String(rawUpdateId), message: null };
  }

  const message = rawMessage as Record<string, unknown>;
  const rawChat = message.chat;
  if (typeof rawChat !== "object" || rawChat === null) {
    return { updateId: String(rawUpdateId), message: null };
  }

  const chat = rawChat as Record<string, unknown>;
  const chatId = typeof chat.id === "number" || typeof chat.id === "string" ? String(chat.id) : null;
  const chatType = typeof chat.type === "string" ? chat.type : "";
  const messageId =
    typeof message.message_id === "number" || typeof message.message_id === "string"
      ? String(message.message_id)
      : null;
  if (!chatId || chatId.length > 32 || !messageId || messageId.length > 32) {
    return { updateId: String(rawUpdateId), message: null };
  }

  const text = typeof message.text === "string" ? message.text.trim() : null;
  const rawReply = message.reply_to_message;
  const replyToMessageId =
    typeof rawReply === "object" && rawReply !== null
      ? (() => {
          const replyId = (rawReply as Record<string, unknown>).message_id;
          return typeof replyId === "number" || typeof replyId === "string"
            ? String(replyId).slice(0, 32)
            : null;
        })()
      : null;

  const rawFrom = message.from;
  const fromName =
    typeof rawFrom === "object" && rawFrom !== null
      ? (() => {
          const from = rawFrom as Record<string, unknown>;
          const first = typeof from.first_name === "string" ? from.first_name.trim() : "";
          const last = typeof from.last_name === "string" ? from.last_name.trim() : "";
          return `${first} ${last}`.trim().slice(0, 120) || null;
        })()
      : null;

  return {
    updateId: String(rawUpdateId),
    message: { messageId, chatId, chatType, text, replyToMessageId, fromName },
  };
}

export type ClassifiedUpdate =
  | { readonly kind: "ignore"; readonly reason: string }
  /** `/start` from a private chat; `token` is null for a bare `/start`. */
  | { readonly kind: "customer-start"; readonly chatId: string; readonly fromName: string | null; readonly token: string | null }
  /** Ordinary text from a connected-or-hoping customer chat. */
  | { readonly kind: "customer-text"; readonly chatId: string; readonly text: string }
  /** Any non-text customer message (photo, sticker, voice, …). */
  | { readonly kind: "customer-media"; readonly chatId: string; readonly messageId: string }
  /** A reply from inside the configured staff chat, targeted at a relayed message. */
  | { readonly kind: "staff-reply"; readonly chatId: string; readonly replyToMessageId: string; readonly text: string };

/** Longest customer text we embed in a relay; the staff message must fit 4096. */
export const CUSTOMER_RELAY_TEXT_LIMIT = 3500;

/**
 * Routes one parsed message. The staff chat is classified first so a staff
 * group can never be mistaken for a customer, and only *private* chats reach
 * the customer paths — a stranger's group cannot start tokens or trigger
 * relays. Staff messages that are not replies are ignored: there is no command
 * syntax to get wrong and no way to address a customer without a Reply target.
 */
export function classifyMessage(
  message: TelegramIncomingMessage,
  staffChatId: string | null,
): ClassifiedUpdate {
  if (staffChatId && message.chatId === staffChatId) {
    if (message.replyToMessageId && message.text) {
      return {
        kind: "staff-reply",
        chatId: message.chatId,
        replyToMessageId: message.replyToMessageId,
        text: message.text,
      };
    }
    return {
      kind: "ignore",
      reason: "staff chat message without a reply target (only Replies route)",
    };
  }

  if (message.chatType === "private") {
    if (message.text !== null && message.text.startsWith("/start")) {
      const parts = message.text.split(/\s+/);
      const token = parts.length > 1 && parts[1] ? parts[1].slice(0, 128) : null;
      return {
        kind: "customer-start",
        chatId: message.chatId,
        fromName: message.fromName,
        token,
      };
    }
    if (message.text) {
      return { kind: "customer-text", chatId: message.chatId, text: message.text };
    }
    return { kind: "customer-media", chatId: message.chatId, messageId: message.messageId };
  }

  return {
    kind: "ignore",
    reason: `unsupported chat type (${message.chatType || "unknown"})`,
  };
}

/** Truncates customer text for embedding in a staff relay. */
export function truncateCustomerText(text: string): string {
  return text.length > CUSTOMER_RELAY_TEXT_LIMIT
    ? `${text.slice(0, CUSTOMER_RELAY_TEXT_LIMIT)}…`
    : text;
}

/* Message wording
   -------------------------------------------------------------------------- */

/** Allowlisted `?telegram=` notices the order detail page can render. */
export type TelegramNoticeCode = "connected" | "unavailable" | "error";

/** Resolves the order page's `?telegram=` parameter against an allowlist. */
export function resolveTelegramNotice(
  value: string | string[] | undefined,
): TelegramNoticeCode | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (first === "connected" || first === "unavailable" || first === "error") {
    return first;
  }
  return null;
}

/** What the connected customer sees right after pressing Start. */
export function formatCustomerAckMessage(orderRef: string): string {
  return [
    `Thanks! We've received your order ${orderRef}.`,
    `Please wait for the devKitCat team to respond.`,
  ].join("\n");
}

/**
 * The only message an invalid, expired, already-used, or stolen token can
 * produce — identical for every failure so bot replies reveal nothing about
 * orders.
 */
export const CUSTOMER_LINK_REJECTED_MESSAGE =
  'This connection link is invalid or has already been used. Open your order page on devKitCat and tap "Start Telegram" to get a fresh link.';

/** Duplicate Start from the chat that already owns the connection. */
export function formatCustomerAlreadyConnectedMessage(orderRef: string): string {
  return `You're already connected to order ${orderRef}. Our team will respond here — no need to start again.`;
}

/** A private chat that writes before connecting gets this, and nothing else. */
export const CUSTOMER_NOT_CONNECTED_MESSAGE =
  'Hi! This bot handles devKitCat orders. Open your order page on devKitCat and tap "Start Telegram" to connect it first.';

export interface TelegramOrderSummary {
  readonly orderId: string;
  readonly customerName: string;
  readonly customerEmail: string;
  readonly customerPhone: string;
  readonly items: readonly { readonly quantity: number; readonly productTitle: string; readonly unitPrice: string }[];
  readonly total: string;
  readonly currency: string;
  readonly status: string;
  readonly telegramName: string | null;
}

/** Staff notice sent once, the moment an order is connected on Telegram. */
export function formatTelegramConnectionNotice(order: TelegramOrderSummary): string {
  const lines: string[] = [
    `<b>🔗 ORDER CONNECTED ON TELEGRAM</b>`,
    ``,
    `<b>Order:</b> <code>${escapeTelegramHtml(order.orderId)}</code>`,
    `<b>Customer:</b> ${escapeTelegramHtml(order.customerName)} (${escapeTelegramHtml(order.customerEmail)})`,
    `<b>Phone:</b> <code>${escapeTelegramHtml(order.customerPhone)}</code>`,
    ``,
    `<b>Items:</b>`,
  ];
  for (const item of order.items) {
    lines.push(`• ${item.quantity}x ${escapeTelegramHtml(item.productTitle)} — $${item.unitPrice}`);
  }
  lines.push(
    ``,
    `<b>Total:</b> $${order.total} ${escapeTelegramHtml(order.currency)}`,
    `<b>Status:</b> ${escapeTelegramHtml(order.status)}`,
  );
  if (order.telegramName) {
    lines.push(`<b>Telegram:</b> ${escapeTelegramHtml(order.telegramName)}`);
  }
  lines.push(``, `Reply to this message — or to any customer message below — to respond.`);
  return lines.join("\n");
}

export interface CustomerRelayContext {
  readonly orderId: string;
  readonly customerName: string;
  readonly customerPhone: string;
  /** Order refs for any *other* order connected to this same chat. */
  readonly otherOrderRefs: readonly string[];
}

/**
 * The staff-chat relay for one customer text message. Everything under
 * customer control is escaped; the structure is fixed so it reads the same
 * every time.
 */
export function formatCustomerRelayToStaff(
  context: CustomerRelayContext,
  customerText: string,
): string {
  const lines: string[] = [
    `<b>🔔 CUSTOMER MESSAGE</b>`,
    ``,
    `<b>Order:</b> <code>${escapeTelegramHtml(context.orderId)}</code>`,
    `<b>Customer:</b> ${escapeTelegramHtml(context.customerName)}`,
    `<b>Phone:</b> <code>${escapeTelegramHtml(context.customerPhone)}</code>`,
    ``,
    `💬 ${escapeTelegramHtml(truncateCustomerText(customerText))}`,
  ];
  if (context.otherOrderRefs.length > 0) {
    lines.push(
      ``,
      `Also connected to this chat: ${context.otherOrderRefs.map((ref) => escapeTelegramHtml(ref)).join(", ")}`,
    );
  }
  return lines.join("\n");
}

/**
 * Context line sent after a forwarded customer attachment, so staff know which
 * order it belongs to. The forward itself is what staff Reply to; this line is
 * mapped for replies too.
 */
export function formatCustomerMediaNoticeToStaff(context: CustomerRelayContext): string {
  return [
    `<b>📎 CUSTOMER ATTACHMENT</b>`,
    ``,
    `<b>Order:</b> <code>${escapeTelegramHtml(context.orderId)}</code>`,
    `<b>Customer:</b> ${escapeTelegramHtml(context.customerName)}`,
    `<b>Phone:</b> <code>${escapeTelegramHtml(context.customerPhone)}</code>`,
    ``,
    `The forwarded message below is from this customer. Reply to it to respond.`,
  ].join("\n");
}

/** Confirmation the admin sees after a Reply was delivered to the customer. */
export function formatStaffReplyConfirmation(orderRef: string): string {
  return `✅ Reply delivered to the customer (order ${orderRef}).`;
}

/** What the admin sees when the customer's chat could not be reached. */
export function formatStaffReplyFailure(orderRef: string): string {
  return `⚠️ Could not deliver your reply (order ${orderRef}). The customer may have blocked the bot — ask them to reconnect from their devKitCat order page.`;
}
