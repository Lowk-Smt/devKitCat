"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import {
  initialCheckoutFormState,
  type CheckoutFormState,
} from "@/lib/cart-contract";
import { placeOrderAction } from "@/lib/server/cart-actions";
import styles from "./CheckoutSubmit.module.css";

interface CheckoutSubmitProps {
  /** Generated per checkout render; resolves a retry to its original order. */
  idempotencyKey: string;
  /** The subtotal on screen when the form was rendered. */
  reviewedSubtotalCents: number;
  disabled?: boolean;
}

/**
 * The order submission form.
 *
 * It posts two server-generated values and nothing else: no price, no total, no
 * product list, and no customer identity. `placeOrderAction` re-authenticates,
 * re-reads the cart, recomputes the total from current catalog prices, and
 * refuses the order when the reviewed subtotal no longer matches — so a stale or
 * tampered form cannot change what is charged later or who owns the order.
 *
 * A double submission cannot create two orders: the key is unique per customer
 * in the database, and the retry resolves to the order it already made.
 */
export function CheckoutSubmit({
  idempotencyKey,
  reviewedSubtotalCents,
  disabled = false,
}: CheckoutSubmitProps) {
  const [state, formAction, pending] = useActionState<CheckoutFormState, FormData>(
    placeOrderAction,
    initialCheckoutFormState,
  );

  return (
    <form action={formAction} method="post" className={styles.form}>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input
        type="hidden"
        name="reviewedSubtotalCents"
        value={reviewedSubtotalCents}
      />

      {state.status === "error" && state.message ? (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" fullWidth disabled={disabled || pending}>
        {pending ? "Placing your order…" : "Place order"}
      </Button>

      <p className={styles.hint}>
        Nothing is charged: this records an unpaid order you can review in your
        purchases. Payment arrives in a later release.
      </p>
    </form>
  );
}
