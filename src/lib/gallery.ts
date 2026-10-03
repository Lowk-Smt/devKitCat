import type { IconName, Product } from "@/types";

/**
 * One entry in a product gallery. New media types plug into the stage and
 * thumbnail renderers without changing selection or the product page.
 */
export type GalleryItem = GalleryImage | GalleryModel | GalleryPlaceholder;

interface GalleryItemBase {
  id: string;
  /** Short name used for thumbnail buttons and screen reader announcements. */
  label: string;
}

export interface GalleryImage extends GalleryItemBase {
  kind: "image";
  src: string;
  alt: string;
}

export interface GalleryModel extends GalleryItemBase {
  kind: "model";
  src: string;
  title: string;
  description: string;
}

/** Stand-in artwork for products that don't have real imagery yet. */
export interface GalleryPlaceholder extends GalleryItemBase {
  kind: "placeholder";
  icon: IconName;
  categoryName: string;
}

interface GalleryContext {
  categoryName: string;
  icon: IconName;
}

/** Model previews first, then images; keep the original empty-gallery fallback. */
export function buildGalleryItems(
  product: Pick<Product, "id" | "title" | "images" | "modelPreviews">,
  { categoryName, icon }: GalleryContext,
): GalleryItem[] {
  const items: GalleryItem[] = [
    ...(product.modelPreviews ?? []).map((preview, index): GalleryModel => ({
      id: `${product.id}-model-${index}`,
      kind: "model",
      label: preview.label,
      src: preview.src,
      title: `${product.title} — ${preview.label}`,
      description: preview.description,
    })),
    ...product.images.map((src, index): GalleryImage => ({
      id: `${product.id}-image-${index}`,
      kind: "image",
      label: `Image ${index + 1}`,
      src,
      alt: `${product.title} — preview ${index + 1} of ${product.images.length}`,
    })),
  ];

  return items.length > 0
    ? items
    : [
        {
          id: `${product.id}-placeholder`,
          kind: "placeholder",
          label: "Preview",
          icon,
          categoryName,
        },
      ];
}
