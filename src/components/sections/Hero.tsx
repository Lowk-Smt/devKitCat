import { Button } from "@/components/ui/Button";
import styles from "./Hero.module.css";

/** Homepage hero: brand promise and primary calls to action. */
export function Hero() {
  return (
    <section className={styles.hero} aria-labelledby="hero-heading">
      <div className="container">
        <div className={styles.content}>
          <p className={styles.eyebrow}>Developer resources for Roblox</p>
          <h1 id="hero-heading" className={styles.title}>
            Build better Roblox games.
          </h1>
          <p className={styles.subtitle}>
            Production-ready systems, UI, assets, and developer resources for
            Roblox creators.
          </p>
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
