import { lineTotalCents, sumCents } from "./money";
import type { IconName } from "@/types";

/**
 * Client-safe cart contracts.
 *
 * Server Functions and Server Components produce these values; client
 * components only render them. Like `src/lib/auth-forms.ts`, this module must
 * stay free of server-only imports so a client bundle never pulls in Prisma.
 *
 * Every money value here is an integer number of cents computed on the server
 * from the current catalog row. Clients format them and never send prices,
 * totals, discounts, or ownership identifiers back — the checkout Server
 * Function recomputes everything from the database.
 */

export const CART_CURRENCY = "USD";

/**
 * Cart policy, shared so the client can bound its inputs and label them.
 * The server (`src/lib/server/cart-core.ts`) enforces every one of these, so a
 * client that ignores them still cannot exceed them: 1-10 copies of a product
 * per line and at most 20 distinct products per cart.
 */
export const CART_ITEM_MIN_QUANTITY = 1;
export const CART_ITEM_MAX_QUANTITY = 10;
export const CART_MAX_LINES = 20;

export interface CartLineView {
  productId: string;
  productTitle: string;
  productSlug: string;
  categoryName: string;
  categoryIcon: IconName;
  /** First catalog image, or null when the product only has a placeholder. */
  imageSrc: string | null;
  unitPriceCents: number;
  lineTotalCents: number;
  quantity: number;
  /** False when the product was unpublished after it was added to the cart. */
  available: boolean;
}

export interface CartSummaryView {
  lines: CartLineView[];
  /** Total quantity across the orderable lines. */
  itemCount: number;
  subtotalCents: number;
  currency: typeof CART_CURRENCY;
  /** Empty carts, and carts holding an unavailable product, cannot be ordered. */
  canCheckout: boolean;
}

/** Shared by the cart service and the browser-local (signed-out) cart. */
export function summarizeCartLines(lines: readonly CartLineView[]): CartSummaryView {
  const orderable = lines.filter((line) => line.available);
  const totals = orderable.map((line) =>
    lineTotalCents(line.unitPriceCents, line.quantity),
  );
  const subtotalCents =
    totals.some((total) => total === null) ? 0 : (sumCents(totals as number[]) ?? 0);

  return {
    lines: [...lines],
    itemCount: orderable.reduce((sum, line) => sum + line.quantity, 0),
    subtotalCents,
    currency: CART_CURRENCY,
    // Non-empty, and every line still purchasable.
    canCheckout: orderable.length > 0 && orderable.length === lines.length,
  };
}

export function emptyCart(): CartSummaryView {
  return summarizeCartLines([]);
}

/** Result of reading the signed-in customer's cart on mount. */
export type CartSyncResult =
  | { status: "anonymous" }
  | { status: "ok"; cart: CartSummaryView }
  | { status: "error"; message: string };

/**
 * Result of a cart mutation. `message` is always a display string produced on
 * the server. A mutation from an expired session never returns here: the Server
 * Function redirects to `/login` instead, like every other protected action.
 */
export type CartMutationResult =
  | { status: "ok"; cart: CartSummaryView }
  | { status: "error"; message: string; cart?: CartSummaryView };

/** State contract for the checkout form, mirroring `AuthFormState`. */
export interface CheckoutFormState {
  status: "idle" | "error";
  message?: string;
}

export const initialCheckoutFormState: CheckoutFormState = { status: "idle" };
