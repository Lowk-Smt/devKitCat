import type { Metadata } from "next";
import { CheckoutLine } from "@/components/checkout/CheckoutLine";
import { CheckoutSubmit } from "@/components/checkout/CheckoutSubmit";
import { PaymentNotice } from "@/components/checkout/PaymentNotice";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { formatPrice } from "@/lib/catalog";
import type { CartSummaryView } from "@/lib/cart-contract";
import { cx } from "@/lib/cx";
import { priceCentsToAmount } from "@/lib/money";
import { requireCustomer } from "@/lib/server/auth";
import { cart, isCartServiceAvailable } from "@/lib/server/cart";
import {
  describeCartFailure,
  generateOrderIdempotencyKey,
} from "@/lib/server/cart-core";
import type { CartResult } from "@/lib/server/cart-service";
import styles from "./checkout.module.css";

export const metadata: Metadata = {
  title: "Checkout",
  description:
    "Review the products in your devKitCat cart and submit an order. Payment is not connected yet.",
};

/**
 * Cart review and order submission for the signed-in customer.
 *
 * The page is a Server Component that reads the customer's own database cart,
 * so every name, image, price, line total, and the subtotal are rendered from
 * current catalog rows. Mutations and the submission are Server Functions that
 * re-authenticate and recompute everything; the form carries no price and no
 * customer identity.
 *
 * Submitting creates an **unpaid** `PENDING_PAYMENT` order with item snapshots
 * and clears the cart in one transaction. No payment provider is connected, so
 * nothing is charged and no download is unlocked.
 */
export default async function CheckoutPage() {
  // Reading the session both gates the route and makes it render per request.
  const customer = await requireCustomer();

  const result: CartResult<CartSummaryView> = isCartServiceAvailable()
    ? await cart.getCart(customer.id)
    : { ok: false, code: "UNAVAILABLE" };

  if (!result.ok) {
    return (
      <div className={cx("section", styles.page)}>
        <div className="container">
          <SectionHeading
            level={1}
            eyebrow="Checkout"
            title="We could not load your cart"
          />
          <div className={styles.errorCard} role="alert">
            <p>{describeCartFailure(result.code, { titles: result.titles })}</p>
            <Button href="/checkout" variant="secondary" size="sm">
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const summary: CartSummaryView = result.value;

  if (summary.lines.length === 0) {
    return (
      <div className={cx("section", styles.page)}>
        <div className="container">
          <SectionHeading level={1} eyebrow="Checkout" title="Your cart" />
          <EmptyState
            icon="cart"
            title="Your cart is empty"
            description="Add a system, kit, or asset pack and it will appear here, ready to review."
            action={<Button href="/products">Browse products</Button>}
          />
        </div>
      </div>
    );
  }

  const unavailableCount = summary.lines.filter((line) => !line.available).length;

  return (
    <div className={cx("section", styles.page)}>
      <div className="container">
        <SectionHeading
          level={1}
          eyebrow="Checkout"
          title="Review your order"
          description={`Signed in as ${customer.email}. Prices are read from the catalog at review time and recalculated on the server when you submit.`}
          action={
            <Button href="/products" variant="secondary" size="sm">
              Continue browsing
            </Button>
          }
        />

        <div className={styles.grid}>
          <section className={styles.linesCard} aria-label="Items in your cart">
            <h2 className={styles.cardTitle}>
              {summary.itemCount} {summary.itemCount === 1 ? "item" : "items"}
            </h2>
            <ul className={styles.lines}>
              {summary.lines.map((line) => (
                <CheckoutLine key={line.productId} line={line} />
              ))}
            </ul>
          </section>

          <aside className={styles.summaryCard} aria-label="Order summary">
            <h2 className={styles.cardTitle}>Order summary</h2>

            <dl className={styles.rows}>
              <div className={styles.row}>
                <dt>Items</dt>
                <dd>{summary.itemCount}</dd>
              </div>
              <div className={styles.row}>
                <dt>Subtotal</dt>
                <dd>{formatPrice(priceCentsToAmount(summary.subtotalCents))}</dd>
              </div>
              <div className={styles.row}>
                <dt>Tax, fees &amp; discounts</dt>
                <dd>Not applied yet</dd>
              </div>
            </dl>

            <p className={styles.total}>
              <span>Order total</span>
              <strong>
                {formatPrice(priceCentsToAmount(summary.subtotalCents))}
              </strong>
            </p>

            {unavailableCount > 0 ? (
              <p className={styles.warning} role="alert">
                {unavailableCount === 1
                  ? "One item is no longer available."
                  : `${unavailableCount} items are no longer available.`}{" "}
                Remove {unavailableCount === 1 ? "it" : "them"} before
                submitting.
              </p>
            ) : null}

            <PaymentNotice variant="checkout" />

            <CheckoutSubmit
              idempotencyKey={generateOrderIdempotencyKey()}
              reviewedSubtotalCents={summary.subtotalCents}
              disabled={!summary.canCheckout}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
