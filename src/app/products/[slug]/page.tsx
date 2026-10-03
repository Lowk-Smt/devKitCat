import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductBadges } from "@/components/product/ProductBadges";
import { ProductPurchasePanel } from "@/components/product/ProductPurchasePanel";
import { RelatedProducts } from "@/components/product/RelatedProducts";
import { ProductDetailSections } from "@/components/product/detail/ProductDetailSections";
import { SectionNav } from "@/components/product/detail/SectionNav";
import { ProductGallery } from "@/components/product/gallery/ProductGallery";
import { products as demoProducts } from "@/data/products";
import {
  getProductBySlug,
  listCategories,
} from "@/lib/server/data-access";
import { formatDate, PRODUCT_TYPE_LABELS } from "@/lib/catalog";
import { buildGalleryItems } from "@/lib/gallery";
import styles from "./product.module.css";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  // Keep the existing demo product paths available at build time. `dynamicParams`
  // remains enabled so a database-backed slug can render on its first request.
  return demoProducts.map((product) => ({ slug: product.slug }));
}

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  await connection();
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) {
    return { title: "Product not found" };
  }

  return {
    title: product.title,
    description: product.description,
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  await connection();
  const { slug } = await params;
  const [product, categories] = await Promise.all([
    getProductBySlug(slug),
    listCategories(),
  ]);

  if (!product) {
    notFound();
  }

  const category = categories.find(
    (candidate) => candidate.slug === product.category,
  );
  const galleryItems = buildGalleryItems(product, {
    categoryName: category?.name ?? "Product",
    icon: category?.icon ?? "templates",
  });

  return (
    <div className={styles.page}>
      <div className="container">
        <nav aria-label="Breadcrumb">
          <ol className={styles.breadcrumbList}>
            <li>
              <Link href="/products" className={styles.crumbLink}>
                Marketplace
              </Link>
            </li>
            {category ? (
              <li>
                <Link
                  href={`/products?category=${category.slug}`}
                  className={styles.crumbLink}
                >
                  {category.name}
                </Link>
              </li>
            ) : null}
            <li aria-current="page" className={styles.crumbCurrent}>
              {product.title}
            </li>
          </ol>
        </nav>

        <div className={styles.hero}>
          <ProductGallery items={galleryItems} title={product.title} />

          <div className={styles.summary}>
            <div className={styles.headerMeta}>
              {category ? (
                <Link
                  href={`/products?category=${category.slug}`}
                  className={styles.categoryChip}
                >
                  {category.name}
                </Link>
              ) : null}
              <ProductBadges
                isFeatured={product.isFeatured}
                isNew={product.isNew}
              />
            </div>
            <h1 className={styles.title}>{product.title}</h1>
            <p className={styles.lede}>{product.description}</p>

            <ProductPurchasePanel product={product} />

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
                <dt>Released</dt>
                <dd>
                  <time dateTime={product.releasedAt}>
                    {formatDate(product.releasedAt)}
                  </time>
                </dd>
              </div>
              <div className={styles.metaRow}>
                <dt>License</dt>
                <dd>{product.license}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className={styles.content}>
          <aside className={styles.sectionNav}>
            <SectionNav />
          </aside>
          <ProductDetailSections product={product} />
        </div>

        <RelatedProducts product={product} categories={categories} />
      </div>
    </div>
  );
}
