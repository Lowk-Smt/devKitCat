import "server-only";

import { unstable_cache } from "next/cache";

import { listCategories, listProducts } from "./data-access";

/**
 * Cached reads for the **public** marketplace catalog.
 *
 * Every marketplace render (`/`, `/products`, product detail) used to run its
 * own Prisma round trips against Neon on each request, so navigating to
 * `/products` paid the full remote-database latency every single time. The
 * catalog is the same for every visitor and only changes when it is reseeded,
 * which makes it safe to cache server-side.
 *
 * This project does not use Cache Components (`cacheComponents` is not
 * enabled), so this stays on the previous caching model with `unstable_cache`:
 * an in-memory entry shared across requests, revalidated after a short TTL.
 * The 60 second window bounds how long a freshly seeded catalog can lag while
 * still removing the database round trip from nearly every marketplace render.
 *
 * Customer-scoped reads (orders, downloads, cart) live in
 * `src/lib/server/auth.ts` + `src/lib/server/data-access.ts` and are
 * deliberately NOT wrapped here: they vary per session and must stay private.
 */
export const CATALOG_CACHE_TAG = "catalog";

/** How long a cached catalog read may be served before it is refreshed. */
export const CATALOG_REVALIDATE_SECONDS = 60;

const CACHE_OPTIONS: { tags: string[]; revalidate: number } = {
  tags: [CATALOG_CACHE_TAG],
  revalidate: CATALOG_REVALIDATE_SECONDS,
};

/** Every published product with the media/detail relations the UI renders. */
export const getCachedProducts = unstable_cache(
  async () => listProducts(),
  ["devkitcat-catalog-products"],
  CACHE_OPTIONS,
);

/** The category list that backs the marketplace filter chips. */
export const getCachedCategories = unstable_cache(
  async () => listCategories(),
  ["devkitcat-catalog-categories"],
  CACHE_OPTIONS,
);
