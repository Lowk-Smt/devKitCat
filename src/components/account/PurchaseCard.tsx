import Link from "next/link";
import { OrderStatus } from "@/components/account/OrderStatus";
import { Button } from "@/components/ui/Button";
import { formatDate, formatPrice } from "@/lib/catalog";
import type { ResolvedOrder } from "@/data/mock-account";
import styles from "./PurchaseCard.module.css";

interface PurchaseCardProps {
  order: ResolvedOrder;
  compact?: boolean;
}

export function PurchaseCard({ order, compact = false }: PurchaseCardProps) {
  return (
    <article className={`${styles.card}${compact ? ` ${styles.compact}` : ""}`}>
      <div className={styles.topLine}>
        <div className={styles.orderHeading}>
          <p className={styles.orderLabel}>Order</p>
          <h3 className={styles.orderId}>
            <Link href={`/account/purchases/${encodeURIComponent(order.id)}`}>
              {order.id}
            </Link>
          </h3>
        </div>
        <OrderStatus status={order.status} />
      </div>

      <div className={styles.meta}>
        <span>
          <span className={styles.metaLabel}>Placed</span>
          <time dateTime={order.date}>{formatDate(order.date)}</time>
        </span>
        <span>
          <span className={styles.metaLabel}>Total</span>
          <strong>{formatPrice(order.total)}</strong>
        </span>
      </div>

      <ul className={styles.items} aria-label={`Items in order ${order.id}`}>
        {order.items.map((item) => (
          <li className={styles.item} key={item.productId}>
            <Link href={`/products/${item.product.slug}`} className={styles.productName}>
              {item.product.title}
            </Link>
            {item.quantity > 1 ? (
              <span className={styles.quantity}>× {item.quantity}</span>
            ) : null}
          </li>
        ))}
      </ul>

      <div className={styles.bottomLine}>
        <span className={styles.itemCount}>
          {order.items.length} {order.items.length === 1 ? "item" : "items"}
        </span>
        <Button
          href={`/account/purchases/${encodeURIComponent(order.id)}`}
          variant="secondary"
          size="sm"
          className={styles.viewButton}
        >
          View order
        </Button>
      </div>
    </article>
  );
}
