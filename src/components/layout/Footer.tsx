import { AppLink } from "@/components/ui/AppLink";
import { Logo } from "@/components/layout/Logo";
import { cx } from "@/lib/cx";
import styles from "./Footer.module.css";

const MARKETPLACE_LINKS = [
  { href: "/products", label: "Browse Products" },
  { href: "/#categories", label: "Categories" },
] as const;

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      <div className={cx("container", styles.inner)}>
        <div className={styles.brand}>
          <div className={styles.brandRow}>
            <Logo size={24} />
            <span className={styles.wordmark}>devKitCat</span>
          </div>
          <p className={styles.tagline}>Build better Roblox games.</p>
        </div>

        <nav className={styles.columns} aria-label="Footer">
          <div className={styles.column}>
            <h2 className={styles.columnTitle}>Marketplace</h2>
            <ul className={styles.linkList}>
              {MARKETPLACE_LINKS.map((link) => (
                <li key={link.href}>
                  <AppLink href={link.href} className={styles.link}>
                    {link.label}
                  </AppLink>
                </li>
              ))}
            </ul>
          </div>

          <div className={styles.column}>
            <h2 className={styles.columnTitle}>Resources</h2>
            <ul className={styles.linkList}>
              <li>
                <span className={styles.disabledLink}>
                  Documentation
                  <span className={styles.soonChip}>Soon</span>
                </span>
              </li>
            </ul>
          </div>
        </nav>
      </div>

      <div className={cx("container", styles.bottomBar)}>
        <p>
          &copy; {year} devKitCat. All rights reserved.
        </p>
        <p className={styles.note}>Made for Roblox creators.</p>
      </div>
    </footer>
  );
}
