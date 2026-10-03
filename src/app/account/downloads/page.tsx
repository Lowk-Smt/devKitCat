import { AccountCollectionState } from "@/components/account/AccountCollectionState";
import { AccountPageHeader } from "@/components/account/AccountPageHeader";
import { AccountSection } from "@/components/account/AccountSection";
import { DownloadCard } from "@/components/account/DownloadCard";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getMockDownloads } from "@/data/mock-account";
import { parseAccountCollectionPreviewState } from "@/lib/account-presentation";
import styles from "@/components/account/AccountPage.module.css";

export const metadata = {
  title: "Downloads",
};

export default async function DownloadsPage({
  searchParams,
}: PageProps<"/account/downloads">) {
  const params = await searchParams;
  const previewState = parseAccountCollectionPreviewState(params.preview);
  const downloads = getMockDownloads();

  return (
    <div className={styles.page}>
      <AccountPageHeader
        eyebrow="Your account"
        title="Downloads"
        description="Find the resources linked to your demo purchases and review their catalog versions."
      />

      <AccountSection
        title="Your library"
        description="Download delivery is not connected. The disabled controls below are placeholders only."
      >
        {previewState === "loading" || previewState === "error" ? (
          <AccountCollectionState
            state={previewState}
            collection="downloads"
            populatedHref="/account/downloads"
          />
        ) : previewState === "empty" || downloads.length === 0 ? (
          <EmptyState
            icon="download"
            title="Your library is empty"
            description="Purchased products will be listed here when account purchases are connected. This is an empty-state preview."
            action={
              <Button href="/products" variant="secondary">
                Browse products
              </Button>
            }
          />
        ) : (
          <div className={styles.downloadsGrid}>
            {downloads.map((download) => (
              <DownloadCard key={download.product.id} download={download} />
            ))}
          </div>
        )}
      </AccountSection>
    </div>
  );
}
