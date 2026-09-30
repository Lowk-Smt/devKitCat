import { PRODUCT_SECTIONS } from "@/components/product/detail/sections";
import styles from "./SectionNav.module.css";

/** In-page anchor navigation for the product detail sections. */
export function SectionNav() {
  return (
    <nav className={styles.nav} aria-label="On this page">
      <p className={styles.heading} aria-hidden="true">
        On this page
      </p>
      <ul className={styles.list}>
        {PRODUCT_SECTIONS.map((section) => (
          <li key={section.id}>
            <a href={`#${section.id}`} className={styles.link}>
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
