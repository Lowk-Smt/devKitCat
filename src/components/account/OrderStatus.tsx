import type { MockOrderStatus } from "@/data/mock-account";
import styles from "./OrderStatus.module.css";

const STATUS_LABELS: Record<MockOrderStatus, string> = {
  complete: "Complete",
  processing: "Processing",
  refunded: "Refunded",
};

export function OrderStatus({ status }: { status: MockOrderStatus }) {
  return (
    <span className={`${styles.status} ${styles[status]}`}>
      <span className={styles.dot} aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}
