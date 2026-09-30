import { CategoryCard } from "@/components/category/CategoryCard";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type { Category } from "@/types";
import { cx } from "@/lib/cx";
import styles from "./CategoriesSection.module.css";

interface CategoriesSectionProps {
  categories: readonly Category[];
}

/** Homepage section listing every product category. */
export function CategoriesSection({ categories }: CategoriesSectionProps) {
  return (
    <section
      id="categories"
      className={cx("section", styles.section)}
      aria-labelledby="categories-heading"
    >
      <div className="container">
        <SectionHeading
          id="categories-heading"
          eyebrow="Categories"
          title="Explore by category"
          description="Eight focused categories covering everything from core systems to complete game kits."
        />
        <div className="category-grid">
          {categories.map((category) => (
            <CategoryCard key={category.id} category={category} />
          ))}
        </div>
      </div>
    </section>
  );
}
