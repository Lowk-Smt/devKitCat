import type { IconName, Product } from "@/types";

/**
 * One entry in a product gallery. The gallery renders a list of these, so new
 * media types (e.g. an interactive 3D model) can be added as another `kind`
 * without changing the gallery's selection, thumbnail, or layout logic.
 */
export type GalleryItem = GalleryImage | GalleryPlaceholder;

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

/** Builds gallery items from a product: its images, or one placeholder. */
export function buildGalleryItems(
  product: Pick<Product, "id" | "title" | "images">,
  { categoryName, icon }: GalleryContext,
): GalleryItem[] {
  if (product.images.length === 0) {
    return [
      {
        id: `${product.id}-placeholder`,
        kind: "placeholder",
        label: "Preview",
        icon,
        categoryName,
      },
    ];
  }

  return product.images.map((src, index) => ({
    id: `${product.id}-image-${index}`,
    kind: "image",
    label: `Image ${index + 1}`,
    src,
    alt: `${product.title} — preview ${index + 1} of ${product.images.length}`,
  }));
}
