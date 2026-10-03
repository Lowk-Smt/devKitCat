import Link from "next/link";
import { ProductBadges } from "@/components/product/ProductBadges";
import { ProductPreview } from "@/components/product/ProductPreview";
import { Icon } from "@/components/ui/Icon";
import { getCategoryBySlug } from "@/data/categories";
import { formatPrice } from "@/lib/catalog";
import type { Category, Product } from "@/types";
import styles from "./ProductCard.module.css";

interface ProductCardProps {
  product: Product;
  /** Live server category, with the fixture used as a backward-compatible fallback. */
  category?: Category;
  /** Hide the Featured badge where every item is featured anyway. */
  showFeaturedBadge?: boolean;
}

const CARD_IMAGE_SIZES =
  "(min-width: 1120px) 352px, (min-width: 640px) 33vw, 100vw";

/**
 * Reusable product card, rendered from catalog data.
 * The title link is stretched over the whole card, so the card is fully
 * clickable while screen readers get one clear link named after the product.
 */
export function ProductCard({
  product,
  category: providedCategory,
  showFeaturedBadge = true,
}: ProductCardProps) {
  const category = providedCategory ?? getCategoryBySlug(product.category);

  return (
    <article className={styles.card}>
      <div className={styles.media}>
        <ProductPreview
          product={product}
          category={category}
          sizes={CARD_IMAGE_SIZES}
        />
        <ProductBadges
          isFeatured={product.isFeatured}
          isNew={product.isNew}
          showFeatured={showFeaturedBadge}
          className={styles.badges}
        />
      </div>
      <div className={styles.body}>
        <p className={styles.category}>{category?.name}</p>
        <h3 className={styles.title}>
          <Link href={`/products/${product.slug}`} className={styles.link}>
            {product.title}
          </Link>
        </h3>
        <p className={styles.description}>{product.description}</p>
        <div className={styles.footer}>
          <span className={styles.price}>{formatPrice(product.price)}</span>
          <span className={styles.viewHint} aria-hidden="true">
            View details
            <Icon name="arrow-right" size={15} />
          </span>
        </div>
      </div>
    </article>
  );
}
