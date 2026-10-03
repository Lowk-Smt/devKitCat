import type { ReactNode } from "react";
import styles from "./AccountSection.module.css";

interface AccountSectionProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function AccountSection({
  title,
  description,
  action,
  children,
  className,
}: AccountSectionProps) {
  return (
    <section className={`${styles.section}${className ? ` ${className}` : ""}`}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2 className={styles.title}>{title}</h2>
          {description ? <p className={styles.description}>{description}</p> : null}
        </div>
        {action ? <div className={styles.action}>{action}</div> : null}
      </header>
      <div className={styles.content}>{children}</div>
    </section>
  );
}
