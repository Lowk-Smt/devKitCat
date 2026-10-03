import { AccountPageHeader } from "@/components/account/AccountPageHeader";
import { AccountSection } from "@/components/account/AccountSection";
import { SettingsForm } from "@/components/account/SettingsForm";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { toIsoDate } from "@/lib/account-presentation";
import { formatDate } from "@/lib/catalog";
import { requireCustomer } from "@/lib/server/auth";
import { signOutAction } from "@/lib/server/auth-actions";
import styles from "@/components/account/AccountPage.module.css";

export const metadata = {
  title: "Account settings",
};

export default async function AccountSettingsPage() {
  const customer = await requireCustomer();
  const memberSince = toIsoDate(customer.createdAt);

  return (
    <div className={styles.page}>
      <AccountPageHeader
        eyebrow="Your account"
        title="Account settings"
        description="Review and update the profile and preferences stored on your devKitCat account."
      />

      <div className={styles.settingsLayout}>
        <AccountSection
          title="Profile & preferences"
          description="Changes are saved to your customer record. Your password and email address are not editable here."
        >
          <SettingsForm customer={customer} />
        </AccountSection>

        <div className={styles.stack}>
          <AccountSection title="Account">
            <div className={styles.accountFacts}>
              <div className={styles.fact}>
                <span className={styles.factIcon}>
                  <Icon name="user" size={18} />
                </span>
                <div className={styles.factCopy}>
                  <h3 className={styles.factTitle}>Signed-in profile</h3>
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
                    <time dateTime={memberSince}>{formatDate(memberSince)}</time>
                  </p>
                </div>
              </div>
            </div>
            <p className={styles.summaryNote}>
              This session is stored on the server and ends when you sign out or
              when it expires. Your password is kept only as a salted scrypt
              hash.
            </p>
            <form action={signOutAction} className={styles.sessionRow}>
              <Button type="submit" variant="secondary" size="sm">
                <Icon name="user" size={16} />
                Sign out
              </Button>
            </form>
          </AccountSection>

          <AccountSection title="Not connected yet">
            <div className={styles.fact}>
              <span className={styles.factIcon}>
                <Icon name="info" size={18} />
              </span>
              <div className={styles.factCopy}>
                <h3 className={styles.factTitle}>Deferred account services</h3>
                <p className={styles.factDescription}>
                  Checkout, payment processing, secure file delivery, email
                  verification, password recovery, and social sign-in are not
                  part of this milestone.
                </p>
              </div>
            </div>
          </AccountSection>
        </div>
      </div>
    </div>
  );
}
