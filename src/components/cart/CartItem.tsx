import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { getCategoryBySlug } from "@/data/categories";
import { formatPrice } from "@/lib/catalog";
import type { Product } from "@/types";
import styles from "./CartItem.module.css";

interface CartItemProps {
  product: Product;
  onRemove: (productId: string) => void;
  /** Called when the product link is followed (e.g. to close the drawer). */
  onNavigate: () => void;
}

/** One line in the cart. Digital licenses are one per product — no quantity. */
export function CartItem({ product, onRemove, onNavigate }: CartItemProps) {
  const category = getCategoryBySlug(product.category);

  return (
    <li className={styles.item}>
      <span className={styles.icon} aria-hidden="true">
        <Icon name={category?.icon ?? "templates"} size={20} />
      </span>
      <div className={styles.details}>
        <Link
          href={`/products/${product.slug}`}
          className={styles.title}
          onClick={onNavigate}
        >
          {product.title}
        </Link>
        <p className={styles.meta}>
          {category?.name} · v{product.version}
        </p>
        <button
          type="button"
          className={styles.remove}
          onClick={() => onRemove(product.id)}
          aria-label={`Remove ${product.title} from cart`}
        >
          <Icon name="trash" size={14} />
          Remove
        </button>
      </div>
      <span className={styles.price}>{formatPrice(product.price)}</span>
    </li>
  );
}
