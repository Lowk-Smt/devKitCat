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
  /** Pre-filled customer name from authenticated session */
  initialCustomerName?: string;
  disabled?: boolean;
}

/**
 * The order submission form.
 *
 * Posts the server-generated checkout tokens alongside the two contact details
 * manual fulfillment needs: full name and phone number. Telegram is connected
 * *after* checkout, from the order page's one-time deep link — no username is
 * collected here, and the phone number is entered exactly once.
 * `placeOrderAction` re-authenticates, re-reads the cart, recomputes the total
 * from current catalog prices, validates contact details, and refuses the order
 * if tampered or stale.
 */
export function CheckoutSubmit({
  idempotencyKey,
  reviewedSubtotalCents,
  initialCustomerName = "",
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

      <div className={styles.fieldGroup}>
        <label htmlFor="checkout-name" className={styles.label}>
          Full name <span className={styles.required}>*</span>
        </label>
        <input
          id="checkout-name"
          type="text"
          name="customerName"
          defaultValue={initialCustomerName}
          required
          autoComplete="name"
          maxLength={120}
          className={styles.input}
          placeholder="Your full name"
        />
      </div>

      <div className={styles.fieldGroup}>
        <label htmlFor="checkout-phone" className={styles.label}>
          Phone number <span className={styles.required}>*</span>
        </label>
        <input
          id="checkout-phone"
          type="tel"
          name="customerPhone"
          required
          autoComplete="tel"
          maxLength={32}
          className={styles.input}
          placeholder="+1 (555) 000-0000"
        />
        <span className={styles.fieldHint}>
          Required to confirm payment and coordinate fulfillment. After you place the
          order, you can connect Telegram from the confirmation page.
        </span>
      </div>

      {state.status === "error" && state.message ? (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" fullWidth disabled={disabled || pending}>
        {pending ? "Placing your order…" : "Place order"}
      </Button>

      <p className={styles.hint}>
        You will not be charged yet. We will confirm payment and deliver your
        files directly via Telegram.
      </p>
    </form>
  );
}
