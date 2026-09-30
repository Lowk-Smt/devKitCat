import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { Icon } from "@/components/ui/Icon";
import { getCategoryBySlug } from "@/data/categories";
import { getProductBySlug, products } from "@/data/products";
import { formatPrice, PRODUCT_TYPE_LABELS } from "@/lib/catalog";
import styles from "./product.module.css";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return products.map((product) => ({ slug: product.slug }));
}

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = getProductBySlug(slug);

  if (!product) {
    return { title: "Product not found" };
  }

  return {
    title: product.title,
    description: product.description,
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = getProductBySlug(slug);

  if (!product) {
    notFound();
  }

  const category = getCategoryBySlug(product.category);

  return (
    <div className={styles.page}>
      <div className="container">
        <Link href="/products" className={styles.backLink}>
          <span aria-hidden="true">←</span> Back to products
        </Link>

        <header className={styles.header}>
          <div className={styles.headerMeta}>
            {category ? (
              <Link
                href={`/products?category=${category.slug}`}
                className={styles.categoryChip}
              >
                {category.name}
              </Link>
            ) : null}
            {product.isNew ? <span className={styles.newBadge}>New</span> : null}
          </div>
          <h1 className={styles.title}>{product.title}</h1>
          <p className={styles.lede}>{product.description}</p>
        </header>

        <div className={styles.layout}>
          <div className={styles.main}>
            <section aria-labelledby="features-heading" className={styles.block}>
              <h2 id="features-heading" className={styles.blockTitle}>
                Features
              </h2>
              <ul className={styles.featureList}>
                {product.features.map((feature) => (
                  <li key={feature} className={styles.featureItem}>
                    <span className={styles.featureMarker} aria-hidden="true" />
                    {feature}
                  </li>
                ))}
              </ul>
            </section>

            <section
              aria-labelledby="included-heading"
              className={styles.block}
            >
              <h2 id="included-heading" className={styles.blockTitle}>
                What&apos;s included
              </h2>
              <ul className={styles.fileList}>
                {product.includedFiles.map((file) => (
                  <li key={file} className={styles.fileItem}>
                    <Icon name="templates" size={16} />
                    {file}
                  </li>
                ))}
              </ul>
            </section>

            <section
              aria-labelledby="requirements-heading"
              className={styles.block}
            >
              <h2 id="requirements-heading" className={styles.blockTitle}>
                Requirements
              </h2>
              <ul className={styles.requirementList}>
                {product.requirements.map((requirement) => (
                  <li key={requirement}>{requirement}</li>
                ))}
              </ul>
            </section>

            <section
              aria-labelledby="changelog-heading"
              className={styles.block}
            >
              <h2 id="changelog-heading" className={styles.blockTitle}>
                Changelog
              </h2>
              <ol className={styles.changelog}>
                {product.changelog.map((entry) => (
                  <li key={entry.version} className={styles.changelogEntry}>
                    <div className={styles.changelogHeader}>
                      <span className={styles.changelogVersion}>
                        v{entry.version}
                      </span>
                      <time className={styles.changelogDate} dateTime={entry.date}>
                        {entry.date}
                      </time>
                    </div>
                    <p className={styles.changelogNotes}>{entry.notes}</p>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <aside className={styles.aside} aria-label="Product summary">
            <div className={styles.buyBox}>
              <ProductThumbnail
                icon={category?.icon ?? "templates"}
                label={category?.name ?? "Product"}
              />
              <p className={styles.price}>{formatPrice(product.price)}</p>
              <dl className={styles.metaList}>
                <div className={styles.metaRow}>
                  <dt>Version</dt>
                  <dd>{product.version}</dd>
                </div>
                <div className={styles.metaRow}>
                  <dt>Type</dt>
                  <dd>{PRODUCT_TYPE_LABELS[product.type]}</dd>
                </div>
                <div className={styles.metaRow}>
                  <dt>License</dt>
                  <dd>{product.license}</dd>
                </div>
                <div className={styles.metaRow}>
                  <dt>Category</dt>
                  <dd>
                    {category ? (
                      <Link
                        href={`/products?category=${category.slug}`}
                        className={styles.metaLink}
                      >
                        {category.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              </dl>
              <p className={styles.purchaseNote}>
                Checkout and secure downloads arrive in a later release — this
                page previews the catalog structure for now.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
