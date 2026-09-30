import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { Category } from "@/types";
import styles from "./CategoryCard.module.css";

interface CategoryCardProps {
  category: Category;
}

/** Reusable category card, rendered from category data. */
export function CategoryCard({ category }: CategoryCardProps) {
  return (
    <Link
      href={`/products?category=${category.slug}`}
      className={styles.card}
      aria-label={`Browse ${category.name} products`}
    >
      <span className={styles.iconWrap}>
        <Icon name={category.icon} size={22} />
      </span>
      <span className={styles.content}>
        <span className={styles.name}>{category.name}</span>
        <span className={styles.description}>{category.description}</span>
      </span>
      <Icon name="arrow-right" size={16} className={styles.arrow} />
    </Link>
  );
}
