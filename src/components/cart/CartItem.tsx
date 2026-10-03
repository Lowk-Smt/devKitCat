"use client";

import Link from "next/link";
import { ProductImage } from "@/components/product/ProductImage";
import { Icon } from "@/components/ui/Icon";
import { formatPrice } from "@/lib/catalog";
import type { CartLineView } from "@/lib/cart-contract";
import { priceCentsToAmount } from "@/lib/money";
import styles from "./CartItem.module.css";

interface CartItemProps {
  line: CartLineView;
  /**
   * Upper bound for the stepper. Quantity controls are only rendered when
   * `onQuantityChange` is provided, i.e. for the signed-in database cart.
   */
  maxQuantity?: number;
  /** Disables the controls while a cart mutation is in flight. */
  busy?: boolean;
  onQuantityChange?: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  /** Called when the product link is followed (e.g. to close the drawer). */
  onNavigate: () => void;
}

/**
 * One cart line: artwork, name, unit price, quantity, and the line total.
 *
 * Every amount comes from the server-computed cart line in whole cents; this
 * component only formats them and never sends a price back.
 */
export function CartItem({
  line,
  maxQuantity = 10,
  busy = false,
  onQuantityChange,
  onRemove,
  onNavigate,
}: CartItemProps) {
  const artwork = <Icon name={line.categoryIcon} size={20} />;
  const quantityLabel = `${line.quantity} × ${formatPrice(priceCentsToAmount(line.unitPriceCents))}`;

  return (
    <li className={styles.item}>
      <span className={styles.icon} aria-hidden="true">
        {line.imageSrc ? (
          <ProductImage
            src={line.imageSrc}
            alt=""
            sizes="44px"
            fallback={artwork}
          />
        ) : (
          artwork
        )}
      </span>
      <div className={styles.details}>
        <Link
          href={`/products/${line.productSlug}`}
          className={styles.title}
          onClick={onNavigate}
        >
          {line.productTitle}
        </Link>
        <p className={styles.meta}>
          {line.categoryName} · {formatPrice(priceCentsToAmount(line.unitPriceCents))}{" "}
          each
        </p>

        {line.available ? null : (
          <p className={styles.unavailable} role="status">
            No longer available — remove it to continue.
          </p>
        )}

        {onQuantityChange ? (
          <div
            className={styles.quantityRow}
            role="group"
            aria-label={`Quantity of ${line.productTitle}`}
          >
            <button
              type="button"
              className={styles.step}
              onClick={() => onQuantityChange(line.productId, line.quantity - 1)}
              disabled={busy || line.quantity <= 1}
              aria-label={`Decrease quantity of ${line.productTitle}`}
            >
              −
            </button>
            <span className={styles.quantityValue} aria-live="polite">
              {line.quantity}
            </span>
            <button
              type="button"
              className={styles.step}
              onClick={() => onQuantityChange(line.productId, line.quantity + 1)}
              disabled={busy || line.quantity >= maxQuantity}
              aria-label={`Increase quantity of ${line.productTitle}`}
            >
              +
            </button>
          </div>
        ) : null}

        <button
          type="button"
          className={styles.remove}
          onClick={() => onRemove(line.productId)}
          disabled={busy}
          aria-label={`Remove ${line.productTitle} from cart`}
        >
          <Icon name="trash" size={14} />
          Remove
        </button>
      </div>
      <span className={styles.price}>
        <span className={styles.lineTotal}>
          {formatPrice(priceCentsToAmount(line.lineTotalCents))}
        </span>
        {onQuantityChange ? (
          <span className={styles.quantityNote}>{quantityLabel}</span>
        ) : null}
      </span>
    </li>
  );
}
