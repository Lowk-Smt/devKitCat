import {
  categories as defaultCategories,
  getCategoryBySlug,
} from "@/data/categories";
import type { Category, Product, ProductType } from "@/types";

/** Human-readable labels for each product type. */
export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  system: "System",
  "ui-kit": "UI Kit",
  "starter-kit": "Starter Kit",
  "model-pack": "Model Pack",
  "vfx-pack": "VFX Pack",
};

/** Formats a USD price, e.g. `14.99` → `$14.99`. */
export function formatPrice(price: number): string {
  return price.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/** Formats an ISO date (YYYY-MM-DD), e.g. `2026-08-14` → `Aug 14, 2026`. */
export function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/* Marketplace browsing: search, category filter, and sorting
   ------------------------------------------------------------------ */

export const SORT_OPTIONS = [
  { value: "featured", label: "Featured" },
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
] as const;

export type SortOption = (typeof SORT_OPTIONS)[number]["value"];

export const DEFAULT_SORT: SortOption = "featured";

/** Narrows an untrusted value (e.g. a URL param) to a known sort option. */
export function parseSort(value: string | null | undefined): SortOption {
  return (
    SORT_OPTIONS.find((option) => option.value === value)?.value ?? DEFAULT_SORT
  );
}

export interface ProductFilters {
  /** Free-text search across title, description, category, and type. */
  query: string;
  /** Category slug, or `undefined` for all categories. */
  category: string | undefined;
  sort: SortOption;
}

/** Fields the browsing helpers need, so they work with any product shape. */
type BrowsableProduct = Pick<
  Product,
  | "title"
  | "description"
  | "category"
  | "type"
  | "price"
  | "releasedAt"
  | "isFeatured"
>;

function normalize(text: string): string {
  return text
    .toLocaleLowerCase("en-US")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
}

function searchText(
  product: BrowsableProduct,
  categoryList: readonly Category[],
): string {
  const categoryName =
    categoryList.find((category) => category.slug === product.category)?.name ??
    getCategoryBySlug(product.category)?.name ??
    "";
  return normalize(
    [
      product.title,
      product.description,
      categoryName,
      product.category,
      PRODUCT_TYPE_LABELS[product.type],
    ].join(" "),
  );
}

/** True when every whitespace-separated search term appears in the product. */
export function matchesQuery(
  product: BrowsableProduct,
  query: string,
  categoryList: readonly Category[] = defaultCategories,
): boolean {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = searchText(product, categoryList);
  return terms.every((term) => haystack.includes(term));
}

function compareProducts(
  a: BrowsableProduct,
  b: BrowsableProduct,
  sort: SortOption,
): number {
  switch (sort) {
    case "featured":
      return Number(b.isFeatured) - Number(a.isFeatured);
    case "newest":
      return b.releasedAt.localeCompare(a.releasedAt);
    case "price-asc":
      return a.price - b.price;
    case "price-desc":
      return b.price - a.price;
  }
}

/**
 * Applies search, category, and sort together. Sorting is stable, so ties
 * keep the catalog's curated order.
 */
export function filterAndSortProducts<T extends BrowsableProduct>(
  items: readonly T[],
  { query, category, sort }: ProductFilters,
  categoryList: readonly Category[] = defaultCategories,
): T[] {
  return items
    .filter((product) => !category || product.category === category)
    .filter((product) => matchesQuery(product, query, categoryList))
    .sort((a, b) => compareProducts(a, b, sort));
}
