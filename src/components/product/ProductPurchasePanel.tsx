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
 * Price + purchase actions. UI only: "Buy now" adds the product to the cart and
 * opens it for review; there is no checkout or payment in this release.
 */
export function ProductPurchasePanel({ product }: ProductPurchasePanelProps) {
  const { has, add, remove, open } = useCart();
  const inCart = has(product.id);

  return (
    <div className={styles.panel}>
      <p className={styles.price}>{formatPrice(product.price)}</p>

      <div className={styles.actions}>
        <Button
          fullWidth
          onClick={() => {
            add(product.id);
            open();
          }}
        >
          Buy now
        </Button>
        {inCart ? (
          <Button variant="secondary" fullWidth onClick={open}>
            <Icon name="check" size={16} />
            Added to cart — view cart
          </Button>
        ) : (
          <Button variant="secondary" fullWidth onClick={() => add(product.id)}>
            <Icon name="cart" size={16} />
            Add to cart
          </Button>
        )}
        {inCart ? (
          <button
            type="button"
            className={styles.remove}
            onClick={() => remove(product.id)}
          >
            Remove from cart
          </button>
        ) : null}
      </div>

      <p className={styles.note}>
        Checkout isn&apos;t available yet. “Buy now” adds this item to your cart
        so you can review it — nothing is purchased or charged.
      </p>

      <p className="sr-only" role="status">
        {inCart ? `${product.title} was added to your cart.` : ""}
      </p>
    </div>
  );
}
