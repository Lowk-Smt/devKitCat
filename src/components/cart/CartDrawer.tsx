"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { CartItem } from "@/components/cart/CartItem";
import { useCart } from "@/components/cart/cart-context";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { formatPrice } from "@/lib/catalog";
import styles from "./CartDrawer.module.css";

/**
 * Cart side panel built on a native modal <dialog>, which provides focus
 * trapping, Escape-to-close, an inert background, and focus restoration.
 * UI only: there is no checkout — the checkout button is intentionally inert.
 */
export function CartDrawer() {
  const { items, itemCount, subtotal, isOpen, remove, clear, close } =
    useCart();
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
              {items.map((product) => (
                <CartItem
                  key={product.id}
                  product={product}
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
                  <dd>{formatPrice(subtotal)}</dd>
                </div>
              </dl>
              <p className={styles.note}>
                Checkout isn&apos;t available yet. Your cart is saved on this
                device only, and nothing has been purchased or charged.
              </p>
              <Button fullWidth disabled>
                Checkout coming soon
              </Button>
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
                >
                  Clear cart
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </dialog>
  );
}
