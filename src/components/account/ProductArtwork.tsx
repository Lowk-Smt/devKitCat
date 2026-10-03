import { ProductImage } from "@/components/product/ProductImage";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { getCategoryBySlug } from "@/data/categories";
import type { IconName, Product } from "@/types";
import styles from "./ProductArtwork.module.css";

interface ProductArtworkProps {
  /** `category` is only used to choose a placeholder icon, so it is optional. */
  product: Pick<Product, "title" | "images"> & { category?: Product["category"] };
  size?: "sm" | "md";
  /** Placeholder icon to use instead of the category lookup (cart lines). */
  icon?: IconName;
}

/** Small product art for account lists; uses the catalog image or its existing placeholder. */
export function ProductArtwork({ product, size = "md", icon: iconOverride }: ProductArtworkProps) {
  const category = product.category ? getCategoryBySlug(product.category) : undefined;
  const icon = iconOverride ?? category?.icon ?? "systems";
  const fallback = (
    <ProductThumbnail
      icon={icon}
      label={product.title}
      decorative
      className={styles.fallback}
    />
  );

  return (
    <div className={`${styles.artwork} ${styles[size]}`}>
      {product.images[0] ? (
        <ProductImage
          src={product.images[0]}
          alt=""
          fallback={fallback}
          sizes={size === "sm" ? "56px" : "88px"}
        />
      ) : (
        fallback
      )}
    </div>
  );
}
