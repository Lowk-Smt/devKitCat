import { ProductImage } from "@/components/product/ProductImage";
import { Icon } from "@/components/ui/Icon";
import { cx } from "@/lib/cx";
import type { GalleryItem } from "@/lib/gallery";
import styles from "./GalleryThumb.module.css";

interface GalleryThumbProps {
  item: GalleryItem;
  position: number;
  total: number;
  selected: boolean;
  onSelect: () => void;
}

const THUMB_IMAGE_SIZES = "120px";

function ThumbContent({ item }: { item: GalleryItem }) {
  switch (item.kind) {
    case "image":
      return (
        <ProductImage
          src={item.src}
          alt=""
          sizes={THUMB_IMAGE_SIZES}
          fallback={
            <span className={styles.icon}>
              <Icon name="templates" size={20} />
            </span>
          }
        />
      );
    case "placeholder":
      return (
        <span className={styles.icon}>
          <Icon name={item.icon} size={20} />
        </span>
      );
  }
}

/** A thumbnail button that selects a gallery item. */
export function GalleryThumb({
  item,
  position,
  total,
  selected,
  onSelect,
}: GalleryThumbProps) {
  return (
    <button
      type="button"
      className={cx(styles.thumb, selected && styles.selected)}
      aria-pressed={selected}
      aria-label={`${item.label}, ${position} of ${total}`}
      onClick={onSelect}
    >
      <ThumbContent item={item} />
    </button>
  );
}
