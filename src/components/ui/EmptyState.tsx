import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { cx } from "@/lib/cx";
import type { IconName } from "@/types";
import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  icon: IconName;
  title: string;
  description: string;
  /** Optional call to action (link or button). */
  action?: ReactNode;
  /** Heading level for the title; pick one that fits the page outline. */
  headingLevel?: 2 | 3;
  className?: string;
}

/** Shared empty / no-results panel. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  headingLevel = 2,
  className,
}: EmptyStateProps) {
  const Title = headingLevel === 2 ? "h2" : "h3";

  return (
    <div className={cx(styles.empty, className)}>
      <span className={styles.icon}>
        <Icon name={icon} size={22} />
      </span>
      <Title className={styles.title}>{title}</Title>
      <p className={styles.description}>{description}</p>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
