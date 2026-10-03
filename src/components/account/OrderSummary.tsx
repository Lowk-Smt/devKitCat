import { OrderStatus } from "@/components/account/OrderStatus";
import { Button } from "@/components/ui/Button";
import { formatDate, formatPrice } from "@/lib/catalog";
import type { ResolvedOrder } from "@/types/account";
import styles from "@/components/account/AccountPage.module.css";

export function OrderSummary({ order }: { order: ResolvedOrder }) {
  const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0);

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
            <strong>Demo record</strong>
          </dd>
        </div>
      </dl>

      <p className={styles.summaryTotal}>
        <span>Total</span>
        <strong>{formatPrice(order.total)}</strong>
      </p>
      <p className={styles.summaryNote}>
        This is a frontend-only order fixture. No payment was processed.
      </p>
      <Button href="/account/downloads" variant="secondary" fullWidth>
        Go to downloads
      </Button>
    </aside>
  );
}
