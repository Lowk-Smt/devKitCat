"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { categories as defaultCategories } from "@/data/categories";
import type { Category } from "@/types";
import {
  DEFAULT_SORT,
  parseSort,
  type ProductFilters,
  type SortOption,
} from "@/lib/catalog";

/** URL parameter names: `/products?q=data&category=systems&sort=price-asc`. */
const PARAMS = { query: "q", category: "category", sort: "sort" } as const;

type HistoryMode = "push" | "replace";

/**
 * Marketplace filters, with the URL as the single source of truth so every
 * view is shareable and works with the back button. Invalid or unknown URL
 * values fall back to defaults.
 *
 * Updates use the native History API, which Next.js integrates with
 * `useSearchParams` — no server round trip for what is purely client-side
 * filtering of local data.
 */
export function useProductFilters(
  availableCategories: readonly Category[] = defaultCategories,
) {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const rawQuery = searchParams.get(PARAMS.query) ?? "";
  const rawCategory = searchParams.get(PARAMS.category);
  const rawSort = searchParams.get(PARAMS.sort);

  const filters = useMemo<ProductFilters>(
    () => ({
      query: rawQuery,
      category:
        rawCategory &&
        availableCategories.some((category) => category.slug === rawCategory)
          ? rawCategory
          : undefined,
      sort: parseSort(rawSort),
    }),
    [rawQuery, rawCategory, rawSort, availableCategories],
  );

  const update = useCallback(
    (patch: Partial<ProductFilters>, mode: HistoryMode) => {
      const next = { ...filters, ...patch };
      const params = new URLSearchParams();
      if (next.query.trim()) params.set(PARAMS.query, next.query);
      if (next.category) params.set(PARAMS.category, next.category);
      if (next.sort !== DEFAULT_SORT) params.set(PARAMS.sort, next.sort);

      const search = params.toString();
      const url = search ? `${pathname}?${search}` : pathname;
      if (mode === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [filters, pathname],
  );

  return {
    filters,
    hasActiveFilters: Boolean(filters.query.trim() || filters.category),
    // Typing rewrites the current history entry instead of adding one per key.
    setQuery: (query: string) => update({ query }, "replace"),
    setCategory: (category: string | undefined) => update({ category }, "push"),
    setSort: (sort: SortOption) => update({ sort }, "push"),
    /** Clears search and category, keeping the chosen sort order. */
    reset: () => update({ query: "", category: undefined }, "push"),
  };
}
