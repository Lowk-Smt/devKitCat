"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type {
  CartMutationResult,
  CartSyncResult,
  CheckoutFormState,
} from "../cart-contract";
import { getAuthenticatedCustomer, requireCustomer } from "./auth";
import { cart, isCartServiceAvailable } from "./cart";
import {
  describeCartFailure,
  describeCheckoutFailure,
  type CartFailureCode,
  type CartFailureContext,
} from "./cart-core";
import type { CartResult } from "./cart-service";
import type { CartSummaryView } from "../cart-contract";

/**
 * Server Functions behind the cart and the checkout form.
 *
 * Each one is a public POST endpoint, so each re-authenticates, re-validates its
 * input, and returns only display strings and server-computed cart numbers. The
 * customer identity always comes from the session cookie — no action accepts a
 * customer ID, a price, or a total from the client. Next.js rejects action
 * requests whose `Origin` does not match the host, and the session cookie is
 * `SameSite=Lax`, so the existing CSRF posture is unchanged.
 *
 * None of these charges money: checkout stops at an unpaid `PENDING_PAYMENT`
 * order (see `src/lib/server/cart-service.ts`).
 */

// Not exported: a `"use server"` module may only export async functions.
const CHECKOUT_PATH = "/checkout";

const CART_REVALIDATED_PATHS = [CHECKOUT_PATH] as const;

function cartFailure(
  code: CartFailureCode,
  context: CartFailureContext = {},
): CartMutationResult {
  return { status: "error", message: describeCartFailure(code, context) };
}

function toMutationResult(
  result: CartResult<CartSummaryView>,
): CartMutationResult {
  if (result.ok) return { status: "ok", cart: result.value };
  return cartFailure(result.code, { titles: result.titles });
}

/** Keeps the checkout screen's server-rendered totals in step with a mutation. */
function revalidateCart(): void {
  for (const path of CART_REVALIDATED_PATHS) revalidatePath(path);
}

/**
 * Reads the signed-in customer's cart once, when the cart UI mounts.
 *
 * Deliberately non-throwing: a signed-out visitor — or a deployment without a
 * database — gets `anonymous`, and the storefront keeps its browser-local cart.
 */
export async function readCartAction(): Promise<CartSyncResult> {
  if (!isCartServiceAvailable()) return { status: "anonymous" };

  const customer = await getAuthenticatedCustomer();
  if (!customer) return { status: "anonymous" };

  const result = await cart.getCart(customer.id);
  if (!result.ok) {
    return {
      status: "error",
      message: describeCartFailure(result.code, { titles: result.titles }),
    };
  }

  return { status: "ok", cart: result.value };
}

/** Adds a published product to the signed-in customer's cart. */
export async function addToCartAction(
  productId: string,
  quantity: number = 1,
): Promise<CartMutationResult> {
  const customer = await requireCustomer();
  const result = await cart.addItem(customer.id, productId, quantity);
  const mapped = toMutationResult(result);

  if (mapped.status === "ok") revalidateCart();
  return mapped;
}

/** Sets the quantity of one of the signed-in customer's cart lines. */
export async function setCartItemQuantityAction(
  productId: string,
  quantity: number,
): Promise<CartMutationResult> {
  const customer = await requireCustomer();
  const result = await cart.setItemQuantity(customer.id, productId, quantity);
  const mapped = toMutationResult(result);

  if (mapped.status === "ok") revalidateCart();
  return mapped;
}

/** Removes one of the signed-in customer's cart lines. */
export async function removeCartItemAction(
  productId: string,
): Promise<CartMutationResult> {
  const customer = await requireCustomer();
  const result = await cart.removeItem(customer.id, productId);
  const mapped = toMutationResult(result);

  if (mapped.status === "ok") revalidateCart();
  return mapped;
}

/** Empties the signed-in customer's cart. */
export async function clearCartAction(): Promise<CartMutationResult> {
  const customer = await requireCustomer();
  const result = await cart.clearCart(customer.id);
  const mapped = toMutationResult(result);

  if (mapped.status === "ok") revalidateCart();
  return mapped;
}

/**
 * Submits the checkout.
 *
 * Revalidates the cart, availability, quantities, and current prices on the
 * server; writes an unpaid `PENDING_PAYMENT` order with its item snapshots and
 * clears the cart in one transaction; then sends the customer to their own
 * order. Nothing is charged and no download is unlocked.
 */
export async function placeOrderAction(
  _previousState: CheckoutFormState,
  formData: FormData,
): Promise<CheckoutFormState> {
  const customer = await requireCustomer();

  const customerName = formData.get("customerName");
  const customerPhone = formData.get("customerPhone");

  // Phone number is required for manual fulfillment; Telegram is connected
  // after checkout via the order page's one-time deep link, so no Telegram
  // username is collected here anymore.
  if (typeof customerPhone !== "string" || !customerPhone.trim()) {
    return {
      status: "error",
      message: describeCheckoutFailure("INVALID_PHONE"),
    };
  }

  const result = await cart.placeOrder(customer.id, {
    // Both values are validated server-side: the key only resolves a retry to
    // its own order, and the reviewed subtotal is compared against a freshly
    // computed total rather than being used as a price.
    idempotencyKey: formData.get("idempotencyKey"),
    reviewedSubtotalCents: formData.get("reviewedSubtotalCents"),
    customerName,
    customerPhone,
  });

  if (!result.ok) {
    return {
      status: "error",
      message: describeCheckoutFailure(result.code, { titles: result.titles }),
    };
  }

  revalidateCart();
  // The new order shows up in the customer's purchase history immediately.
  revalidatePath("/account/purchases");

  redirect(
    `/account/purchases/${encodeURIComponent(result.value.orderId)}?placed=1`,
  );
}
