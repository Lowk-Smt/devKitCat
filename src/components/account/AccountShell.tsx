import Link from "next/link";
import type { ReactNode } from "react";
import { AccountNavigation } from "@/components/account/AccountNavigation";
import { Icon } from "@/components/ui/Icon";
import { customerInitials, toIsoDate } from "@/lib/account-presentation";
import { formatDate } from "@/lib/catalog";
import { signOutAction } from "@/lib/server/auth-actions";
import type { CustomerRecord } from "@/types/account";
import styles from "./AccountShell.module.css";

interface AccountShellProps {
  /** The authenticated customer resolved by `requireCustomer()`. */
  customer: CustomerRecord;
  children: ReactNode;
}

/**
 * Account chrome for a signed-in customer: identity, section navigation, and a
 * sign-out action that revokes the stored session before clearing its cookie.
 */
export function AccountShell({ customer, children }: AccountShellProps) {
  const initials = customerInitials(customer.name);
  const memberSince = toIsoDate(customer.createdAt);

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <aside className={styles.sidebar} aria-label="Customer account">
          <div className={styles.identity}>
            <span className={styles.avatar} aria-hidden="true">
              {initials}
            </span>
            <div className={styles.identityText}>
              <div className={styles.nameRow}>
                <span className={styles.name}>{customer.name}</span>
                <span className={styles.statusBadge}>Signed in</span>
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
            <form action={signOutAction} className={styles.signOutForm}>
              <button className={styles.footerAction} type="submit">
                <Icon name="user" size={17} />
                <span>Sign out</span>
              </button>
            </form>
            <p className={styles.footerNote}>
              Signing out ends this session on the server and on this device.
            </p>
          </div>
        </aside>

        <div className={styles.contentColumn}>
          <div className={styles.mobileHeader}>
            <div className={styles.mobileIdentity}>
              <span className={styles.avatar} aria-hidden="true">
                {initials}
              </span>
              <div className={styles.identityText}>
                <span className={styles.mobileEyebrow}>Signed in</span>
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
                  <form action={signOutAction} className={styles.signOutForm}>
                    <button className={styles.footerAction} type="submit">
                      <Icon name="user" size={17} />
                      <span>Sign out</span>
                    </button>
                  </form>
                </div>
              </div>
            </details>
          </div>

          <div className={styles.accountNotice} role="note">
            <span className={styles.noticeIcon}>
              <Icon name="info" size={17} />
            </span>
            <p>
              <strong>Your devKitCat account.</strong> Purchases, downloads, and
              profile details here belong to {customer.email}. Checkout, paid
              file delivery, and password recovery are not part of this
              milestone.
            </p>
          </div>

          <div className={styles.memberNote}>
            <Icon name="calendar" size={15} />
            <span>
              Member since{" "}
              <time dateTime={memberSince}>{formatDate(memberSince)}</time>
            </span>
          </div>

          <div className={styles.mainContent}>{children}</div>
        </div>
      </div>
    </div>
  );
}
