import { OrderStatus } from "@/components/account/OrderStatus";
import { Button } from "@/components/ui/Button";
import { isUnpaidOrderStatus } from "@/lib/account-presentation";
import { formatDate, formatPrice } from "@/lib/catalog";
import type { ResolvedOrder } from "@/types/account";
import styles from "@/components/account/AccountPage.module.css";

export function OrderSummary({ order }: { order: ResolvedOrder }) {
  const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const unpaid = isUnpaidOrderStatus(order.status);

  return (
    <aside className={styles.summaryCard} aria-label="Order summary">
      <h2 className={styles.summaryTitle}>Order summary</h2>
      <div className={styles.summaryStatus}>
        <OrderStatus status={order.status} />
      </div>

      <dl className={styles.summaryRows}>
        <div className={styles.summaryRow}>
          <dt>Order date</dt>
          <dd>
            <strong>
              <time dateTime={order.date}>{formatDate(order.date)}</time>
            </strong>
          </dd>
        </div>
        <div className={styles.summaryRow}>
          <dt>Items</dt>
          <dd>
            <strong>{quantity}</strong>
          </dd>
        </div>
        <div className={styles.summaryRow}>
          <dt>Payment</dt>
          <dd>
            <strong>{unpaid ? "Awaiting payment" : "Completed"}</strong>
          </dd>
        </div>
        {order.customerPhone ? (
          <div className={styles.summaryRow}>
            <dt>Phone</dt>
            <dd>
              <strong>{order.customerPhone}</strong>
            </dd>
          </div>
        ) : null}
        {order.telegramHandle ? (
          <div className={styles.summaryRow}>
            <dt>Telegram</dt>
            <dd>
              <strong>{order.telegramHandle}</strong>
            </dd>
          </div>
        ) : null}
      </dl>

      <p className={styles.summaryTotal}>
        <span>{unpaid ? "Order total" : "Total"}</span>
        <strong>{formatPrice(order.total)}</strong>
      </p>
      <p className={styles.summaryNote}>
        {unpaid
          ? "This order is awaiting payment: payment will be confirmed and assets delivered manually via Telegram."
          : "Payment processing is not connected to devKitCat yet, so this order carries no payment record."}
      </p>
      <Button href="/account/downloads" variant="secondary" fullWidth>
        Go to downloads
      </Button>
    </aside>
  );
}
