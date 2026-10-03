import { ProductImage } from "@/components/product/ProductImage";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { ModelViewer } from "@/components/product/viewer/ModelViewer";
import type { GalleryItem, GalleryPlaceholder } from "@/lib/gallery";
import styles from "./GalleryStage.module.css";

interface GalleryStageProps {
  item: GalleryItem;
  /** Prioritize loading for the first (above-the-fold) image. */
  priority?: boolean;
}

const STAGE_IMAGE_SIZES = "(min-width: 900px) 560px, 100vw";

function Placeholder({ item }: { item: GalleryPlaceholder }) {
  return (
    <ProductThumbnail
      icon={item.icon}
      label={item.categoryName}
      className={styles.fill}
    />
  );
}

/**
 * The large main preview. Renders whichever kind of media is selected; add a
 * case here to support a new `GalleryItem` kind.
 */
export function GalleryStage({ item, priority = false }: GalleryStageProps) {
  switch (item.kind) {
    case "model":
      return (
        <div className={styles.stage}>
          <ModelViewer
            key={item.id}
            src={item.src}
            title={item.title}
            description={item.description}
          />
        </div>
      );
    case "image":
      return (
        <div className={styles.stage}>
          <ProductImage
            src={item.src}
            alt={item.alt}
            sizes={STAGE_IMAGE_SIZES}
            priority={priority}
            fallback={
              <ProductThumbnail
                icon="templates"
                label="Preview unavailable"
                className={styles.fill}
              />
            }
          />
        </div>
      );
    case "placeholder":
      return (
        <div className={styles.stage}>
          <Placeholder item={item} />
        </div>
      );
  }
}
