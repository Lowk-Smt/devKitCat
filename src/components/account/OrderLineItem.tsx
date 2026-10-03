import Link from "next/link";
import { ProductArtwork } from "@/components/account/ProductArtwork";
import { Icon } from "@/components/ui/Icon";
import { formatPrice } from "@/lib/catalog";
import type { ResolvedOrderItem } from "@/types/account";
import styles from "./OrderLineItem.module.css";

export function OrderLineItem({ item }: { item: ResolvedOrderItem }) {
  const lineTotal = item.price * item.quantity;

  return (
    <article className={styles.item}>
      <ProductArtwork product={item.product} />
      <div className={styles.productDetails}>
        <h3 className={styles.title}>
          <Link href={`/products/${item.product.slug}`}>{item.product.title}</Link>
        </h3>
        <p className={styles.category}>{item.categoryName}</p>
        <p className={styles.version}>Version {item.version}</p>
        <div className={styles.actions}>
          <Link className={styles.productLink} href={`/products/${item.product.slug}`}>
            View product <Icon name="arrow-up-right" size={14} />
          </Link>
          <button
            className={styles.downloadPlaceholder}
            type="button"
            disabled
            aria-label={`Downloads for ${item.product.title} are coming soon`}
          >
            <Icon name="download" size={14} />
            <span>Download soon</span>
          </button>
        </div>
      </div>
      <div className={styles.price}>
        <span className={styles.lineTotal}>{formatPrice(lineTotal)}</span>
        <span className={styles.quantity}>
          Qty {item.quantity} · {formatPrice(item.price)} each
        </span>
      </div>
    </article>
  );
}
