import { ProductCard } from "@/components/product/ProductCard";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getRelatedProducts } from "@/lib/server/data-access";
import type { Category, Product } from "@/types";
import styles from "./RelatedProducts.module.css";

interface RelatedProductsProps {
  product: Product;
  categories: readonly Category[];
}

/** Same-category products first; never includes the current product. */
export async function RelatedProducts({
  product,
  categories,
}: RelatedProductsProps) {
  const { items, sameCategory } = await getRelatedProducts(product);
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
            <ProductCard
              product={item}
              category={categories.find(
                (category) => category.slug === item.category,
              )}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
