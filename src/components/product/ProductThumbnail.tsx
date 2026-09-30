import { Icon } from "@/components/ui/Icon";
import type { IconName } from "@/types";
import styles from "./ProductThumbnail.module.css";

interface ProductThumbnailProps {
  icon: IconName;
  label: string;
  className?: string;
  /** Hide from assistive tech when the surrounding UI already names the product. */
  decorative?: boolean;
}

/**
 * Data-driven placeholder artwork for a product.
 * Real product images replace this once assets land in a later PR.
 */
export function ProductThumbnail({
  icon,
  label,
  className,
  decorative = false,
}: ProductThumbnailProps) {
  return (
    <div
      className={
        className ? `${styles.thumbnail} ${className}` : styles.thumbnail
      }
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": `${label} artwork placeholder` })}
    >
      <span className={styles.iconWrap}>
        <Icon name={icon} size={30} />
      </span>
      {decorative ? null : <span className={styles.label}>{label}</span>}
    </div>
  );
}
