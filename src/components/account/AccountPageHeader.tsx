import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import styles from "./AccountPageHeader.module.css";

interface AccountPageHeaderProps {
  title: string;
  description: string;
  eyebrow?: string;
  action?: ReactNode;
  backLink?: { href: string; label: string };
}

export function AccountPageHeader({
  title,
  description,
  eyebrow,
  action,
  backLink,
}: AccountPageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.copy}>
        {backLink ? (
          <Link className={styles.backLink} href={backLink.href}>
            <Icon name="arrow-right" size={15} />
            <span>{backLink.label}</span>
          </Link>
        ) : null}
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.description}>{description}</p>
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </header>
  );
}
