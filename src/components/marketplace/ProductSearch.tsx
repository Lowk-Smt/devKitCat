"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/Icon";
import styles from "./ProductSearch.module.css";

interface ProductSearchProps {
  /** Current query, as stored in the URL. */
  value: string;
  onChange: (query: string) => void;
}

/**
 * Search box. Uncontrolled while typing (so the caret never jumps while the
 * URL catches up) and re-synced from `value` when the query changes from
 * outside, e.g. "Clear filters" or following a link — unless the user is
 * currently typing in it.
 */
export function ProductSearch({ value, onChange }: ProductSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (input && input.value !== value && document.activeElement !== input) {
      input.value = value;
    }
  }, [value]);

  return (
    <form
      role="search"
      className={styles.search}
      onSubmit={(event) => event.preventDefault()}
    >
      <label htmlFor="product-search" className="sr-only">
        Search products
      </label>
      <Icon name="search" size={18} className={styles.icon} />
      <input
        ref={inputRef}
        id="product-search"
        type="search"
        name="q"
        className={styles.input}
        placeholder="Search products"
        defaultValue={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </form>
  );
}
