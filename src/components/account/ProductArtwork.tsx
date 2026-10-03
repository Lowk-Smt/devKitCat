import { ProductImage } from "@/components/product/ProductImage";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { getCategoryBySlug } from "@/data/categories";
import type { Product } from "@/types";
import styles from "./ProductArtwork.module.css";

interface ProductArtworkProps {
  product: Pick<Product, "title" | "category" | "images">;
  size?: "sm" | "md";
}

/** Small product art for account lists; uses the catalog image or its existing placeholder. */
export function ProductArtwork({ product, size = "md" }: ProductArtworkProps) {
  const category = getCategoryBySlug(product.category);
  const icon = category?.icon ?? "systems";
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
