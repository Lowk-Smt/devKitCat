import { Button } from "@/components/ui/Button";
import { cx } from "@/lib/cx";
import styles from "./not-found.module.css";

export default function NotFound() {
  return (
    <div className={styles.wrapper}>
      <div className={cx("container", styles.inner)}>
        <p className={styles.code}>404</p>
        <h1 className={styles.title}>Page not found</h1>
        <p className={styles.description}>
          The page you are looking for doesn&apos;t exist or may have moved.
        </p>
        <div className={styles.actions}>
          <Button href="/">Back to homepage</Button>
          <Button href="/products" variant="secondary">
            Browse Products
          </Button>
        </div>
      </div>
    </div>
  );
}
