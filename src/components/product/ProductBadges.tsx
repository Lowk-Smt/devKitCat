import { cx } from "@/lib/cx";
import styles from "./ProductBadges.module.css";

interface ProductBadgesProps {
  isFeatured: boolean;
  isNew: boolean;
  /** Hide the Featured badge where every item is featured anyway. */
  showFeatured?: boolean;
  className?: string;
}

/** Featured / New status badges shared by cards and the detail page. */
export function ProductBadges({
  isFeatured,
  isNew,
  showFeatured = true,
  className,
}: ProductBadgesProps) {
  const featured = isFeatured && showFeatured;
  if (!featured && !isNew) return null;

  return (
    <ul className={cx(styles.badges, className)} aria-label="Product status">
      {featured ? (
        <li className={cx(styles.badge, styles.featured)}>Featured</li>
      ) : null}
      {isNew ? <li className={cx(styles.badge, styles.new)}>New</li> : null}
    </ul>
  );
}
