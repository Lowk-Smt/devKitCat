import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import styles from "./AccountCollectionState.module.css";

interface AccountCollectionStateProps {
  state: "loading" | "error";
  collection: "purchases" | "downloads";
  populatedHref: string;
}

export function AccountCollectionState({
  state,
  collection,
  populatedHref,
}: AccountCollectionStateProps) {
  const label = collection === "purchases" ? "purchases" : "downloads";

  if (state === "loading") {
    return (
      <div
        className={styles.skeletonList}
        role="status"
        aria-label={`Loading ${label}`}
      >
        <span className="sr-only">Loading {label}…</span>
        {[0, 1].map((item) => (
          <div className={styles.skeletonCard} key={item} aria-hidden="true">
            <span className={styles.skeletonLine} />
            <span className={`${styles.skeletonLine} ${styles.medium}`} />
            <span className={`${styles.skeletonLine} ${styles.short}`} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <section className={styles.error} role="alert">
      <span className={styles.errorIcon} aria-hidden="true">
        <Icon name="info" size={21} />
      </span>
      <div>
        <h2>We couldn&apos;t show the demo {label}</h2>
        <p>
          This is a visual error-state preview. No account service or backend was
          contacted.
        </p>
        <Link className={styles.retryLink} href={populatedHref}>
          Return to populated demo data <Icon name="arrow-right" size={15} />
        </Link>
      </div>
    </section>
  );
}
