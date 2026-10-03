"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { ProductArtwork } from "@/components/account/ProductArtwork";
import { Icon } from "@/components/ui/Icon";
import { formatPrice } from "@/lib/catalog";
import {
  CART_ITEM_MAX_QUANTITY,
  CART_ITEM_MIN_QUANTITY,
  type CartLineView,
  type CartMutationResult,
} from "@/lib/cart-contract";
import { priceCentsToAmount } from "@/lib/money";
import {
  removeCartItemAction,
  setCartItemQuantityAction,
} from "@/lib/server/cart-actions";
import styles from "./CheckoutLine.module.css";

interface CheckoutLineProps {
  line: CartLineView;
}

/**
 * One reviewable cart line on `/checkout`.
 *
 * Quantity and removal go to the same Server Functions the cart drawer uses; the
 * action revalidates the route, so the server-rendered subtotal underneath
 * updates in the same response. The typed quantity is only a request — the
 * server re-checks the bounds and recomputes every amount from the catalog.
 */
export function CheckoutLine({ line }: CheckoutLineProps) {
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const quantityRef = useRef<HTMLInputElement>(null);

  function run(action: () => Promise<CartMutationResult>) {
    startTransition(async () => {
      setNotice(null);
      const result = await action();
      if (result.status === "error") setNotice(result.message);
    });
  }

  const unitPrice = formatPrice(priceCentsToAmount(line.unitPriceCents));
  const quantityId = `quantity-${line.productId}`;

  return (
    <li className={styles.line}>
      <ProductArtwork
        product={{
          title: line.productTitle,
          images: line.imageSrc ? [line.imageSrc] : [],
        }}
        icon={line.categoryIcon}
        size="sm"
      />

      <div className={styles.details}>
        <h3 className={styles.title}>
          <Link href={`/products/${line.productSlug}`}>{line.productTitle}</Link>
        </h3>
        <p className={styles.meta}>
          {line.categoryName} · {unitPrice} each
        </p>

        {line.available ? null : (
          <p className={styles.unavailable}>
            No longer available. Remove it to continue.
          </p>
        )}

        <div className={styles.controls}>
          <div className={styles.stepper}>
            <button
              type="button"
              className={styles.step}
              onClick={() =>
                run(() => setCartItemQuantityAction(line.productId, line.quantity - 1))
              }
              disabled={isPending || line.quantity <= CART_ITEM_MIN_QUANTITY}
              aria-label={`Decrease quantity of ${line.productTitle}`}
            >
              −
            </button>
            <label className="sr-only" htmlFor={quantityId}>
              Quantity of {line.productTitle}
            </label>
            <input
              ref={quantityRef}
              className={styles.quantity}
              id={quantityId}
              name="quantity"
              type="number"
              inputMode="numeric"
              min={CART_ITEM_MIN_QUANTITY}
              max={CART_ITEM_MAX_QUANTITY}
              defaultValue={line.quantity}
              disabled={isPending}
              aria-describedby={`${quantityId}-hint`}
            />
            <button
              type="button"
              className={styles.step}
              onClick={() =>
                run(() => setCartItemQuantityAction(line.productId, line.quantity + 1))
              }
              disabled={isPending || line.quantity >= CART_ITEM_MAX_QUANTITY}
              aria-label={`Increase quantity of ${line.productTitle}`}
            >
              +
            </button>
            <button
              type="button"
              className={styles.update}
              onClick={() => {
                // Out-of-range or non-numeric input is rejected by the server,
                // which reports the allowed range back to the customer.
                const next = Number(quantityRef.current?.value);
                run(() => setCartItemQuantityAction(line.productId, next));
              }}
              disabled={isPending}
            >
              Update
            </button>
          </div>

          <button
            type="button"
            className={styles.remove}
            onClick={() => run(() => removeCartItemAction(line.productId))}
            disabled={isPending}
          >
            <Icon name="trash" size={14} />
            Remove
          </button>
        </div>

        <p id={`${quantityId}-hint`} className={styles.hint}>
          {CART_ITEM_MIN_QUANTITY}–{CART_ITEM_MAX_QUANTITY} per product.
        </p>

        {notice ? (
          <p className={styles.notice} role="alert">
            {notice}
          </p>
        ) : null}
      </div>

      <p className={styles.lineTotal}>
        {formatPrice(priceCentsToAmount(line.lineTotalCents))}
      </p>
    </li>
  );
}
