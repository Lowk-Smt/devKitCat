import Link from "next/link";
import { ProductCard } from "@/components/product/ProductCard";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type { Product } from "@/types";
import { cx } from "@/lib/cx";
import styles from "./FeaturedProductsSection.module.css";

interface FeaturedProductsSectionProps {
  products: Product[];
}

/** Homepage section showcasing featured products from the mock catalog. */
export function FeaturedProductsSection({
  products,
}: FeaturedProductsSectionProps) {
  return (
    <section
      className={cx("section", styles.section)}
      aria-labelledby="featured-heading"
    >
      <div className="container">
        <SectionHeading
          id="featured-heading"
          eyebrow="Featured"
          title="Hand-picked starting points"
          description="A few of the most useful resources in the catalog right now."
          action={
            <Link href="/products" className={styles.viewAll}>
              View all products
              <span aria-hidden="true"> →</span>
            </Link>
          }
        />
        <div className="card-grid">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              showFeaturedBadge={false}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
