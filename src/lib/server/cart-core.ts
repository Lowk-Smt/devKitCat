import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import {
  CART_CURRENCY,
  CART_ITEM_MAX_QUANTITY,
  CART_ITEM_MIN_QUANTITY,
  CART_MAX_LINES,
} from "../cart-contract";

/**
 * Framework-free cart and checkout policy: quantity and identifier limits,
 * order references, idempotency keys, and the user-facing wording for every
 * failure a cart operation can return.
 *
 * Nothing here touches Next.js, Prisma, or the request context (mirroring
 * `auth-core.ts`), so the whole surface is unit-testable. Prices and totals are
 * handled by `src/lib/money.ts`; this module owns the limits around them.
 */

/**
 * Cart policy. The limits themselves live in the client-safe contract module so
 * the drawer can bound its stepper, but they are **enforced here**: devKitCat
 * sells digital licenses, so these are sanity bounds rather than inventory
 * rules, and anything outside them is rejected before it reaches the database.
 */
export {
  CART_CURRENCY,
  CART_ITEM_MAX_QUANTITY,
  CART_ITEM_MIN_QUANTITY,
  CART_MAX_LINES,
};

/** 32 bytes of entropy, base64url encoded — the session token's own format. */
export const ORDER_IDEMPOTENCY_KEY_BYTES = 32;
const ORDER_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Catalog IDs are seeded slugs or Prisma cuids; both fit this shape. */
const CATALOG_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const QUANTITY_PATTERN = /^\d{1,3}$/;

/** Seeded historical orders use `DKC-YYYY-MMDD-NNNNN`; checkout matches it. */
const ORDER_REFERENCE_PATTERN = /^DKC-\d{4}-\d{4}-\d{5}$/;

export type CartFailureCode =
  /** `DATABASE_URL` is not configured, so no cart can be stored. */
  | "UNAVAILABLE"
  /** No verified customer identity reached the service. */
  | "UNAUTHENTICATED"
  /** The product does not exist or is not published. */
  | "INVALID_PRODUCT"
  /** A product already in the cart was unpublished before checkout. */
  | "PRODUCT_UNAVAILABLE"
  | "INVALID_QUANTITY"
  | "CART_FULL"
  | "CART_EMPTY"
  /** The line was already removed, e.g. from a second tab. */
  | "NOT_IN_CART"
  /** The catalog changed between the checkout screen and the submission. */
  | "TOTAL_CHANGED"
  /** Missing or malformed idempotency key / reviewed subtotal. */
  | "INVALID_CHECKOUT"
  | "ERROR";

export interface CartFailureContext {
  /** Names of the products that caused a `PRODUCT_UNAVAILABLE` failure. */
  titles?: readonly string[];
}

/** Parses an untrusted quantity (form field, JSON body) into a valid count. */
export function parseCartQuantity(value: unknown): number | null {
  const text =
    typeof value === "number"
      ? Number.isInteger(value)
        ? String(value)
        : null
      : typeof value === "string"
        ? value.trim()
        : null;

  if (text === null || !QUANTITY_PATTERN.test(text)) return null;

  const quantity = Number(text);
  return quantity >= CART_ITEM_MIN_QUANTITY && quantity <= CART_ITEM_MAX_QUANTITY
    ? quantity
    : null;
}

/** Clamps a stored quantity into policy, so an old row cannot break the totals. */
export function clampCartQuantity(quantity: number): number {
  if (!Number.isSafeInteger(quantity) || quantity < CART_ITEM_MIN_QUANTITY) {
    return CART_ITEM_MIN_QUANTITY;
  }

  return Math.min(quantity, CART_ITEM_MAX_QUANTITY);
}

/** Rejects malformed product identifiers before they reach a query. */
export function isCatalogIdentifier(value: unknown): value is string {
  return typeof value === "string" && CATALOG_ID_PATTERN.test(value);
}

/** A customer identity always comes from the session; this only sanity-checks it. */
export function isCustomerIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 64;
}

/**
 * Random key the checkout form submits with its order. It is not a secret and
 * not a price: the server uses it only to resolve a retried submission to the
 * order it already created, backed by a unique database constraint.
 */
export function generateOrderIdempotencyKey(): string {
  return randomBytes(ORDER_IDEMPOTENCY_KEY_BYTES).toString("base64url");
}

export function isOrderIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && ORDER_IDEMPOTENCY_KEY_PATTERN.test(value);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Human-readable order reference in the seeded format
 * (`DKC-2026-0918-10482`): year, month + day, then five random digits. A
 * collision is rejected by the primary key and surfaces as a retryable error.
 */
export function generateOrderReference(now: Date = new Date()): string {
  const serial = String(randomInt(0, 100_000)).padStart(5, "0");
  return `DKC-${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${serial}`;
}

export function isOrderReference(value: unknown): value is string {
  return typeof value === "string" && ORDER_REFERENCE_PATTERN.test(value);
}

function joinTitles(titles: readonly string[]): string {
  if (titles.length === 0) return "One or more items";
  if (titles.length === 1) return `“${titles[0]}”`;
  if (titles.length === 2) return `“${titles[0]}” and “${titles[1]}”`;

  const head = titles.slice(0, 2).map((title) => `“${title}”`).join(", ");
  return `${head}, and ${titles.length - 2} more item${titles.length === 3 ? "" : "s"}`;
}

/** Display wording for a failed cart mutation. Never echoes raw input. */
export function describeCartFailure(
  code: CartFailureCode,
  context: CartFailureContext = {},
): string {
  switch (code) {
    case "UNAVAILABLE":
      return "Your cart is temporarily unavailable. Please try again later.";
    case "UNAUTHENTICATED":
      return "Please sign in to manage your cart.";
    case "INVALID_PRODUCT":
      return "That product is not available for purchase.";
    case "PRODUCT_UNAVAILABLE":
      return `${joinTitles(context.titles ?? [])} ${
        (context.titles?.length ?? 0) > 1 ? "are" : "is"
      } no longer available. Remove ${
        (context.titles?.length ?? 0) > 1 ? "them" : "it"
      } to continue.`;
    case "INVALID_QUANTITY":
      return `Enter a quantity between ${CART_ITEM_MIN_QUANTITY} and ${CART_ITEM_MAX_QUANTITY}.`;
    case "CART_FULL":
      return `Your cart can hold up to ${CART_MAX_LINES} different products.`;
    case "CART_EMPTY":
      return "Your cart is empty. Add a product before checking out.";
    case "NOT_IN_CART":
      return "That item is no longer in your cart.";
    case "TOTAL_CHANGED":
      return "The order total changed since this page loaded. Review the updated subtotal and submit again.";
    case "INVALID_CHECKOUT":
      return "This checkout could not be completed. Review your cart and try again.";
    case "ERROR":
      return "We could not update your cart. Please try again.";
  }
}

/**
 * Display wording for a failed checkout submission. It always states that
 * nothing was charged, because no payment provider is connected yet.
 */
export function describeCheckoutFailure(
  code: CartFailureCode,
  context: CartFailureContext = {},
): string {
  switch (code) {
    case "CART_EMPTY":
      return "Your cart is empty, so there is nothing to order yet.";
    case "PRODUCT_UNAVAILABLE":
      return `${joinTitles(context.titles ?? [])} ${
        (context.titles?.length ?? 0) > 1 ? "are" : "is"
      } no longer available. Remove ${
        (context.titles?.length ?? 0) > 1 ? "them" : "it"
      } from your cart, then submit again. Nothing was charged.`;
    case "TOTAL_CHANGED":
      return "Prices changed since you opened checkout. Review the updated subtotal below and submit again. Nothing was charged.";
    case "INVALID_CHECKOUT":
      return "This checkout session has expired. Reload the page and try again. Nothing was charged.";
    case "UNAUTHENTICATED":
      return "Please sign in to place an order.";
    case "UNAVAILABLE":
      return "Checkout is temporarily unavailable. Please try again later. Nothing was charged.";
    default:
      return "We could not place your order. Nothing was charged — please try again.";
  }
}
