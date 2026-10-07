import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  summarizeCartLines,
  type CartLineView,
  type CartSummaryView,
} from "../cart-contract";
import {
  lineTotalCents,
  priceCentsToDecimalString,
  sumCents,
  toPriceCents,
} from "../money";
import {
  CART_CURRENCY,
  CART_ITEM_MAX_QUANTITY,
  CART_MAX_LINES,
  clampCartQuantity,
  generateOrderReference,
  isCatalogIdentifier,
  isCustomerIdentifier,
  isOrderIdempotencyKey,
  normalizeOrderCustomerName,
  normalizeOrderPhoneNumber,
  normalizeTelegramHandle,
  parseCartQuantity,
  type CartFailureCode,
} from "./cart-core";
import { mapCategoryIcon } from "./data-access-core";
import {
  sendTelegramOrderNotification,
  type TelegramNotificationResult,
  type TelegramOrderNotification,
} from "./telegram";

/**
 * Database-backed shopping cart and checkout submission.
 *
 * Every read and write is keyed by the customer that owns it, and that identity
 * always comes from a verified session (`requireCustomer()` in
 * `src/lib/server/cart-actions.ts`) — never from a request body, so a client
 * cannot name somebody else's cart. Prices are read from the current `Product`
 * row at the moment of every read and every checkout; a browser never supplies
 * a price, a total, a discount, or an owner.
 *
 * Checkout deliberately stops at an **unpaid** order: it writes an `Order` in
 * `PENDING_PAYMENT` plus `OrderItem` snapshots and clears the cart in one
 * transaction. It never touches `Download`, never records a payment, and grants
 * no file access — no payment provider is connected in this release.
 */

/** One cart line plus just enough product data to price and describe it. */
const CART_ITEM_INCLUDE = {
  product: {
    include: {
      category: true,
      images: { orderBy: { position: "asc" }, take: 1 },
    },
  },
} satisfies Prisma.CartItemInclude;

type CartItemRow = Prisma.CartItemGetPayload<{ include: typeof CART_ITEM_INCLUDE }>;

export type CartResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; code: CartFailureCode; titles?: readonly string[] };

export interface PlacedOrder {
  /** The order reference shown to the customer, e.g. `DKC-2026-1003-48213`. */
  orderId: string;
  totalCents: number;
  currency: string;
  itemCount: number;
  /** True when a retried submission resolved to an order it had already made. */
  alreadyPlaced: boolean;
}

export interface CheckoutInput {
  /** Rendered by the checkout page; resolves a retry to its original order. */
  idempotencyKey: unknown;
  /**
   * The subtotal the customer actually reviewed, in cents. It is not trusted as
   * a price — the server recomputes the total and refuses to submit when the
   * two disagree, so a price or availability change forces a fresh review.
   */
  reviewedSubtotalCents: unknown;
  /** Customer's full name for order records. */
  customerName?: unknown;
  /** Customer's contact phone number for manual payment and fulfillment. */
  customerPhone?: unknown;
  /** Optional customer Telegram handle (e.g. @username). */
  telegramHandle?: unknown;
}

export interface CartService {
  /** False when no PostgreSQL database is configured for this deployment. */
  isAvailable(): boolean;
  getCart(customerId: string): Promise<CartResult<CartSummaryView>>;
  addItem(
    customerId: string,
    productId: string,
    quantity?: number,
  ): Promise<CartResult<CartSummaryView>>;
  setItemQuantity(
    customerId: string,
    productId: string,
    quantity: number,
  ): Promise<CartResult<CartSummaryView>>;
  removeItem(
    customerId: string,
    productId: string,
  ): Promise<CartResult<CartSummaryView>>;
  clearCart(customerId: string): Promise<CartResult<CartSummaryView>>;
  placeOrder(
    customerId: string,
    input: CheckoutInput,
  ): Promise<CartResult<PlacedOrder>>;
}

export type CartLogger = (resource: string, code: string) => void;

export type TelegramNotifier = (
  notification: TelegramOrderNotification,
) => Promise<TelegramNotificationResult>;

/** Prisma's unique-constraint and missing-row codes drive the user-facing errors. */
const UNIQUE_VIOLATION_CODE = "P2002";
const RECORD_NOT_FOUND_CODE = "P2025";

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

/** Control-flow error that rolls the checkout transaction back with a code. */
class CartFailure extends Error {
  readonly code: CartFailureCode;
  readonly titles: readonly string[];

  constructor(code: CartFailureCode, titles: readonly string[] = []) {
    super(code);
    this.name = "CartFailure";
    this.code = code;
    this.titles = titles;
  }
}

function failure(
  code: CartFailureCode,
  titles?: readonly string[],
): { ok: false; code: CartFailureCode; titles?: readonly string[] } {
  return titles && titles.length > 0 ? { ok: false, code, titles } : { ok: false, code };
}

/** Whole-cent unit price for a cart row, or a failure if the row is unusable. */
function unitPriceCents(row: CartItemRow): number {
  const cents = toPriceCents(row.product.price);
  if (cents === null) throw new CartFailure("ERROR");
  return cents;
}

function toCartLine(row: CartItemRow): CartLineView {
  const cents = unitPriceCents(row);
  const quantity = clampCartQuantity(row.quantity);
  const total = lineTotalCents(cents, quantity);
  if (total === null) throw new CartFailure("ERROR");

  return {
    productId: row.productId,
    productTitle: row.product.title,
    productSlug: row.product.slug,
    categoryName: row.product.category.name,
    categoryIcon: mapCategoryIcon(row.product.category.icon),
    imageSrc: row.product.images[0]?.src ?? null,
    unitPriceCents: cents,
    lineTotalCents: total,
    quantity,
    available: row.product.published,
  };
}

function toCartSummary(rows: readonly CartItemRow[]): CartSummaryView {
  return summarizeCartLines(rows.map(toCartLine));
}

/** Order projection used to resolve a retried submission to its own order. */
const PLACED_ORDER_SELECT = {
  id: true,
  total: true,
  currency: true,
  items: { select: { quantity: true } },
} satisfies Prisma.OrderSelect;

/** Parses the reviewed subtotal; it must be a whole number of cents. */
function parseReviewedSubtotal(value: unknown): number | null {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : null;
  if (text === null || !/^\d{1,11}$/.test(text)) return null;

  const cents = Number(text);
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Builds the cart service around a Prisma client provider, exactly like
 * `createCustomerAuthService`. A provider that returns `null` (no
 * `DATABASE_URL`) makes every operation report `UNAVAILABLE`: a cart has no
 * owner without a database-backed session, so there is no offline fallback.
 */
export function createCartService(
  getClient: () => PrismaClient | null,
  logger: CartLogger = (resource, code) => {
    console.error(`[devKitCat cart] ${resource} failed (${code}).`);
  },
  notifier: TelegramNotifier = sendTelegramOrderNotification,
): CartService {
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

  async function readCart(
    client: PrismaClient,
    customerId: string,
  ): Promise<CartSummaryView> {
    const rows = await client.cartItem.findMany({
      // Ownership is part of the query, so this can only ever return the
      // signed-in customer's own lines.
      where: { customerId },
      include: CART_ITEM_INCLUDE,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    return toCartSummary(rows);
  }

  /** Shared guard: a cart operation without a customer identity never runs. */
  function authorizedClient(
    customerId: string,
  ): { client: PrismaClient } | { ok: false; code: CartFailureCode } {
    const client = resolveClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };
    if (!isCustomerIdentifier(customerId)) return { ok: false, code: "UNAUTHENTICATED" };
    return { client };
  }

  async function getCart(customerId: string): Promise<CartResult<CartSummaryView>> {
    const gate = authorizedClient(customerId);
    if ("ok" in gate) return failure(gate.code);

    try {
      return { ok: true, value: await readCart(gate.client, customerId) };
    } catch (error) {
      if (error instanceof CartFailure) return failure(error.code, error.titles);
      logger("cart read", getSafeErrorCode(error));
      return failure("ERROR");
    }
  }

  async function addItem(
    customerId: string,
    productId: string,
    quantity: number = 1,
  ): Promise<CartResult<CartSummaryView>> {
    const gate = authorizedClient(customerId);
    if ("ok" in gate) return failure(gate.code);
    if (!isCatalogIdentifier(productId)) return failure("INVALID_PRODUCT");

    const parsedQuantity = parseCartQuantity(quantity);
    if (parsedQuantity === null) return failure("INVALID_QUANTITY");

    const { client } = gate;

    try {
      // Existence and availability are checked server-side; an unpublished or
      // unknown product cannot enter a cart.
      const product = await client.product.findFirst({
        where: { id: productId, published: true },
        select: { id: true },
      });
      if (!product) return failure("INVALID_PRODUCT");

      const existing = await client.cartItem.findUnique({
        where: { customerId_productId: { customerId, productId } },
        select: { id: true, quantity: true },
      });

      if (!existing) {
        const lineCount = await client.cartItem.count({ where: { customerId } });
        if (lineCount >= CART_MAX_LINES) return failure("CART_FULL");
      }

      // The unique index on (customerId, productId) makes a repeated "add" a
      // quantity change, so the same product can never appear on two lines.
      const saved = await client.cartItem.upsert({
        where: { customerId_productId: { customerId, productId } },
        create: { customerId, productId, quantity: parsedQuantity },
        update: { quantity: { increment: parsedQuantity } },
        select: { id: true, quantity: true },
      });

      // Incrementing could pass the documented maximum; clamp instead of
      // rejecting, so a double-click lands on the cap rather than an error.
      if (saved.quantity > CART_ITEM_MAX_QUANTITY) {
        await client.cartItem.update({
          where: { id: saved.id },
          data: { quantity: CART_ITEM_MAX_QUANTITY },
          select: { id: true },
        });
      }

      return { ok: true, value: await readCart(client, customerId) };
    } catch (error) {
      if (error instanceof CartFailure) return failure(error.code, error.titles);
      logger("cart update", getSafeErrorCode(error));
      return failure("ERROR");
    }
  }

  async function setItemQuantity(
    customerId: string,
    productId: string,
    quantity: number,
  ): Promise<CartResult<CartSummaryView>> {
    const gate = authorizedClient(customerId);
    if ("ok" in gate) return failure(gate.code);
    if (!isCatalogIdentifier(productId)) return failure("INVALID_PRODUCT");

    const parsedQuantity = parseCartQuantity(quantity);
    if (parsedQuantity === null) return failure("INVALID_QUANTITY");

    const { client } = gate;

    try {
      await client.cartItem.update({
        // The compound key includes the customer, so this cannot reach a line
        // belonging to another account.
        where: { customerId_productId: { customerId, productId } },
        data: { quantity: parsedQuantity },
        select: { id: true },
      });

      return { ok: true, value: await readCart(client, customerId) };
    } catch (error) {
      if (error instanceof CartFailure) return failure(error.code, error.titles);

      const code = getSafeErrorCode(error);
      if (code === RECORD_NOT_FOUND_CODE) return failure("NOT_IN_CART");

      logger("cart update", code);
      return failure("ERROR");
    }
  }

  async function removeItem(
    customerId: string,
    productId: string,
  ): Promise<CartResult<CartSummaryView>> {
    const gate = authorizedClient(customerId);
    if ("ok" in gate) return failure(gate.code);
    if (!isCatalogIdentifier(productId)) return failure("INVALID_PRODUCT");

    const { client } = gate;

    try {
      // Idempotent by design: removing a line that is already gone (two tabs,
      // a retried request) is a success, not an error.
      await client.cartItem.deleteMany({ where: { customerId, productId } });
      return { ok: true, value: await readCart(client, customerId) };
    } catch (error) {
      if (error instanceof CartFailure) return failure(error.code, error.titles);
      logger("cart update", getSafeErrorCode(error));
      return failure("ERROR");
    }
  }

  async function clearCart(customerId: string): Promise<CartResult<CartSummaryView>> {
    const gate = authorizedClient(customerId);
    if ("ok" in gate) return failure(gate.code);

    const { client } = gate;

    try {
      await client.cartItem.deleteMany({ where: { customerId } });
      return { ok: true, value: await readCart(client, customerId) };
    } catch (error) {
      if (error instanceof CartFailure) return failure(error.code, error.titles);
      logger("cart update", getSafeErrorCode(error));
      return failure("ERROR");
    }
  }

  async function placeOrder(
    customerId: string,
    input: CheckoutInput,
  ): Promise<CartResult<PlacedOrder>> {
    const gate = authorizedClient(customerId);
    if ("ok" in gate) return failure(gate.code);

    // Both checkout fields are validated before anything is read or written.
    if (!isOrderIdempotencyKey(input.idempotencyKey)) {
      return failure("INVALID_CHECKOUT");
    }

    const reviewedSubtotalCents = parseReviewedSubtotal(input.reviewedSubtotalCents);
    if (reviewedSubtotalCents === null) return failure("INVALID_CHECKOUT");

    // Contact fields are validated server-side if provided.
    const customerPhone = input.customerPhone;
    let validatedPhone: string | null = null;
    if (customerPhone !== undefined) {
      validatedPhone = normalizeOrderPhoneNumber(customerPhone);
      if (!validatedPhone) return failure("INVALID_PHONE");
    }

    const customerName = input.customerName;
    let validatedName: string | null = null;
    if (customerName !== undefined) {
      validatedName = normalizeOrderCustomerName(customerName);
      if (!validatedName) return failure("INVALID_NAME");
    }

    const telegramHandle = input.telegramHandle;
    const validatedTelegram =
      telegramHandle !== undefined
        ? normalizeTelegramHandle(telegramHandle)
        : null;

    const { client } = gate;
    const idempotencyKey = input.idempotencyKey;

    /**
     * Resolves a submission this customer already made with the same key, so a
     * retry (a second click, a resubmitted form) returns the original order
     * instead of failing on the now-empty cart or writing a duplicate.
     */
    async function findPlacedOrder(): Promise<PlacedOrder | null> {
      const existing = await client.order
        .findFirst({
          where: { customerId, idempotencyKey },
          select: PLACED_ORDER_SELECT,
        })
        .catch(() => null);
      if (!existing) return null;

      const totalCents = toPriceCents(existing.total);
      if (totalCents === null) return null;

      return {
        orderId: existing.id,
        totalCents,
        currency: existing.currency,
        itemCount: existing.items.reduce((sum, item) => sum + item.quantity, 0),
        alreadyPlaced: true,
      };
    }

    const alreadyPlaced = await findPlacedOrder();
    if (alreadyPlaced) return { ok: true, value: alreadyPlaced };

    try {
      const placed = await client.$transaction(async (tx) => {
        const rows = await tx.cartItem.findMany({
          where: { customerId },
          include: CART_ITEM_INCLUDE,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        if (rows.length === 0) throw new CartFailure("CART_EMPTY");

        // Revalidated at submission time, against current catalog rows.
        const priced = rows.map((row) => ({
          row,
          quantity: clampCartQuantity(row.quantity),
          unitPriceCents: unitPriceCents(row),
        }));

        const unavailable = priced.filter(({ row }) => !row.product.published);
        if (unavailable.length > 0) {
          throw new CartFailure(
            "PRODUCT_UNAVAILABLE",
            unavailable.map(({ row }) => row.product.title),
          );
        }

        const totals = priced.map(({ unitPriceCents: unit, quantity }) =>
          lineTotalCents(unit, quantity),
        );
        if (totals.some((total) => total === null)) throw new CartFailure("ERROR");

        const totalCents = sumCents(totals as number[]);
        if (totalCents === null || totalCents < 0) throw new CartFailure("ERROR");

        // The customer must have reviewed this exact total; otherwise the
        // catalog moved under them and the order is refused.
        if (totalCents !== reviewedSubtotalCents) throw new CartFailure("TOTAL_CHANGED");

        // Clearing first is the double-submit guard: Postgres row locks make a
        // concurrent checkout wait, and it then finds nothing left to order.
        const cleared = await tx.cartItem.deleteMany({ where: { customerId } });
        if (cleared.count === 0) throw new CartFailure("CART_EMPTY");
        if (cleared.count !== rows.length) throw new CartFailure("TOTAL_CHANGED");

        const order = await tx.order.create({
          data: {
            id: generateOrderReference(),
            customerId,
            // Unpaid: no payment provider exists yet, so nothing here claims a
            // payment happened and no download entitlement is created.
            status: "PENDING_PAYMENT",
            // Server-computed from the catalog, never from the request.
            total: priceCentsToDecimalString(totalCents),
            currency: CART_CURRENCY,
            idempotencyKey,
            customerName: validatedName,
            customerPhone: validatedPhone,
            telegramHandle: validatedTelegram,
            items: {
              create: priced.map(({ row, quantity, unitPriceCents: unit }, position) => ({
                productId: row.productId,
                // Snapshots: later catalog edits must not rewrite this order.
                productTitle: row.product.title,
                productSlug: row.product.slug,
                categorySlug: row.product.category.slug,
                categoryName: row.product.category.name,
                versionAtPurchase: row.product.version,
                unitPrice: priceCentsToDecimalString(unit),
                quantity,
                position,
              })),
            },
          },
          select: { id: true },
        });

        return {
          orderId: order.id,
          totalCents,
          itemCount: priced.reduce((sum, { quantity }) => sum + quantity, 0),
          customerName: validatedName,
          customerPhone: validatedPhone,
          telegramHandle: validatedTelegram,
          notificationItems: priced.map(({ row, quantity, unitPriceCents: unit }) => ({
            quantity,
            productTitle: row.product.title,
            unitPrice: priceCentsToDecimalString(unit),
          })),
        };
      });

      // Post-commit Telegram notification.
      // Database transaction has succeeded and committed; any Telegram failure
      // or missing credentials must never roll back or disrupt the customer's order.
      //
      // Only a freshly created order reaches this point: a retried submission
      // with the same idempotency key resolves to its original order (and
      // `alreadyPlaced: true`) above, before the transaction, so an order can
      // never be notified twice.
      // Every newly created order must get a notification attempt. Do not gate
      // this on optional contact fields: the order is the event, and those
      // fields are not a prerequisite for Telegram delivery.
      try {
        const customerRow = await client.customer
          .findUnique({
            where: { id: customerId },
            select: { email: true, name: true },
          })
          .catch(() => null);

        const notification = {
          orderId: placed.orderId,
          customerName: placed.customerName || customerRow?.name || "Customer",
          customerEmail: customerRow?.email || "N/A",
          customerPhone: validatedPhone || "N/A",
          telegramHandle: placed.telegramHandle,
          items: placed.notificationItems,
          total: priceCentsToDecimalString(placed.totalCents),
          currency: CART_CURRENCY,
          status: "PENDING PAYMENT",
        } satisfies TelegramOrderNotification;

        const notificationResult = await notifier(notification);
        if (!notificationResult.ok) {
          // A delivery failure is diagnostic only: the order is already committed.
          logger(`telegram notification for order ${placed.orderId}`, notificationResult.error);
        }
      } catch (error) {
        // Retain a correlated fallback if an injected notifier unexpectedly throws.
        logger(`telegram notification for order ${placed.orderId}`, getSafeErrorCode(error));
      }

      return {
        ok: true,
        value: {
          orderId: placed.orderId,
          totalCents: placed.totalCents,
          currency: CART_CURRENCY,
          itemCount: placed.itemCount,
          alreadyPlaced: false,
        },
      };
    } catch (error) {
      if (error instanceof CartFailure) return failure(error.code, error.titles);

      const code = getSafeErrorCode(error);
      if (code === UNIQUE_VIOLATION_CODE) {
        // Two identical submissions raced: the unique index on
        // (customerId, idempotencyKey) rejected the second one, so resolve it to
        // the order that won. Uniqueness is enforced by the database, not by a
        // disabled button.
        const raced = await findPlacedOrder();
        if (raced) return { ok: true, value: raced };
      }

      logger("checkout", code);
      return failure("ERROR");
    }
  }

  return {
    isAvailable,
    getCart,
    addItem,
    setItemQuantity,
    removeItem,
    clearCart,
    placeOrder,
  };
}
