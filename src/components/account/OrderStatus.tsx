import type { OrderStatus } from "@/types/account";
import styles from "./OrderStatus.module.css";

const STATUS_LABELS: Record<OrderStatus, string> = {
  complete: "Complete",
  processing: "Processing",
  refunded: "Refunded",
};

export function OrderStatus({ status }: { status: OrderStatus }) {
  return (
    <span className={`${styles.status} ${styles[status]}`}>
      <span className={styles.dot} aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}
