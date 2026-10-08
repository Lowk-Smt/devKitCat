import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  generateLinkToken,
  hashLinkToken,
  isValidLinkToken,
  linkExpiryFromNow,
} from "./telegram-link-core";

/**
 * Database service for the order <-> Telegram connection.
 *
 * Every entry point is keyed by verified data — a session customer id, a hashed
 * token, or a Telegram chat id Telegram itself delivered — never by anything a
 * request body could invent. The two security-critical invariants live here:
 *
 * * **Issuing** requires the order to belong to the signed-in customer and to
 *   still be unpaid, and replaces any previous link (new hashed token, cleared
 *   claim) unless the order is already connected and no reset was asked for.
 * * **Claiming** is a single conditional `updateMany` on the stored token hash:
 *   `chatId` must still be null and the link unexpired, so exactly one Telegram
 *   chat can ever win a token, concurrent Starts converge on one winner, and a
 *   second chat is rejected without a read-modify-write race.
 */

export type TelegramLinkLogger = (resource: string, code: string) => void;

export type TelegramLinkResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; code: TelegramLinkFailureCode };

export type TelegramLinkFailureCode =
  | "UNAVAILABLE"
  | "NOT_FOUND"
  | "NOT_CLAIMABLE"
  | "ERROR";

export interface IssuedLink {
  /** The raw token; it exists only inside the generated deep link. */
  token: string;
  expiresAt: Date;
}

/** Returned when the order is already connected and no rebind was requested. */
export interface ExistingConnection {
  alreadyConnected: true;
  connectedAt: Date;
  telegramName: string | null;
}

export interface TelegramConnectionView {
  state: "connected";
  connectedAt: Date;
  telegramName: string | null;
}

export interface OrderSnapshot {
  orderId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  items: { quantity: number; productTitle: string; unitPrice: string }[];
  total: string;
  currency: string;
  status: string;
}

export interface ClaimOutcome {
  kind: "claimed" | "already-connected-same-chat" | "rejected";
  /** The connection row this token belongs to; null on rejection. */
  linkId: string | null;
  /** The order this token belongs to; set for claimed and same-chat outcomes. */
  order: OrderSnapshot | null;
  telegramName: string | null;
}

export interface ConnectedOrderContext extends OrderSnapshot {
  linkId: string;
}

export interface ResolvedRelay {
  linkId: string;
  chatId: string;
  orderId: string;
}

const UNIQUE_VIOLATION_CODE = "P2002";

function getSafeErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_]{2,16}$/.test(error.code)
  ) {
    return error.code;
  }
  return "UNKNOWN";
}

const ORDER_SNAPSHOT_INCLUDE = {
  items: { orderBy: [{ position: "asc" }, { id: "asc" }] },
  customer: { select: { name: true, email: true } },
} satisfies Prisma.OrderInclude;

type OrderSnapshotRow = Prisma.OrderGetPayload<{ include: typeof ORDER_SNAPSHOT_INCLUDE }>;

/** Projects an order row into the snapshot shared by notices and relays. */
function toOrderSnapshot(order: OrderSnapshotRow): OrderSnapshot {
  return {
    orderId: order.id,
    customerName: order.customerName ?? order.customer?.name ?? "Customer",
    customerEmail: order.customer?.email ?? "N/A",
    customerPhone: order.customerPhone ?? "N/A",
    items: order.items.map((item) => ({
      quantity: item.quantity,
      productTitle: item.productTitle,
      unitPrice: String(item.unitPrice),
    })),
    total: String(order.total),
    currency: order.currency,
    status: order.status,
  };
}

export interface TelegramLinkService {
  isAvailable(): boolean;
  /**
   * Issues (or rotates) the deep-link token for one unpaid order owned by
   * `customerId`. Rotation replaces the stored hash and clears any previous
   * claim; when the order is already connected and `rebind` is false, the
   * existing connection is reported instead so a plain page view can never
   * silently unbind a customer.
   */
  issueLink(
    customerId: string,
    orderId: string,
    options?: { rebind?: boolean },
  ): Promise<TelegramLinkResult<IssuedLink | ExistingConnection>>;
  /** Connection state for the order-detail page; ownership is re-checked. */
  getConnection(
    customerId: string,
    orderId: string,
  ): Promise<TelegramLinkResult<TelegramConnectionView | null>>;
  /**
   * Atomically claims a link token for one Telegram private chat. Unknown,
   * expired, and already-consumed tokens all collapse into `rejected`.
   */
  claimByToken(
    rawToken: string | null,
    identity: { chatId: string; telegramName: string | null },
  ): Promise<ClaimOutcome>;
  /** All orders connected to one customer chat, newest connection first. */
  findConnectedOrdersByChat(chatId: string): Promise<ConnectedOrderContext[]>;
  /** Records which staff-chat message relays which customer connection. */
  recordStaffRelay(linkId: string, staffChatId: string, staffMessageId: string): Promise<boolean>;
  /** Resolves a staff Reply target to the customer chat it must reach. */
  resolveStaffRelay(
    staffChatId: string,
    staffMessageId: string,
  ): Promise<ResolvedRelay | null>;
  /**
   * Marks a webhook update as seen; false means "already processed" (or the
   * marker could not be written), so the caller must skip the update either way.
   */
  markUpdateSeen(updateId: string): Promise<boolean>;
}

/**
 * Builds the Telegram link service around a Prisma client provider, exactly
 * like `createCartService`. A provider that returns `null` (no `DATABASE_URL`)
 * makes every operation report `UNAVAILABLE`.
 */
export function createTelegramLinkService(
  getClient: () => PrismaClient | null,
  logger: TelegramLinkLogger = (resource, code) => {
    console.error(`[devKitCat telegram-link] ${resource} failed (${code}).`);
  },
): TelegramLinkService {
  function resolveClient(): PrismaClient | null {
    try {
      return getClient();
    } catch {
      logger("database configuration", "INVALID_DATABASE_URL");
      return null;
    }
  }

  function isAvailable(): boolean {
    return resolveClient() !== null;
  }

  async function issueLink(
    customerId: string,
    orderId: string,
    options?: { rebind?: boolean },
  ): Promise<TelegramLinkResult<IssuedLink | ExistingConnection>> {
    const client = resolveClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };

    if (
      typeof customerId !== "string" || customerId.length === 0 || customerId.length > 64 ||
      typeof orderId !== "string" || orderId.length === 0 || orderId.length > 64
    ) {
      return { ok: false, code: "NOT_FOUND" };
    }

    try {
      // Ownership first: the order must belong to the signed-in customer and
      // still be awaiting manual payment, exactly like the page that renders
      // the button. A foreign or settled order is indistinguishable from a
      // missing one.
      const order = await client.order.findFirst({
        where: { id: orderId, customerId, status: "PENDING_PAYMENT" },
        select: { id: true },
      });
      if (!order) return { ok: false, code: "NOT_FOUND" };

      const existing = await client.orderTelegramLink.findUnique({
        where: { orderId },
        select: { id: true, chatId: true, connectedAt: true, telegramName: true },
      });

      if (existing?.chatId && !options?.rebind) {
        return {
          ok: true,
          value: {
            alreadyConnected: true,
            connectedAt: existing.connectedAt ?? new Date(0),
            telegramName: existing.telegramName,
          },
        };
      }

      const token = generateLinkToken();
      const expiresAt = linkExpiryFromNow(new Date());
      const data = {
        tokenHash: hashLinkToken(token),
        expiresAt,
        consumedAt: null,
        chatId: null,
        connectedAt: null,
        telegramName: null,
      };

      if (existing) {
        await client.orderTelegramLink.update({ where: { id: existing.id }, data });
      } else {
        try {
          await client.orderTelegramLink.create({ data: { orderId, ...data } });
        } catch (error) {
          if (getSafeErrorCode(error) !== UNIQUE_VIOLATION_CODE) throw error;
          // A concurrent first issue won the unique orderId; rotate that row.
          const raced = await client.orderTelegramLink.findUnique({
            where: { orderId },
            select: { id: true },
          });
          if (!raced) return { ok: false, code: "ERROR" };
          await client.orderTelegramLink.update({ where: { id: raced.id }, data });
        }
      }

      return { ok: true, value: { token, expiresAt } };
    } catch (error) {
      logger("link issue", getSafeErrorCode(error));
      return { ok: false, code: "ERROR" };
    }
  }

  async function getConnection(
    customerId: string,
    orderId: string,
  ): Promise<TelegramLinkResult<TelegramConnectionView | null>> {
    const client = resolveClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };

    try {
      const order = await client.order.findFirst({
        where: { id: orderId, customerId },
        select: { id: true, telegramLink: { select: { chatId: true, connectedAt: true, telegramName: true } } },
      });
      if (!order) return { ok: false, code: "NOT_FOUND" };

      const link = order.telegramLink;
      if (!link?.chatId || !link.connectedAt) return { ok: true, value: null };
      return {
        ok: true,
        value: { state: "connected", connectedAt: link.connectedAt, telegramName: link.telegramName },
      };
    } catch (error) {
      logger("connection read", getSafeErrorCode(error));
      return { ok: false, code: "ERROR" };
    }
  }

  async function loadOrderSnapshot(
    client: PrismaClient,
    orderId: string,
  ): Promise<OrderSnapshot | null> {
    const order = await client.order.findUnique({
      where: { id: orderId },
      include: ORDER_SNAPSHOT_INCLUDE,
    });
    return order ? toOrderSnapshot(order) : null;
  }

  async function claimByToken(
    rawToken: string | null,
    identity: { chatId: string; telegramName: string | null },
  ): Promise<ClaimOutcome> {
    const client = resolveClient();
    if (!client) return { kind: "rejected", linkId: null, order: null, telegramName: null };

    if (!isValidLinkToken(rawToken)) {
      return { kind: "rejected", linkId: null, order: null, telegramName: null };
    }
    const chatId = identity.chatId.trim();
    if (!chatId || chatId.length > 32) {
      return { kind: "rejected", linkId: null, order: null, telegramName: null };
    }
    const telegramName = identity.telegramName?.trim().slice(0, 120) || null;

    try {
      const link = await client.orderTelegramLink.findUnique({
        where: { tokenHash: hashLinkToken(rawToken) },
        select: { id: true, orderId: true },
      });
      // Unknown token, expired token, and a token another chat already
      // consumed all end in the same refusal below — the bot reply must not
      // reveal which one happened.
      if (!link) return { kind: "rejected", linkId: null, order: null, telegramName: null };

      const now = new Date();
      // The atomic claim: chatId must still be null and the link unexpired.
      // Two concurrent Starts run this as one conditional UPDATE; exactly one
      // row change means one winner.
      const claimed = await client.orderTelegramLink.updateMany({
        where: { id: link.id, chatId: null, expiresAt: { gt: now } },
        data: { consumedAt: now, chatId, connectedAt: now, telegramName },
      });

      if (claimed.count === 1) {
        const order = await loadOrderSnapshot(client, link.orderId);
        return { kind: "claimed", linkId: link.id, order, telegramName };
      }

      const current = await client.orderTelegramLink.findUnique({
        where: { id: link.id },
        select: { chatId: true },
      });
      if (current?.chatId && current.chatId === chatId) {
        // Same chat pressed Start again (double tap, retry, webhook redelivery):
        // idempotent — re-acknowledge without touching the row.
        const order = await loadOrderSnapshot(client, link.orderId);
        return { kind: "already-connected-same-chat", linkId: link.id, order, telegramName };
      }
      return { kind: "rejected", linkId: null, order: null, telegramName: null };
    } catch (error) {
      logger("token claim", getSafeErrorCode(error));
      return { kind: "rejected", linkId: null, order: null, telegramName: null };
    }
  }

  async function findConnectedOrdersByChat(chatId: string): Promise<ConnectedOrderContext[]> {
    const client = resolveClient();
    if (!client || !chatId || chatId.length > 32) return [];

    try {
      // chatId is only ever written by a successful claim, so this query
      // returns exactly the orders this Telegram chat is allowed to discuss.
      const links = await client.orderTelegramLink.findMany({
        where: { chatId },
        orderBy: [{ connectedAt: "desc" }, { id: "asc" }],
        include: { order: { include: ORDER_SNAPSHOT_INCLUDE } },
      });
      return links
        .filter((link) => link.order !== null)
        .map((link) => ({ linkId: link.id, ...toOrderSnapshot(link.order) }));
    } catch (error) {
      logger("connected-order lookup", getSafeErrorCode(error));
      return [];
    }
  }

  async function recordStaffRelay(
    linkId: string,
    staffChatId: string,
    staffMessageId: string,
  ): Promise<boolean> {
    const client = resolveClient();
    if (!client || !linkId || !staffChatId || !staffMessageId) return false;

    try {
      await client.telegramStaffRelay.create({
        data: { linkId, staffChatId, staffMessageId },
      });
      return true;
    } catch (error) {
      if (getSafeErrorCode(error) === UNIQUE_VIOLATION_CODE) return true;
      logger("relay record", getSafeErrorCode(error));
      return false;
    }
  }

  async function resolveStaffRelay(
    staffChatId: string,
    staffMessageId: string,
  ): Promise<ResolvedRelay | null> {
    const client = resolveClient();
    if (!client || !staffChatId || !staffMessageId) return null;

    try {
      const relay = await client.telegramStaffRelay.findUnique({
        where: { staffChatId_staffMessageId: { staffChatId, staffMessageId } },
        select: { linkId: true, link: { select: { chatId: true, orderId: true } } },
      });
      // The connection may have been rebound since the relay was sent; without
      // a live chat there is nowhere safe to deliver.
      if (!relay?.link?.chatId) return null;
      return { linkId: relay.linkId, chatId: relay.link.chatId, orderId: relay.link.orderId };
    } catch (error) {
      logger("relay resolve", getSafeErrorCode(error));
      return null;
    }
  }

  async function markUpdateSeen(updateId: string): Promise<boolean> {
    const client = resolveClient();
    if (!client || !updateId || updateId.length > 24) return false;

    try {
      await client.telegramWebhookEvent.create({ data: { updateId } });
      return true;
    } catch (error) {
      if (getSafeErrorCode(error) === UNIQUE_VIOLATION_CODE) return false;
      // Fail closed: if the marker cannot be written, skip the update rather
      // than risk processing a Telegram retry twice.
      logger("webhook event record", getSafeErrorCode(error));
      return false;
    }
  }

  return {
    isAvailable,
    issueLink,
    getConnection,
    claimByToken,
    findConnectedOrdersByChat,
    recordStaffRelay,
    resolveStaffRelay,
    markUpdateSeen,
  };
}
