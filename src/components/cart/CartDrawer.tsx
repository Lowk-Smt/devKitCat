"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { CartItem } from "@/components/cart/CartItem";
import { useCart } from "@/components/cart/cart-context";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { formatPrice } from "@/lib/catalog";
import { CART_CURRENCY, CART_ITEM_MAX_QUANTITY } from "@/lib/cart-contract";
import { priceCentsToAmount } from "@/lib/money";
import styles from "./CartDrawer.module.css";

/**
 * Cart side panel built on a native modal <dialog>, which provides focus
 * trapping, Escape-to-close, an inert background, and focus restoration.
 *
 * Review only — nothing is charged here. For a signed-in customer the lines are
 * their database cart and the button goes to `/checkout`; for a signed-out
 * visitor the lines are browser-local and the button goes to sign-in, because a
 * cart cannot be ordered without an account.
 */
export function CartDrawer() {
  const {
    lines,
    itemCount,
    subtotalCents,
    isOpen,
    isAuthenticated,
    isPending,
    notice,
    setQuantity,
    remove,
    clear,
    close,
  } = useCart();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // The clicked button disappears when an item is removed, so move focus to
  // the drawer title instead of dropping it on <body>.
  function withFocusReset<Args extends unknown[]>(
    action: (...args: Args) => void,
  ) {
    return (...args: Args) => {
      action(...args);
      titleRef.current?.focus();
    };
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.drawer}
      aria-labelledby="cart-title"
      onClose={close}
      onClick={(event) => {
        // A click on the backdrop targets the <dialog> element itself.
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className={styles.panel}>
        <header className={styles.header}>
          <div>
            <h2
              id="cart-title"
              ref={titleRef}
              tabIndex={-1}
              className={styles.title}
            >
              Your cart
            </h2>
            <p className={styles.count} aria-live="polite">
              {itemCount === 0
                ? "No items"
                : `${itemCount} ${itemCount === 1 ? "item" : "items"}`}
            </p>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={close}
            aria-label="Close cart"
          >
            <Icon name="close" size={20} />
          </button>
        </header>

        {notice ? (
          <p className={styles.notice} role="alert">
            {notice}
          </p>
        ) : null}

        {itemCount === 0 ? (
          <div className={styles.emptyWrap}>
            <EmptyState
              icon="cart"
              headingLevel={3}
              title="Your cart is empty"
              description="Add a system, kit, or asset pack and it will show up here."
              action={
                <Button href="/products" size="sm" onClick={close}>
                  Browse products
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <ul className={styles.list} aria-label="Items in your cart">
              {lines.map((line) => (
                <CartItem
                  key={line.productId}
                  line={line}
                  maxQuantity={CART_ITEM_MAX_QUANTITY}
                  busy={isPending}
                  onQuantityChange={
                    isAuthenticated === true ? withFocusReset(setQuantity) : undefined
                  }
                  onRemove={withFocusReset(remove)}
                  onNavigate={close}
                />
              ))}
            </ul>

            <footer className={styles.footer}>
              <dl className={styles.summary}>
                <div className={styles.summaryRow}>
                  <dt>Items</dt>
                  <dd>{itemCount}</dd>
                </div>
                <div className={styles.summaryTotal}>
                  <dt>Subtotal</dt>
                  <dd>{formatPrice(priceCentsToAmount(subtotalCents))}</dd>
                </div>
              </dl>
              <p className={styles.note}>
                {isAuthenticated === true
                  ? "Your cart is saved to your devKitCat account. Nothing has been purchased or charged — payment is not connected yet."
                  : "Your cart is saved on this device only, and nothing has been purchased or charged. Sign in to check out."}
              </p>

              {isAuthenticated === true ? (
                <Button href="/checkout" fullWidth disabled={isPending}>
                  Review &amp; checkout
                </Button>
              ) : isAuthenticated === false ? (
                <Button href="/login" fullWidth>
                  Sign in to check out
                </Button>
              ) : (
                <Button fullWidth disabled aria-busy="true">
                  Checking your cart…
                </Button>
              )}

              <div className={styles.secondary}>
                <Link
                  href="/products"
                  className={styles.textAction}
                  onClick={close}
                >
                  Continue browsing
                </Link>
                <button
                  type="button"
                  className={styles.textAction}
                  onClick={withFocusReset(clear)}
                  disabled={isPending}
                >
                  Clear cart
                </button>
              </div>
              <p className={styles.currency}>
                Prices in {CART_CURRENCY}. Final payment calculations arrive with
                the payment integration.
              </p>
            </footer>
          </>
        )}
      </div>
    </dialog>
  );
}
