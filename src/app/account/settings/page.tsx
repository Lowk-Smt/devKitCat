import Link from "next/link";
import { AccountPageHeader } from "@/components/account/AccountPageHeader";
import { AccountSection } from "@/components/account/AccountSection";
import { SettingsForm } from "@/components/account/SettingsForm";
import { Icon } from "@/components/ui/Icon";
import { mockAccountPresentation } from "@/data/mock-account";
import { formatDate } from "@/lib/catalog";
import styles from "@/components/account/AccountPage.module.css";

export const metadata = {
  title: "Account settings",
};

export default function AccountSettingsPage() {
  const { customer } = mockAccountPresentation;

  return (
    <div className={styles.page}>
      <AccountPageHeader
        eyebrow="Your account"
        title="Account settings"
        description="Review the profile and preference controls for this frontend-only demo."
      />

      <div className={styles.settingsLayout}>
        <AccountSection
          title="Profile & preferences"
          description="Use the controls to preview the settings layout. No changes are saved."
        >
          <SettingsForm
            name={customer.name}
            email={customer.email}
            preferences={customer.preferences}
          />
        </AccountSection>

        <div className={styles.stack}>
          <AccountSection title="Account">
            <div className={styles.accountFacts}>
              <div className={styles.fact}>
                <span className={styles.factIcon}>
                  <Icon name="user" size={18} />
                </span>
                <div className={styles.factCopy}>
                  <h3 className={styles.factTitle}>Demo profile</h3>
                  <p className={styles.factDescription}>
                    {customer.name} · {customer.email}
                  </p>
                </div>
              </div>
              <div className={styles.fact}>
                <span className={styles.factIcon}>
                  <Icon name="calendar" size={18} />
                </span>
                <div className={styles.factCopy}>
                  <h3 className={styles.factTitle}>Member since</h3>
                  <p className={styles.factDescription}>
                    <time dateTime={customer.memberSince}>
                      {formatDate(customer.memberSince)}
                    </time>
                  </p>
                </div>
              </div>
            </div>
            <p className={styles.summaryNote}>
              This fixed demo identity is not authenticated and has no stored session.
            </p>
            <Link className={styles.inlineLink} href="/login">
              <Icon name="user" size={16} />
              Sign out preview <Icon name="arrow-up-right" size={14} />
            </Link>
          </AccountSection>

          <AccountSection title="Not connected yet">
            <div className={styles.fact}>
              <span className={styles.factIcon}>
                <Icon name="info" size={18} />
              </span>
              <div className={styles.factCopy}>
                <h3 className={styles.factTitle}>Account services are deferred</h3>
                <p className={styles.factDescription}>
                  Authentication, profile persistence, payments, and secure file delivery are not part of this frontend milestone.
                </p>
              </div>
            </div>
          </AccountSection>
        </div>
      </div>
    </div>
  );
}
