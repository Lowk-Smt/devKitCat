import { DetailSection } from "@/components/product/detail/DetailSection";
import { Icon } from "@/components/ui/Icon";
import { formatDate } from "@/lib/catalog";
import type { Product } from "@/types";
import styles from "./ProductDetailSections.module.css";

interface ProductDetailSectionsProps {
  product: Product;
}

/** The structured content sections of a product page, rendered from data. */
export function ProductDetailSections({ product }: ProductDetailSectionsProps) {
  return (
    <div className={styles.sections}>
      <DetailSection id="overview" title="Overview">
        <div className={styles.prose}>
          {product.overview.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </DetailSection>

      <DetailSection id="features" title="Features">
        <ul className={styles.featureList}>
          {product.features.map((feature) => (
            <li key={feature} className={styles.featureItem}>
              <span className={styles.featureMarker} aria-hidden="true" />
              {feature}
            </li>
          ))}
        </ul>
      </DetailSection>

      <DetailSection id="requirements" title="Requirements">
        <ul className={styles.requirementList}>
          {product.requirements.map((requirement) => (
            <li key={requirement}>
              <Icon name="check" size={16} className={styles.check} />
              {requirement}
            </li>
          ))}
        </ul>
      </DetailSection>

      <DetailSection id="included" title="What's included">
        <ul className={styles.fileList}>
          {product.includedFiles.map((file) => (
            <li key={file} className={styles.fileItem}>
              <Icon name="templates" size={16} />
              {file}
            </li>
          ))}
        </ul>
      </DetailSection>

      <DetailSection id="installation" title="Installation">
        <ol className={styles.steps}>
          {product.installation.map((step) => (
            <li key={step} className={styles.step}>
              {step}
            </li>
          ))}
        </ol>
      </DetailSection>

      <DetailSection id="documentation" title="Documentation">
        <p className={styles.prose}>{product.documentation.summary}</p>
        <ul className={styles.topicList} aria-label="Documentation topics">
          {product.documentation.topics.map((topic) => (
            <li key={topic} className={styles.topic}>
              <Icon name="docs" size={16} />
              {topic}
            </li>
          ))}
        </ul>
        <p className={styles.hint}>
          Documentation ships with the product files. Online documentation pages
          aren&apos;t available yet.
        </p>
      </DetailSection>

      <DetailSection id="changelog" title="Changelog">
        <ol className={styles.changelog}>
          {product.changelog.map((entry) => (
            <li key={entry.version} className={styles.changelogEntry}>
              <div className={styles.changelogHeader}>
                <span className={styles.changelogVersion}>
                  v{entry.version}
                </span>
                <time className={styles.changelogDate} dateTime={entry.date}>
                  {formatDate(entry.date)}
                </time>
              </div>
              <p className={styles.changelogNotes}>{entry.notes}</p>
            </li>
          ))}
        </ol>
      </DetailSection>

      <DetailSection id="license" title="License">
        <p className={styles.licenseName}>
          <Icon name="production" size={18} />
          {product.license}
        </p>
        <p className={styles.hint}>
          Full license terms will be published before purchasing is available.
        </p>
      </DetailSection>
    </div>
  );
}
