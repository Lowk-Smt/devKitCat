/**
 * Integer-cent money helpers shared by the server-side cart/checkout code and
 * the client components that render their results.
 *
 * Amounts are held as whole cents so line totals and subtotals never accumulate
 * binary floating-point error, and `DECIMAL(10, 2)` columns are read and written
 * through these helpers. Authoritative prices and totals are always produced on
 * the server (`src/lib/server/cart-service.ts`) from current catalog rows; the
 * browser only formats the numbers it is given and never contributes to them.
 */

/** `DECIMAL(10, 2)` headroom: 99,999,999.99 expressed in cents. */
export const MAX_PRICE_CENTS = 9_999_999_999;

/** A non-negative amount with at most two decimal places, as Prisma returns it. */
const PRICE_PATTERN = /^\d{1,8}(?:\.\d{1,2})?$/;

function toPriceText(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toFixed(2) : null;
  }

  if (typeof value === "string") return value.trim();

  // Prisma hands `Decimal` columns back as objects; read them through `String`.
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toString?: unknown }).toString === "function"
  ) {
    try {
      return String(value).trim();
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Parses a price into whole cents. Returns null for anything that is not a
 * non-negative amount with at most two decimal places — a silently rounded
 * third decimal place would be a pricing bug, so it is rejected instead.
 */
export function toPriceCents(value: unknown): number | null {
  const text = toPriceText(value);
  if (text === null || !PRICE_PATTERN.test(text)) return null;

  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));

  return Number.isSafeInteger(cents) && cents <= MAX_PRICE_CENTS ? cents : null;
}

/** Whole cents back to a display amount, e.g. `1499` → `14.99`. */
export function priceCentsToAmount(cents: number): number {
  return cents / 100;
}

/**
 * Whole cents as the fixed-point string Prisma stores in a `Decimal` column.
 * Written as text so no float ever reaches the database.
 */
export function priceCentsToDecimalString(cents: number): string {
  return priceCentsToAmount(cents).toFixed(2);
}

/** `unitPriceCents * quantity`, or null when either side is not usable. */
export function lineTotalCents(
  unitPriceCents: number,
  quantity: number,
): number | null {
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) return null;
  if (!Number.isSafeInteger(quantity) || quantity < 1) return null;

  const total = unitPriceCents * quantity;
  return Number.isSafeInteger(total) && total <= MAX_PRICE_CENTS ? total : null;
}

/** Sums whole cents. Non-integers are rejected rather than silently rounded. */
export function sumCents(values: Iterable<number>): number | null {
  let total = 0;

  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    total += value;
  }

  return Number.isSafeInteger(total) && total <= MAX_PRICE_CENTS ? total : null;
}
