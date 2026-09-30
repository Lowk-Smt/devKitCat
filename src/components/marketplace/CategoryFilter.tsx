import { categories } from "@/data/categories";
import { cx } from "@/lib/cx";
import styles from "./CategoryFilter.module.css";

interface CategoryFilterProps {
  /** Active category slug, or `undefined` for all. */
  value: string | undefined;
  onChange: (category: string | undefined) => void;
  /** Product count per category slug (reflects the current search). */
  counts: Record<string, number>;
  totalCount: number;
}

/** Category chips. Toggle buttons, so state is exposed via `aria-pressed`. */
export function CategoryFilter({
  value,
  onChange,
  counts,
  totalCount,
}: CategoryFilterProps) {
  return (
    <div
      role="group"
      aria-label="Filter by category"
      className={styles.filters}
    >
      <Chip
        label="All"
        count={totalCount}
        active={value === undefined}
        onClick={() => onChange(undefined)}
      />
      {categories.map((category) => (
        <Chip
          key={category.id}
          label={category.name}
          count={counts[category.slug] ?? 0}
          active={value === category.slug}
          onClick={() => onChange(category.slug)}
        />
      ))}
    </div>
  );
}

interface ChipProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

function Chip({ label, count, active, onClick }: ChipProps) {
  return (
    <button
      type="button"
      className={cx(styles.chip, active && styles.chipActive)}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
      <span className={styles.count} aria-label={`${count} products`}>
        {count}
      </span>
    </button>
  );
}
