"use client";

import { useCart } from "@/components/cart/cart-context";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { formatPrice } from "@/lib/catalog";
import type { Product } from "@/types";
import styles from "./ProductPurchasePanel.module.css";

interface ProductPurchasePanelProps {
  product: Pick<Product, "id" | "title" | "price">;
}

/**
 * Price + purchase actions.
 *
 * "Buy now" adds the product to the cart and opens it for review; "Add to cart"
 * does the same without opening it. For a signed-in customer that writes a
 * database cart line (adding again raises its quantity), and checkout happens on
 * `/checkout`. No payment provider is connected, so nothing is charged here.
 */
export function ProductPurchasePanel({ product }: ProductPurchasePanelProps) {
  const { has, quantityOf, add, remove, open, isPending } = useCart();
  const inCart = has(product.id);
  const quantity = quantityOf(product.id);

  return (
    <div className={styles.panel}>
      <p className={styles.price}>{formatPrice(product.price)}</p>

      <div className={styles.actions}>
        <Button
          fullWidth
          disabled={isPending}
          onClick={() => {
            add(product.id);
            open();
          }}
        >
          Buy now
        </Button>
        {inCart ? (
          <Button variant="secondary" fullWidth onClick={open} disabled={isPending}>
            <Icon name="check" size={16} />
            {quantity > 1
              ? `${quantity} in cart — view cart`
              : "Added to cart — view cart"}
          </Button>
        ) : (
          <Button
            variant="secondary"
            fullWidth
            onClick={() => add(product.id)}
            disabled={isPending}
          >
            <Icon name="cart" size={16} />
            Add to cart
          </Button>
        )}
        {inCart ? (
          <button
            type="button"
            className={styles.remove}
            onClick={() => remove(product.id)}
            disabled={isPending}
          >
            Remove from cart
          </button>
        ) : null}
      </div>

      <p className={styles.note}>
        Payment is not connected to devKitCat yet, so nothing is charged at
        checkout. “Buy now” adds this item to your cart so you can review the
        order first.
      </p>

      <p className="sr-only" role="status">
        {inCart ? `${product.title} was added to your cart.` : ""}
      </p>
    </div>
  );
}
