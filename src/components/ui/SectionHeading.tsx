import type { ReactNode } from "react";
import styles from "./SectionHeading.module.css";

interface SectionHeadingProps {
  /** Small uppercase label above the title. */
  eyebrow?: string;
  title: string;
  description?: string;
  /** Optional action rendered on the right (e.g. a "view all" link). */
  action?: ReactNode;
  /** Heading level: sections use h2 by default. */
  level?: 2 | 3;
  id?: string;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  level = 2,
  id,
}: SectionHeadingProps) {
  const Title = level === 2 ? "h2" : "h3";

  return (
    <div className={styles.heading}>
      <div className={styles.text}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <Title className={styles.title} id={id}>
          {title}
        </Title>
        {description ? (
          <p className={styles.description}>{description}</p>
        ) : null}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
