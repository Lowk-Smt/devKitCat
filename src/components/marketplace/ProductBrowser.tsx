"use client";

import { useMemo } from "react";
import { CategoryFilter } from "@/components/marketplace/CategoryFilter";
import { ProductSearch } from "@/components/marketplace/ProductSearch";
import { SortSelect } from "@/components/marketplace/SortSelect";
import { useProductFilters } from "@/components/marketplace/useProductFilters";
import { ProductCard } from "@/components/product/ProductCard";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { filterAndSortProducts, matchesQuery } from "@/lib/catalog";
import type { Category, Product } from "@/types";
import styles from "./ProductBrowser.module.css";

interface ProductBrowserProps {
  products: Product[];
  categories: Category[];
}

/**
 * The marketplace's interactive browsing experience: search, category filter,
 * and sorting all combine, and all live in the URL.
 */
export function ProductBrowser({ products, categories }: ProductBrowserProps) {
  const { filters, hasActiveFilters, setQuery, setCategory, setSort, reset } =
    useProductFilters(categories);

  const results = useMemo(
    () => filterAndSortProducts(products, filters, categories),
    [products, filters, categories],
  );

  // Category chip counts follow the search, so they match what you'd get.
  const counts = useMemo(() => {
    const searched = products.filter((product) =>
      matchesQuery(product, filters.query, categories),
    );
    return Object.fromEntries(
      categories.map((category) => [
        category.slug,
        searched.filter((product) => product.category === category.slug).length,
      ]),
    );
  }, [products, filters.query, categories]);

  const activeCategory = filters.category
    ? categories.find((category) => category.slug === filters.category)
    : undefined;
  const trimmedQuery = filters.query.trim();

  return (
    <div>
      <div className={styles.controls}>
        <div className={styles.toolbar}>
          <ProductSearch value={filters.query} onChange={setQuery} />
          <SortSelect value={filters.sort} onChange={setSort} />
        </div>
        <CategoryFilter
          categories={categories}
          value={filters.category}
          onChange={setCategory}
          counts={counts}
          totalCount={Object.values(counts).reduce(
            (sum, count) => sum + count,
            0,
          )}
        />
      </div>

      <h2 className="sr-only">Product results</h2>
      <div className={styles.summary}>
        <p className={styles.count} role="status">
          <strong>{results.length}</strong>{" "}
          {results.length === 1 ? "product" : "products"}
          {activeCategory ? <> in {activeCategory.name}</> : null}
          {trimmedQuery ? <> matching “{trimmedQuery}”</> : null}
        </p>
        {hasActiveFilters ? (
          <button type="button" className={styles.clear} onClick={reset}>
            Clear filters
          </button>
        ) : null}
      </div>

      {results.length > 0 ? (
        <ul className={styles.grid}>
          {results.map((product) => (
            <li key={product.id} className={styles.gridItem}>
              <ProductCard
                product={product}
                category={categories.find(
                  (category) => category.slug === product.category,
                )}
              />
            </li>
          ))}
        </ul>
      ) : (
        <NoResults
          hasProducts={products.length > 0}
          categoryName={activeCategory?.name}
          query={trimmedQuery}
          onReset={reset}
        />
      )}
    </div>
  );
}

interface NoResultsProps {
  hasProducts: boolean;
  categoryName: string | undefined;
  query: string;
  onReset: () => void;
}

function NoResults({
  hasProducts,
  categoryName,
  query,
  onReset,
}: NoResultsProps) {
  if (!hasProducts) {
    return (
      <EmptyState
        icon="systems"
        title="No products yet"
        description="The catalog is empty right now. New resources are added regularly — check back soon."
      />
    );
  }

  if (query) {
    return (
      <EmptyState
        icon="search"
        title={`No results for “${query}”`}
        description={
          categoryName
            ? `Nothing in ${categoryName} matches your search. Try different keywords, or search all categories.`
            : "Try different keywords, or check the spelling."
        }
        action={
          <Button variant="secondary" size="sm" onClick={onReset}>
            Clear filters
          </Button>
        }
      />
    );
  }

  return (
    <EmptyState
      icon="templates"
      title={`No ${categoryName ?? "matching"} products yet`}
      description="New resources are added regularly. Check back soon, or browse everything in the catalog."
      action={
        <Button variant="secondary" size="sm" onClick={onReset}>
          Show all products
        </Button>
      }
    />
  );
}
