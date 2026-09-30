import type { ReactNode } from "react";
import styles from "./DetailSection.module.css";

interface DetailSectionProps {
  id: string;
  title: string;
  children: ReactNode;
}

/** Anchored, labelled section shell used by the product detail page. */
export function DetailSection({ id, title, children }: DetailSectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={styles.section}
    >
      <h2 id={`${id}-heading`} className={styles.title}>
        {title}
      </h2>
      {children}
    </section>
  );
}
