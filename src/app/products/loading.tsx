import { cx } from "@/lib/cx";
import styles from "./products.module.css";

/**
 * Instant fallback while the marketplace content streams in.
 *
 * `/products` renders dynamically (it awaits `connection()` so the server HTML
 * can reflect URL filters), and without a `loading.tsx` the router waited for
 * the entire render — including the catalog reads — before showing anything.
 * This boundary makes navigation respond immediately, and it is also the point
 * `<Link>` prefetches stop at, so the prefetch itself stays cheap.
 */
export default function ProductsLoading() {
  return (
    <div className={cx("section", styles.page)} aria-busy="true">
      <p className="sr-only" role="status">
        Loading the marketplace catalog…
      </p>
      <div className="container" aria-hidden="true">
        <div className={styles.loadingHeading}>
          <span className={cx(styles.skeletonLine, styles.skeletonEyebrow)} />
          <span className={cx(styles.skeletonLine, styles.skeletonTitle)} />
          <span className={cx(styles.skeletonLine, styles.skeletonText)} />
        </div>

        <div className={styles.loadingControls}>
          <span className={cx(styles.skeletonLine, styles.skeletonSearch)} />
          <span className={cx(styles.skeletonLine, styles.skeletonSort)} />
        </div>

        <ul className={styles.loadingGrid}>
          {Array.from({ length: 6 }, (_, index) => (
            <li key={index} className={styles.loadingCard}>
              <span className={styles.loadingCardMedia} />
              <span className={cx(styles.skeletonLine, styles.skeletonCardName)} />
              <span className={cx(styles.skeletonLine, styles.skeletonCardText)} />
              <span
                className={cx(
                  styles.skeletonLine,
                  styles.skeletonCardPrice,
                )}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
