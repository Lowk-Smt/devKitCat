import Link from "next/link";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { Icon } from "@/components/ui/Icon";
import { getCategoryBySlug } from "@/data/categories";
import { formatPrice } from "@/lib/catalog";
import type { Product } from "@/types";
import styles from "./ProductCard.module.css";

interface ProductCardProps {
  product: Product;
}

/** Reusable product card, rendered from catalog data. */
export function ProductCard({ product }: ProductCardProps) {
  const category = getCategoryBySlug(product.category);

  return (
    <article className={styles.card}>
      <Link
        href={`/products/${product.slug}`}
        className={styles.link}
        aria-label={`View ${product.title} — ${formatPrice(product.price)}`}
      >
        <ProductThumbnail
          icon={category?.icon ?? "templates"}
          label={category?.name ?? "Product"}
        />
        <div className={styles.body}>
          <div className={styles.metaRow}>
            <span className={styles.category}>{category?.name}</span>
            {product.isNew ? <span className={styles.newBadge}>New</span> : null}
          </div>
          <h3 className={styles.title}>{product.title}</h3>
          <p className={styles.description}>{product.description}</p>
          <div className={styles.footer}>
            <span className={styles.price}>{formatPrice(product.price)}</span>
            <span className={styles.viewHint}>
              View details
              <Icon name="arrow-right" size={15} />
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}
