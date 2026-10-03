import Link from "next/link";
import type { ReactNode } from "react";
import { AccountNavigation } from "@/components/account/AccountNavigation";
import { Icon } from "@/components/ui/Icon";
import { formatDate } from "@/lib/catalog";
import { mockAccountPresentation } from "@/data/mock-account";
import styles from "./AccountShell.module.css";

export function AccountShell({ children }: { children: ReactNode }) {
  const { customer, status } = mockAccountPresentation;
  const isDemoSignedIn = status === "demo-signed-in";

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <aside className={styles.sidebar} aria-label="Customer account">
          <div className={styles.identity}>
            <span className={styles.avatar} aria-hidden="true">
              {customer.initials}
            </span>
            <div className={styles.identityText}>
              <div className={styles.nameRow}>
                <span className={styles.name}>{customer.name}</span>
                <span className={styles.demoBadge}>
                  {isDemoSignedIn ? "Demo" : "Signed out"}
                </span>
              </div>
              <span className={styles.email}>{customer.email}</span>
            </div>
          </div>

          <AccountNavigation variant="sidebar" />

          <div className={styles.sidebarFooter}>
            <Link className={styles.footerLink} href="/products">
              <Icon name="arrow-up-right" size={17} />
              <span>Back to marketplace</span>
            </Link>
            <Link className={styles.footerLink} href="/login">
              <Icon name="user" size={17} />
              <span>Sign out</span>
              <span className={styles.demoOnly}>demo</span>
            </Link>
            <p className={styles.footerNote}>
              Sign out opens the sign-in preview; no session is stored.
            </p>
          </div>
        </aside>

        <div className={styles.contentColumn}>
          <div className={styles.mobileHeader}>
            <div className={styles.mobileIdentity}>
              <span className={styles.avatar} aria-hidden="true">
                {customer.initials}
              </span>
              <div className={styles.identityText}>
                <span className={styles.mobileEyebrow}>
                  {isDemoSignedIn ? "Demo account" : "Signed out"}
                </span>
                <span className={styles.name}>{customer.name}</span>
              </div>
            </div>
            <details className={styles.mobileMenu}>
              <summary className={styles.mobileMenuSummary}>
                <span>Account sections</span>
                <Icon name="menu" size={18} />
              </summary>
              <div className={styles.mobileMenuContent}>
                <AccountNavigation variant="mobile" />
                <div className={styles.mobileFooterLinks}>
                  <Link className={styles.footerLink} href="/products">
                    <Icon name="arrow-up-right" size={17} />
                    <span>Back to marketplace</span>
                  </Link>
                  <Link className={styles.footerLink} href="/login">
                    <Icon name="user" size={17} />
                    <span>Sign out</span>
                    <span className={styles.demoOnly}>demo</span>
                  </Link>
                </div>
              </div>
            </details>
          </div>

          <div className={styles.demoNotice} role="note">
            <span className={styles.noticeIcon}>
              <Icon name="info" size={17} />
            </span>
            <p>
              <strong>Frontend preview.</strong> This is mock account data only;
              authentication, persistence, payments, and secure downloads are
              not connected.
            </p>
          </div>

          <div className={styles.memberNote}>
            <Icon name="calendar" size={15} />
            <span>Member since {formatDate(customer.memberSince)}</span>
          </div>

          <div className={styles.mainContent}>{children}</div>
        </div>
      </div>
    </div>
  );
}
