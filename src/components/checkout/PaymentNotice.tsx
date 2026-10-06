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
 * States plainly that devKitCat uses manual Telegram fulfillment and no automated
 * payment provider is connected yet.
 *
 * It appears on the checkout screen and on the confirmation for an order that
 * checkout created, so no screen can imply that card details were collected
 * or that an automated charge took place.
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
            ? "Payment is not enabled yet — manual Telegram fulfillment"
            : "Order received — awaiting manual payment"}
        </p>
        <p className={styles.body}>
          {isCheckout
            ? "Submitting records this order on your devKitCat account. No payment provider is connected yet, so you will not be charged now and no card details are collected. No download is unlocked until our team manually verifies payment with you on Telegram."
            : "Your order has been created successfully with status “Awaiting payment”. No payment provider is connected yet, so nothing was charged and no download has been unlocked automatically. Our team will verify payment and deliver your purchased assets through Telegram."}
        </p>
      </div>
    </div>
  );
}
