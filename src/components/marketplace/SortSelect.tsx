import { SORT_OPTIONS, type SortOption } from "@/lib/catalog";
import styles from "./SortSelect.module.css";

interface SortSelectProps {
  value: SortOption;
  onChange: (sort: SortOption) => void;
}

/** Native select (best keyboard / screen reader / mobile support). */
export function SortSelect({ value, onChange }: SortSelectProps) {
  return (
    <div className={styles.field}>
      <label htmlFor="product-sort" className={styles.label}>
        Sort by
      </label>
      <select
        id="product-sort"
        className={styles.select}
        value={value}
        onChange={(event) => {
          const option = SORT_OPTIONS.find(
            (item) => item.value === event.target.value,
          );
          if (option) onChange(option.value);
        }}
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
