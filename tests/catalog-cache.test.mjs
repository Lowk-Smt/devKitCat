import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

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
