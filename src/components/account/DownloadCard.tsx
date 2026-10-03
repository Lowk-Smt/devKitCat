import Link from "next/link";
import { ProductArtwork } from "@/components/account/ProductArtwork";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { formatDate } from "@/lib/catalog";
import type { DownloadStatus, ResolvedDownload } from "@/types/account";
import styles from "./DownloadCard.module.css";

interface DownloadCardProps {
  download: ResolvedDownload;
  compact?: boolean;
}

const DOWNLOAD_STATUS_LABELS: Record<DownloadStatus, string> = {
  "coming-soon": "Delivery coming soon",
};

export function DownloadCard({ download, compact = false }: DownloadCardProps) {
  const { product } = download;

  return (
    <article className={`${styles.card}${compact ? ` ${styles.compact}` : ""}`}>
      <div className={styles.productHead}>
        <ProductArtwork product={product} size="sm" />
        <div className={styles.productInfo}>
          <h3 className={styles.title}>
            <Link href={`/products/${product.slug}`}>{product.title}</Link>
          </h3>
          <p className={styles.category}>{download.categoryName}</p>
          <span className={styles.comingSoon}>
            {DOWNLOAD_STATUS_LABELS[download.status]}
          </span>
        </div>
      </div>

      <dl className={styles.details}>
        <div>
          <dt>Version</dt>
          <dd>{download.version}</dd>
        </div>
        <div>
          <dt>Files</dt>
          <dd>{download.fileCount}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>
            <time dateTime={download.lastUpdated}>
              {formatDate(download.lastUpdated)}
            </time>
          </dd>
        </div>
      </dl>

      <div className={styles.actions}>
        <Button
          variant="secondary"
          size="sm"
          disabled
          ariaLabel={`Download ${product.title} — coming soon`}
          className={styles.downloadButton}
        >
          <Icon name="download" size={16} />
          Download soon
        </Button>
        <Link className={styles.productLink} href={`/products/${product.slug}`}>
          View product <Icon name="arrow-up-right" size={14} />
        </Link>
      </div>
      {!compact ? (
        <p className={styles.helper}>
          File delivery is not enabled in this frontend preview.
        </p>
      ) : null}
    </article>
  );
}
