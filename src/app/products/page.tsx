import type { Metadata } from "next";
import Link from "next/link";
import { ProductCard } from "@/components/product/ProductCard";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { categories, getCategoryBySlug } from "@/data/categories";
import { getProductsByCategory, products } from "@/data/products";
import { cx } from "@/lib/cx";
import styles from "./products.module.css";

export const metadata: Metadata = {
  title: "Products",
  description:
    "Browse production-ready systems, UI kits, assets, and developer resources for Roblox creators.",
};

interface ProductsPageProps {
  searchParams: Promise<{ category?: string }>;
}

export default async function ProductsPage({
  searchParams,
}: ProductsPageProps) {
  const { category } = await searchParams;
  const activeCategory =
    category && getCategoryBySlug(category) ? category : undefined;
  const categoryData = activeCategory ? getCategoryBySlug(activeCategory) : undefined;
  const visibleProducts = activeCategory
    ? getProductsByCategory(activeCategory)
    : products;

  return (
    <div className={cx("section", styles.page)}>
      <div className="container">
        <SectionHeading
          eyebrow="Catalog"
          title="Browse products"
          description={
            categoryData
              ? `Showing products in ${categoryData.name}.`
              : "Every resource in the devKitCat catalog, straight from the local mock data."
          }
        />

        <nav className={styles.filters} aria-label="Filter products by category">
          <Link
            href="/products"
            className={cx(
              styles.filter,
              !activeCategory && styles.filterActive,
            )}
            aria-current={!activeCategory ? "page" : undefined}
          >
            All products
          </Link>
          {categories.map((categoryItem) => {
            const isActive = activeCategory === categoryItem.slug;
            return (
              <Link
                key={categoryItem.id}
                href={`/products?category=${categoryItem.slug}`}
                className={cx(styles.filter, isActive && styles.filterActive)}
                aria-current={isActive ? "page" : undefined}
              >
                {categoryItem.name}
              </Link>
            );
          })}
        </nav>

        {visibleProducts.length > 0 ? (
          <div className={cx("card-grid", styles.grid)}>
            {visibleProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>
              No products in this category yet.
            </p>
            <p className={styles.emptyText}>
              New resources are added regularly — check back soon or browse
              everything.
            </p>
            <Link href="/products" className={styles.emptyLink}>
              Show all products
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
