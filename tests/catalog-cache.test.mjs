import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  // Guard the wiring, not examples or API names mentioned in comments.
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("/#categories shares both public catalog reads with /products", async () => {
  // Categories is a homepage anchor, not a separate /categories route.
  const page = await readSource("../src/app/page.tsx");

  assert.match(page, /from "@\/lib\/server\/catalog-cache"/);
  assert.match(page, /await connection\(\)/);
  assert.match(
    page,
    /const \[categories, products\] = await Promise\.all\(\[\s*getCachedCategories\(\),\s*getCachedProducts\(\),?\s*\]\)/,
  );
  // An uncached featured-product read would still block the Categories section.
  assert.doesNotMatch(page, /from "@\/lib\/server\/data-access"|\blist(?:Categories|Products)\(/);
  assert.match(page, /<CategoriesSection categories=\{categories\}/);
  // Filter on the server without mutating the shared catalog or changing order.
  assert.match(page, /const featuredProducts = products\.filter\(\(product\) => product\.isFeatured\)/);
  assert.match(page, /<FeaturedProductsSection\s+products=\{featuredProducts\}\s+categories=\{categories\}/);
});

test("both public catalog entries retain the shared tag, keys and 60-second revalidation", async () => {
  const cache = await readSource("../src/lib/server/catalog-cache.ts");

  assert.match(cache, /import "server-only"/);
  assert.match(cache, /export const CATALOG_CACHE_TAG = "catalog"/);
  assert.match(cache, /export const CATALOG_REVALIDATE_SECONDS = 60/);
  assert.match(cache, /tags: \[CATALOG_CACHE_TAG\]/);
  assert.match(cache, /revalidate: CATALOG_REVALIDATE_SECONDS/);
  for (const [reader, key] of [["Products", "products"], ["Categories", "categories"]]) {
    assert.match(
      cache,
      new RegExp(`getCached${reader} = unstable_cache\\(\\s*async \\(\\) => list${reader}\\(\\),\\s*\\["devkitcat-catalog-${key}"\\],\\s*CACHE_OPTIONS,?\\s*\\)`),
    );
  }
});

test("existing product writes immediately expire the tag used by the Categories destination", async () => {
  const actions = await readSource("../src/lib/server/product-admin-actions.ts");

  assert.match(actions, /import \{ CATALOG_CACHE_TAG \} from "\.\/catalog-cache"/);
  assert.match(actions, /function refreshCatalogCache\(\): void \{\s*updateTag\(CATALOG_CACHE_TAG\)/);
  assert.match(actions, /function done\([^)]*\): void \{\s*refreshCatalogCache\(\)/);
});

test("/products reads the public catalog through the shared cache layer", async () => {
  const page = await readSource("../src/app/products/page.tsx");

  assert.match(page, /from "@\/lib\/server\/catalog-cache"/);
  assert.match(page, /getCachedProducts\(\)/);
  assert.match(page, /getCachedCategories\(\)/);
  // The two reads stay parallel even when they hit the cache.
  assert.match(page, /Promise\.all\(\[/);
  // The page must not fall back to an uncached direct read.
  assert.doesNotMatch(page, /from "@\/lib\/server\/data-access"/);
});

test("the catalog cache only wraps public marketplace reads", async () => {
  const cache = await readSource("../src/lib/server/catalog-cache.ts");

  assert.match(cache, /unstable_cache/);
  assert.match(cache, /revalidate:/);
  assert.match(cache, /listProducts/);
  assert.match(cache, /listCategories/);

  // Customer-specific data must never be served from a shared cache entry.
  assert.doesNotMatch(
    cache,
    /listCustomerOrders|getCustomerOrderById|listCustomerDownloads|Cart/,
  );
});

test("/products keeps an instant loading boundary for the dynamic render", async () => {
  const loading = await readSource("../src/app/products/loading.tsx");

  assert.match(loading, /export default function/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /role="status"/);
});
