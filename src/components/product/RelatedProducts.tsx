import { ProductCard } from "@/components/product/ProductCard";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getRelatedProducts } from "@/data/products";
import type { Product } from "@/types";
import styles from "./RelatedProducts.module.css";

interface RelatedProductsProps {
  product: Product;
}

/** Same-category products first; never includes the current product. */
export function RelatedProducts({ product }: RelatedProductsProps) {
  const { items, sameCategory } = getRelatedProducts(product);
  if (items.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby="related-heading">
      <SectionHeading
        id="related-heading"
        title={sameCategory ? "Related products" : "More from the catalog"}
        description={
          sameCategory
            ? undefined
            : "No other products in this category yet — here are some others to explore."
        }
      />
      <ul className={styles.grid}>
        {items.map((item) => (
          <li key={item.id} className={styles.item}>
            <ProductCard product={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}
