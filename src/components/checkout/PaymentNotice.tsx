import { Icon } from "@/components/ui/Icon";
import styles from "./PaymentNotice.module.css";

interface PaymentNoticeProps {
  /**
   * `checkout` — before submitting, so nobody mistakes the screen for a payment
   * form. `order-placed` — on the confirmation for the unpaid order checkout
   * created.
   */
  variant: "checkout" | "order-placed";
}

/**
 * States plainly that devKitCat has no payment provider connected.
 *
 * It appears on the checkout screen and on the confirmation for an order that
 * checkout created, so no screen can imply that a payment happened, that card
 * details were collected, or that a download has been unlocked.
 */
export function PaymentNotice({ variant }: PaymentNoticeProps) {
  const isCheckout = variant === "checkout";

  return (
    <div className={styles.notice} role="status">
      <span className={styles.icon} aria-hidden="true">
        <Icon name="info" size={18} />
      </span>
      <div className={styles.copy}>
        <p className={styles.title}>
          {isCheckout
            ? "Payment is not enabled yet"
            : "Order received — payment is not enabled yet"}
        </p>
        <p className={styles.body}>
          {isCheckout
            ? "Submitting records this order on your devKitCat account and nothing else. No payment provider is connected, so you will not be charged and no card details are collected. The subtotal is the current catalog total; tax, shipping, discounts, and final payment calculations arrive with the payment integration."
            : "Your order is saved with the status “Awaiting payment”. No payment provider is connected to devKitCat yet, so nothing has been charged, no card details were collected, and no download has been unlocked. Payment processing arrives in a later release."}
        </p>
      </div>
    </div>
  );
}
