"use client";

import { useCart } from "@/components/cart/cart-context";
import { Icon } from "@/components/ui/Icon";
import styles from "./CartButton.module.css";

/** Header button that shows the cart item count and opens the cart drawer. */
export function CartButton() {
  const { itemCount, open, isOpen } = useCart();

  return (
    <button
      type="button"
      className={styles.button}
      onClick={open}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-label={
        itemCount === 0
          ? "Open cart, empty"
          : `Open cart, ${itemCount} ${itemCount === 1 ? "item" : "items"}`
      }
    >
      <Icon name="cart" size={20} />
      {itemCount > 0 ? (
        <span className={styles.badge} aria-hidden="true">
          {itemCount}
        </span>
      ) : null}
    </button>
  );
}
