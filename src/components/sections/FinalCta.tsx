import { Button } from "@/components/ui/Button";
import styles from "./FinalCta.module.css";

/** Closing call-to-action band at the bottom of the homepage. */
export function FinalCta() {
  return (
    <section
      className={styles.section}
      aria-labelledby="final-cta-heading"
    >
      <div className="container">
        <div className={styles.panel}>
          <div className={styles.copy}>
            <h2 id="final-cta-heading" className={styles.title}>
              Ready to build faster?
            </h2>
            <p className={styles.description}>
              Browse the catalog and find your next starting point — systems,
              UI, assets, and full kits for Roblox creators.
            </p>
          </div>
          <div className={styles.actions}>
            <Button href="/products">Browse Products</Button>
            <Button href="/#categories" variant="secondary">
              Explore Categories
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
