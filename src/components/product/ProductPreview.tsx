import { ProductImage } from "@/components/product/ProductImage";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { getCategoryBySlug } from "@/data/categories";
import type { Product } from "@/types";

interface ProductPreviewProps {
  product: Product;
  sizes: string;
}

/**
 * A product's single preview (used on cards): its first image when there is
 * one, otherwise the placeholder artwork. Decorative — the card's link text
 * already names the product.
 */
export function ProductPreview({ product, sizes }: ProductPreviewProps) {
  const category = getCategoryBySlug(product.category);
  const placeholder = (
    <ProductThumbnail
      icon={category?.icon ?? "templates"}
      label={category?.name ?? "Product"}
      decorative
    />
  );
  const [image] = product.images;

  if (!image) return placeholder;

  return (
    <ProductImage src={image} alt="" sizes={sizes} fallback={placeholder} />
  );
}
