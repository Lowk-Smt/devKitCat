import { AccountCollectionState } from "@/components/account/AccountCollectionState";
import { AccountPageHeader } from "@/components/account/AccountPageHeader";
import { AccountSection } from "@/components/account/AccountSection";
import styles from "@/components/account/AccountPage.module.css";

export default function DownloadsLoading() {
  return (
    <div className={styles.page}>
      <AccountPageHeader
        eyebrow="Your account"
        title="Downloads"
        description="Loading your demo library."
      />
      <AccountSection title="Your library">
        <AccountCollectionState
          state="loading"
          collection="downloads"
          populatedHref="/account/downloads"
        />
      </AccountSection>
    </div>
  );
}
